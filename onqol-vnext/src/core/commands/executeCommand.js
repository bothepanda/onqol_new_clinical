import { COMMAND, validateCommand } from "./commandTypes.js";
import { EVENT } from "../events/eventTypes.js";
import { createEvent } from "../events/eventLog.js";
import { hospitalIso, hospitalHour } from "../time/clock.js";
import { advanceTime } from "../time/advanceTime.js";
import { schedulePending } from "../time/scheduler.js";
import { resolveResource, callStaff } from "../hospital/resourceResolution.js";
import { constraintForCapability } from "../hospital/dynamicConstraints.js";
import { buildLearnerVisibleState } from "../state/learnerView.js";
import { eligibleRules, governanceBlockedEligibleRules } from "../rules/ruleEngine.js";
import { isRuntimeAuthoritative } from "../rules/governance.js";
import { reviewStatusOf, authorityLayerOf, jurisdictionOf } from "../rules/contentProvenance.js";
import { appliesInJurisdiction } from "../hospital/hospitalProfiles.js";
import { LIMITATION_REASON_NOT_MODELED, simulatorLimitation } from "../rules/governance.js";
import { normalizeReasoningDelta, REASONING_SCHEMA_VERSION } from "../reasoning/reasoningState.js";
import { isInteractionV2Enabled } from "../../ai/interaction/featureFlags.js";
import { contentConditionsMet } from "../rules/contentConditions.js";
import { validateMedicationOrder, evaluateProphylaxisAtMinute } from "../rules/medicationOrderValidation.js";

/**
 * Executing one validated command against the current world.
 *
 * Return shape is always the same:
 *
 *   { outcome: "EXECUTED", events }
 *   { outcome: "CLARIFY", missing }                 -- Core Runtime Spec §48
 *   { outcome: "STAFF_CLARIFICATION", staffRole, ... } -- Contract §10
 *   { outcome: "SAFETY_STOP", ruleId, teachingPointRu }-- Mentor Spec §6.6
 *   { outcome: "UNSUPPORTED_CONTENT", capabilityKey }  -- Core Runtime Spec §50
 *   { outcome: "UNAVAILABLE_RESOURCE", reasonKey }      -- Core Runtime Spec §50
 *   { outcome: "PREOP_NOT_READY", missingItems }        -- Core Runtime Spec §58
 *
 * Every branch that fires a Level-3/4 rule goes through the rule engine
 * first, evaluated against `buildLearnerVisibleState` - never against
 * `state.truth` - so a safety stop can never leak a hidden fact as a side
 * effect of blocking an action. `eligibleRules` already applies the runtime
 * governance gate (`core/rules/governance.js`): a clinically-eligible but
 * not-`approved_for_training` rule can never reach `blocking` or
 * `firedNonBlocking` below. `governanceBlockedEligibleRules` still records
 * what was excluded, for the causal/audit trail - never for authority.
 */
export function executeCommand({ state, clockRoot, bundle, rng, patient, command, turnContext = {} }) {
  const validation = validateCommand(command);
  if (validation.outcome === "CLARIFY") {
    return { outcome: "CLARIFY", missing: validation.missing, command };
  }

  // Rules are evaluated BEFORE any structural gate below, so that (a) an
  // approved Level-4 rule still outranks everything, and (b) the
  // governance-blocked audit trail is recorded on every path, including the
  // ones that stop the command for a non-clinical reason.
  const learnerVisible = buildLearnerVisibleState(state);
  const rules = bundle.rules.rules ?? [];
  const ruleContext = { state, learnerVisible, command, bundle };
  const fired = eligibleRules(rules, ruleContext);
  const governanceBlocked = governanceBlockedEligibleRules(rules, ruleContext);
  const blocking = fired.find((rule) => rule.level === "LEVEL_4_CATASTROPHIC");
  if (blocking) {
    return { outcome: "SAFETY_STOP", ruleId: blocking.id, teachingPointRu: blocking.teaching_point_ru, command, governanceBlocked };
  }

  // Core Architecture Contract §58: readiness for an irreversible step is
  // real tracked state, not a conversational keyword. This is a workflow
  // invariant intrinsic to the architecture, independent of any specific
  // clinical content item's review status - which is why it still holds
  // while the consent safety rule itself is governance-blocked.
  if (command.type === COMMAND.START_PROCEDURE) {
    const prophylaxis = evaluateProphylaxisAtMinute({ policy: bundle.operative?.antibiotic_prophylaxis, state });
    const missingItems = state.preop.required
      .filter((item) => item.blocking && !state.preop.completed.includes(item.id))
      .map((item) => item.id);
    if (!prophylaxis.complete && state.preop.required.some((item) => item.id === "antibiotic_prophylaxis")) {
      if (!missingItems.includes("antibiotic_prophylaxis")) missingItems.push("antibiotic_prophylaxis");
    }
    if (!state.preop.ready || missingItems.length > 0) {
      return { outcome: "PREOP_NOT_READY", missingItems, command, governanceBlocked };
    }
  }
  if (isImpossiblePostoperativeRoute(state, command)) {
    return {
      outcome: "DISPOSITION_NOT_READY",
      blockers: [{ reasonRu: "Послеоперационный маршрут доступен только после завершения операции." }],
      command,
      governanceBlocked,
    };
  }
  // Level 2/3 rules do not block execution by default (Contract §18) - they
  // are surfaced to the mentor layer as candidate teaching moments and still
  // let the handler run. `firedNonBlocking` rides along on the result so the
  // mentor step can choose whether to CHALLENGE.
  const firedNonBlocking = fired.filter((rule) => rule.level !== "LEVEL_4_CATASTROPHIC");

  const handler = HANDLERS[command.type];
  if (!handler) return { outcome: "UNSUPPORTED_CONTENT", capabilityKey: command.type, command };

  const result = handler({ state, clockRoot, bundle, rng, patient, command, turnContext });
  return { ...result, command, firedRules: firedNonBlocking, governanceBlocked };
}

const nowIso = (clockRoot, state) => hospitalIso(clockRoot, state.clock.elapsedMinutes);

const HANDLERS = {
  [COMMAND.TAKE_HISTORY]: ({ state, clockRoot }) => ({
    outcome: "EXECUTED",
    events: [
      createEvent({
        type: EVENT.HISTORY_OBTAINED,
        atMinutes: state.clock.elapsedMinutes,
        atIso: nowIso(clockRoot, state),
        payload: { bundleId: "core_history", findingIds: ["history.core"] },
        cause: { actor: "learner" },
      }),
    ],
  }),

  [COMMAND.ASK_PATIENT]: ({ state, clockRoot, bundle, patient, command }) => {
    const answerRu = patientAnswerFor(command.params.topic, patient, bundle);
    if (!answerRu) {
      return { outcome: "UNSUPPORTED_CONTENT", capabilityKey: `patient_question:${command.params.topic}` };
    }
    return {
      outcome: "EXECUTED",
      events: [
        createEvent({
          type: EVENT.PATIENT_QUESTION_ANSWERED,
          atMinutes: state.clock.elapsedMinutes,
          atIso: nowIso(clockRoot, state),
          payload: {
            topic: command.params.topic,
            answerRu,
            findingIds: [`history.${command.params.topic}`],
          },
          cause: { actor: "learner", commandId: command.id },
        }),
      ],
    };
  },

  [COMMAND.EXAMINE]: ({ state, clockRoot, bundle, command }) => {
    // A region may also yield a measurement (perfusion -> capillary refill);
    // content declares which under `findings.observation_targets`.
    const observed = observedFor(bundle, state, [command.params.region]);
    const measured = observed && Object.keys(observed).length > 0;
    return {
      outcome: "EXECUTED",
      events: [
        createEvent({
          type: EVENT.EXAMINATION_PERFORMED,
          atMinutes: state.clock.elapsedMinutes,
          atIso: nowIso(clockRoot, state),
          payload: { region: command.params.region, findingIds: [`exam.${command.params.region}`], ...(measured ? { observed } : {}) },
          cause: { actor: "learner", commandId: command.id },
        }),
        ...(measured
          ? [createEvent({
              type: EVENT.VITALS_OBSERVED,
              atMinutes: state.clock.elapsedMinutes,
              atIso: nowIso(clockRoot, state),
              payload: { findingIds: [`vitals.${command.params.region}`], observed },
              cause: { actor: "learner", commandId: command.id },
            })]
          : []),
      ],
    };
  },

  [COMMAND.REQUEST_STATUS]: () => ({ outcome: "EXECUTED", events: [] }), // pure read; renderer handles it

  [COMMAND.WAIT]: ({ command, turnContext }) => ({
    outcome: command.params.untilNextPending === true && turnContext.waitTargetMinutes == null ? "NO_PENDING_WORK" : "EXECUTED",
    events: [],
  }),

  [COMMAND.ORDER_TEST]: ({ state, clockRoot, bundle, command, patient }) => {
    const timing = bundle.trajectories.investigation_timing[command.params.testId];
    if (!timing) {
      // An investigation with no modeled result in this case (a recognised name such
      // as pelvic ultrasound, or any unmodeled id). It is a SIMULATOR LIMITATION -
      // recorded as one, classified as one in the trail, never a learner error and
      // never answered with a substitute study.
      return {
        outcome: "UNSUPPORTED_CONTENT",
        capabilityKey: `test:${command.params.testId}`,
        classification: "simulator_limitation",
        events: [
          createEvent({
            type: EVENT.SIMULATOR_LIMITATION_NOTED,
            atMinutes: state.clock.elapsedMinutes,
            atIso: nowIso(clockRoot, state),
            payload: simulatorLimitation({ kind: "investigation_not_modeled", id: command.params.testId, reviewStatus: null, reason: LIMITATION_REASON_NOT_MODELED }),
            cause: { actor: "system", source: "content_coverage", commandId: command.id },
          }),
        ],
      };
    }

    // Wave §13: the same investigation is already in flight or already has a
    // result, and the learner did not EXPLICITLY ask for a repeat/serial test
    // ("повторить", "в динамике", "контроль") -> do not create a second copy.
    // This is an operational note, not a learner error (folded as
    // COMMAND_ACCEPTED, never COMMAND_REJECTED). An explicit
    // `params.repeat === true` always goes through.
    const existing = state.investigations[command.params.testId];
    if (existing && command.params.repeat !== true) {
      const phase = ["ordered", "in_progress", "preliminary"].includes(existing.status) ? "pending" : "resulted";
      return { outcome: "ALREADY_PENDING", command, testId: command.params.testId, phase };
    }

    // Matrix V07 / task §8: an investigation may declare a parameter the order
    // is incomplete without. "БХАК" is the case that matters - it used to
    // auto-populate a whole chemistry panel nobody asked for. The requirement
    // is CONTENT, not a branch on the string "chemistry", so any investigation
    // can declare one.
    if (timing.requires_parameter) {
      const supplied = command.params[timing.requires_parameter];
      if (!supplied || (Array.isArray(supplied) && supplied.length === 0)) {
        return {
          outcome: "CLARIFY",
          missing: [timing.requires_parameter],
          clarifyPromptRu: timing.clarify_prompt_ru ?? null,
          clarifyBy: "laboratory",
          command,
        };
      }
    }

    // Matrix I12 / task §10: a department policy, never a universal medical
    // contraindication. Off in every shipped profile; when a site turns it on,
    // the refusal is spoken by RADIOLOGY as a local workflow fact and is
    // recorded with `authority_layer: hospital_rule` so the debrief cannot
    // present it as evidence-based medicine.
    const contrastBlock = contrastPolicyBlock({ state, testId: command.params.testId });
    if (contrastBlock) return { ...contrastBlock, command };

    const capabilityKey = TEST_CAPABILITY[command.params.testId] ?? "laboratory";
    const resolution = resolveResource({
      hospital: state.hospital,
      capabilityKey,
      clock: { hospitalHour: hospitalHour(clockRoot, state.clock.elapsedMinutes) },
    });
    if (resolution.status !== "available") {
      if (resolution.status === "unsupported_content") return { outcome: "UNSUPPORTED_CONTENT", capabilityKey };
      // Running into a constraint is how it becomes known (task brief §12.3):
      // the world discloses the real operational reason at the moment it
      // blocks the learner, and only then does it enter the sidebar.
      return {
        outcome: "UNAVAILABLE_RESOURCE",
        reasonKey: resolution.reasonKey,
        capabilityKey,
        events: buildConstraintDisclosure({ state, clockRoot, capabilityKey, reasonKey: resolution.reasonKey, command }),
      };
    }

    const etaMinutes = timing.etaMinutes + resolution.etaMinutes;
    const scheduledPending = [
      ...buildTestSchedule(command, timing, state, patient, bundle, etaMinutes, resolution.etaMinutes),
      // A preoperative requirement that IS an investigation (the KZ ABO/Rh and
      // coagulation items) completes when its result lands, not when the
      // learner says the word. Content declares the link via
      // `investigation_id`; nothing here knows what a blood group is.
      ...preopItemsSatisfiedBy(command, bundle, state, etaMinutes),
    ];
    const orderedEvent = createEvent({
      type: EVENT.TEST_ORDERED,
      atMinutes: state.clock.elapsedMinutes,
      atIso: nowIso(clockRoot, state),
      payload: {
        investigationId: command.params.testId,
        testId: command.params.testId,
        analytes: command.params.analytes ?? null,
        etaMinutes,
        scheduledPending,
      },
      cause: { actor: "learner", commandId: command.id },
    });

    return { outcome: "EXECUTED", events: [orderedEvent] };
  },

  [COMMAND.ORDER_MEDICATION]: ({ state, clockRoot, bundle, command, rng }) => {
    // Core Runtime Spec §50's three-way distinction, for medications: a drugId
    // absent from the reviewed formulary is `unsupported_content` - never
    // reported to the learner as a hospital stock-out (Contract §50.2).
    const known = bundle.shared?.medications?.medications?.[command.params.drugId];
    if (!known) return { outcome: "UNSUPPORTED_CONTENT", capabilityKey: `medication:${command.params.drugId}` };
    const validation = validateMedicationOrder({ medication: known, command, state });
    if (!validation.ok) return { outcome: "ORDER_VALIDATION_FAILED", ...validation };

    const effectPending = scheduleGovernedTreatmentEffect({
      bundle,
      state,
      command,
      matchKey: "drugId",
      matchValue: command.params.drugId,
      route: command.params.route,
      rng,
    });

    return {
      outcome: "EXECUTED",
      events: [
        createEvent({
          type: EVENT.MEDICATION_ORDERED,
          atMinutes: state.clock.elapsedMinutes,
          atIso: nowIso(clockRoot, state),
          payload: { orderId: command.id, ...command.params },
          cause: { actor: "learner", commandId: command.id },
        }),
        createEvent({
          type: EVENT.MEDICATION_ADMINISTERED,
          atMinutes: state.clock.elapsedMinutes,
          atIso: nowIso(clockRoot, state),
          payload: { orderId: command.id, ...command.params, scheduledPending: effectPending },
          cause: { actor: "learner", commandId: command.id },
        }),
      ],
    };
  },

  [COMMAND.ORDER_INFUSION]: ({ state, clockRoot, bundle, command, rng }) => {
    const known = bundle.shared?.medications?.fluids?.[command.params.fluidId];
    if (!known) return { outcome: "UNSUPPORTED_CONTENT", capabilityKey: `fluid:${command.params.fluidId}` };
    const durationMinutes = command.params.durationMinutes ?? 0;
    const effectPending = scheduleGovernedTreatmentEffect({
      bundle,
      state,
      command,
      matchKey: "fluidId",
      matchValue: command.params.fluidId,
      route: "iv",
      rng,
    });
    const scheduledPending = [
      ...(durationMinutes
        ? [{ id: `${command.id}::infusion`, kind: "infusion_complete", orderId: command.id, dueAtMinutes: state.clock.elapsedMinutes + durationMinutes }]
        : []),
      ...effectPending,
    ];
    return {
      outcome: "EXECUTED",
      events: [
        createEvent({
          type: EVENT.INFUSION_STARTED,
          atMinutes: state.clock.elapsedMinutes,
          atIso: nowIso(clockRoot, state),
          payload: { orderId: command.id, ...command.params, scheduledPending },
          cause: { actor: "learner", commandId: command.id },
        }),
      ],
    };
  },

  [COMMAND.PRESCRIBE_MONITORING]: ({ state, clockRoot, command }) => ({
    outcome: "EXECUTED",
    events: [
      createEvent({
        type: EVENT.MONITORING_PRESCRIBED,
        atMinutes: state.clock.elapsedMinutes,
        atIso: nowIso(clockRoot, state),
        payload: { level: command.params.level ?? "ward_standard", parameters: command.params.targets ?? [] },
        cause: { actor: "learner", commandId: command.id },
      }),
    ],
  }),

  [COMMAND.REASSESS]: ({ state, clockRoot, bundle, command }) => {
    // Content that declares `observation_targets` discloses only the fields a
    // target actually measures; content that doesn't (appendicitis) keeps the
    // original whole-snapshot behaviour.
    const observed = observedFor(bundle, state, command.params.targets ?? []);
    const targeted = observed !== undefined;
    return {
      outcome: "EXECUTED",
      events: [
        createEvent({
          type: EVENT.PATIENT_REASSESSED,
          atMinutes: state.clock.elapsedMinutes,
          atIso: nowIso(clockRoot, state),
          payload: { region: "reassessment", findingIds: ["reassessment"], targets: command.params.targets, ...(targeted ? { observed } : {}) },
          cause: { actor: "learner", commandId: command.id },
        }),
        ...(!targeted || Object.keys(observed).length > 0
          ? [createEvent({
              type: EVENT.VITALS_OBSERVED,
              atMinutes: state.clock.elapsedMinutes,
              atIso: nowIso(clockRoot, state),
              payload: { findingIds: ["vitals.reassessment"], ...(targeted ? { observed } : {}) },
              cause: { actor: "learner", commandId: command.id },
            })]
          : []),
      ],
    };
  },

  [COMMAND.STATE_REASONING]: ({ state, clockRoot, command }) => ({
    outcome: "EXECUTED",
    events: [
      createEvent({
        type: EVENT.REASONING_STATED,
        atMinutes: state.clock.elapsedMinutes,
        atIso: nowIso(clockRoot, state),
        payload: isInteractionV2Enabled(state.session)
          ? {
              schemaVersion: REASONING_SCHEMA_VERSION,
              delta: normalizeReasoningDelta({
                ...command.params,
                text: command.params.text ?? command.sourceText,
              }),
              evidenceSpans: command.params.evidenceSpans ?? [command.sourceText].filter(Boolean),
            }
          : { ...command.params },
        cause: { actor: "learner", commandId: command.id },
      }),
    ],
  }),

  [COMMAND.CALL_STAFF]: ({ state, clockRoot, command }) => {
    const resolution = callStaff({ hospital: state.hospital, role: command.params.role });
    if (resolution.status === "unsupported_content") return { outcome: "UNSUPPORTED_CONTENT", capabilityKey: `staff:${command.params.role}` };
    const scheduledPending = [
      { id: `${command.id}::arrival`, kind: "staff_arrival", role: command.params.role, dueAtMinutes: state.clock.elapsedMinutes + resolution.etaMinutes },
    ];
    return {
      outcome: "EXECUTED",
      events: [
        createEvent({
          type: EVENT.STAFF_CALLED,
          atMinutes: state.clock.elapsedMinutes,
          atIso: nowIso(clockRoot, state),
          payload: { role: command.params.role, etaMinutes: resolution.etaMinutes, scheduledPending },
          cause: { actor: "learner", commandId: command.id },
        }),
      ],
    };
  },

  [COMMAND.COMMIT_MANAGEMENT_PLAN]: ({ state, clockRoot, bundle, command }) => ({
    outcome: "EXECUTED",
    events: [
      createEvent({
        type: EVENT.MANAGEMENT_PLAN_COMMITTED,
        atMinutes: state.clock.elapsedMinutes,
        atIso: nowIso(clockRoot, state),
        payload: {
          intent: command.params.intent,
          // Matrix §13 / task §14: jurisdictional requirements apply only in a
          // hospital that declares that jurisdiction. A KZ ABO/Rh requirement
          // must never appear in a non-KZ hospital's preop list, and must never
          // be presented as universal medicine when it does appear.
          requiredPreop: applicablePreopRequirements(bundle, state.hospital),
        },
        cause: { actor: "learner", commandId: command.id },
      }),
    ],
  }),

  [COMMAND.OBTAIN_CONSENT]: ({ state, clockRoot, command }) => ({
    outcome: "EXECUTED",
    events: [
      createEvent({
        type: EVENT.CONSENT_OBTAINED,
        atMinutes: state.clock.elapsedMinutes,
        atIso: nowIso(clockRoot, state),
        payload: {},
        cause: { actor: "learner", commandId: command.id },
      }),
    ],
  }),

  // ---- Real preoperative actions (task brief P0-1 §4.1, P0-4) --------------
  // Each of these is a genuine clinical/workflow action the learner performs,
  // not a synthetic "mark preop item done" shortcut. `preop.ready` is derived
  // from these actually having happened (worldState.js#derivePreopReady).

  // Matrix PR01: ordering nil-by-mouth is a real order, and it is NOT the same
  // thing as having assessed when the patient last ate and drank. The old
  // handler completed a blocking `npo_status` preop item, which made "нулевой
  // стол" a magic word that unlocked the operating theatre. Now it prescribes
  // oral intake status, and the fasting ASSESSMENT is completed only by
  // actually obtaining the history (ASK_FASTING_HISTORY, or the
  // anesthesiologist on arrival).
  [COMMAND.SET_NPO]: ({ state, clockRoot, command }) => ({
    outcome: "EXECUTED",
    events: [
      createEvent({
        type: EVENT.ORAL_INTAKE_PRESCRIBED,
        atMinutes: state.clock.elapsedMinutes,
        atIso: nowIso(clockRoot, state),
        payload: { level: "nil_by_mouth" },
        cause: { actor: "learner", commandId: command.id },
      }),
    ],
  }),

  [COMMAND.ESTABLISH_IV_ACCESS]: ({ state, clockRoot, command }) => ({
    outcome: "EXECUTED",
    events: [
      createEvent({
        type: EVENT.PREOP_ITEM_COMPLETED,
        atMinutes: state.clock.elapsedMinutes,
        atIso: nowIso(clockRoot, state),
        payload: { itemId: "iv_access" },
        cause: { actor: "learner", commandId: command.id },
      }),
    ],
  }),

  // Matrix AB03 / task §16.1: "антибиотикопрофилактика" on its own is an
  // INTENT, not an order. The nurse asks which drug, what dose and by which
  // route; the system never fills any of the three in (`REQUIRED_PARAMS` in
  // commandTypes.js makes the incomplete command CLARIFY before it gets here).
  [COMMAND.GIVE_ANTIBIOTIC_PROPHYLAXIS]: ({ state, clockRoot, bundle, command }) => {
    const known = bundle.shared?.medications?.medications?.[command.params.drugId];
    if (!known) return { outcome: "UNSUPPORTED_CONTENT", capabilityKey: `medication:${command.params.drugId}` };
    const validation = validateMedicationOrder({ medication: known, command, state });
    if (!validation.ok) return { outcome: "ORDER_VALIDATION_FAILED", ...validation };
    const regimen = evaluateProphylaxisAtMinute({
      policy: bundle.operative?.antibiotic_prophylaxis,
      state,
      currentOrder: command,
    });
    const completionEvents = regimen.complete ? [
      createEvent({
        type: EVENT.PREOP_ITEM_COMPLETED,
        atMinutes: state.clock.elapsedMinutes,
        atIso: nowIso(clockRoot, state),
        payload: {
          itemId: "antibiotic_prophylaxis",
          administeredAtMinutes: state.clock.elapsedMinutes,
          regimenId: regimen.regimenId,
          timingValidated: true,
        },
        cause: { actor: "learner", commandId: command.id, ruleIds: ["ABX-PROPHYLAXIS-APP004-PILOT"] },
      }),
    ] : [];
    return {
      outcome: "EXECUTED",
      events: [
        createEvent({
          type: EVENT.MEDICATION_ADMINISTERED,
          atMinutes: state.clock.elapsedMinutes,
          atIso: nowIso(clockRoot, state),
          payload: { orderId: command.id, purpose: "prophylaxis", ...command.params },
          cause: { actor: "learner", commandId: command.id },
        }),
        ...completionEvents,
      ],
    };
  },

  // Anesthesia review is genuinely delayed until the anesthesiologist arrives
  // (Contract §13 - characters have realistic ETAs); this reuses the same
  // hospital-staff resolution CALL_STAFF uses, and schedules the preop item's
  // completion for the same due time as the arrival, so the two facts stay
  // consistent without anesthesia-specific core logic (the pending "kind" is
  // generic - see advanceTime.js).
  [COMMAND.REQUEST_ANESTHESIA_REVIEW]: ({ state, clockRoot, command }) => {
    const resolution = callStaff({ hospital: state.hospital, role: "anesthesiologist" });
    if (resolution.status === "unsupported_content") return { outcome: "UNSUPPORTED_CONTENT", capabilityKey: "staff:anesthesiologist" };
    const dueAtMinutes = state.clock.elapsedMinutes + resolution.etaMinutes;
    const scheduledPending = [
      { id: `${command.id}::arrival`, kind: "staff_arrival", role: "anesthesiologist", dueAtMinutes },
      { id: `${command.id}::preop_item`, kind: "preop_item_ready", itemId: "anesthesia_review", dueAtMinutes },
      // Matrix PR02/MR05: if the learner never asked when the patient last ate
      // or drank, the anesthesiologist obtains it. The information reaches the
      // case either way; the learner's omission still reaches the debrief.
      { id: `${command.id}::fasting`, kind: "fasting_discovery", dueAtMinutes },
    ];
    return {
      outcome: "EXECUTED",
      events: [
        createEvent({
          type: EVENT.STAFF_CALLED,
          atMinutes: state.clock.elapsedMinutes,
          atIso: nowIso(clockRoot, state),
          payload: { role: "anesthesiologist", etaMinutes: resolution.etaMinutes, scheduledPending },
          cause: { actor: "learner", commandId: command.id },
        }),
      ],
    };
  },

  [COMMAND.MOVE_PATIENT]: ({ state, clockRoot, command }) => ({
    outcome: "EXECUTED",
    events: [
      createEvent({
        type: EVENT.PATIENT_MOVED,
        atMinutes: state.clock.elapsedMinutes,
        atIso: nowIso(clockRoot, state),
        payload: { to: command.params.to, monitoringLevel: command.params.monitoringLevel },
        cause: { actor: "learner", commandId: command.id },
      }),
    ],
  }),

  [COMMAND.START_PROCEDURE]: ({ state, clockRoot, bundle, command }) => {
    const firstStep = bundle.operative.operative_sequence[0];
    return {
      outcome: "EXECUTED",
      events: [
        // Matrix PR08 / task §14.1: a jurisdictional investigation the learner
        // never ordered is noticed by staff and obtained through workflow. The
        // omission is RECORDED (so debrief can name it) but does not create an
        // "irrational prolonged deadlock" - these items are non-blocking.
        ...jurisdictionalCatchUpEvents({ state, clockRoot, bundle, command }),
        createEvent({
          type: EVENT.PROCEDURE_STARTED,
          atMinutes: state.clock.elapsedMinutes,
          atIso: nowIso(clockRoot, state),
          payload: { approach: command.params.approach },
          cause: { actor: "learner", commandId: command.id },
        }),
        // The patient is physically in theatre once the operation starts.
        // Tracking it is not decoration: `left_theatre_and_recovery` is one of
        // the structural discharge criteria, and without this the world
        // believed an operated patient was still in the emergency department -
        // so "выписываю" straight off the table met every structural check.
        createEvent({
          type: EVENT.PATIENT_MOVED,
          atMinutes: state.clock.elapsedMinutes,
          atIso: nowIso(clockRoot, state),
          payload: { to: "operating_room", monitoringLevel: "intraoperative" },
          cause: { actor: "system", source: "operative_sequence", commandId: command.id },
        }),
        createEvent({
          type: EVENT.OPERATIVE_FINDING_REVEALED,
          atMinutes: state.clock.elapsedMinutes,
          atIso: nowIso(clockRoot, state),
          payload: { findingId: firstStep.finding_id, decisionId: firstStep.decision_id },
          cause: { actor: "system", source: "operative_sequence" },
        }),
      ],
    };
  },

  // Content-driven (Core Runtime Spec §63/§71, task brief P0-6): which choice
  // ids count as source control, and which complications get scheduled
  // afterward, come entirely from `operative.yaml` / `complications.yaml`.
  // Nothing here compares against a specific choice string or complication
  // id - a second disease's operative.yaml/complications.yaml is read the
  // same way with no core change.
  [COMMAND.OPERATIVE_DECISION]: ({ state, clockRoot, bundle, command }) => {
    const decision = bundle.operative.decisions[command.params.decisionId];
    const option = decision?.options?.find((candidate) => candidate.id === command.params.choice);

    // Matrix O12/O13, task §17.8/§17.9: an option content marks
    // `executable: false` is RECOGNISED - the learner's intent is understood
    // and can be challenged in their own terms - but it is not performed,
    // because performing it would require a consequence model (unnecessary
    // partial cecectomy) or an untreated-disease trajectory (closing without
    // appendectomy) that no reviewer has approved. The simulator neither
    // executes it nor fabricates a complication for it.
    if (option && option.executable === false) {
      return {
        outcome: "OPTION_NOT_MODELED",
        challengeRu: option.challenge_ru ?? null,
        blockedReason: option.blocked_reason ?? "needs_reviewed_content",
        events: [
          createEvent({
            type: EVENT.SIMULATOR_LIMITATION_NOTED,
            atMinutes: state.clock.elapsedMinutes,
            atIso: nowIso(clockRoot, state),
            payload: simulatorLimitation({
              kind: "operative_option",
              id: option.id,
              reviewStatus: option.blocked_reason ?? null,
            }),
            cause: { actor: "system", source: "governance_gate", commandId: command.id },
          }),
        ],
      };
    }

    const events = [
      createEvent({
        type: EVENT.OPERATIVE_DECISION_MADE,
        atMinutes: state.clock.elapsedMinutes,
        atIso: nowIso(clockRoot, state),
        payload: { decisionId: command.params.decisionId, choice: command.params.choice },
        cause: { actor: "learner", commandId: command.id },
      }),
    ];
    if (option?.source_control) {
      const complicationChecks = scheduleGovernedComplicationChecks({ bundle, state, command });
      events.push(
        createEvent({
          type: EVENT.SOURCE_CONTROL_COMPLETED,
          atMinutes: state.clock.elapsedMinutes,
          atIso: nowIso(clockRoot, state),
          payload: {},
          cause: { actor: "learner", commandId: command.id },
        }),
        // Matrix PO17: automatic hospital workflow, triggered by content
        // (`complications.yaml#postoperative_course.automatic_workflow`), not
        // by a branch that knows what an appendix is.
        ...automaticWorkflowEvents({ state, clockRoot, bundle, trigger: "source_control_completed" }),
        createEvent({
          type: EVENT.PROCEDURE_COMPLETED,
          atMinutes: state.clock.elapsedMinutes,
          atIso: nowIso(clockRoot, state),
          payload: { closureStatementRu: bundle.operative.closure_statement_ru ?? null, scheduledPending: complicationChecks },
          cause: { actor: "system", source: "operative_sequence" },
        }),
        createEvent({
          type: EVENT.PATIENT_MOVED,
          atMinutes: state.clock.elapsedMinutes,
          atIso: nowIso(clockRoot, state),
          payload: { to: "recovery", monitoringLevel: "recovery" },
          cause: { actor: "system", source: "operative_sequence" },
        }),
      );
    }
    return { outcome: "EXECUTED", events, decisionOptions: decision?.options };
  },

  [COMMAND.DISPOSITION]: ({ state, clockRoot, command }) => ({
    outcome: "EXECUTED",
    events: [
      createEvent({
        type: EVENT.PATIENT_MOVED,
        atMinutes: state.clock.elapsedMinutes,
        atIso: nowIso(clockRoot, state),
        payload: { to: command.params.destination, monitoringLevel: command.params.monitoringLevel },
        cause: { actor: "learner", commandId: command.id },
      }),
    ],
  }),

  // Safe transfer to another facility is a valid terminal state (Core
  // Core Runtime Spec §56), tracked distinctly from an in-hospital DISPOSITION
  // move so the debrief can tell the two apart.
  //
  // TRANSPORT TAKES TIME (PBC-3, Contract §3.2/§7.1). Every real profile
  // already authored a `transferEtaMinutes` (150/45/20) and nothing read it,
  // so the ambulance arrived at the receiving hospital in zero minutes and
  // the case closed on the same clock tick the learner decided. Contract §3.2
  // names transfer duration as a defining Real-Hospital fact ("a transfer
  // takes 60 to 90 minutes") and §7.1 lists transport among the things
  // clinical time advances for.
  //
  // This is OPERATIONAL data, not clinical content (Core Runtime Spec §46): an
  // ambulance journey time is not a clinical rule and is not governance-gated.
  // The arrival is scheduled rather than applied here, so the interval drains
  // pending work like any other passage of time, and the departure is a
  // separate visible event from the arrival.
  [COMMAND.TRANSFER]: ({ state, clockRoot, command }) => {
    const etaMinutes = state.hospital.transferEtaMinutes ?? 0;
    const scheduledPending = etaMinutes > 0
      ? [{
          id: `${command.id}::transfer_arrival`,
          kind: "transfer_arrival",
          destination: command.params.destination,
          dueAtMinutes: state.clock.elapsedMinutes + etaMinutes,
        }]
      : [];
    const events = [
      createEvent({
        type: EVENT.TRANSFER_INITIATED,
        atMinutes: state.clock.elapsedMinutes,
        atIso: nowIso(clockRoot, state),
        payload: { destination: command.params.destination, etaMinutes, scheduledPending },
        cause: { actor: "learner", commandId: command.id },
      }),
    ];
    // No authored transport time (Reference Hospital): arrival is immediate,
    // which keeps the terminal state reachable rather than inventing a number.
    if (etaMinutes <= 0) {
      events.push(
        createEvent({
          type: EVENT.PATIENT_TRANSFERRED,
          atMinutes: state.clock.elapsedMinutes,
          atIso: nowIso(clockRoot, state),
          payload: { detail: command.params.destination },
          cause: { actor: "learner", commandId: command.id },
        }),
      );
    }
    // `consumesMinutes` is the general "this action takes clinical time"
    // seam (Contract §7.1: time advances for transport, procedures, observation).
    // `submitLearnerTurn` advances the clock by it AFTER the command executes,
    // which drains the journey's pending work and resolves the arrival above.
    return { outcome: "EXECUTED", events, consumesMinutes: etaMinutes };
  },

  [COMMAND.DISCHARGE]: ({ state, clockRoot, bundle, command }) => {
    const readiness = evaluateDischargeReadiness(state, bundle);
    if (readiness.blockers.length > 0) {
      return { outcome: "DISCHARGE_NOT_READY", blockers: readiness.blockers, command };
    }
    return {
      outcome: "EXECUTED",
      events: [
        // The withheld clinical-readiness criteria are recorded on the log at
        // the moment of discharge, so the debrief can say plainly that clinical
        // discharge readiness was NOT evaluated in this build. Silently
        // discharging without saying so would be the dishonest version.
        ...readiness.blockedCriteria.map((limitation) =>
          createEvent({
            type: EVENT.SIMULATOR_LIMITATION_NOTED,
            atMinutes: state.clock.elapsedMinutes,
            atIso: nowIso(clockRoot, state),
            payload: limitation,
            cause: { actor: "system", source: "governance_gate:discharge_criteria" },
          }),
        ),
        createEvent({
          type: EVENT.PATIENT_DISCHARGED,
          atMinutes: state.clock.elapsedMinutes,
          atIso: nowIso(clockRoot, state),
          payload: { detail: command.params.detail ?? null },
          cause: { actor: "learner", commandId: command.id },
        }),
        // Matrix PO18/PO20: the system issues the reviewed follow-up wording
        // and red flags. The resident is not made to type discharge boilerplate
        // in every case, and is not quizzed on reciting return precautions.
        ...dischargeBundleEvents({ state, clockRoot, bundle }),
      ],
    };
  },

  // Matrix PO05 / task §18.2: early oral intake as tolerated. Recorded so the
  // debrief shows what was actually ordered; NO physiological consequence is
  // modeled, because none has been reviewed.
  [COMMAND.ORDER_ORAL_INTAKE]: ({ state, clockRoot, command }) => ({
    outcome: "EXECUTED",
    events: [
      createEvent({
        type: EVENT.ORAL_INTAKE_PRESCRIBED,
        atMinutes: state.clock.elapsedMinutes,
        atIso: nowIso(clockRoot, state),
        payload: { level: command.params.level ?? "liquids" },
        cause: { actor: "learner", commandId: command.id },
      }),
    ],
  }),

  // Matrix PR02: the learner asking when the patient last ate and drank.
  [COMMAND.ASK_FASTING_HISTORY]: ({ state, clockRoot, command }) => ({
    outcome: "EXECUTED",
    events: [
      createEvent({
        type: EVENT.FASTING_HISTORY_OBTAINED,
        atMinutes: state.clock.elapsedMinutes,
        atIso: nowIso(clockRoot, state),
        payload: { fasting: state.preop.fasting ?? null, obtainedBy: "learner", findingIds: ["history.fasting"] },
        cause: { actor: "learner", commandId: command.id },
      }),
    ],
  }),

  [COMMAND.END_CASE]: ({ state, clockRoot, command }) => ({
    outcome: "EXECUTED",
    events: [
      createEvent({
        type: EVENT.SESSION_ENDED,
        atMinutes: state.clock.elapsedMinutes,
        atIso: nowIso(clockRoot, state),
        payload: { status: "incomplete" },
        cause: { actor: "learner", commandId: command.id },
      }),
    ],
  }),
};

/**
 * Focused answers may only expose facts already present in the generated
 * patient or wording already authored inside the full history bundle.
 */
function patientAnswerFor(topic, patient, bundle) {
  if (topic === "nausea_vomiting") return patient.presentation.nauseaVomitingRu ?? null;
  return bundle.findings?.history_bundle_ru?.focused_answers_ru?.[topic] ?? null;
}

const TEST_CAPABILITY = Object.freeze({
  cbc: "laboratory",
  chemistry: "laboratory",
  crp: "laboratory",
  urinalysis: "laboratory",
  betahcg: "laboratory",
  coagulation: "laboratory",
  blood_group_rh: "laboratory",
  ultrasound_abdomen: "ultrasound",
  ct_abdomen: "ct",
});

/** Investigations that use intravenous contrast, for the radiology policy below. */
const IV_CONTRAST_TESTS = Object.freeze(["ct_abdomen"]);

/**
 * The creatinine-before-contrast question (matrix I12, task §10).
 *
 * ACR supports RISK-BASED renal-function screening, not universal creatinine
 * testing, so "no creatinine means contrast CT is medically impossible" is not
 * a clinical rule and this codebase must never teach it as one. If a site wants
 * that behaviour it is a DEPARTMENT policy on the hospital profile, spoken by
 * radiology in operational language, and tagged `hospital_rule` so the debrief
 * classifies it as jurisdictional workflow rather than medicine.
 *
 * Every shipped profile has it OFF (matrix §13: NEEDS SITE POLICY).
 */
function contrastPolicyBlock({ state, testId }) {
  if (!IV_CONTRAST_TESTS.includes(testId)) return null;
  if (state.hospital.radiologyPolicy?.requiresCurrentCreatinineForContrastCt !== true) return null;
  const creatinineResulted = state.investigations.chemistry?.status === "resulted" &&
    (state.investigations.chemistry.result?.analytes ?? []).includes("creatinine");
  if (creatinineResulted) return null;
  return {
    outcome: "HOSPITAL_POLICY_BLOCK",
    policyId: "radiology.contrast_requires_current_creatinine",
    authorityLayer: "hospital_rule",
    speakerRu: "Рентгенолог",
    textRu: "В этом отделении КТ с в/в контрастированием без актуального креатинина не выполняют.",
  };
}

/**
 * Preop requirements that apply in THIS hospital (matrix §13).
 *
 * A requirement with `jurisdiction: null` is universal; one with
 * `jurisdiction: "KZ"` applies only in a hospital that declares KZ. This is
 * the mechanism that keeps the KZ ABO/Rh and coagulation standards from being
 * presented to the learner as international evidence-based practice.
 */
function applicablePreopRequirements(bundle, hospital) {
  return (bundle.operative.preop_requirements ?? []).filter((item) =>
    appliesInJurisdiction(jurisdictionOf(item), hospital.jurisdiction ?? null),
  );
}

/**
 * Jurisdictional items the learner never ordered, caught up by staff at the
 * theatre door (matrix PR08).
 *
 * Two events per item, and both matter: PREOP_ITEM_OMITTED is what the debrief
 * reads to say the learner did not order it, and PREOP_ITEM_COMPLETED, caused
 * by staff rather than the learner, is what stops the case deadlocking on a
 * form. Neither is a clinical judgement.
 */
function jurisdictionalCatchUpEvents({ state, clockRoot, bundle, command }) {
  const events = [];
  for (const item of applicablePreopRequirements(bundle, state.hospital)) {
    if (authorityLayerOf(item) !== "hospital_rule") continue;
    if (item.blocking) continue;
    if (state.preop.completed.includes(item.id)) continue;
    // The learner ORDERED it and it is simply still in the lab. That is not an
    // omission, and telling them "не была назначена" when they назначили it is
    // exactly the debrief failure the foundation spec names by example.
    if (item.investigation_id && state.investigations[item.investigation_id]) continue;
    events.push(
      createEvent({
        type: EVENT.PREOP_ITEM_OMITTED,
        atMinutes: state.clock.elapsedMinutes,
        atIso: hospitalIso(clockRoot, state.clock.elapsedMinutes),
        payload: { itemId: item.id, jurisdiction: jurisdictionOf(item), authorityLayer: "hospital_rule" },
        cause: { actor: "system", source: "jurisdictional_preop_catch_up", commandId: command.id },
      }),
      createEvent({
        type: EVENT.PREOP_ITEM_COMPLETED,
        atMinutes: state.clock.elapsedMinutes,
        atIso: hospitalIso(clockRoot, state.clock.elapsedMinutes),
        payload: { itemId: item.id, obtainedBy: item.obtained_by_staff_if_omitted ?? "nurse", jurisdiction: jurisdictionOf(item) },
        cause: { actor: "system", source: "jurisdictional_preop_catch_up", commandId: command.id },
      }),
    );
  }
  return events;
}

/**
 * Preop requirements this investigation order satisfies, scheduled to complete
 * when the result actually arrives.
 */
function preopItemsSatisfiedBy(command, bundle, state, etaMinutes) {
  return applicablePreopRequirements(bundle, state.hospital)
    .filter((item) => item.investigation_id === command.params.testId)
    .map((item) => ({
      id: `${command.id}::preop::${item.id}`,
      kind: "preop_item_ready",
      itemId: item.id,
      dueAtMinutes: state.clock.elapsedMinutes + etaMinutes,
    }));
}

/** Hospital workflow that simply happens, declared by content (matrix PO17). */
function automaticWorkflowEvents({ state, clockRoot, bundle, trigger }) {
  const workflow = bundle.complications?.postoperative_course?.automatic_workflow ?? [];
  return workflow
    .filter((entry) => entry.trigger === trigger)
    .map((entry) =>
      createEvent({
        type: EVENT.SPECIMEN_SENT_TO_PATHOLOGY,
        atMinutes: state.clock.elapsedMinutes,
        atIso: hospitalIso(clockRoot, state.clock.elapsedMinutes),
        payload: { workflowId: entry.id, labelRu: entry.label_ru },
        cause: { actor: "system", source: "hospital_workflow" },
      }),
    );
}

/** The reviewed discharge bundle (matrix PO18, PO20). */
function dischargeBundleEvents({ state, clockRoot, bundle }) {
  const dischargeBundle = bundle.complications?.discharge_bundle;
  if (!dischargeBundle) return [];
  return [
    createEvent({
      type: EVENT.DISCHARGE_INSTRUCTIONS_ISSUED,
      atMinutes: state.clock.elapsedMinutes,
      atIso: hospitalIso(clockRoot, state.clock.elapsedMinutes),
      payload: {
        followUpRu: dischargeBundle.follow_up_ru,
        histopathologyRu: dischargeBundle.histopathology_ru,
        returnPrecautionsRu: dischargeBundle.return_precautions_ru ?? [],
      },
      cause: { actor: "system", source: "discharge_bundle" },
    }),
  ];
}

/**
 * Resolving what a test will show, from patient truth, at the moment it is
 * ordered, and turning one order into one or two pending items.
 *
 * Where the content authors a `preliminaryAtMinutes` (CT/ultrasound - Contract
 * §9.2), this schedules a separate earlier pending item that produces
 * TEST_PRELIMINARY_REPORTED, and a later one that produces TEST_RESULTED -
 * two real arrivals, not one event relabelled. The value itself is fixed here
 * (order time), not at either resolution time, so a reassessment in between
 * cannot retroactively change an already-ordered test's answer: the disease
 * has one truth, and an investigation reports what was true when the sample
 * was taken or the image was acquired.
 */
function buildTestSchedule(command, timing, state, patient, bundle, etaMinutes, resourceEtaMinutes) {
  const testId = command.params.testId;
  const isImaging = testId === "ultrasound_abdomen" || testId === "ct_abdomen";
  const result = isImaging
    ? imagingResultFor(testId, patient)
    : labResultFor(testId, state.physiology, patient, bundle, command.params);
  const preliminary = isImaging ? imagingPreliminaryFor(testId, patient) ?? result : result;
  const orderedAt = state.clock.elapsedMinutes;

  const items = [];
  if (timing.preliminaryAtMinutes != null) {
    items.push({
      id: `${command.id}::preliminary`,
      kind: "test_result",
      phase: "preliminary",
      investigationId: testId,
      testId,
      dueAtMinutes: orderedAt + timing.preliminaryAtMinutes + resourceEtaMinutes,
      preliminaryText: preliminary,
    });
  }
  items.push({
    id: `${command.id}::final`,
    kind: "test_result",
    phase: "final",
    investigationId: testId,
    testId,
    dueAtMinutes: orderedAt + etaMinutes,
    result,
  });
  return items;
}

/**
 * Imaging results, assembled from reviewed content only.
 *
 * ULTRASOUND (matrix I02/I03). The retrocecal appendix is more likely to be
 * nondiagnostic, and the authored wording says exactly that: "не визуализирован
 * ... исследование неинформативно". It is NOT rendered as a negative study, and
 * `ultrasound_visualized_enabled` is false because the share of visualised
 * retrocecal appendices is unreviewed.
 *
 * CT (matrix I04, I05, I07, I08, I09). A FULL abdomen/pelvis report assembled
 * from the authored sections plus the seeded free-fluid variant plus the
 * authored conclusion. No appendix DIAMETER appears anywhere: the numeric range
 * is NEEDS SOURCE, and §20 forbids the renderer inventing one. No appendicolith
 * and no incidental findings exist in the content, so none can be printed.
 */
function imagingResultFor(testId, patient) {
  if (testId === "ultrasound_abdomen") {
    return patient.imaging.ultrasound_ru ?? null;
  }
  if (testId === "ct_abdomen") return buildCtReport(patient);
  return null;
}

function imagingPreliminaryFor(testId, patient) {
  if (testId === "ct_abdomen") return patient.imaging?.ct_report_ru?.preliminary_ru ?? null;
  return null;
}

function buildCtReport(patient) {
  const report = patient.imaging?.ct_report_ru;
  // Migrated V3.5 phenotypes carry a single authored CT sentence rather than
  // APP-004's newer sectioned report. Returning that sentence verbatim keeps
  // the old reviewed-internal wording without inventing missing sections.
  if (!report) return patient.imaging?.ct_ru ?? null;
  const sections = (report.sections ?? []).map((section) => section.text_ru);
  const freeFluid = patient.imaging.ctFreeFluid?.text_ru;
  return {
    kind: "structured_report",
    modalityRu: report.modality_ru,
    sectionsRu: [...sections, ...(freeFluid ? [freeFluid] : [])],
    conclusionRu: report.conclusion_ru,
  };
}

/**
 * Laboratory results.
 *
 * BIOCHEMISTRY (matrix V07, task §8): only the analytes the learner NAMED are
 * reported, from the content's own per-analyte wording. Nothing is added that
 * was not requested, and no numeric value is asserted - the reviewed content is
 * qualitative because no reference range or value for this patient has been
 * reviewed.
 *
 * URINALYSIS (matrix V06): the seeded variant, which may carry a small
 * nonspecific finding and is never presented as evidence of UTI/stone.
 *
 * COAGULATION / ABO-Rh: KZ jurisdictional investigations. The ABO/Rh RESULT is
 * deliberately not a fabricated blood group - the case does not model
 * transfusion, and inventing "A(II) Rh+" would be exactly the invented clinical
 * fact §20 prohibits.
 */
function labResultFor(testId, physiology, patient, bundle, params) {
  switch (testId) {
    case "cbc":
      return { wbc: physiology.wbc, neutrophilPercent: physiology.neutrophilPercent };
    case "chemistry": {
      const catalogue = bundle?.trajectories?.chemistry_analytes ?? {};
      const requested = params.analytes ?? [];
      return {
        analytes: requested,
        linesRu: requested.map((id) => catalogue[id]?.result_ru ?? `${id}: результат не смоделирован`),
      };
    }
    case "crp":
      return { crp: physiology.crp };
    case "urinalysis":
      return { note: patient?.laboratory?.urinalysisRu ?? "Общий анализ мочи без значимых отклонений." };
    case "betahcg":
      return { note: "отрицательный" };
    case "coagulation":
      return { note: "показатели коагулограммы в пределах референсных значений" };
    case "blood_group_rh":
      return { note: "группа крови и резус-фактор определены и внесены в карту" };
    default:
      return null;
  }
}

/**
 * Disclosing the constraint the learner just ran into.
 *
 * A dynamic constraint carries its own authored explanation; a static
 * profile limitation (this hospital simply has no CT) gets a generic one
 * keyed off the reason. Either way, disclosure happens ON CONTACT, never in
 * advance - and the mentor is not involved, because "the scanner is broken"
 * is an operational fact from the hospital, not teaching (Contract §23).
 */
function buildConstraintDisclosure({ state, clockRoot, capabilityKey, reasonKey, command }) {
  const alreadyKnown = state.hospital.constraints.some((entry) => entry.capabilityKey === capabilityKey);
  if (alreadyKnown) return [];

  const dynamic = constraintForCapability(state.hospital.dynamicConstraints ?? [], capabilityKey);
  const constraint = {
    id: dynamic?.id ?? `static:${capabilityKey}`,
    capabilityKey,
    reasonKey,
    textRu: dynamic?.textRu ?? null,
  };

  return [
    createEvent({
      type: EVENT.RESOURCE_CONSTRAINT_REVEALED,
      atMinutes: state.clock.elapsedMinutes,
      atIso: hospitalIso(clockRoot, state.clock.elapsedMinutes),
      payload: { constraint },
      cause: { actor: "system", commandId: command.id, source: "resource_resolution" },
    }),
  ];
}

/**
 * Governed treatment-effect scheduling.
 *
 * THREE things must now be true before an effect touches patient truth, where
 * the previous version required only the first two:
 *
 *   1. content declares an effect for this drug/fluid;
 *   2. that effect is `approved_for_training`;
 *   3. the effect matches the ROUTE actually ordered, and carries a reviewed
 *      `response_envelope`.
 *
 * (3) is the 2026-08-25 remediation (matrix M04/M05, task §12.1). The old
 * `analgesia_iv_nsaid -> pain -3` applied one magnitude to ketorolac and
 * ketoprofen by any route. Now every (drug, route) pair is its own content
 * object, and all of them ship with `response_envelope: null` - so the
 * medication is genuinely GIVEN and recorded, and nothing pretends to know
 * what happens next.
 */
function scheduleGovernedTreatmentEffect({ bundle, state, command, matchKey, matchValue, route, rng }) {
  const effects = bundle.trajectories?.treatment_effects ?? {};
  const entry = Object.entries(effects).find(([, effect]) => {
    const routeMatches = !effect.applies_to_routes || (route != null && effect.applies_to_routes.includes(route));
    if (!routeMatches) return false;
    if (matchKey === "drugId") return effect.applies_to?.includes(matchValue);
    if (matchKey === "fluidId") return effect.applies_to_fluid?.includes(matchValue);
    return false;
  });
  if (!entry) return [];
  const [effectId, effect] = entry;
  if (!isRuntimeAuthoritative(reviewStatusOf(effect))) return [];

  const envelope = effect.response_envelope;
  if (envelope == null) return [];

  // Matrix M09: a fluid effect is conditional on an actual volume state, which
  // base APP-004 does not have and this pass does not model.
  if (effect.requires_patient_state && state.truth?.[effect.requires_patient_state] !== true) return [];

  const onsetMinutes = envelope.onset_minutes ?? 0;
  const sample = (value, name) => {
    if (Number.isFinite(value)) return value;
    if (Array.isArray(value) && value.length === 2 && value.every(Number.isFinite)) {
      return rng.stream(`treatment_effect:${effectId}:${command.id}:${name}`).range(value[0], value[1], 1);
    }
    return undefined;
  };
  return [
    {
      id: `${command.id}::effect::${effectId}`,
      kind: "treatment_effect",
      effectId,
      deltas: samplePhysiologyDeltas(envelope, sample),
      symptomDeltas: { painScore: sample(envelope.pain_score_delta ?? envelope.pain_score_delta_range, "painScore") },
      commandId: command.id,
      ruleId: effect.provenance?.id ?? effectId,
      sourceIds: effect.source_ids ?? [],
      durationMinutes: envelope.duration_minutes ?? null,
      dueAtMinutes: state.clock.elapsedMinutes + onsetMinutes,
    },
  ];
}

// Which physiology fields does examining/reassessing these targets actually
// measure? `undefined` means the content declares no observation targets at
// all (legacy: disclose the whole snapshot); `{}` means "nothing measured".
function observedFor(bundle, state, keys) {
  const map = bundle.findings?.observation_targets;
  if (!map) return undefined;
  const observed = {};
  for (const key of keys) {
    for (const field of map[key]?.fields ?? []) {
      if (state.physiology[field] != null) observed[field] = state.physiology[field];
    }
  }
  return observed;
}

// A response envelope declares a physiology delta as `<field>_delta` (a fixed
// number) or `<field>_delta_range` (sampled). This reads whichever fields are
// actually present, generically - a content author adding `crt_seconds_delta`
// or `urine_output_ml_per_hr_delta` for a new disease needs no code change
// here (Wave B / ТЗ §14 generalization: the physiology-delta mechanism was
// previously hardcoded to heart_rate/systolic_bp/temperature_c only).
const DELTA_SUFFIX = "_delta";
const DELTA_RANGE_SUFFIX = "_delta_range";

function toCamelCase(snakeCase) {
  return snakeCase.replace(/_([a-z0-9])/g, (_, char) => char.toUpperCase());
}

function samplePhysiologyDeltas(envelope, sample) {
  const fields = new Set();
  for (const key of Object.keys(envelope ?? {})) {
    if (key.endsWith(DELTA_RANGE_SUFFIX)) fields.add(key.slice(0, -DELTA_RANGE_SUFFIX.length));
    else if (key.endsWith(DELTA_SUFFIX)) fields.add(key.slice(0, -DELTA_SUFFIX.length));
  }
  const deltas = {};
  for (const field of fields) {
    const physiologyKey = toCamelCase(field);
    const raw = envelope[`${field}_delta`] ?? envelope[`${field}_delta_range`];
    deltas[physiologyKey] = sample(raw, physiologyKey);
  }
  return deltas;
}

/**
 * Governed postoperative complication scheduling (task brief P0-6/P1-4).
 *
 * Iterates every complication content declares for this disease - not a
 * single hardcoded id - and only schedules a check for ones that are
 * `approved_for_training`. A complication pending purely on governance is
 * never rolled at all (not even a suppressed roll): `advanceTime.js`
 * resolves it as a recorded simulator limitation, never as a silent "no
 * complication happened" that would misrepresent an unreviewed probability
 * as a reviewed one.
 */
function scheduleGovernedComplicationChecks({ bundle, state, command }) {
  const complications = bundle.complications?.postoperative_course?.complications ?? [];
  return complications.map((complication) => ({
    id: `${command.id}::${complication.id}`,
    kind: "complication_check",
    complicationId: complication.id,
    dueAtMinutes: state.clock.elapsedMinutes + (complication.earliest_onset_hours ?? 48) * 60,
  }));
}

/**
 * Discharge readiness (matrix PO12-PO16, PO21; task §19).
 *
 * Two layers, kept strictly apart, because collapsing them is what produced
 * the finding the clinical review flagged - a patient discharged 12 h after
 * admission with pain 7.6/10 because only structural flags were checked.
 *
 * STRUCTURAL (`authority_layer: workflow`). Facts the architecture owns and
 * can evaluate without making any clinical claim: has the operation finished,
 * is there an unresolved complication, has the patient left theatre and
 * recovery. These carry `review_status: not_a_clinical_rule` and are selected
 * by their authority layer, NOT by being promoted.
 *
 * CLINICAL (`authority_layer: clinical_rule`). Functional readiness -
 * haemodynamics, pain controlled on an oral regimen, tolerating intake, no
 * persistent vomiting, mobile. These are PROPOSALS pending review, so they are
 * skipped here and returned as `blockedCriteria` for the caller to record as
 * simulator limitations.
 *
 * The consequence is stated plainly rather than papered over: in this build
 * clinical discharge readiness is NOT evaluated, and that is reported as a
 * release blocker. The alternative - inventing a pain threshold or a "24 h
 * afebrile" rule to make the gate feel real - is exactly what the review
 * removed (matrix PO11, PO12, PO13).
 *
 * WHAT IS NOT CHECKED, BY EXPLICIT DECISION: flatus or stool (PO16), a minimum
 * 24-hour stay (PO13), a next-day CBC (PO10), or an arbitrary pain <= 3 (PO12).
 */
function evaluateDischargeReadiness(state, bundle) {
  const criteria = bundle?.complications?.discharge_criteria ?? [];
  const blockers = [];
  const blockedCriteria = [];

  for (const criterion of criteria) {
    if (authorityLayerOf(criterion) === "workflow") {
      if (!STRUCTURAL_DISCHARGE_CHECKS[criterion.id]) continue;
      if (!STRUCTURAL_DISCHARGE_CHECKS[criterion.id](state)) {
        blockers.push({ id: criterion.id, reasonRu: criterion.learner_reason_ru ?? criterion.label_ru });
      }
      continue;
    }
    // Clinical readiness: governed, and currently never authoritative.
    if (!isRuntimeAuthoritative(reviewStatusOf(criterion))) {
      blockedCriteria.push(
        simulatorLimitation({ kind: "discharge_criterion", id: criterion.id, reviewStatus: reviewStatusOf(criterion) ?? null }),
      );
      continue;
    }
    if (criterion.runtime_evaluation === "unavailable_without_recovery_calibration") {
      blockedCriteria.push(
        simulatorLimitation({ kind: "discharge_runtime_fact", id: criterion.id, reviewStatus: "approved_rule_unmeasured_patient_fact" }),
      );
      continue;
    }
    if (criterion.runtime_evaluation === "conditional_only") continue;
    if (!contentConditionsMet(criterion.conditions, state) && criterion.blocking !== false) {
      blockers.push({ id: criterion.id, reasonRu: criterion.learner_reason_ru ?? criterion.label_ru });
    }
  }

  return { blockers, blockedCriteria };
}

/**
 * Structural checks. Every one of these is a workflow fact with no threshold
 * and no clinical claim in it - which is why they can run while all clinical
 * criteria are governance-blocked.
 */
const STRUCTURAL_DISCHARGE_CHECKS = Object.freeze({
  operation_completed: (state) =>
    state.managementPlan.intent !== "operative" || state.operative.completed === true,
  no_active_unresolved_complication: (state) =>
    (state.postop?.activeComplications?.length ?? 0) === 0,
  left_theatre_and_recovery: (state) =>
    !["operating_room", "recovery"].includes(state.location),
});

function isImpossiblePostoperativeRoute(state, command) {
  if (state.managementPlan.intent !== "operative" || state.operative.completed) return false;
  const destination = command.type === COMMAND.DISPOSITION
    ? command.params.destination
    : command.type === COMMAND.MOVE_PATIENT
      ? command.params.to
      : null;
  return ["recovery", "surgical_ward"].includes(destination);
}

export { advanceTime, schedulePending };

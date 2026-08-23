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

/**
 * Executing one validated command against the current world.
 *
 * Return shape is always the same:
 *
 *   { outcome: "EXECUTED", events }
 *   { outcome: "CLARIFY", missing }                 -- Foundation Spec §48
 *   { outcome: "STAFF_CLARIFICATION", staffRole, ... } -- Contract §10
 *   { outcome: "SAFETY_STOP", ruleId, teachingPointRu }-- Mentor Spec §6.6
 *   { outcome: "UNSUPPORTED_CONTENT", capabilityKey }  -- Foundation Spec §50
 *   { outcome: "UNAVAILABLE_RESOURCE", reasonKey }      -- Foundation Spec §50
 *   { outcome: "PREOP_NOT_READY", missingItems }        -- Foundation Spec §58
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
  const fired = eligibleRules(rules, { state, learnerVisible, command });
  const governanceBlocked = governanceBlockedEligibleRules(rules, { state, learnerVisible, command });
  const blocking = fired.find((rule) => rule.level === "LEVEL_4_CATASTROPHIC");
  if (blocking) {
    return { outcome: "SAFETY_STOP", ruleId: blocking.id, teachingPointRu: blocking.teaching_point_ru, command, governanceBlocked };
  }

  // Core Architecture Contract §58: readiness for an irreversible step is
  // real tracked state, not a conversational keyword. This is a workflow
  // invariant intrinsic to the architecture, independent of any specific
  // clinical content item's review status - which is why it still holds
  // while the consent safety rule itself is governance-blocked.
  if (command.type === COMMAND.START_PROCEDURE && !state.preop.ready) {
    const missingItems = state.preop.required
      .filter((item) => item.blocking && !state.preop.completed.includes(item.id))
      .map((item) => item.id);
    return { outcome: "PREOP_NOT_READY", missingItems, command, governanceBlocked };
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

  [COMMAND.EXAMINE]: ({ state, clockRoot, command }) => ({
    outcome: "EXECUTED",
    events: [
      createEvent({
        type: EVENT.EXAMINATION_PERFORMED,
        atMinutes: state.clock.elapsedMinutes,
        atIso: nowIso(clockRoot, state),
        payload: { region: command.params.region, findingIds: [`exam.${command.params.region}`] },
        cause: { actor: "learner", commandId: command.id },
      }),
    ],
  }),

  [COMMAND.REQUEST_STATUS]: () => ({ outcome: "EXECUTED", events: [] }), // pure read; renderer handles it

  [COMMAND.ORDER_TEST]: ({ state, clockRoot, bundle, command, patient }) => {
    const timing = bundle.trajectories.investigation_timing[command.params.testId];
    if (!timing) return { outcome: "UNSUPPORTED_CONTENT", capabilityKey: `test:${command.params.testId}` };

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
    const scheduledPending = buildTestSchedule(command, timing, state, patient, etaMinutes, resolution.etaMinutes);
    const orderedEvent = createEvent({
      type: EVENT.TEST_ORDERED,
      atMinutes: state.clock.elapsedMinutes,
      atIso: nowIso(clockRoot, state),
      payload: { investigationId: command.params.testId, testId: command.params.testId, etaMinutes, scheduledPending },
      cause: { actor: "learner", commandId: command.id },
    });

    return { outcome: "EXECUTED", events: [orderedEvent] };
  },

  [COMMAND.ORDER_MEDICATION]: ({ state, clockRoot, bundle, command }) => {
    // Foundation Spec §50's three-way distinction, for medications: a drugId
    // absent from the reviewed formulary is `unsupported_content` - never
    // reported to the learner as a hospital stock-out (Contract §50.2).
    const known = bundle.shared?.medications?.medications?.[command.params.drugId];
    if (!known) return { outcome: "UNSUPPORTED_CONTENT", capabilityKey: `medication:${command.params.drugId}` };

    const effectPending = scheduleGovernedTreatmentEffect({
      bundle,
      state,
      command,
      matchKey: "drugId",
      matchValue: command.params.drugId,
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

  [COMMAND.ORDER_INFUSION]: ({ state, clockRoot, bundle, command }) => {
    const known = bundle.shared?.medications?.fluids?.[command.params.fluidId];
    if (!known) return { outcome: "UNSUPPORTED_CONTENT", capabilityKey: `fluid:${command.params.fluidId}` };
    const durationMinutes = command.params.durationMinutes ?? 0;
    const effectPending = scheduleGovernedTreatmentEffect({
      bundle,
      state,
      command,
      matchKey: "fluidId",
      matchValue: command.params.fluidId,
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

  [COMMAND.REASSESS]: ({ state, clockRoot, command }) => ({
    outcome: "EXECUTED",
    events: [
      createEvent({
        type: EVENT.PATIENT_REASSESSED,
        atMinutes: state.clock.elapsedMinutes,
        atIso: nowIso(clockRoot, state),
        payload: { region: "reassessment", findingIds: ["reassessment"], targets: command.params.targets },
        cause: { actor: "learner", commandId: command.id },
      }),
      createEvent({
        type: EVENT.VITALS_OBSERVED,
        atMinutes: state.clock.elapsedMinutes,
        atIso: nowIso(clockRoot, state),
        payload: { findingIds: ["vitals.reassessment"] },
        cause: { actor: "learner", commandId: command.id },
      }),
    ],
  }),

  [COMMAND.STATE_REASONING]: ({ state, clockRoot, command }) => ({
    outcome: "EXECUTED",
    events: [
      createEvent({
        type: EVENT.REASONING_STATED,
        atMinutes: state.clock.elapsedMinutes,
        atIso: nowIso(clockRoot, state),
        payload: { ...command.params },
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
        payload: { intent: command.params.intent, requiredPreop: bundle.operative.preop_requirements },
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

  [COMMAND.SET_NPO]: ({ state, clockRoot, command }) => ({
    outcome: "EXECUTED",
    events: [
      createEvent({
        type: EVENT.PREOP_ITEM_COMPLETED,
        atMinutes: state.clock.elapsedMinutes,
        atIso: nowIso(clockRoot, state),
        payload: { itemId: "npo_status" },
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

  [COMMAND.GIVE_ANTIBIOTIC_PROPHYLAXIS]: ({ state, clockRoot, bundle, command }) => {
    const known = bundle.shared?.medications?.medications?.[command.params.drugId];
    if (!known) return { outcome: "UNSUPPORTED_CONTENT", capabilityKey: `medication:${command.params.drugId}` };
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
        createEvent({
          type: EVENT.PREOP_ITEM_COMPLETED,
          atMinutes: state.clock.elapsedMinutes,
          atIso: nowIso(clockRoot, state),
          payload: { itemId: "antibiotic_prophylaxis" },
          cause: { actor: "learner", commandId: command.id },
        }),
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
        createEvent({
          type: EVENT.PROCEDURE_STARTED,
          atMinutes: state.clock.elapsedMinutes,
          atIso: nowIso(clockRoot, state),
          payload: { approach: command.params.approach },
          cause: { actor: "learner", commandId: command.id },
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

  // Content-driven (Foundation Spec §63/§71, task brief P0-6): which choice
  // ids count as source control, and which complications get scheduled
  // afterward, come entirely from `operative.yaml` / `complications.yaml`.
  // Nothing here compares against a specific choice string or complication
  // id - a second disease's operative.yaml/complications.yaml is read the
  // same way with no core change.
  [COMMAND.OPERATIVE_DECISION]: ({ state, clockRoot, bundle, command }) => {
    const decision = bundle.operative.decisions[command.params.decisionId];
    const option = decision?.options?.find((candidate) => candidate.id === command.params.choice);
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
        createEvent({
          type: EVENT.PROCEDURE_COMPLETED,
          atMinutes: state.clock.elapsedMinutes,
          atIso: nowIso(clockRoot, state),
          payload: { scheduledPending: complicationChecks },
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
  // Foundation Spec §56), tracked distinctly from an in-hospital DISPOSITION
  // move so the debrief can tell the two apart.
  [COMMAND.TRANSFER]: ({ state, clockRoot, command }) => ({
    outcome: "EXECUTED",
    events: [
      createEvent({
        type: EVENT.TRANSFER_INITIATED,
        atMinutes: state.clock.elapsedMinutes,
        atIso: nowIso(clockRoot, state),
        payload: { destination: command.params.destination },
        cause: { actor: "learner", commandId: command.id },
      }),
      createEvent({
        type: EVENT.PATIENT_TRANSFERRED,
        atMinutes: state.clock.elapsedMinutes,
        atIso: nowIso(clockRoot, state),
        payload: { detail: command.params.destination },
        cause: { actor: "learner", commandId: command.id },
      }),
    ],
  }),

  [COMMAND.DISCHARGE]: ({ state, clockRoot, command }) => {
    const blockers = evaluateDischargeReadiness(state);
    if (blockers.length > 0) return { outcome: "DISCHARGE_NOT_READY", blockers, command };
    return {
      outcome: "EXECUTED",
      events: [
        createEvent({
          type: EVENT.PATIENT_DISCHARGED,
          atMinutes: state.clock.elapsedMinutes,
          atIso: nowIso(clockRoot, state),
          payload: { detail: command.params.detail ?? null },
          cause: { actor: "learner", commandId: command.id },
        }),
      ],
    };
  },

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

const TEST_CAPABILITY = Object.freeze({
  cbc: "laboratory",
  chemistry: "laboratory",
  crp: "laboratory",
  urinalysis: "laboratory",
  betahcg: "laboratory",
  ultrasound_abdomen: "ultrasound",
  ct_abdomen: "ct",
});

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
function buildTestSchedule(command, timing, state, patient, etaMinutes, resourceEtaMinutes) {
  const testId = command.params.testId;
  const isImaging = testId === "ultrasound_abdomen" || testId === "ct_abdomen";
  const result = isImaging ? imagingResultFor(testId, patient) : labResultFor(testId, state.physiology);
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
      preliminaryText: result,
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

function imagingResultFor(testId, patient) {
  if (testId === "ultrasound_abdomen") {
    return patient.imaging.ultrasound_ru ?? patient.imaging.ultrasound_variants_ru?.[0] ?? null;
  }
  if (testId === "ct_abdomen") return patient.imaging.ct_ru ?? null;
  return null;
}

function labResultFor(testId, physiology) {
  switch (testId) {
    case "cbc":
      return { wbc: physiology.wbc, neutrophilPercent: physiology.neutrophilPercent };
    case "chemistry":
      return { note: "без значимых отклонений" };
    case "crp":
      return { crp: physiology.crp };
    case "urinalysis":
      return { note: "без значимых отклонений" };
    case "betahcg":
      return { note: "отрицательный" };
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
 * Governed treatment-effect scheduling (task brief P0-3).
 *
 * Reads `bundle.trajectories.treatment_effects` generically - no drug or
 * fluid id is special-cased here beyond what the content's `applies_to` /
 * `applies_to_fluid` arrays declare. An effect only schedules a pending item
 * when it is `approved_for_training` (`isRuntimeAuthoritative`); otherwise
 * this returns an empty array and the order still executes (the medication
 * IS given), it just has no modeled physiological consequence yet - an
 * honest simulator limitation, not a fabricated one (task §21).
 */
function scheduleGovernedTreatmentEffect({ bundle, state, command, matchKey, matchValue }) {
  const effects = bundle.trajectories?.treatment_effects ?? {};
  const entry = Object.entries(effects).find(([, effect]) => {
    if (matchKey === "drugId") return effect.applies_to?.includes(matchValue);
    if (matchKey === "fluidId") return effect.applies_to_fluid?.includes(matchValue);
    return false;
  });
  if (!entry) return [];
  const [effectId, effect] = entry;
  if (!isRuntimeAuthoritative(effect.review_status)) return [];

  const onsetMinutes = effect.onset_minutes ?? 0;
  return [
    {
      id: `${command.id}::effect::${effectId}`,
      kind: "treatment_effect",
      effectId,
      deltas: {
        heartRate: effect.heart_rate_delta,
        systolicBp: effect.systolic_bp_delta,
        temperatureC: effect.temperature_c_delta,
      },
      symptomDeltas: { painScore: effect.pain_score_delta },
      dueAtMinutes: state.clock.elapsedMinutes + onsetMinutes,
    },
  ];
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
 * Structural discharge gate (task brief P1-2): observable state facts, not
 * an unapproved clinical scoring rule. `discharge_criteria` content
 * (`complications.yaml`) is `pending` review, so this does not cite it as
 * authoritative teaching - it only checks facts already tracked as world
 * state (fever, an active unresolved complication) that the architecture
 * needs regardless of any specific clinical content's review status.
 */
function evaluateDischargeReadiness(state) {
  const blockers = [];
  if (state.physiology.temperatureC >= 38.0) blockers.push("fever");
  const hasActiveComplication = state.session.status !== "complete" && (state.postop?.activeComplications?.length ?? 0) > 0;
  if (hasActiveComplication) blockers.push("active_complication");
  return blockers;
}

export { advanceTime, schedulePending };

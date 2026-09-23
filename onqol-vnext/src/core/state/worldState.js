import { EVENT, DISCLOSING_EVENTS, TERMINAL_EVENTS } from "../events/eventTypes.js";
import { activePainScore, toPostSourceControlPain } from "./painState.js";
import {
  createEmptyReasoningState,
  createLegacyReasoningState,
  mergeLegacyReasoningState,
  mergeReasoningState,
} from "../reasoning/reasoningState.js";
import { isInteractionV2Enabled } from "../../ai/interaction/featureFlags.js";

/**
 * The world, as independent dimensions.
 *
 * THERE IS NO `path_state` HERE, AND THAT IS THE POINT.
 *
 * The previous runtime derived the whole world from one phase label
 * (`data_gathering` -> `tests_and_treatment` -> `decision` -> `preop` ->
 * `operation`), and every failure that made this rebuild necessary came out of
 * that: a patient who had been examined could not be re-examined, because the
 * phase said examination was over; committing to surgery made the patient
 * ready for surgery, because the phase said so.
 *
 * A real patient is many things at once - in the ED, stable, in pain,
 * appendicitis confirmed, planned for theatre, not consented, prophylaxis
 * pending - so the state carries those as separate fields that move
 * separately. `workflow.label` exists at the bottom of this file for analytics
 * and the dev panel; nothing clinical reads it, and the learner never sees it.
 */

export function createInitialState({ session, patient, hospital, clock }) {
  return {
    session: {
      id: session.id,
      seed: session.seed,
      mode: session.mode, // "reference" | "real"
      locale: session.locale,
      jurisdictionContext: session.jurisdictionContext ?? null,
      purpose: session.purpose,
      casePresetId: session.casePresetId ?? null,
      interactionFlags: { ...(session.interactionFlags ?? {}) },
      presetRuntimeStatus: session.presetRuntimeStatus ?? null,
      productionReleaseAllowed: session.productionReleaseAllowed === true,
      presentationCategory: session.presentationCategory,
      contentVersions: session.contentVersions,
      status: "active", // active | complete | incomplete
      endpoint: null,
      // Review matrix §G1 / task §3: a build generating non-approved patient
      // truth may run for internal development, but it must SAY SO. This flag
      // rides on session state, is exported, and is repeated in the debrief,
      // so no downstream surface can present such a build as pilot-ready.
      patientTruthApproved: session.patientTruthApproved ?? false,
    },

    clock: { elapsedMinutes: 0, startIso: clock.startIso, offset: clock.offset },

    // ---- Patient ------------------------------------------------------
    // `truth` is hidden. Nothing outside the patient engine and the renderer
    // of an already-disclosing event may read it, and the mentor envelope
    // never receives it.
    truth: patient.truth,

    physiology: { ...patient.initialPhysiology },
    symptoms: { ...patient.initialSymptoms },

    demographics: { ...patient.demographics },

    // ---- Where the patient is -----------------------------------------
    location: patient.presentation?.initialLocation ?? "emergency_department",
    monitoring: { level: "ed_standard", prescribed: [] },

    // ---- Things that are running --------------------------------------
    investigations: {}, // id -> { id, status, orderedAt, etaMinutes, availableAt, result, preliminary }
    treatments: { active: [], administered: [] },
    infusions: [],
    // Cumulative infused volume, so content can condition on "how much has
    // been given" (fluid overload) without a per-disease counter.
    fluidBalance: { infusedMl: 0, bolusMl: 0, fluidIds: [] },

    // ---- What the learner knows ---------------------------------------
    revealed: {
      findings: [], // finding ids the learner has actually been shown
      results: [], // investigation ids whose results are on screen
      constraints: [], // resource constraint ids disclosed
    },
    observations: { vitals: [], examinations: [], history: [] },

    // ---- What the learner has decided ---------------------------------
    reasoning: isInteractionV2Enabled(session)
      ? createEmptyReasoningState()
      : createLegacyReasoningState(),
    managementPlan: { intent: null, committedAt: null }, // "operative" | "nonoperative" | "observation"

    preop: {
      required: [], // filled from content when an operative plan is committed
      completed: [],
      omitted: [],
      consent: "not_obtained", // not_obtained | obtained | refused
      ready: false,
      // Matrix PR02 / task §13.2: the fasting history is real patient data the
      // learner may ask for and the anesthesiologist obtains if they did not.
      // It is NOT a hard stop (matrix PR01) - `fasting_assessment` is a
      // non-blocking preop item.
      fasting: patient.presentation?.fastingHistory
        ? { ...patient.presentation.fastingHistory }
        : null,
    },

    operative: {
      started: false,
      approach: null,
      findingsRevealed: [],
      decisions: [],
      pendingDecision: null,
      sourceControl: false,
      completed: false,
    },

    postop: {
      disposition: null,
      day: 0,
      activeComplications: [],
      recovery: { stateId: null, enteredAtMinutes: null, facts: {} },
      // Matrix PO05 / PO17: ordinary ward workflow the resident is not quizzed
      // on. Tracked so the debrief can show what actually happened.
      oralIntake: null, // null | "liquids" | "diet_as_tolerated" | "nil_by_mouth"
      histopathologySent: false,
      dischargeBundleIssued: false,
    },

    // Content that would have acted but was withheld by the runtime
    // governance gate (`core/rules/governance.js`). Kept as world state so
    // the debrief can distinguish "the simulator does not model this yet"
    // from "the learner failed to do this" (task §21).
    simulatorLimitations: [],

    // ---- Hospital ------------------------------------------------------
    hospital: {
      profileId: hospital.profileId,
      profileTitleKey: hospital.profileTitleKey,
      capabilities: { ...hospital.capabilities },
      // `constraints` holds only DISCLOSED constraints - what the learner has
      // actually run into and may see in the sidebar. The full set of active
      // ones lives in `dynamicConstraints`, which the learner view never
      // exposes, so a broken scanner is not announced before it is met.
      constraints: [],
      dynamicConstraints: [...(hospital.dynamicConstraints ?? [])],
      // Which jurisdiction's workflow rules this hospital runs under, and its
      // department policies. Both are HOSPITAL facts, not clinical ones: they
      // decide which jurisdictional preoperative requirements apply and
      // whether radiology enforces a local pre-contrast policy (matrix §13).
      jurisdiction: hospital.jurisdiction ?? null,
      radiologyPolicy: { ...(hospital.radiologyPolicy ?? {}) },
      // Transport time to a receiving facility (Contract §3.2 "a transfer
      // takes 60 to 90 minutes"). Authored per profile; null in Reference.
      transferEtaMinutes: hospital.transferEtaMinutes ?? null,
      staff: { ...hospital.staff },
    },

    // ---- Scheduler ------------------------------------------------------
    // Work the world owes the learner: a result that will land, an infusion
    // that will finish, a consultant who will arrive, a disease step that will
    // happen. Ordered by dueAt when drained.
    pending: [],

    // The order a hospital character is currently waiting on an answer for
    // (Contract §8.2/§10). Set by CLARIFICATION_REQUESTED, discharged by the
    // next learner turn - the same lifetime as `mentor.openQuestion`, and for
    // the same reason: a question must not outlive the turn that answered it.
    clarification: null, // { commandType, params, missing, askedTurn }

    // ---- Teaching bookkeeping (never clinical truth) ---------------------
    mentor: {
      lastInterventionTurn: null,
      openQuestion: null, // { issueId, expects, askedTurn, scaffolding }
      scaffolding: 0,
      silentTurns: 0,
      raisedIssues: [],

      // ---- Stateful Grounded Mentor Wave A (additive; stay at these
      // initial values, and are never read, when STATEFUL_GROUNDED_MENTOR_V1
      // is off - see docs/STATEFUL_GROUNDED_MENTOR_WAVE_A.md) -------------
      // Unlike `openQuestion`, this survives LEARNER_TURN_RECEIVED - it is
      // only replaced or cleared by MENTOR_INTERVENED, so a short answer two
      // or more turns later can still resolve against the same issue.
      pendingMentorQuestion: null, // { issueId, askedTurn, learnerQuote, expectedAnswerDomains, scaffoldingLevel }
      probingStreak: 0, // consecutive non-SUFFICIENT adequacy verdicts on the current pending issue
      recentMentorQuestions: [], // last 3 { issueId, text }, most recent last - so a new question can be checked against it
      deferredMentorIssues: [], // issueIds pushed to the debrief instead of re-probed this case
    },

    turn: 0,
    workflow: { label: "arrival" }, // analytics/dev only - see file header
  };
}

/**
 * The reducer. Pure: (state, event) -> state.
 *
 * A case is `events.reduce(applyEvent, createInitialState(seed))` and nothing
 * else. If a field cannot be reconstructed this way it does not belong in the
 * world state.
 */
export function applyEvent(state, event) {
  const next = { ...state, clock: { ...state.clock, elapsedMinutes: event.atMinutes } };

  switch (event.type) {
    case EVENT.SESSION_STARTED:
    case EVENT.PATIENT_ARRIVED:
      if (event.payload?.disclosesVitals === false) break;
      next.observations = {
        ...next.observations,
        // Pain is observed at the same moment vitals are, and the learner is
        // entitled to see it - it rides in the same snapshot so there is one
        // disclosure record, not two that can disagree about what was known
        // when (task brief §14's PAIN row in the sidebar reads this).
        vitals: [
          ...next.observations.vitals,
          { atMinutes: event.atMinutes, values: vitalsSnapshot(state) },
        ],
      };
      break;

    case EVENT.LEARNER_TURN_RECEIVED:
      next.turn = state.turn + 1;
      // The learner has now responded to whatever the mentor last asked, so
      // the question contract is discharged (Mentor Spec §13). If the reply
      // was inadequate the mentor re-asks on this same turn, which sets a
      // fresh one - but a question must never outlive the turn that answered
      // it, or every later turn gets read as a reply to an old question.
      next.mentor = { ...state.mentor, openQuestion: null };
      // Same discharge rule for a staff clarification: this turn is the reply
      // to it, so it must not still be open on the turn after this one.
      next.clarification = null;
      break;

    // TIME_ADVANCED CARRIES NO PATIENT TRUTH, ON PURPOSE.
    //
    // It used to apply `payload.physiology` and `payload.symptoms`, which was
    // an ungoverned write path into patient truth: nothing produced such a
    // payload, but any future producer would have bypassed the governance gate
    // entirely just by attaching values to a clock tick. The clock advancing is
    // not a clinical event. Physiology changes through DISEASE_PROGRESSED
    // (gated on the trajectory) or TREATMENT_EFFECT_APPLIED (gated on the
    // effect), and through nothing else - see the causal-trace regression test.
    case EVENT.TIME_ADVANCED:
      break;

    // The reducer previously ignored `payload.symptoms` here while
    // `advanceTime` was emitting it, so a DISEASE_PROGRESSED event recorded a
    // pain value that never reached state - the log and the world disagreed,
    // and an approved trajectory still could not have moved pain. Both halves
    // are now consistent.
    case EVENT.DISEASE_PROGRESSED:
      next.truth = {
        ...state.truth,
        stage: event.payload.stage ?? state.truth.stage,
        ...(event.payload.truth ?? {}),
        naturalCourseStateId: event.payload.transition?.to ?? state.truth.naturalCourseStateId,
        naturalCourseStateEnteredAtMinutes: event.payload.transition?.enteredAtMinutes ?? state.truth.naturalCourseStateEnteredAtMinutes,
      };
      if (event.payload.physiology) next.physiology = { ...state.physiology, ...event.payload.physiology };
      if (event.payload.symptoms) next.symptoms = { ...state.symptoms, ...event.payload.symptoms };
      break;

    case EVENT.POSTOPERATIVE_RECOVERY_UPDATED:
      if (event.payload.physiology) next.physiology = { ...state.physiology, ...event.payload.physiology };
      if (event.payload.symptoms) next.symptoms = { ...state.symptoms, ...event.payload.symptoms };
      if (event.payload.truth) next.truth = { ...state.truth, ...event.payload.truth };
      next.postop = {
        ...state.postop,
        ...(event.payload.postop ?? {}),
        recovery: {
          ...state.postop.recovery,
          ...(event.payload.postop?.recovery ?? {}),
          stateId: event.payload.transition?.to ?? state.postop.recovery.stateId,
          enteredAtMinutes: event.payload.transition?.enteredAtMinutes ?? state.postop.recovery.enteredAtMinutes,
        },
      };
      break;

    case EVENT.HISTORY_OBTAINED:
      next.observations = {
        ...next.observations,
        history: [...next.observations.history, { atMinutes: event.atMinutes, bundle: event.payload.bundleId }],
      };
      break;

    case EVENT.PATIENT_QUESTION_ANSWERED:
      next.observations = {
        ...next.observations,
        history: [
          ...next.observations.history,
          { atMinutes: event.atMinutes, topic: event.payload.topic, findingIds: event.payload.findingIds ?? [] },
        ],
      };
      break;

    case EVENT.EXAMINATION_PERFORMED:
    case EVENT.PATIENT_REASSESSED:
      next.observations = {
        ...next.observations,
        examinations: [
          ...next.observations.examinations,
          { atMinutes: event.atMinutes, region: event.payload.region, findingIds: event.payload.findingIds ?? [] },
        ],
      };
      break;

    case EVENT.VITALS_OBSERVED:
      next.observations = {
        ...next.observations,
        // Pain is observed at the same moment vitals are, and the learner is
        // entitled to see it - it rides in the same snapshot so there is one
        // disclosure record, not two that can disagree about what was known
        // when (task brief §14's PAIN row in the sidebar reads this).
        vitals: [
          ...next.observations.vitals,
          event.payload?.observed
            ? mergeObservedSnapshot(state.observations.vitals.at(-1), event.payload.observed, event.atMinutes)
            : { atMinutes: event.atMinutes, values: vitalsSnapshot(state) },
        ],
      };
      break;

    case EVENT.TEST_ORDERED:
      next.investigations = {
        ...state.investigations,
        [event.payload.investigationId]: {
          id: event.payload.investigationId,
          status: "ordered",
          orderedAt: event.atMinutes,
          etaMinutes: event.payload.etaMinutes,
          availableAt: event.atMinutes + event.payload.etaMinutes,
          preliminaryAt: event.payload.preliminaryAt ?? null,
          result: null,
          preliminary: null,
        },
      };
      break;

    case EVENT.TEST_IN_PROGRESS:
      next.investigations = patchInvestigation(state, event.payload.investigationId, { status: "in_progress" });
      break;

    case EVENT.TEST_PRELIMINARY_REPORTED:
      next.investigations = patchInvestigation(state, event.payload.investigationId, {
        status: "preliminary",
        preliminary: event.payload.preliminary,
      });
      break;

    case EVENT.TEST_RESULTED:
      next.investigations = patchInvestigation(state, event.payload.investigationId, {
        status: "resulted",
        result: event.payload.result,
        resultedAt: event.atMinutes,
      });
      break;

    case EVENT.TEST_UNAVAILABLE:
      next.investigations = patchInvestigation(state, event.payload.investigationId, {
        status: "unavailable",
        reason: event.payload.reason,
      });
      break;

    case EVENT.TEST_CANCELLED:
      next.investigations = patchInvestigation(state, event.payload.investigationId, { status: "cancelled" });
      break;

    case EVENT.MEDICATION_ORDERED:
      next.treatments = {
        ...state.treatments,
        active: [...state.treatments.active, { ...event.payload, orderedAt: event.atMinutes, status: "ordered" }],
      };
      break;

    case EVENT.MEDICATION_ADMINISTERED:
      next.treatments = {
        active: state.treatments.active.filter((item) => item.orderId !== event.payload.orderId),
        administered: [...state.treatments.administered, { ...event.payload, atMinutes: event.atMinutes }],
      };
      break;

    case EVENT.INFUSION_STARTED:
      next.infusions = [...state.infusions, { ...event.payload, startedAt: event.atMinutes, status: "running", observationsAtStart: state.observations.vitals.length }];
      next.fluidBalance = {
        infusedMl: (state.fluidBalance?.infusedMl ?? 0) + (Number(event.payload.volumeMl) || 0),
        bolusMl: (state.fluidBalance?.bolusMl ?? 0) + (event.payload.bolus === true ? Number(event.payload.volumeMl) || 0 : 0),
        fluidIds: [...new Set([...(state.fluidBalance?.fluidIds ?? []), event.payload.fluidId])],
      };
      break;

    case EVENT.INFUSION_STOPPED:
      next.infusions = state.infusions.map((infusion) =>
        (event.payload.orderIds ?? []).includes(infusion.orderId) ? { ...infusion, status: "stopped", stoppedAt: event.atMinutes } : infusion,
      );
      break;

    case EVENT.INFUSION_COMPLETED:
      next.infusions = state.infusions.map((infusion) =>
        infusion.orderId === event.payload.orderId ? { ...infusion, status: "completed" } : infusion,
      );
      break;

    case EVENT.TREATMENT_EFFECT_APPLIED:
      next.physiology = { ...state.physiology, ...(event.payload.physiology ?? {}) };
      if (event.payload.symptoms) next.symptoms = { ...state.symptoms, ...event.payload.symptoms };
      break;

    case EVENT.MONITORING_PRESCRIBED:
      next.monitoring = {
        level: event.payload.level ?? state.monitoring.level,
        prescribed: [...state.monitoring.prescribed, ...(event.payload.parameters ?? [])],
      };
      break;

    case EVENT.PROCEDURE_PERFORMED:
      next.treatments = {
        ...next.treatments,
        administered: [...next.treatments.administered, { ...event.payload, atMinutes: event.atMinutes }],
      };
      break;

    case EVENT.REASONING_STATED:
      next.reasoning = isInteractionV2Enabled(state.session)
        ? mergeReasoningState(state.reasoning, event.payload, state.turn)
        : mergeLegacyReasoningState(state.reasoning, event.payload, state.turn);
      break;

    case EVENT.MANAGEMENT_PLAN_COMMITTED:
      // Committing to an operation is a decision, not a state of readiness.
      // `preop.ready` is untouched here on purpose.
      next.managementPlan = { intent: event.payload.intent, committedAt: event.atMinutes };
      next.preop = { ...state.preop, required: event.payload.requiredPreop ?? state.preop.required };
      break;

    case EVENT.PREOP_ITEM_COMPLETED: {
      const completed = unique([...state.preop.completed, event.payload.itemId]);
      next.preop = { ...state.preop, completed, ready: derivePreopReady(state, completed) };
      break;
    }

    case EVENT.PREOP_ITEM_OMITTED:
      next.preop = { ...state.preop, omitted: unique([...state.preop.omitted, event.payload.itemId]) };
      break;

    case EVENT.CONSENT_OBTAINED: {
      const completed = unique([...state.preop.completed, "consent"]);
      next.preop = { ...state.preop, consent: "obtained", completed, ready: derivePreopReady(state, completed) };
      break;
    }

    // Matrix PR02: fasting history is DATA, not a gate. Recording it also
    // completes the (non-blocking) `fasting_assessment` preop item, whoever
    // obtained it - the learner by asking, or the anesthesiologist on arrival.
    case EVENT.FASTING_HISTORY_OBTAINED: {
      const completed = unique([...state.preop.completed, "fasting_assessment"]);
      next.preop = {
        ...state.preop,
        fasting: { ...(state.preop.fasting ?? {}), ...(event.payload.fasting ?? {}), obtained: true, obtainedBy: event.payload.obtainedBy ?? "learner" },
        completed,
        ready: derivePreopReady(state, completed),
      };
      break;
    }

    case EVENT.CONSENT_REFUSED:
      next.preop = { ...state.preop, consent: "refused", ready: false };
      break;

    case EVENT.ORAL_INTAKE_PRESCRIBED:
      next.postop = { ...state.postop, oralIntake: event.payload.level };
      break;

    case EVENT.SPECIMEN_SENT_TO_PATHOLOGY:
      next.postop = { ...state.postop, histopathologySent: true };
      break;

    case EVENT.DISCHARGE_INSTRUCTIONS_ISSUED:
      next.postop = { ...state.postop, dischargeBundleIssued: true };
      break;

    case EVENT.PATIENT_MOVED:
      next.location = event.payload.to;
      next.monitoring = { ...state.monitoring, level: event.payload.monitoringLevel ?? state.monitoring.level };
      // A move that happens once the operation is done IS the postoperative
      // disposition - the two were previously tracked separately, which left
      // `postop.disposition` permanently null however the learner played.
      if (state.operative.completed) next.postop = { ...state.postop, disposition: event.payload.to };
      break;

    case EVENT.PROCEDURE_STARTED:
      next.operative = { ...state.operative, started: true, approach: event.payload.approach };
      break;

    case EVENT.OPERATIVE_FINDING_REVEALED:
      next.operative = {
        ...state.operative,
        findingsRevealed: unique([...state.operative.findingsRevealed, event.payload.findingId]),
        pendingDecision: event.payload.decisionId ?? state.operative.pendingDecision,
      };
      break;

    case EVENT.OPERATIVE_DECISION_MADE:
      next.operative = {
        ...state.operative,
        decisions: [...state.operative.decisions, { id: event.payload.decisionId, choice: event.payload.choice }],
        pendingDecision: null,
      };
      break;

    // Matrix PO01 / task §18.1: pain before and after source control are
    // different states, not one variable. The TRANSITION is structural and
    // happens here; the post-source-control pain VALUE is content
    // (`trajectories.yaml#post_source_control_course`), that content is null
    // pending review, and nothing invents a recovery curve to fill it.
    //
    // Second Clinical Reviewer Decision, 2026-09-01 (Sarina T.T.): source
    // control can precede completion of the operation, anaesthetic
    // maintenance and surgical closure, so it is NOT the postoperative
    // recovery clock anchor. That anchor lives on PROCEDURE_COMPLETED below.
    case EVENT.SOURCE_CONTROL_COMPLETED:
      next.operative = { ...state.operative, sourceControl: true };
      next.truth = { ...state.truth, sourceControlled: true, stage: "post_source_control" };
      next.symptoms = toPostSourceControlPain(state.symptoms);
      break;

    // The operation-complete event: closure is recorded (payload carries the
    // closure statement) and the patient is moved toward recovery. Second
    // Clinical Reviewer Decision, 2026-09-01 (Sarina T.T., REVISE on
    // TRJ-POSTOP-RECOVERY): this, not SOURCE_CONTROL_COMPLETED, is where the
    // postoperative recovery clock (`postop.recovery.enteredAtMinutes`)
    // starts. `stateId` is deliberately left for the model's own
    // `initial_state_id` to supply (see `evaluateBoundedStateTransition`)
    // rather than being hardcoded here.
    case EVENT.PROCEDURE_COMPLETED:
      next.operative = { ...state.operative, completed: true, pendingDecision: null };
      next.postop = {
        ...state.postop,
        recovery: { ...state.postop.recovery, enteredAtMinutes: event.atMinutes },
      };
      break;

    case EVENT.RESOURCE_CONSTRAINT_REVEALED:
      next.hospital = {
        ...state.hospital,
        constraints: upsertConstraint(state.hospital.constraints, event.payload.constraint),
      };
      break;

    case EVENT.RESOURCE_BECAME_AVAILABLE:
      next.hospital = {
        ...state.hospital,
        constraints: state.hospital.constraints.filter((item) => item.id !== event.payload.constraintId),
      };
      break;

    case EVENT.STAFF_CALLED:
      next.hospital = {
        ...state.hospital,
        staff: {
          ...state.hospital.staff,
          [event.payload.role]: {
            ...state.hospital.staff[event.payload.role],
            called: true,
            etaMinutes: event.payload.etaMinutes,
          },
        },
      };
      break;

    case EVENT.STAFF_ARRIVED:
      next.hospital = {
        ...state.hospital,
        staff: {
          ...state.hospital.staff,
          [event.payload.role]: { ...state.hospital.staff[event.payload.role], present: true, etaMinutes: 0 },
        },
      };
      break;

    case EVENT.DETERIORATION_DETECTED:
      if (event.payload.physiology) next.physiology = { ...state.physiology, ...event.payload.physiology };
      if (event.payload.truth) next.truth = { ...state.truth, ...event.payload.truth };
      next.mentor = { ...state.mentor, openQuestion: null };
      break;

    case EVENT.COMPLICATION_OCCURRED:
      if (event.payload.physiology) next.physiology = { ...state.physiology, ...event.payload.physiology };
      if (event.payload.truth) next.truth = { ...state.truth, ...event.payload.truth };
      next.postop = {
        ...state.postop,
        activeComplications: unique([...state.postop.activeComplications, event.payload.complicationId]),
      };
      break;

    case EVENT.SIMULATOR_LIMITATION_NOTED:
      next.simulatorLimitations = [
        ...state.simulatorLimitations,
        { atMinutes: event.atMinutes, kind: event.payload.kind, id: event.payload.id, reviewStatus: event.payload.reviewStatus, reason: event.payload.reason ?? "not_approved_for_training" },
      ];
      break;

    // The hospital is now waiting on the learner for a named parameter.
    // Recorded as world state, not as a chat message, so the NEXT turn can be
    // read as the answer to it (PBC-8).
    case EVENT.CLARIFICATION_REQUESTED:
      next.clarification = {
        commandType: event.payload.commandType,
        params: event.payload.params ?? {},
        missing: event.payload.missing ?? [],
        askedTurn: state.turn,
      };
      break;

    case EVENT.MENTOR_INTERVENED: {
      // `spoke` (Stateful Grounded Mentor Wave A) is absent on every
      // pre-wave event, which the `!== false` check treats as true -
      // identical to the unconditional `state.turn`/`0` this case always
      // wrote before. It is only ever `false` for a memory-only update on a
      // turn the mentor stayed silent (see submitLearnerTurn.js), and exists
      // so that update doesn't get misread as an actual intervention.
      const spoke = event.payload.spoke !== false;
      next.mentor = {
        ...state.mentor,
        lastInterventionTurn: spoke ? state.turn : state.mentor.lastInterventionTurn,
        openQuestion: event.payload.openQuestion ?? null,
        scaffolding: event.payload.scaffolding ?? state.mentor.scaffolding,
        silentTurns: spoke ? 0 : state.mentor.silentTurns,
        raisedIssues: event.payload.issueId
          ? unique([...state.mentor.raisedIssues, event.payload.issueId])
          : state.mentor.raisedIssues,
        // Stateful Grounded Mentor Wave A fields: only present in the payload
        // when `mentorMemory.js` computed them (STATEFUL_GROUNDED_MENTOR_V1
        // on for this session - see submitLearnerTurn.js). Absent means "flag
        // off, or this decision didn't change working memory" - keep the
        // prior value, so a flag-off session's `state.mentor` never grows
        // these fields beyond their initial null/0/[] defaults.
        pendingMentorQuestion: "pendingMentorQuestion" in event.payload
          ? event.payload.pendingMentorQuestion
          : state.mentor.pendingMentorQuestion,
        probingStreak: event.payload.probingStreak ?? state.mentor.probingStreak,
        recentMentorQuestions: event.payload.recentMentorQuestions ?? state.mentor.recentMentorQuestions,
        deferredMentorIssues: event.payload.deferredMentorIssues ?? state.mentor.deferredMentorIssues,
      };
      break;
    }

    case EVENT.PATIENT_DISCHARGED:
    case EVENT.PATIENT_TRANSFERRED:
    case EVENT.PATIENT_DIED:
      next.session = { ...state.session, status: "complete", endpoint: endpointOf(event) };
      break;

    case EVENT.SESSION_ENDED:
      next.session = {
        ...state.session,
        status: event.payload.status ?? "incomplete",
        endpoint: state.session.endpoint,
      };
      break;

    default:
      break;
  }

  // Scheduling future work is also cross-cutting: any event may carry
  // `payload.scheduledPending`, computed by the layer that produced the event
  // (it alone has the content/patient context to know the due time and the
  // eventual result). The reducer's only job is to append it, so `pending` -
  // like everything else - stays a pure function of the event log.
  if (event.payload.scheduledPending?.length) {
    let seq = next.pending.length;
    next.pending = [
      ...next.pending,
      ...event.payload.scheduledPending.map((item) => ({ ...item, seq: seq++ })),
    ];
  }

  // The other half of the same mechanism: an event that RESOLVES a pending
  // item (a result arriving, an infusion finishing, staff showing up, a
  // complication check completing either way) names it via
  // `payload.resolvedPendingId`, and the reducer retires it. Without this
  // half a due item would be re-drained on every later TIME_ADVANCED call -
  // for a probabilistic complication check that would mean re-rolling the
  // same dice forever.
  if (event.payload.resolvedPendingId) {
    next.pending = next.pending.filter((item) => item.id !== event.payload.resolvedPendingId);
  }

  // Disclosure is a cross-cutting consequence of certain events rather than
  // something each case above has to remember to do.
  if (DISCLOSING_EVENTS.includes(event.type)) {
    next.revealed = {
      findings: unique([...state.revealed.findings, ...(event.payload.findingIds ?? [])]),
      results: unique([
        ...state.revealed.results,
        ...(event.payload.investigationId ? [event.payload.investigationId] : []),
      ]),
      constraints: unique([
        ...state.revealed.constraints,
        ...(event.payload.constraint ? [event.payload.constraint.id] : []),
      ]),
    };
  }

  // Monitoring adequacy is DERIVED, never stored as a manually-set value
  // (task brief P1-2.2). Previously `monitoring.level === "inadequate"` was
  // read by the complication check but nothing could ever produce it, so
  // that whole probability branch was unreachable in play.
  next.monitoring = { ...next.monitoring, adequacy: deriveMonitoringAdequacy(next) };

  next.workflow = { label: deriveWorkflowLabel(next) };
  return next;
}

export function reduceEvents(initial, events) {
  return events.reduce(applyEvent, initial);
}

/**
 * Monitoring adequacy, derived from where the patient is and what was
 * actually prescribed (task brief P1-2.2).
 *
 * Deliberately structural, not a clinical claim: this asks only "is this a
 * postoperative patient in a low-observation location with no monitoring
 * orders written", which is a workflow fact the architecture owns. It does
 * NOT encode any threshold about which patients need which monitoring
 * intensity - that is Clinical Rule Layer content and is not approved
 * (see docs/IMPLEMENTATION_GAP_AUDIT_2026-08-23.md). It also does not, by
 * itself, change any complication's biological incidence: the probability
 * branch it feeds is separately governance-gated, per the task brief's
 * explicit caution against inventing that relationship.
 */
function deriveMonitoringAdequacy(state) {
  if (!state.operative.completed) return "not_applicable";
  const lowObservation = state.location === "surgical_ward";
  const nothingPrescribed = state.monitoring.prescribed.length === 0;
  return lowObservation && nothingPrescribed ? "inadequate" : "adequate";
}

/**
 * A patient is not "ready for the OR" merely because every entry of an
 * empty `required` list is vacuously satisfied (Core Runtime Spec §58:
 * readiness must be real, not conversational). Readiness requires an actual
 * operative management plan to have populated `required` in the first
 * place, and every `blocking` item in it to be completed.
 */
function derivePreopReady(state, completed) {
  const blocking = state.preop.required.filter((item) => item.blocking);
  if (state.managementPlan.intent !== "operative" || blocking.length === 0) return false;
  return blocking.every((item) => completed.includes(item.id));
}

/**
 * One vitals snapshot. Pain rides in the same record as the vital signs so
 * there is a single disclosure fact, and it is read through `activePainScore`
 * so a patient whose source has been controlled is never reported as still
 * having the pre-source-control pain (matrix PO01).
 */
// A targeted observation (content-declared `observation_targets`) discloses
// only the fields actually measured; earlier-measured fields are kept, each
// with its own measurement time, so nothing unmeasured is ever shown.
function mergeObservedSnapshot(previous, observed, atMinutes) {
  const values = { ...(previous?.values ?? {}), ...observed };
  const fieldAtMinutes = { ...(previous?.fieldAtMinutes ?? Object.fromEntries(Object.keys(previous?.values ?? {}).map((k) => [k, previous.atMinutes]))) };
  for (const key of Object.keys(observed)) fieldAtMinutes[key] = atMinutes;
  return { atMinutes, values, fieldAtMinutes };
}

function vitalsSnapshot(state) {
  return { ...state.physiology, painScore: activePainScore(state.symptoms), painState: state.symptoms.painState };
}

function patchInvestigation(state, id, patch) {
  const current = state.investigations[id];
  if (!current) return state.investigations;
  return { ...state.investigations, [id]: { ...current, ...patch } };
}

function upsertConstraint(constraints, constraint) {
  const rest = constraints.filter((item) => item.id !== constraint.id);
  return [...rest, constraint];
}

function endpointOf(event) {
  return {
    type: TERMINAL_EVENTS.includes(event.type) ? event.type : "SESSION_ENDED",
    atMinutes: event.atMinutes,
    detail: event.payload.detail ?? null,
  };
}

function unique(items) {
  return [...new Set(items)];
}

/**
 * A label for analytics and the developer panel ONLY.
 *
 * It is derived FROM the dimensions, never the other way round, and no clinical
 * decision anywhere in the codebase may branch on it. It is not exported to the
 * learner UI. Deleting it must change nothing except a dev readout.
 */
function deriveWorkflowLabel(state) {
  if (state.session.endpoint) return "closed";
  if (state.postop.disposition) return "postoperative";
  if (state.operative.completed) return "postoperative";
  if (state.operative.started) return "intraoperative";
  if (state.managementPlan.intent === "operative") return "perioperative_preparation";
  if (Object.keys(state.investigations).length > 0) return "workup";
  if (state.observations.examinations.length > 0 || state.observations.history.length > 0) return "assessment";
  return "arrival";
}

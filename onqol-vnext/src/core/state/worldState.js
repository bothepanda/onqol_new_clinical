import { EVENT, DISCLOSING_EVENTS, TERMINAL_EVENTS } from "../events/eventTypes.js";

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
      presentationCategory: session.presentationCategory,
      contentVersions: session.contentVersions,
      status: "active", // active | complete | incomplete
      endpoint: null,
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
    location: "emergency_department",
    monitoring: { level: "ed_standard", prescribed: [] },

    // ---- Things that are running --------------------------------------
    investigations: {}, // id -> { id, status, orderedAt, etaMinutes, availableAt, result, preliminary }
    treatments: { active: [], administered: [] },
    infusions: [],

    // ---- What the learner knows ---------------------------------------
    revealed: {
      findings: [], // finding ids the learner has actually been shown
      results: [], // investigation ids whose results are on screen
      constraints: [], // resource constraint ids disclosed
    },
    observations: { vitals: [], examinations: [], history: [] },

    // ---- What the learner has decided ---------------------------------
    reasoning: {
      stabilityStated: false,
      workingDiagnosis: null,
      differential: [],
      statements: [],
    },
    managementPlan: { intent: null, committedAt: null }, // "operative" | "nonoperative" | "observation"

    preop: {
      required: [], // filled from content when an operative plan is committed
      completed: [],
      omitted: [],
      consent: "not_obtained", // not_obtained | obtained | refused
      ready: false,
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

    postop: { disposition: null, day: 0, activeComplications: [] },

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
      staff: { ...hospital.staff },
    },

    // ---- Scheduler ------------------------------------------------------
    // Work the world owes the learner: a result that will land, an infusion
    // that will finish, a consultant who will arrive, a disease step that will
    // happen. Ordered by dueAt when drained.
    pending: [],

    // ---- Teaching bookkeeping (never clinical truth) ---------------------
    mentor: {
      lastInterventionTurn: null,
      openQuestion: null, // { issueId, expects, askedTurn, scaffolding }
      scaffolding: 0,
      silentTurns: 0,
      raisedIssues: [],
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
      next.observations = {
        ...next.observations,
        // Pain is observed at the same moment vitals are, and the learner is
        // entitled to see it - it rides in the same snapshot so there is one
        // disclosure record, not two that can disagree about what was known
        // when (task brief §14's PAIN row in the sidebar reads this).
        vitals: [
          ...next.observations.vitals,
          { atMinutes: event.atMinutes, values: { ...state.physiology, painScore: state.symptoms.painScore } },
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
      break;

    case EVENT.TIME_ADVANCED:
      if (event.payload.physiology) next.physiology = { ...state.physiology, ...event.payload.physiology };
      if (event.payload.symptoms) next.symptoms = { ...state.symptoms, ...event.payload.symptoms };
      break;

    case EVENT.DISEASE_PROGRESSED:
      next.truth = { ...state.truth, stage: event.payload.stage ?? state.truth.stage };
      if (event.payload.physiology) next.physiology = { ...state.physiology, ...event.payload.physiology };
      break;

    case EVENT.HISTORY_OBTAINED:
      next.observations = {
        ...next.observations,
        history: [...next.observations.history, { atMinutes: event.atMinutes, bundle: event.payload.bundleId }],
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
          { atMinutes: event.atMinutes, values: { ...state.physiology, painScore: state.symptoms.painScore } },
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
      next.infusions = [...state.infusions, { ...event.payload, startedAt: event.atMinutes, status: "running" }];
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
      next.reasoning = {
        ...state.reasoning,
        stabilityStated: state.reasoning.stabilityStated || Boolean(event.payload.stability),
        workingDiagnosis: event.payload.workingDiagnosis ?? state.reasoning.workingDiagnosis,
        differential: event.payload.differential?.length
          ? unique([...state.reasoning.differential, ...event.payload.differential])
          : state.reasoning.differential,
        statements: [...state.reasoning.statements, { atTurn: state.turn, text: event.payload.text }],
      };
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

    case EVENT.CONSENT_REFUSED:
      next.preop = { ...state.preop, consent: "refused", ready: false };
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

    case EVENT.SOURCE_CONTROL_COMPLETED:
      next.operative = { ...state.operative, sourceControl: true };
      next.truth = { ...state.truth, sourceControlled: true };
      break;

    case EVENT.PROCEDURE_COMPLETED:
      next.operative = { ...state.operative, completed: true, pendingDecision: null };
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
        { atMinutes: event.atMinutes, kind: event.payload.kind, id: event.payload.id, reviewStatus: event.payload.reviewStatus },
      ];
      break;

    case EVENT.MENTOR_INTERVENED:
      next.mentor = {
        ...state.mentor,
        lastInterventionTurn: state.turn,
        openQuestion: event.payload.openQuestion ?? null,
        scaffolding: event.payload.scaffolding ?? state.mentor.scaffolding,
        silentTurns: 0,
        raisedIssues: event.payload.issueId
          ? unique([...state.mentor.raisedIssues, event.payload.issueId])
          : state.mentor.raisedIssues,
      };
      break;

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
 * empty `required` list is vacuously satisfied (Core Foundation Spec §58:
 * readiness must be real, not conversational). Readiness requires an actual
 * operative management plan to have populated `required` in the first
 * place, and every `blocking` item in it to be completed.
 */
function derivePreopReady(state, completed) {
  const blocking = state.preop.required.filter((item) => item.blocking);
  if (state.managementPlan.intent !== "operative" || blocking.length === 0) return false;
  return blocking.every((item) => completed.includes(item.id));
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

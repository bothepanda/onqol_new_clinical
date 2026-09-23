import { EVENT } from "../events/eventTypes.js";
import { createEvent } from "../events/eventLog.js";
import { drainPendingWork } from "./scheduler.js";
import { hospitalIso } from "./clock.js";
import { isRuntimeAuthoritative, simulatorLimitation } from "../rules/governance.js";
import { reviewStatusOf } from "../rules/contentProvenance.js";
import { activePainField } from "../state/painState.js";
import { reduceEvents } from "../state/worldState.js";
import { evaluateBoundedStateTransition } from "./boundedStateTransitions.js";

/**
 * Advancing the clock to `targetMinutes`.
 *
 * Two independent things happen, both producing ordinary events so replay
 * stays exact (Core Runtime Spec §61):
 *
 *  1. Every piece of *scheduled* work due by `targetMinutes` drains - a test
 *     resulting, an infusion completing, a consultant arriving, a treatment
 *     effect reaching onset, a postoperative complication check. Each pending
 *     item was created by baking `scheduledPending` onto the event that
 *     caused it (see `executeCommand.js`), so this function never invents
 *     timing - it only resolves timing someone already authored.
 *
 *  2. Natural course over the whole `[elapsedMinutes, targetMinutes]` interval
 *     is offered to the trajectory's reviewed course model, as one
 *     DISEASE_PROGRESSED event carrying absolute values. Computed directly
 *     rather than queued, so `pending` stays limited to things a specific past
 *     action genuinely scheduled.
 *
 *     As of the 2026-08-25 clinical remediation there is NO approved course
 *     model: the previous fixed per-hour drift was withdrawn by clinical
 *     review, and nothing replaced it. Every advance therefore records a
 *     simulator limitation instead of moving patient truth.
 *
 * GOVERNANCE (task brief P0-5): every clinical-content-driven change here -
 * trajectory drift, recovery, treatment effect, complication probability -
 * passes `isRuntimeAuthoritative` on the content item's own `review_status`
 * before it may touch patient truth. Content below that bar produces a
 * SIMULATOR_LIMITATION_NOTED event instead: the fact that a modeled effect
 * was withheld stays in the causal log and can be shown in debrief as a
 * simulator limitation, never as a learner omission.
 */
export function advanceTime({ state, clockRoot, bundle, rng, targetMinutes, cause }) {
  if (targetMinutes <= state.clock.elapsedMinutes) return { events: [] };

  const runItem = (currentState, item) => runPendingItem({ state: currentState, clockRoot, bundle, rng, item, cause });
  const { events } = drainPendingWork(state, targetMinutes, runItem);
  const afterPending = reduceEvents(state, events);
  // Second Clinical Reviewer Decision, 2026-09-01 (Sarina T.T.): the
  // postoperative recovery course starts once the OPERATION is complete
  // (PROCEDURE_COMPLETED), not at source control alone - source control can
  // precede closure and anaesthetic emergence.
  const progressionEvents = afterPending.operative.completed
    ? buildPostoperativeRecoveryEvents({ state: afterPending, clockRoot, bundle, rng, targetMinutes, cause })
    : buildProgressionEvents({ state: afterPending, clockRoot, bundle, rng, targetMinutes, cause, fromMinutes: state.clock.elapsedMinutes });

  const timeEvent = createEvent({
    type: EVENT.TIME_ADVANCED,
    atMinutes: targetMinutes,
    atIso: hospitalIso(clockRoot, targetMinutes),
    payload: {},
    cause,
  });

  return { events: [...events, ...progressionEvents, timeEvent] };
}

/**
 * Natural course, from the trajectory the patient is actually on.
 *
 * Pre- and post-source-control behaviour live in the same content object, so
 * both are gated by that object's single review status - a trajectory is
 * approved as a whole natural history or not at all.
 */
function buildProgressionEvents({ state, clockRoot, bundle, rng, targetMinutes, cause, fromMinutes = state.clock.elapsedMinutes }) {
  const trajectoryId = state.truth.trajectoryId ?? "TRJ-STABLE";
  const trajectory = bundle.trajectories.trajectories[trajectoryId];
  if (!trajectory) return [];

  // Compared with where the clock was BEFORE this advance drained its pending
  // work: `state` is already folded through those events, so a treatment effect
  // due exactly at the target would otherwise make the interval look empty and
  // silently skip the natural course (found in Wave B: overload never
  // triggered when the last bolus landed at the wait's end).
  if (targetMinutes <= fromMinutes) return [];

  const atIso = hospitalIso(clockRoot, targetMinutes);

  // Two independent conditions, both of which must hold before natural course
  // may touch patient truth:
  //
  //   1. the trajectory content is `approved_for_training`;
  //   2. it actually carries a reviewed course MODEL.
  //
  // (2) is new in the 2026-08-25 remediation. The old fixed per-hour arithmetic
  // (HR +1/h, T +0.03/h, CRP +4/h, pain +0.15/h) was withdrawn by the clinical
  // review as not being a guideline-derived biological law (matrix T01/T02),
  // and the task forbids inventing replacement numbers. `natural_course_model`
  // is therefore null, and would stay inert even if someone promoted the
  // trajectory's review status by hand - promotion alone cannot resurrect
  // deleted arithmetic.
  const model = trajectory.natural_course_model;
  if (!isRuntimeAuthoritative(reviewStatusOf(trajectory)) || model == null) {
    // The patient does not silently freeze in time as if nothing were
    // modeled - the withheld progression is recorded, once per advance, so
    // the debrief can say "disease progression is not simulated in this
    // build pending clinical review" rather than implying the disease was
    // static or that the learner's management held it stable.
    return [
      createEvent({
        type: EVENT.SIMULATOR_LIMITATION_NOTED,
        atMinutes: targetMinutes,
        atIso,
        payload: simulatorLimitation({
          kind: "trajectory",
          id: trajectoryId,
          reviewStatus: reviewStatusOf(trajectory) ?? null,
        }),
        cause: { actor: "system", source: "governance_gate" },
      }),
    ];
  }

  // Reached only by a trajectory that is BOTH approved and carries a reviewed
  // bounded state-transition model. No such content exists yet; when it does,
  // it produces its own absolute values here rather than a per-hour delta.
  const step = evaluateBoundedStateTransition({
    model,
    state,
    currentStateId: state.truth.naturalCourseStateId,
    enteredAtMinutes: state.truth.naturalCourseStateEnteredAtMinutes,
    targetMinutes,
    rng,
    streamName: `natural_course:${trajectoryId}`,
  });
  if (!step) return [];
  return courseEvents({
    eventType: EVENT.DISEASE_PROGRESSED,
    step,
    atMinutes: targetMinutes,
    atIso,
    cause: { ...cause, source: cause?.source ?? `trajectory:${trajectoryId}` },
  });
}

function buildPostoperativeRecoveryEvents({ state, clockRoot, bundle, rng, targetMinutes, cause }) {
  const course = bundle.trajectories?.post_source_control_course;
  const model = course?.model;
  const atIso = hospitalIso(clockRoot, targetMinutes);
  if (!isRuntimeAuthoritative(reviewStatusOf(course)) || model == null) {
    return [
      createEvent({
        type: EVENT.SIMULATOR_LIMITATION_NOTED,
        atMinutes: targetMinutes,
        atIso,
        payload: simulatorLimitation({
          kind: "postoperative_recovery",
          id: course?.provenance?.id ?? "post_source_control_course",
          reviewStatus: reviewStatusOf(course) ?? null,
        }),
        cause: { actor: "system", source: "governance_gate" },
      }),
    ];
  }
  const step = evaluateBoundedStateTransition({
    model,
    state,
    currentStateId: state.postop.recovery?.stateId,
    enteredAtMinutes: state.postop.recovery?.enteredAtMinutes,
    targetMinutes,
    rng,
    streamName: "postoperative_recovery",
  });
  if (!step) {
    // No milestone transition is due yet. If the model has not been entered at
    // all, materialise its DECLARED initial state once - `initial_state_id` and
    // that state's `postop_pain_state`, read straight from the approved content
    // (`evaluateBoundedStateTransition` already treats a null `stateId` as being
    // in this state). This is not a time-scaled or invented value: it is the
    // entry condition of the reviewed recovery model, so the immediate
    // postoperative patient carries the qualitative pain stage the model
    // assigns to `pacu_emergence` ("significant") instead of an empty field
    // until the first milestone is reached.
    const initialStateId = model.initial_state_id ?? model.states?.[0]?.id ?? null;
    const initialState = (model.states ?? []).find((s) => s.id === initialStateId) ?? null;
    if (state.postop.recovery?.stateId == null && initialStateId && initialState?.postop_pain_state) {
      return [
        createEvent({
          type: EVENT.POSTOPERATIVE_RECOVERY_UPDATED,
          atMinutes: targetMinutes,
          atIso,
          payload: {
            symptoms: { postopPainStage: initialState.postop_pain_state },
            truth: { recoveryPhase: initialStateId },
            transition: {
              id: "postoperative_recovery_initialised",
              from: null,
              to: initialStateId,
              // Keep the recovery clock anchored where PROCEDURE_COMPLETED set
              // it, so the next milestone's `eligible_after_minutes` still
              // measures from the operation-complete event.
              enteredAtMinutes: state.postop.recovery.enteredAtMinutes ?? targetMinutes,
            },
          },
          cause: { ...cause, source: cause?.source ?? "postoperative_recovery" },
        }),
      ];
    }
    return [];
  }
  return courseEvents({
    eventType: EVENT.POSTOPERATIVE_RECOVERY_UPDATED,
    step,
    atMinutes: targetMinutes,
    atIso,
    cause: { ...cause, source: cause?.source ?? "postoperative_recovery" },
  });
}

function courseEvents({ eventType, step, atMinutes, atIso, cause }) {
  const events = [
    createEvent({
      type: eventType,
      atMinutes,
      atIso,
      payload: {
        ...step.effects,
        transition: {
          id: step.transitionId,
          from: step.from,
          to: step.to,
          enteredAtMinutes: step.enteredAtMinutes,
        },
      },
      cause: { ...cause, ruleIds: step.ruleIds, sourceIds: step.sourceIds },
    }),
  ];
  if (step.deterioration) {
    events.push(
      createEvent({
        type: EVENT.DETERIORATION_DETECTED,
        atMinutes,
        atIso,
        payload: {
          causeId: step.deterioration.cause_id ?? step.transitionId,
          textRu: step.deterioration.text_ru ?? null,
          physiology: step.effects.physiology,
          truth: step.effects.truth,
          findingIds: step.deterioration.finding_ids ?? [],
        },
        cause: { actor: "system", source: "deterioration_watcher", ruleIds: step.ruleIds, sourceIds: step.sourceIds },
      }),
    );
  }
  return events;
}

function runPendingItem({ state, clockRoot, bundle, rng, item, cause }) {
  const atIso = hospitalIso(clockRoot, item.dueAtMinutes);

  switch (item.kind) {
    case "test_result": {
      const investigation = state.investigations[item.investigationId];
      if (!investigation) return { events: [] };
      if (item.phase === "preliminary") {
        return {
          events: [
            createEvent({
              type: EVENT.TEST_PRELIMINARY_REPORTED,
              atMinutes: item.dueAtMinutes,
              atIso,
              payload: { investigationId: item.investigationId, preliminary: item.preliminaryText, resolvedPendingId: item.id },
              cause,
            }),
          ],
        };
      }
      return {
        events: [
          createEvent({
            type: EVENT.TEST_RESULTED,
            atMinutes: item.dueAtMinutes,
            atIso,
            payload: { investigationId: item.investigationId, result: item.result, resolvedPendingId: item.id },
            cause,
          }),
        ],
      };
    }

    case "infusion_complete":
      return {
        events: [
          createEvent({
            type: EVENT.INFUSION_COMPLETED,
            atMinutes: item.dueAtMinutes,
            atIso,
            payload: { orderId: item.orderId, resolvedPendingId: item.id },
            cause,
          }),
        ],
      };

    case "staff_arrival":
      return {
        events: [
          createEvent({ type: EVENT.STAFF_ARRIVED, atMinutes: item.dueAtMinutes, atIso, payload: { role: item.role, resolvedPendingId: item.id }, cause }),
        ],
      };

    // A preoperative item whose completion is a real-world arrival rather
    // than an instantaneous learner action (anesthesia review). Generic:
    // the item id comes from the pending entry, not from a branch here.
    case "preop_item_ready":
      return {
        events: [
          createEvent({
            type: EVENT.PREOP_ITEM_COMPLETED,
            atMinutes: item.dueAtMinutes,
            atIso,
            payload: { itemId: item.itemId, resolvedPendingId: item.id },
            cause: { actor: "system", source: "preop_workflow" },
          }),
        ],
      };

    // Only ever scheduled for content that already passed the governance
    // gate at order time (`scheduleGovernedTreatmentEffect`), so reaching
    // here means the effect is approved and its deltas may touch patient
    // truth.
    // Only ever scheduled for content that already passed the governance gate
    // AND carries a reviewed response envelope (`scheduleGovernedTreatmentEffect`
    // in executeCommand.js). Reaching here means both are true, so the
    // envelope's deltas may touch patient truth.
    case "treatment_effect": {
      const physiology = {};
      for (const [key, delta] of Object.entries(item.deltas ?? {})) {
        if (delta == null) continue;
        const previous = state.physiology[key];
        const raw = DECIMAL_PHYSIOLOGY_FIELDS.has(key) ? round1(previous + delta) : Math.round(previous + delta);
        physiology[key] = clampToBound(previous, delta, raw, item.bounds?.[key]);
      }
      const symptoms = {};
      // Analgesia acts on whichever pain state is active; it can never write
      // the pre-source-control pain of a patient whose source is already
      // controlled (matrix PO01).
      if (item.symptomDeltas?.painScore != null) {
        const field = activePainField(state.symptoms);
        const current = state.symptoms[field];
        if (current != null) symptoms[field] = clampPain(round1(current + item.symptomDeltas.painScore));
      }
      return {
        events: [
          createEvent({
            type: EVENT.TREATMENT_EFFECT_APPLIED,
            atMinutes: item.dueAtMinutes,
            atIso,
            payload: { effectId: item.effectId, physiology, symptoms, resolvedPendingId: item.id },
            cause: {
              actor: "system",
              commandId: item.commandId,
              ruleIds: item.ruleId ? [item.ruleId] : [],
              sourceIds: item.sourceIds ?? [],
              source: `treatment_effect:${item.effectId}`,
            },
          }),
        ],
      };
    }

    // Matrix PR02 / task §13.2: if the learner never asked when the patient
    // last ate or drank, the anesthesiologist obtains it on arrival. This is a
    // real workflow event with a real actor - not a silent state flip - and
    // the learner's omission still reaches the debrief.
    case "fasting_discovery": {
      if (state.preop.fasting?.obtained) return { events: [] };
      return {
        events: [
          createEvent({
            type: EVENT.FASTING_HISTORY_OBTAINED,
            atMinutes: item.dueAtMinutes,
            atIso,
            payload: { fasting: state.preop.fasting ?? null, obtainedBy: "anesthesiologist", resolvedPendingId: item.id },
            cause: { actor: "system", source: "anesthesia_review" },
          }),
        ],
      };
    }

    // Arrival at the receiving facility, after the authored transport time
    // (Contract §3.2). Generic: the destination rides on the pending entry.
    case "transfer_arrival":
      return {
        events: [
          createEvent({
            type: EVENT.PATIENT_TRANSFERRED,
            atMinutes: item.dueAtMinutes,
            atIso,
            payload: { detail: item.destination, resolvedPendingId: item.id },
            cause: { actor: "system", source: "interfacility_transport" },
          }),
        ],
      };

    case "complication_check":
      return { events: complicationCheckEvents({ bundle, rng, item, atIso }) };

    default:
      return { events: [] };
  }
}

// `state` is deliberately NOT a parameter any more: the only thing this
// function used it for was `state.monitoring.adequacy`, to pick between a
// base and an "inadequate monitoring" probability. Matrix T07/PO09 removed
// that relationship as an unsupported causal claim, and removing the argument
// makes reintroducing it a visible change rather than a one-line edit.
function complicationCheckEvents({ bundle, rng, item, atIso }) {
  const complication = (bundle.complications.postoperative_course.complications ?? []).find((c) => c.id === item.complicationId);
  if (!complication) {
    // Content named a complication id that isn't in the compiled bundle - do
    // not silently leave the pending item queued forever re-rolling itself.
    return [
      createEvent({
        type: EVENT.COMPLICATION_CHECK_CLEARED,
        atMinutes: item.dueAtMinutes,
        atIso,
        payload: { complicationId: item.complicationId, reason: "unknown_complication_id", resolvedPendingId: item.id },
        cause: { actor: "system", source: "complication_check" },
      }),
    ];
  }

  // Governance Spec §7/§8: a complication probability is high-risk clinical
  // content. An unapproved rate is NOT rolled and NOT quietly treated as
  // "cleared" - clearing it would assert, falsely, that a reviewed
  // probability had been evaluated and came out negative.
  if (!isRuntimeAuthoritative(reviewStatusOf(complication))) {
    return [
      createEvent({
        type: EVENT.SIMULATOR_LIMITATION_NOTED,
        atMinutes: item.dueAtMinutes,
        atIso,
        payload: {
          ...simulatorLimitation({ kind: "complication", id: complication.id, reviewStatus: reviewStatusOf(complication) ?? null }),
          resolvedPendingId: item.id,
        },
        cause: { actor: "system", source: "governance_gate" },
      }),
    ];
  }

  // MONITORING ADEQUACY NO LONGER SELECTS A PROBABILITY BRANCH.
  //
  // The previous version read `probability_with_inadequate_monitoring` when the
  // derived monitoring adequacy was "inadequate". Matrix T07/PO09 removed that
  // outright: "inadequate monitoring raises the biological incidence of SSI" is
  // a causal claim with no supporting evidence. Monitoring affects DETECTION
  // and ESCALATION, not incidence, and a future model must say so explicitly
  // rather than reusing this branch. The multiplier is also gone from
  // `complications.yaml`, so there is nothing left to read.
  const probability = complication.base_probability;
  const fires = rng.stream("complications").chance(probability);
  const cause = { actor: "system", source: "complication_check", ruleIds: [complication.id] };

  if (!fires) {
    // A negative check is itself an auditable fact (Core Runtime Spec
    // §41): this complication was rolled for, at this probability, and ruled
    // out - not merely "nothing happened".
    return [
      createEvent({
        type: EVENT.COMPLICATION_CHECK_CLEARED,
        atMinutes: item.dueAtMinutes,
        atIso,
        payload: { complicationId: complication.id, probability, resolvedPendingId: item.id },
        cause,
      }),
    ];
  }
  return [
    createEvent({
      type: EVENT.COMPLICATION_OCCURRED,
      atMinutes: item.dueAtMinutes,
      atIso,
      payload: { complicationId: complication.id, presentationRu: complication.presentation_ru, resolvedPendingId: item.id },
      cause,
    }),
  ];
}

// Physiology fields that carry a decimal (round to 1dp on delta application,
// not the integer rounding the rest of physiology uses). Generic across
// diseases - a content author naming a new decimal field here is a one-line
// registration, not a new core branch.
const DECIMAL_PHYSIOLOGY_FIELDS = new Set(["temperatureC", "crtSeconds", "lactate"]);

// Content-declared saturation (`response_envelope.bounds`): a delta may move a
// value toward its bound but never past it, and never back the other way.
function clampToBound(previous, delta, next, bound) {
  if (!bound) return next;
  if (delta < 0 && bound.min != null) return Math.min(previous, Math.max(next, bound.min));
  if (delta > 0 && bound.max != null) return Math.max(previous, Math.min(next, bound.max));
  return next;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function clampPain(value) {
  return Math.min(10, Math.max(0, value));
}

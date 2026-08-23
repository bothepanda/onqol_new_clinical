import { EVENT } from "../events/eventTypes.js";
import { createEvent } from "../events/eventLog.js";
import { drainPendingWork } from "./scheduler.js";
import { hospitalIso } from "./clock.js";
import { isRuntimeAuthoritative, simulatorLimitation } from "../rules/governance.js";

/**
 * Advancing the clock to `targetMinutes`.
 *
 * Two independent things happen, both producing ordinary events so replay
 * stays exact (Core Foundation Spec §61):
 *
 *  1. Every piece of *scheduled* work due by `targetMinutes` drains - a test
 *     resulting, an infusion completing, a consultant arriving, a treatment
 *     effect reaching onset, a postoperative complication check. Each pending
 *     item was created by baking `scheduledPending` onto the event that
 *     caused it (see `executeCommand.js`), so this function never invents
 *     timing - it only resolves timing someone already authored.
 *
 *  2. Disease progression (pre-source-control drift, post-source-control
 *     recovery) is computed directly over the whole
 *     `[elapsedMinutes, targetMinutes]` interval, as one DISEASE_PROGRESSED
 *     event carrying the resulting absolute values. This is deliberately NOT
 *     modeled as a queued pending item: a queue entry would have to be
 *     re-armed after every drain, which is exactly the kind of state that
 *     lives outside the event log and breaks pure replay (see git history on
 *     this file for the bug that motivated the change). Computing it directly
 *     from elapsed time keeps `pending` limited to things that are genuinely
 *     scheduled by a specific past action.
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

  const progressionEvents = buildProgressionEvents({ state, clockRoot, bundle, targetMinutes, cause });

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
 * Pre-source-control drift and post-source-control recovery, from the
 * trajectory the patient is actually on. Both directions live in the same
 * content object (`trajectories.yaml`), so both are gated by that object's
 * single `review_status` - a trajectory is approved as a whole natural
 * history or not at all.
 */
function buildProgressionEvents({ state, clockRoot, bundle, targetMinutes, cause }) {
  const trajectoryId = state.truth.trajectoryId ?? "TRJ-STABLE";
  const trajectory = bundle.trajectories.trajectories[trajectoryId];
  if (!trajectory) return [];

  const hours = (targetMinutes - state.clock.elapsedMinutes) / 60;
  if (hours <= 0) return [];

  const atIso = hospitalIso(clockRoot, targetMinutes);

  if (!isRuntimeAuthoritative(trajectory.review_status)) {
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
          reviewStatus: trajectory.review_status,
        }),
        cause: { actor: "system", source: "governance_gate" },
      }),
    ];
  }

  const rates = state.operative.sourceControl
    ? trajectory.post_source_control_recovery_per_hour
    : trajectory.pre_source_control_drift_per_hour;
  if (!rates) return [];

  const physiology = {
    heartRate: Math.round(state.physiology.heartRate + (rates.heart_rate ?? 0) * hours),
    temperatureC: round1(state.physiology.temperatureC + (rates.temperature_c ?? 0) * hours),
    crp: Math.round(state.physiology.crp + (rates.crp ?? 0) * hours),
  };
  const painScore = clampPain(round1(state.symptoms.painScore + (rates.pain_score ?? 0) * hours));

  return [
    createEvent({
      type: EVENT.DISEASE_PROGRESSED,
      atMinutes: targetMinutes,
      atIso,
      payload: {
        physiology,
        symptoms: { painScore },
        stage: state.operative.sourceControl ? "recovering" : "untreated",
      },
      cause: { ...cause, source: cause?.source ?? `trajectory:${trajectoryId}` },
    }),
  ];
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
    case "treatment_effect": {
      const physiology = {};
      for (const [key, delta] of Object.entries(item.deltas ?? {})) {
        if (delta == null) continue;
        physiology[key] = key === "temperatureC" ? round1(state.physiology[key] + delta) : Math.round(state.physiology[key] + delta);
      }
      const symptoms = {};
      if (item.symptomDeltas?.painScore != null) {
        symptoms.painScore = clampPain(round1(state.symptoms.painScore + item.symptomDeltas.painScore));
      }
      return {
        events: [
          createEvent({
            type: EVENT.TREATMENT_EFFECT_APPLIED,
            atMinutes: item.dueAtMinutes,
            atIso,
            payload: { effectId: item.effectId, physiology, symptoms, resolvedPendingId: item.id },
            cause: { actor: "system", source: `treatment_effect:${item.effectId}` },
          }),
        ],
      };
    }

    case "complication_check":
      return { events: complicationCheckEvents({ state, bundle, rng, item, atIso }) };

    default:
      return { events: [] };
  }
}

function complicationCheckEvents({ state, bundle, rng, item, atIso }) {
  const complication = bundle.complications.postoperative_course.complications.find((c) => c.id === item.complicationId);
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
  if (!isRuntimeAuthoritative(complication.review_status)) {
    return [
      createEvent({
        type: EVENT.SIMULATOR_LIMITATION_NOTED,
        atMinutes: item.dueAtMinutes,
        atIso,
        payload: {
          ...simulatorLimitation({ kind: "complication", id: complication.id, reviewStatus: complication.review_status }),
          resolvedPendingId: item.id,
        },
        cause: { actor: "system", source: "governance_gate" },
      }),
    ];
  }

  // Monitoring adequacy is DERIVED world state (task brief P1-2.2), not a
  // manually-set field: an inadequate monitoring environment changes which
  // authored probability branch applies.
  const probability =
    state.monitoring.adequacy === "inadequate" ? complication.probability_with_inadequate_monitoring : complication.base_probability;
  const fires = rng.stream("complications").chance(probability);
  const cause = { actor: "system", source: "complication_check", ruleIds: [complication.id] };

  if (!fires) {
    // A negative check is itself an auditable fact (Core Foundation Spec
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

function round1(value) {
  return Math.round(value * 10) / 10;
}

function clampPain(value) {
  return Math.min(10, Math.max(0, value));
}

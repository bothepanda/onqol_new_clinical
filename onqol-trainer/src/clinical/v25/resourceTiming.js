// How long something takes, decided in one place.
//
// WHY
//
// Two systems used to answer this question and they never spoke. The scenario
// engine decided whether a resource was available and how long the shift made
// you wait; the temporal model carried its own constant per action. So an
// ultrasound cost 360 minutes because a table said 360, in a hospital whose own
// capability record said `ultrasound: coverage 24/7`.
//
// That is exactly what the first live run did: reference facility, ultrasound
// declared available round the clock, six hours charged anyway, and then the
// learner was coached about the delay she had not caused. Of the 822 minutes in
// that session, 360 came from this one number.
//
// So the time an action costs is now composed, not looked up:
//
//     total = baseline turnaround + queue delay from THIS shift
//
// The baseline is how long the investigation itself takes. The queue is what the
// facility and the night add. A hospital with the resource available round the
// clock adds nothing.
//
// WHAT THESE NUMBERS ARE
//
// Workflow assumptions, not clinical facts. They describe how long a department
// takes to turn something around, and they are marked for the owner's review -
// see TURNAROUND_REVIEW_STATUS. Nothing here touches physiology: disease time
// advances separately and only through a reviewed trajectory.

import { resolveActionResource } from "./scenarioEngine.js";

/**
 * Baseline turnaround per action, in minutes: the work itself, with no queue.
 *
 * `abdominal_ultrasound` and `pelvic_ultrasound` were 360 here. That number was
 * never a turnaround - it was a night without a sonographer, which belongs to
 * the shift and not to the investigation.
 */
export const BASELINE_TURNAROUND_MINUTES = Object.freeze({
  risk_stratification: 0,
  diagnosis_acute_appendicitis: 0,
  differential_ectopic: 0,
  focused_history: 8,
  abdominal_exam: 6,
  pelvic_gynecologic_screen: 10,
  cbc: 35,
  urinalysis: 20,
  pregnancy_test: 12,
  crp: 35,
  biochemistry: 35,
  abdominal_ultrasound: 30,
  pelvic_ultrasound: 30,
  ct_abdomen: 90,
  active_observation: 120,
  serial_reexamination: 45,
  transfer_before_source_control: 150,
  appendectomy_procedure_start: 15,
  appendectomy_here: 75,
  preop_single_antibiotic_prophylaxis: 5,
  analgesia: 5,
  npo: 2,
  iv_access: 5,
  iv_fluids: 15,
  surgical_consult: 12,
  gynecology_consult: 25,
  antibiotic_observation_course: 20,
  postop_antibiotics_uncomplicated: 5,
  postoperative_reassessment: 0,
  discharge_and_followup: 0,
});

/** Anything not listed above. */
export const DEFAULT_TURNAROUND_MINUTES = 4;

/**
 * `wait_for_ultrasound` is not an investigation, it is the waiting itself.
 *
 * Its cost is whatever the scan's ETA turns out to be in this hospital on this
 * shift - so it is derived, never declared.
 */
export const WAIT_ACTIONS = Object.freeze({
  wait_for_ultrasound: "abdominal_ultrasound",
});

export const TURNAROUND_REVIEW_STATUS = Object.freeze({
  status: "WORKFLOW_ASSUMPTION_NEEDS_OWNER_REVIEW",
  // Named explicitly because it is the number that changed behaviour most.
  note_ru:
    "Базовое время оборота УЗИ снижено с 360 до 30 минут: 360 описывали ночь без врача УЗД, " +
    "а не длительность самого исследования. Ожидание теперь приходит из профиля смены. " +
    "Сами величины оборота - рабочие допущения, не клинические факты.",
  eligible_for_scoring: false,
});

/**
 * What this action costs in this hospital, on this shift.
 *
 * @returns {{
 *   action_id: string,
 *   available: boolean,
 *   baseline_turnaround_minutes: number,
 *   queue_delay_minutes: number,
 *   total_eta_minutes: number,
 *   delay_source: string|null,
 *   learner_visible: boolean,
 *   reveal_text: string|null
 * }}
 */
export function resolveActionEta(scenario, actionId, input = "", clockMinutes = 0) {
  const waitsFor = WAIT_ACTIONS[actionId];
  if (waitsFor) {
    const target = resolveActionEta(scenario, waitsFor, input, clockMinutes);
    if (target.status === "delayed") {
      return {
        ...target,
        action_id: actionId,
        status: "waiting",
        available: true,
        waits_for: waitsFor,
        baseline_turnaround_minutes: 0,
        total_eta_minutes: target.queue_delay_minutes,
        result_ready_at: target.ready_at,
      };
    }
    return {
      ...target,
      action_id: actionId,
      waits_for: waitsFor,
      baseline_turnaround_minutes: 0,
      queue_delay_minutes: 0,
      total_eta_minutes: 0,
      result_ready_at: clockMinutes,
    };
  }

  const baseline = BASELINE_TURNAROUND_MINUTES[actionId] ?? DEFAULT_TURNAROUND_MINUTES;
  const resource = scenario ? resolveActionResource(scenario, actionId, input, clockMinutes) : null;

  // No resource attached, or the shift puts nothing in the way.
  if (!resource || !resource.resource || resource.status === "available") {
    return {
      action_id: actionId,
      status: "available",
      available: true,
      baseline_turnaround_minutes: baseline,
      queue_delay_minutes: 0,
      total_eta_minutes: baseline,
      delay_source: null,
      learner_visible: false,
      reveal_text: null,
      ready_at: resource?.readyAt ?? clockMinutes,
      result_ready_at: clockMinutes + baseline,
    };
  }

  // Permanently absent: no ETA exists, because it is never coming.
  if (resource.status === "unavailable" || resource.status === "transfer_only") {
    return {
      action_id: actionId,
      status: resource.status,
      available: false,
      baseline_turnaround_minutes: baseline,
      queue_delay_minutes: 0,
      total_eta_minutes: 0,
      delay_source: resource.reasonId || "unavailable",
      learner_visible: true,
      reveal_text: resource.revealText || null,
      ready_at: null,
      result_ready_at: null,
      transfer_minutes: resource.transferMinutes || null,
    };
  }

  const queue = resource.delayMinutes || 0;
  return {
    action_id: actionId,
    status: "delayed",
    // Future availability is explicit, but the action cannot execute before it.
    available: false,
    baseline_turnaround_minutes: baseline,
    queue_delay_minutes: queue,
    total_eta_minutes: baseline + queue,
    delay_source: resource.reasonId || "queue",
    learner_visible: true,
    reveal_text: resource.revealText || null,
    ready_at: resource.readyAt,
    result_ready_at: resource.readyAt + baseline,
  };
}

/**
 * The clock cost of one turn.
 *
 * Parallel orders run in parallel: three tests ordered together cost the longest
 * of them, not their sum. A learner who batches sensibly should not be charged
 * for doing so.
 */
export function turnEtaMinutes(scenario, actionIds, input = "", clockMinutes = 0) {
  const etas = [...new Set(actionIds)]
    .map((actionId) => resolveActionEta(scenario, actionId, input, clockMinutes))
    .filter((eta) => eta.available)
    .map((eta) => eta.total_eta_minutes);
  return etas.length ? Math.max(...etas) : 0;
}

/** Human-readable ETA, for answering "когда будет результат?" without ordering. */
export function describeEta(eta) {
  if (!eta.available && eta.status !== "delayed") {
    return eta.reveal_text || "Это исследование сейчас недоступно.";
  }
  const total = eta.total_eta_minutes;
  const when =
    total >= 60
      ? `${Math.floor(total / 60)} ч ${total % 60 ? `${total % 60} мин` : ""}`.trim()
      : `${total} мин`;
  const because = eta.queue_delay_minutes
    ? ` До доступности ресурса: ${eta.queue_delay_minutes} мин.${eta.reveal_text ? ` ${eta.reveal_text}` : ""}`
    : "";
  return `Результат ожидается примерно через ${when}.${because}`;
}

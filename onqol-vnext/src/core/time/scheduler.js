import { EVENT } from "../events/eventTypes.js";

/**
 * Draining pending work.
 *
 * "Advance time" is not one clock tick - it is running every piece of work the
 * world already owes the learner (a lab result, an infusion finishing, a
 * consultant arriving, a scheduled disease step) up to the target minute, each
 * one producing its own event at its own due time, in order.
 *
 * `pending` entries are content- or rule-authored, not ad hoc: an investigation
 * order pushes a `test_result` entry with the content's authored ETA, a
 * disease trajectory pushes its next `disease_step`. This file only knows how
 * to drain the queue, never what a specific kind of pending item means
 * clinically - that lives in the handler passed in.
 *
 * @param {object} state
 * @param {number} targetMinutes  advance up to and including this minute
 * @param {(state, item) => { events: object[] }} runItem
 *        Resolves one due pending item into events. Called once per due item,
 *        in due-time order; ties broken by insertion order.
 */
export function drainPendingWork(state, targetMinutes, runItem) {
  let cursor = state;
  const events = [];
  const due = [...cursor.pending]
    .filter((item) => item.dueAtMinutes <= targetMinutes)
    .sort((a, b) => a.dueAtMinutes - b.dueAtMinutes || a.seq - b.seq);

  for (const item of due) {
    const result = runItem(cursor, item);
    for (const event of result.events) events.push(event);
    // The handler is responsible for producing the event that actually
    // resolves the item (e.g. TEST_RESULTED); this loop only removes it from
    // the queue once that has happened, so nothing can be drained twice.
    cursor = { ...cursor, pending: cursor.pending.filter((entry) => entry.id !== item.id) };
  }

  return { events, remainingPending: cursor.pending };
}

let seqCounter = 0;

export function schedulePending(pending, item) {
  seqCounter += 1;
  return [...pending, { seq: seqCounter, ...item }];
}

/**
 * True when advancing to `targetMinutes` would cross a moment important enough
 * to interrupt whatever the learner is doing right now (Contract §7.4 / §19).
 * The caller supplies which events actually fired; this just classifies them.
 */
export function crossesInterruptingEvent(events) {
  return events.some((event) =>
    [EVENT.DETERIORATION_DETECTED, EVENT.COMPLICATION_OCCURRED, EVENT.PATIENT_DIED].includes(event.type),
  );
}

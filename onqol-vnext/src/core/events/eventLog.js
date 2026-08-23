import { EVENT_TYPES } from "./eventTypes.js";

/**
 * An append-only log with a causal spine.
 *
 * Each entry answers "what happened, when in hospital time, and because of
 * what". `cause` is the part that makes a debrief defensible: a complication
 * that names the rule and the command that produced it can be explained to a
 * learner who disputes it, and a complication that names nothing cannot.
 */

/**
 * @param {object} entry
 * @param {string} entry.type       one of EVENT
 * @param {number} entry.atMinutes  elapsed case minutes
 * @param {string} entry.atIso      hospital-local instant
 * @param {object} [entry.payload]
 * @param {object} [entry.cause]    { commandId, ruleIds, actor, source }
 */
export function createEvent({ type, atMinutes, atIso, payload = {}, cause = {} }) {
  if (!EVENT_TYPES.includes(type)) throw new Error(`Unknown event type "${type}".`);
  return Object.freeze({
    type,
    atMinutes,
    atIso,
    payload: Object.freeze({ ...payload }),
    cause: Object.freeze({
      actor: cause.actor ?? "system",
      commandId: cause.commandId ?? null,
      ruleIds: Object.freeze([...(cause.ruleIds ?? [])]),
      source: cause.source ?? null,
      ...cause,
    }),
  });
}

export function createEventLog(events = []) {
  return Object.freeze(events.map((event, index) => Object.freeze({ seq: index, ...event })));
}

export function appendEvents(log, newEvents) {
  const next = [...log];
  for (const event of newEvents) next.push(Object.freeze({ seq: next.length, ...event }));
  return Object.freeze(next);
}

export function eventsOfType(log, type) {
  return log.filter((event) => event.type === type);
}

export function lastEventOfType(log, type) {
  for (let index = log.length - 1; index >= 0; index -= 1) {
    if (log[index].type === type) return log[index];
  }
  return null;
}

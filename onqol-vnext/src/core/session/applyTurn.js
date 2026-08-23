import { reduceEvents } from "../state/worldState.js";
import { appendEvents } from "../events/eventLog.js";
import { executeCommand } from "../commands/executeCommand.js";
import { advanceTime } from "../time/advanceTime.js";

/**
 * Folding one command into the session: execute -> reduce -> schedule.
 *
 * Kept separate from `executeCommand` (which is pure and side-effect free)
 * so that the pure decision of *what happens* stays testable without a whole
 * session in scope, while this function owns the bookkeeping of turning that
 * decision into the next `{ state, events }` pair.
 */
export function applyCommand({ session, command, turnContext }) {
  const { state, events, clockRoot, bundle, rng, patient } = session;
  const result = executeCommand({ state, clockRoot, bundle, rng, patient, command, turnContext });

  // A command that did NOT execute may still have changed the world: running
  // into an unavailable resource discloses that constraint, which is a real
  // event the learner now knows about (task brief §12.3). So the fold is
  // driven by whether events were produced, not by the outcome label.
  if (!result.events?.length) {
    return { session, result };
  }

  const nextEvents = appendEvents(events, result.events);
  const nextState = reduceEvents(state, result.events);

  return { session: { ...session, state: nextState, events: nextEvents }, result };
}

/**
 * Several commands from one learner turn (Foundation Spec §9, Contract §8.1):
 * each is executed and folded in order, but nothing here forces artificial
 * waiting between them - they all land at the same clock minute unless a
 * handler itself schedules future work.
 */
export function applyCommands({ session, commands, turnContext }) {
  let current = session;
  const results = [];
  for (const command of commands) {
    const { session: nextSession, result } = applyCommand({ session: current, command, turnContext });
    current = nextSession;
    results.push(result);
  }
  return { session: current, results };
}

/**
 * Advancing the clock, draining scheduled work, and folding the resulting
 * events into state - the counterpart to `applyCommand` for time itself.
 */
export function applyTimeAdvance({ session, targetMinutes, cause }) {
  const { state, events, clockRoot, bundle, rng } = session;
  const { events: newEvents } = advanceTime({ state, clockRoot, bundle, rng, targetMinutes, cause });
  const nextState = reduceEvents(state, newEvents);
  const nextEvents = appendEvents(events, newEvents);
  return { session: { ...session, state: nextState, events: nextEvents }, newEvents };
}

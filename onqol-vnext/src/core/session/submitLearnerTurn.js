import { reduceEvents } from "../state/worldState.js";
import { appendEvents, createEvent } from "../events/eventLog.js";
import { EVENT } from "../events/eventTypes.js";
import { hospitalIso } from "../time/clock.js";
import { applyCommands, applyTimeAdvance } from "./applyTurn.js";
import { interpretTurn } from "../../ai/interpreter/interpretTurn.js";
import { decideMentorResponse } from "../../ai/mentor/mentorEngine.js";

/**
 * One complete learner turn: raw text in, `{ session, outcomes, mentor }` out.
 *
 * This is the single orchestration path the task brief's §17 definition of
 * E2E requires - learner text -> interpreter -> validation -> domain
 * execution -> time/events -> mentor -> next turn. Both the React hook and
 * the learner-journey test call THIS function, so there is no way for the
 * UI to reach a capability the tests bypass, or the reverse.
 *
 * It lives in `core/session/` rather than in the React hook because it is
 * pure orchestration over pure functions: no React, no DOM, no provider.
 *
 * CAUSAL TRAIL (task brief P0-8): every turn emits LEARNER_TURN_RECEIVED
 * (with the raw text and what the interpreter made of it) and one
 * COMMAND_ACCEPTED / COMMAND_REJECTED / CLARIFICATION_REQUESTED per command,
 * so the export can answer "what did the learner say, what did the system
 * think it meant, what did it execute, and what did it refuse".
 */
export function submitLearnerTurn({ session, text }) {
  const atIso = (state) => hospitalIso(session.clockRoot, state.clock.elapsedMinutes);

  const interpreted = interpretTurn({
    text,
    turnContext: buildTurnContext(session),
    idPrefix: `t${session.state.turn}`,
  });

  // The turn itself is an event, before anything it asked for happens.
  const turnEvent = createEvent({
    type: EVENT.LEARNER_TURN_RECEIVED,
    atMinutes: session.state.clock.elapsedMinutes,
    atIso: atIso(session.state),
    payload: {
      rawText: text,
      intent: interpreted.intent,
      mentorSignal: interpreted.mentorSignal ?? null,
      interpretedCommands: interpreted.commands.map((c) => ({ id: c.id, type: c.type, params: c.params })),
    },
    cause: { actor: "learner", source: "interpreter" },
  });

  let working = {
    ...session,
    state: reduceEvents(session.state, [turnEvent]),
    events: appendEvents(session.events, [turnEvent]),
  };

  // A pure read (status request) or a turn addressed to the mentor produces
  // no domain events and must not move the clock (Contract §6, §8).
  if (interpreted.intent === "REQUEST_CURRENT_STATUS") {
    return { session: working, interpreted, outcomes: [{ outcome: "STATUS_SNAPSHOT" }], mentor: null };
  }

  if (interpreted.intent === "MENTOR_ANSWER" || interpreted.commands.length === 0) {
    const mentor = decideMentorResponse({
      state: working.state,
      turnResult: { outcome: "EXECUTED" },
      mentorSignal: interpreted.mentorSignal,
    });
    working = recordMentorIntervention(working, mentor, atIso);
    return { session: working, interpreted, outcomes: [], mentor };
  }

  // A stated wait ("переоценю через 30 минут", "переоценю утром") advances
  // the clock FIRST - draining every result, effect and arrival due in that
  // window - so the reassessment observes the world after that time has
  // passed, not at the moment it was requested (Contract §12).
  const waitCommand = interpreted.commands.find((c) => c.params.afterMinutes != null);
  let timeEvents = [];
  if (waitCommand) {
    const target = working.state.clock.elapsedMinutes + waitCommand.params.afterMinutes;
    const advanced = applyTimeAdvance({
      session: working,
      targetMinutes: target,
      cause: { actor: "learner", source: "stated_wait" },
    });
    working = advanced.session;
    timeEvents = advanced.newEvents;
  }

  const { session: afterCommands, results } = applyCommands({ session: working, commands: interpreted.commands });
  working = afterCommands;

  // Every command's disposition, recorded (P0-8).
  const trailEvents = results.map((result) =>
    createEvent({
      type: trailEventTypeFor(result.outcome),
      atMinutes: working.state.clock.elapsedMinutes,
      atIso: atIso(working.state),
      payload: {
        commandId: result.command?.id ?? null,
        commandType: result.command?.type ?? null,
        outcome: result.outcome,
        missing: result.missing ?? null,
        reasonKey: result.reasonKey ?? null,
        capabilityKey: result.capabilityKey ?? null,
        ruleIds: result.firedRules?.map((rule) => rule.id) ?? [],
        governanceBlocked: result.governanceBlocked ?? [],
      },
      cause: { actor: "learner", commandId: result.command?.id ?? null, source: "command_pipeline" },
    }),
  );
  working = {
    ...working,
    state: reduceEvents(working.state, trailEvents),
    events: appendEvents(working.events, trailEvents),
  };

  const mentor = decideMentorResponse({
    state: working.state,
    turnResult: results.at(-1),
    mentorSignal: interpreted.mentorSignal,
  });
  working = recordMentorIntervention(working, mentor, atIso);

  return { session: working, interpreted, outcomes: results, mentor, timeEvents };
}

/**
 * What the interpreter is allowed to know about where the case currently
 * stands (task brief §4.2). Deliberately narrow: enough to disambiguate the
 * same words at different points in the case, and nothing that would let the
 * interpreter reach hidden patient truth.
 */
function buildTurnContext(session) {
  const { state, bundle } = session;
  const pendingDecisionId = state.operative.pendingDecision;
  const pendingDecision = pendingDecisionId ? bundle.operative.decisions[pendingDecisionId] : null;
  return {
    openMentorQuestion: state.mentor.openQuestion,
    preopReady: state.preop.ready,
    managementIntent: state.managementPlan.intent,
    pendingDecisionId,
    pendingDecisionOptions: pendingDecision?.options ?? null,
  };
}

/**
 * A mentor decision is world state, not just a chat message (task brief
 * P0-7): persisting it is what lets the NEXT learner turn be interpreted
 * against the question the mentor actually asked.
 */
function recordMentorIntervention(session, mentor, atIso) {
  if (!mentor?.textRu) return session;
  const event = createEvent({
    type: EVENT.MENTOR_INTERVENED,
    atMinutes: session.state.clock.elapsedMinutes,
    atIso: atIso(session.state),
    payload: {
      mode: mentor.mode,
      issueId: mentor.openQuestion?.issueId ?? mentor.ruleId ?? null,
      scaffolding: mentor.scaffolding ?? session.state.mentor.scaffolding,
      openQuestion: mentor.openQuestion ?? null,
      expectedAnswerDomains: mentor.openQuestion?.expects ?? [],
      source: mentor.ruleId ? "approved_rule" : "scaffolding_ladder",
      allowedRuleIds: mentor.ruleId ? [mentor.ruleId] : [],
    },
    cause: { actor: "system", source: "mentor", ruleIds: mentor.ruleId ? [mentor.ruleId] : [] },
  });
  return {
    ...session,
    state: reduceEvents(session.state, [event]),
    events: appendEvents(session.events, [event]),
  };
}

function trailEventTypeFor(outcome) {
  if (outcome === "EXECUTED") return EVENT.COMMAND_ACCEPTED;
  if (outcome === "CLARIFY") return EVENT.CLARIFICATION_REQUESTED;
  return EVENT.COMMAND_REJECTED;
}

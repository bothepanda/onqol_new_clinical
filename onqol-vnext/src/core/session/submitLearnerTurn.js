import { reduceEvents } from "../state/worldState.js";
import { appendEvents, createEvent } from "../events/eventLog.js";
import { EVENT } from "../events/eventTypes.js";
import { validateCommand } from "../commands/commandTypes.js";
import { hospitalIso } from "../time/clock.js";
import { applyCommands, applyTimeAdvance } from "./applyTurn.js";
import { resolveOperationalCalibration, turnConsumesMinutes } from "./operationalCalibration.js";
import { interpretTurn } from "../../ai/interpreter/interpretTurn.js";
import { decideMentorResponse } from "../../ai/mentor/mentorEngine.js";
import { isInteractionV2Enabled } from "../../ai/interaction/featureFlags.js";
import { runSplitSemanticShadow } from "../../ai/interpreter/splitSemanticInterpreter.js";
import { createNullProviderClient } from "../../ai/providerClient.js";

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
export function submitLearnerTurn({ session, text, shadowProvider, interpreted: interpretedOverride }) {
  const atIso = (state) => hospitalIso(session.clockRoot, state.clock.elapsedMinutes);
  const turnContext = buildTurnContext(session);

  // The hybrid path is async, so `useSession` resolves the interpretation
  // first and passes it in. Everything else - tests, replay - uses the
  // synchronous deterministic interpreter directly. Either way the structured
  // result is recorded in LEARNER_TURN_RECEIVED, so replay never re-interprets.
  const interpreted = interpretedOverride ?? interpretTurn({
    text,
    turnContext,
    bundle: session.bundle,
    idPrefix: `t${session.state.turn}`,
  });
  // Shadow output has no authority and is deliberately kept outside the
  // domain event log. This promise is never awaited by the clinical path.
  const shadowTelemetryPromise = isInteractionV2Enabled(session.state.session)
    ? runSplitSemanticShadow({
        provider: shadowProvider ?? createNullProviderClient(),
        text,
        locale: session.state.session.locale,
        turnContext,
        bundle: session.bundle,
      }).then((telemetry) => ({ ...telemetry, sessionId: session.sessionId, turn: session.state.turn }))
    : Promise.resolve(null);

  // The turn itself is an event, before anything it asked for happens.
  const turnEvent = createEvent({
    type: EVENT.LEARNER_TURN_RECEIVED,
    atMinutes: session.state.clock.elapsedMinutes,
    atIso: atIso(session.state),
    payload: {
      rawText: text,
      intent: interpreted.intent,
      // Wave §17: which interpreter produced this reading - "deterministic" or
      // (Stage 2) "hybrid" / "hybrid_fallback_deterministic".
      interpreterMode: interpreted.mode ?? "deterministic",
      mentorSignal: interpreted.mentorSignal ?? null,
      unmatchedFragments: interpreted.unmatchedFragments ?? [],
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
    return { session: working, interpreted, outcomes: [{ outcome: "STATUS_SNAPSHOT" }], mentor: null, shadowTelemetryPromise };
  }

  if (interpreted.intent === "MENTOR_ANSWER" || interpreted.commands.length === 0) {
    const mentor = decideMentorResponse({
      state: working.state,
      turnResult: { outcome: "EXECUTED" },
      mentorSignal: interpreted.mentorSignal,
    });
    working = recordMentorIntervention(working, mentor, atIso);
    return { session: working, interpreted, outcomes: [], mentor, shadowTelemetryPromise };
  }

  // A stated wait ("переоценю через 30 минут", "переоценю утром") advances
  // the clock FIRST - draining every result, effect and arrival due in that
  // window - so the reassessment observes the world after that time has
  // passed, not at the moment it was requested (Contract §12).
  //
  // BUT ONLY ONCE THE PLAN IS ACTUALLY CLEAR (Contract §10, PBC-10).
  //
  // Contract §10 fixes the order explicitly: ON QOL asks what will be
  // reassessed if that is not clear, and only *"once the reassessment plan is
  // clear"* does clinical time advance. The previous version advanced the
  // clock on any command carrying `afterMinutes`, before the command was
  // validated - so "переоценю через 3 часа" with no named target burned three
  // hours of clinical time, drained every pending result into them, and only
  // then had the nurse ask "Что именно переоцениваешь?". The learner was
  // charged three irreversible hours for a reassessment that never happened,
  // and the answer to the clarification then applied at a time they never
  // chose. Validating first is what makes the clarification a question rather
  // than a receipt.
  const waitCommand = interpreted.commands.find(
    (c) =>
      (c.params.afterMinutes != null || (c.type === "WAIT" && c.params.untilNextPending === true)) &&
      validateCommand(c).outcome !== "CLARIFY",
  );
  let timeEvents = [];
  let waitTargetMinutes = null;
  if (waitCommand) {
    waitTargetMinutes = waitCommand.params.afterMinutes != null
      ? working.state.clock.elapsedMinutes + waitCommand.params.afterMinutes
      : nextPendingMinute(working.state);
    if (waitTargetMinutes != null) {
      const advanced = applyTimeAdvance({
        session: working,
        targetMinutes: waitTargetMinutes,
        cause: { actor: "learner", source: "stated_wait" },
      });
      working = advanced.session;
      timeEvents = advanced.newEvents;
    }
  }

  const { session: afterCommands, results } = applyCommands({
    session: working,
    commands: interpreted.commands,
    turnContext: { waitTargetMinutes },
  });
  working = afterCommands;

  // An action that itself takes clinical time (Contract §7.1: "clinical time
  // advances according to actions, investigations, treatment, TRANSPORT,
  // observation, scheduled reassessment, procedures"). Unlike a stated wait,
  // this interval is consumed AFTER the command executes - the ambulance
  // leaves, then the journey happens - so the clock moves here rather than
  // above, and the interval drains pending work like any other passage of
  // time. Concurrent actions share one interval (§7.2) rather than queueing.
  // Rendered AFTER the command's own output, not before it (unlike
  // `timeEvents`, which precede the action that waited for them).
  let afterEvents = [];
  // Two sources of "this turn takes clinical time", combined by MAX because
  // concurrent actions share one interval (Contract §7.2):
  //  - a command handler that returns its own `consumesMinutes` (TRANSPORT);
  //  - the operational simulation calibration (history / examination / focused
  //    questions), a versioned scoped content artifact - NOT a hard-coded
  //    constant. `src/content/shared/simulation/calibration.yaml`.
  // Ordering an investigation is deliberately 0: a pending result is delivered
  // when simulated time NATURALLY reaches its dueAtMinutes through history,
  // examination, treatment, a stated wait, transport or reassessment.
  const calibration = resolveOperationalCalibration({
    bundle: working.bundle,
    session: working.state.session,
  });
  const handlerMinutes = Math.max(0, ...results.map((result) => result.consumesMinutes ?? 0));
  const calibratedMinutes = turnConsumesMinutes({ calibration, results });
  const consumesMinutes = Math.max(handlerMinutes, calibratedMinutes);
  if (consumesMinutes > 0) {
    const advanced = applyTimeAdvance({
      session: working,
      targetMinutes: working.state.clock.elapsedMinutes + consumesMinutes,
      cause: { actor: "learner", source: "action_duration" },
    });
    working = advanced.session;
    afterEvents = advanced.newEvents;
  }

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
        // What the learner ALREADY supplied, so the answer to the
        // clarification can be merged into it rather than replacing it (PBC-8).
        params: result.command?.params ?? null,
        // Wave §12: every clinical / order-validation failure must land in the
        // record as a deterministic, explainable category - never
        // `ORDER_VALIDATION_FAILED` with reasonKey null, ruleIds [] and no text.
        // `validateMedicationOrder` names its reason `code` and carries a
        // learner-facing `textRu` + `classification`; thread all three.
        reasonKey: result.reasonKey ?? result.code ?? null,
        reasonTextRu: result.textRu ?? null,
        classification: result.classification ?? null,
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

  return { session: working, interpreted, outcomes: results, mentor, timeEvents, afterEvents, shadowTelemetryPromise };
}

/**
 * What the interpreter is allowed to know about where the case currently
 * stands (task brief §4.2). Deliberately narrow: enough to disambiguate the
 * same words at different points in the case, and nothing that would let the
 * interpreter reach hidden patient truth.
 *
 * Exported so the async hybrid interpreter in `useSession` can build the same
 * context this function passes to the synchronous deterministic path.
 */
export function buildTurnContext(session) {
  const { state, bundle } = session;
  const pendingDecisionId = state.operative.pendingDecision;
  const pendingDecision = pendingDecisionId ? bundle.operative.decisions[pendingDecisionId] : null;
  return {
    openMentorQuestion: state.mentor.openQuestion,
    openClarification: state.clarification,
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
  // ALREADY_PENDING is an operational no-op, not a learner error (wave §13).
  if (["EXECUTED", "NO_PENDING_WORK", "ALREADY_PENDING"].includes(outcome)) return EVENT.COMMAND_ACCEPTED;
  if (outcome === "CLARIFY") return EVENT.CLARIFICATION_REQUESTED;
  return EVENT.COMMAND_REJECTED;
}

function nextPendingMinute(state) {
  const future = (state.pending ?? [])
    .map((item) => item.dueAtMinutes)
    .filter((minute) => Number.isFinite(minute) && minute > state.clock.elapsedMinutes);
  return future.length ? Math.min(...future) : null;
}

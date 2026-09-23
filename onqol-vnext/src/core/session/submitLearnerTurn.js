import { reduceEvents } from "../state/worldState.js";
import { appendEvents, createEvent } from "../events/eventLog.js";
import { EVENT } from "../events/eventTypes.js";
import { validateCommand } from "../commands/commandTypes.js";
import { hospitalIso } from "../time/clock.js";
import { applyCommands, applyTimeAdvance } from "./applyTurn.js";
import { resolveOperationalCalibration, turnConsumesMinutes } from "./operationalCalibration.js";
import { interpretTurn } from "../../ai/interpreter/interpretTurn.js";
import { decideMentorResponse } from "../../ai/mentor/mentorEngine.js";
import { isInteractionV2Enabled, isStatefulGroundedMentorEnabled } from "../../ai/interaction/featureFlags.js";
import { runSplitSemanticShadow } from "../../ai/interpreter/splitSemanticInterpreter.js";
import { createNullProviderClient } from "../../ai/providerClient.js";
import { classifyAdequacy } from "../../ai/mentor/mentorAdequacy.js";
import { advanceMentorMemory } from "../../ai/mentor/mentorMemory.js";
import { detectTeachingCandidates, buildIssueDefinitions } from "../../ai/mentor/teachingCandidates.js";
import { buildLearnerVisibleState } from "../state/learnerView.js";

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
      semanticTelemetry: interpreted.semanticTelemetry ?? null,
      // Preserve the async interpretation for resume. Re-parsing its text with
      // today's dictionary or provider would change the historical decision.
      ...(interpretedOverride ? { recordedInterpretation: structuredClone(interpreted) } : {}),
      mentorSignal: interpreted.mentorSignal ?? null,
      unmatchedFragments: interpreted.unmatchedFragments ?? [],
      // Every command here passed the commitment gate: it is a decision, not a
      // hedge, condition, question, deferral or refusal. Those are recorded in
      // `withheldCommands` with the reason and were not executed.
      interpretedCommands: interpreted.commands.map((c) => ({ id: c.id, type: c.type, params: c.params, commitment: "COMMITTED" })),
      withheldCommands: interpreted.withheldCommands ?? [],
      // A stated «сначала X, затем Y»: the ordering the learner gave. Recorded only;
      // each command is still executed and validated on its own.
      ...(interpreted.commandSequence ? { commandSequence: interpreted.commandSequence } : {}),
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
    const turnResultForMentor = { outcome: "EXECUTED" };
    const mentor = enrichMentorWithMemory({
      session: working,
      mentor: decideMentorResponse({ state: working.state, turnResult: turnResultForMentor, mentorSignal: interpreted.mentorSignal, ...mentorContentInputs(working, []) }),
      interpreted,
      turnResult: turnResultForMentor,
      text,
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
  // "Болюс, переоценю через 15 минут": an order that starts a treatment is
  // carried out NOW, and only then does the stated wait pass - otherwise the
  // order would be placed at the END of the wait and the reassessment would
  // observe a patient the treatment has not yet reached. Only orders that can
  // start an effect (infusion / medication) are moved ahead of the wait.
  const startedBeforeWait = waitCommand
    ? interpreted.commands.filter((c) => c !== waitCommand && ["ORDER_INFUSION", "ORDER_MEDICATION"].includes(c.type) && c.params.afterMinutes == null && validateCommand(c).outcome !== "CLARIFY")
    : [];
  let preWaitResults = [];
  if (startedBeforeWait.length) {
    const started = applyCommands({ session: working, commands: startedBeforeWait, turnContext: { waitTargetMinutes: null } });
    working = started.session;
    preWaitResults = started.results;
  }
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

  // Reassessing "after the bolus" means the bolus has run: a reassessment lets
  // treatment effects that are already in flight reach onset first, so it
  // observes the patient's response rather than the moment of the order
  // (ТЗ §13). Only in-flight treatment effects move the clock - a
  // reassessment never skips an investigation or a consultant's arrival.
  if (!waitCommand && interpreted.commands.some((c) => c.type === "REASSESS" && c.params.afterMinutes == null)) {
    const inFlight = (working.state.pending ?? [])
      .filter((item) => item.kind === "treatment_effect" && Number.isFinite(item.dueAtMinutes) && item.dueAtMinutes > working.state.clock.elapsedMinutes)
      .map((item) => item.dueAtMinutes);
    if (inFlight.length) {
      const advanced = applyTimeAdvance({
        session: working,
        targetMinutes: Math.max(...inFlight),
        cause: { actor: "learner", source: "reassessment_after_treatment" },
      });
      working = advanced.session;
      timeEvents = [...timeEvents, ...advanced.newEvents];
    }
  }

  const { session: afterCommands, results: laterResults } = applyCommands({
    session: working,
    commands: interpreted.commands.filter((c) => !startedBeforeWait.includes(c)),
    turnContext: { waitTargetMinutes },
  });
  working = afterCommands;
  const results = [...preWaitResults, ...laterResults];

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
  // How much clinical time this turn's LEARNER-PERFORMED actions consume:
  //  - `calibratedMinutes` - the operational simulation calibration
  //    (`src/content/shared/simulation/calibration.yaml`, a versioned scoped
  //    content artifact, NOT a hard-coded constant): history / examination /
  //    focused questions, SUMMED because one actor performs them in sequence
  //    (§8.3). Ordering / prescribing / calling a consultant are 0 here.
  //  - `handlerMinutes` - a command that models an independent process whose
  //    duration IS the passage of time (interfacility TRANSPORT). Combined by
  //    MAX with the calibrated sum: these do not realistically co-occur in one
  //    turn, and neither should be double-counted against the other.
  // Independent pending processes (investigation turnaround, consultant ETA,
  // transport ETA) run concurrently against the clock through `advanceTime`
  // once time later advances - they are never added together here.
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

  const turnResultForMentor = results.at(-1);
  const mentor = enrichMentorWithMemory({
    session: working,
    mentor: decideMentorResponse({ state: working.state, turnResult: turnResultForMentor, mentorSignal: interpreted.mentorSignal, ...mentorContentInputs(working, results) }),
    interpreted,
    turnResult: turnResultForMentor,
    text,
  });
  working = recordMentorIntervention(working, mentor, atIso);

  return { session: working, interpreted, outcomes: results, mentor, timeEvents, afterEvents, shadowTelemetryPromise };
}

/**
 * Content-declared mentor inputs (Wave B). Only when the stateful mentor is on
 * for the session: a flag-off session gets exactly the arguments it always did.
 * A bundle with no `teaching_issues` / `mentor_policy` (appendicitis) yields
 * no candidates and no policy override, so its behaviour is unchanged even
 * with the flag on.
 */
function mentorContentInputs(session, results) {
  if (!isStatefulGroundedMentorEnabled(session.state.session)) return {};
  const bundle = session.bundle;
  const issueDefinitions = buildIssueDefinitions(bundle);
  const teachingCandidates = results.length
    ? detectTeachingCandidates({ bundle, state: session.state, learnerVisible: buildLearnerVisibleState(session.state), results })
    : [];
  return { teachingCandidates, issueDefinitions, policy: bundle.rules?.mentor_policy ?? {} };
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
  // `memoryChanged` (Stateful Grounded Mentor Wave A, only set when
  // STATEFUL_GROUNDED_MENTOR_V1 is on - see `enrichMentorWithMemory` below)
  // lets a SILENT turn (mentor.textRu null) still persist closing a pending
  // question when the learner's action was sufficient - otherwise a stale
  // `pendingMentorQuestion` from an earlier turn would outlive the answer
  // that resolved it. `payload.spoke` tells the reducer whether to treat
  // this as an actual intervention (advance `lastInterventionTurn`, reset
  // `silentTurns`) or a memory-only update.
  if (!mentor?.textRu && !mentor?.memoryChanged) return session;
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
      spoke: Boolean(mentor.textRu),
      ...(mentor.pendingMentorQuestion !== undefined ? { pendingMentorQuestion: mentor.pendingMentorQuestion } : {}),
      ...(mentor.probingStreak !== undefined ? { probingStreak: mentor.probingStreak } : {}),
      ...(mentor.recentMentorQuestions !== undefined ? { recentMentorQuestions: mentor.recentMentorQuestions } : {}),
      ...(mentor.deferredMentorIssues !== undefined ? { deferredMentorIssues: mentor.deferredMentorIssues } : {}),
      ...(mentor.adequacy !== undefined ? { adequacy: mentor.adequacy } : {}),
    },
    cause: { actor: "system", source: "mentor", ruleIds: mentor.ruleId ? [mentor.ruleId] : [] },
  });
  return {
    ...session,
    state: reduceEvents(session.state, [event]),
    events: appendEvents(session.events, [event]),
  };
}

/**
 * Stateful Grounded Mentor Wave A. Records what the grounded renderer
 * actually showed the learner (accepted / fell back, which cards, whether it
 * took a repair pass) as a NON-authoritative event - see the
 * MENTOR_GROUNDED_RESPONSE_RENDERED comment in eventTypes.js. Called from
 * `useSession.js` (never from inside `submitLearnerTurn` itself: rendering is
 * async, this function is a separate, explicit step after the turn that
 * already recorded the deterministic decision).
 */
export function recordGroundedMentorResponse(session, { mode, status, errorCode, cardIds, sourceIds, regenerations, reasons }, atIso) {
  const event = createEvent({
    type: EVENT.MENTOR_GROUNDED_RESPONSE_RENDERED,
    atMinutes: session.state.clock.elapsedMinutes,
    atIso,
    payload: {
      mode: mode ?? null,
      status: status ?? "fallback",
      errorCode: errorCode ?? null,
      cardIds: cardIds ?? [],
      sourceIds: sourceIds ?? [],
      regenerations: regenerations ?? 0,
      // Short categorical violation codes only - see groundedDialogue.js's
      // attemptVerify comment. Never clinical content, never the verifier's
      // free-text reasoning.
      reasons: reasons ?? [],
    },
    cause: { actor: "system", source: "grounded_mentor" },
  });
  return {
    ...session,
    state: reduceEvents(session.state, [event]),
    events: appendEvents(session.events, [event]),
  };
}

/**
 * Stateful Grounded Mentor Wave A (docs/STATEFUL_GROUNDED_MENTOR_WAVE_A.md).
 * No-op, returning `mentor` unchanged, unless the session opted into
 * STATEFUL_GROUNDED_MENTOR_V1 - this is what keeps a flag-off session's
 * `state.mentor` and MENTOR_INTERVENED payloads byte-identical to before
 * this wave. `decideMentorResponse` itself is never modified.
 */
function enrichMentorWithMemory({ session, mentor, interpreted, turnResult, text }) {
  if (!isStatefulGroundedMentorEnabled(session.state.session)) return mentor;
  const priorMentorState = session.state.mentor;
  const adequacy = classifyAdequacy({
    mentorCandidate: mentor,
    interpreted,
    turnResult,
    pendingMentorQuestion: priorMentorState.pendingMentorQuestion,
    text,
  });
  const memory = advanceMentorMemory({ mentorCandidate: mentor, adequacy, priorMentorState, turn: session.state.turn, text });
  const memoryChanged =
    (memory.pendingMentorQuestion?.issueId ?? null) !== (priorMentorState.pendingMentorQuestion?.issueId ?? null) ||
    (memory.pendingMentorQuestion?.scaffoldingLevel ?? null) !== (priorMentorState.pendingMentorQuestion?.scaffoldingLevel ?? null) ||
    memory.probingStreak !== priorMentorState.probingStreak ||
    memory.deferredMentorIssues.length !== priorMentorState.deferredMentorIssues.length;
  return { ...mentor, adequacy, ...memory, memoryChanged };
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

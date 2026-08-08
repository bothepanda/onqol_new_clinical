import { buildAllowedActionMap } from "./schemas/caseSchema.js";
import { extractLearnerActions } from "./actionExtraction.js";
import { createUuid } from "./ids.js";
import { runClinicalSimulatorAgent } from "./simulatorAgent.js";
import { scoreSession } from "./scoring.js";
import { buildClinicalReasoningReport } from "./report.js";
import { buildSessionVersionSnapshot } from "./versioning.js";

export function createInitialSession(caseData, options = {}) {
  const versionSnapshot = buildSessionVersionSnapshot(caseData, {
    locale: options.locale,
    routerVersion: options.routerVersion,
  });
  const selection = options.selection || {};

  return {
    session_id: options.sessionId || createUuid(),
    anonymous_user_id: options.anonymousUserId || null,
    ...versionSnapshot,
    version_snapshot: versionSnapshot,
    selection_method: selection.selection_method || options.selectionMethod || "direct",
    difficulty: selection.difficulty || caseData.difficulty,
    phase: caseData.patient_state.phase,
    completedActions: [],
    unsafeActions: [],
    unnecessaryActions: [],
    revealedFindings: [],
    appliedTransitions: [],
    messages: [{ role: "assistant", content: caseData.initial_presentation.text }],
    finished: false,
    started_at: options.startedAt || new Date().toISOString(),
    completed_at: null,
    completion_status: "in_progress",
  };
}

function uniquePush(list, value) {
  return list.includes(value) ? list : [...list, value];
}

function getAction(caseData, actionId) {
  return buildAllowedActionMap(caseData).get(actionId);
}

function getActionKind(caseData, actionId) {
  if (caseData.expected_actions.some((action) => action.id === actionId)) return "expected";
  if (caseData.acceptable_alternatives.some((action) => action.id === actionId)) return "alternative";
  if (caseData.unnecessary_actions.some((action) => action.id === actionId)) return "unnecessary";
  if (caseData.unsafe_actions.some((action) => action.id === actionId)) return "unsafe";
  return "unknown";
}

function getRevealId(action) {
  return action.effects_on_case?.reveal || action.maps_to;
}

function isInformationRequest(parsedAction, action) {
  const intentType = action.intent_type || parsedAction.intent_type;
  return ["request_history", "request_examination", "request_test"].includes(intentType);
}

function promptForRequest(parsedActions, transitionPrompts, transitionFindings) {
  if (transitionFindings.length > 0) return "Как оцениваешь ситуацию сейчас и что делаешь?";
  if (parsedActions.some((action) => action.intent_type === "request_test")) {
    return "Как интерпретируешь результаты и что делаешь дальше?";
  }
  if (transitionPrompts.length > 0) return transitionPrompts.at(-1);
  if (parsedActions.some((action) => action.intent_type === "management")) {
    return "Как реализуешь выбранную тактику и что контролируешь дальше?";
  }
  return "Что думаешь и что будешь делать дальше?";
}

function formatFinding(caseData, findingId) {
  const finding = caseData.available_findings[findingId] || caseData.hidden_findings[findingId];
  if (!finding) return "";
  return `**${finding.title}:** ${finding.text}`;
}

function transitionReady(transition, completedActions) {
  if (transition.when_all_done) {
    return transition.when_all_done.every((id) => completedActions.includes(id));
  }
  if (transition.when_any_done) {
    return transition.when_any_done.some((id) => completedActions.includes(id));
  }
  return false;
}

function applyTransitions(caseData, session) {
  let nextSession = session;
  const findings = [];
  const prompts = [];
  const transitions = [];

  for (const transition of caseData.state_transitions) {
    if (
      transitionReady(transition, nextSession.completedActions) &&
      !nextSession.appliedTransitions.includes(transition.id)
    ) {
      nextSession = {
        ...nextSession,
        phase: transition.next_phase,
        appliedTransitions: uniquePush(nextSession.appliedTransitions, transition.id),
      };
      transitions.push(transition.id);
      for (const findingId of transition.reveal || []) {
        nextSession = {
          ...nextSession,
          revealedFindings: uniquePush(nextSession.revealedFindings, findingId),
        };
        const text = formatFinding(caseData, findingId);
        if (text) findings.push({ id: findingId, text });
      }
      if (transition.message) prompts.push(transition.message);
    }
  }

  return { session: nextSession, findings, prompts, transitions };
}

export function advanceCaseWithParsedActions(caseData, session, input, parsed) {
  let nextSession = {
    ...session,
    messages: [...session.messages, { role: "user", content: input }],
  };
  const findingReplies = [];
  const findingsRevealed = [];
  const parsedActionsForPrompt = [];
  const scoringEvents = [];

  if (parsed.actions.some((action) => action.id === "end_case")) {
    const scoring = scoreSession(caseData, nextSession);
    const report = buildClinicalReasoningReport(caseData, scoring);
    const completedAt = new Date().toISOString();
    nextSession = {
      ...nextSession,
      finished: true,
      phase: "report",
      scoring,
      report,
      completed_at: completedAt,
      completion_status: "completed",
      messages: [...nextSession.messages, { role: "assistant", content: report.markdown }],
    };
    return {
      session: nextSession,
      parsed,
      reply: report.markdown,
      findingsRevealed,
      scoringEvents: [
        {
          type: "case_scored",
          overall_score: scoring.overallScore,
          domain_scores: scoring.domainScores,
          critical_errors: scoring.criticalErrors,
        },
      ],
      stateTransitions: [],
      neutralPrompt: "",
    };
  }

  for (const parsedAction of parsed.actions) {
    const action = getAction(caseData, parsedAction.id);
    if (!action) continue;
    const kind = getActionKind(caseData, parsedAction.id);
    parsedActionsForPrompt.push({ ...parsedAction, intent_type: action.intent_type || parsedAction.intent_type });
    scoringEvents.push({
      action_id: action.id,
      action_kind: kind,
      intent_type: action.intent_type || parsedAction.intent_type,
      score_weight: action.score_weight || 0,
      penalty: action.penalty || 0,
      critical: Boolean(action.critical),
      eligible_for_scoring: action.eligible_for_scoring !== false,
    });

    if (kind === "unsafe") {
      nextSession = {
        ...nextSession,
        unsafeActions: uniquePush(nextSession.unsafeActions, action.id),
        completedActions: uniquePush(nextSession.completedActions, action.id),
      };
      continue;
    }

    if (kind === "unnecessary") {
      nextSession = {
        ...nextSession,
        unnecessaryActions: uniquePush(nextSession.unnecessaryActions, action.id),
        completedActions: uniquePush(nextSession.completedActions, action.id),
      };
      const revealId = getRevealId(action) || action.id;
      if (isInformationRequest(parsedAction, action) && caseData.available_findings[revealId]) {
        nextSession = {
          ...nextSession,
          revealedFindings: uniquePush(nextSession.revealedFindings, revealId),
        };
        findingReplies.push(formatFinding(caseData, revealId));
        findingsRevealed.push(revealId);
      }
      continue;
    }

    nextSession = {
      ...nextSession,
      completedActions: uniquePush(nextSession.completedActions, action.id),
    };

    const revealId = getRevealId(action);
    if (isInformationRequest(parsedAction, action) && revealId && caseData.available_findings[revealId]) {
      nextSession = {
        ...nextSession,
        revealedFindings: uniquePush(nextSession.revealedFindings, revealId),
      };
      findingReplies.push(formatFinding(caseData, revealId));
      findingsRevealed.push(revealId);
    }
  }

  const transitioned = applyTransitions(caseData, nextSession);
  nextSession = transitioned.session;
  findingReplies.push(...transitioned.findings.map((finding) => finding.text));
  findingsRevealed.push(...transitioned.findings.map((finding) => finding.id));

  const prompt = promptForRequest(parsedActionsForPrompt, transitioned.prompts, transitioned.findings);
  const reply = [...new Set(findingReplies.filter(Boolean)), prompt].join("\n\n");
  nextSession = {
    ...nextSession,
    messages: [...nextSession.messages, { role: "assistant", content: reply }],
  };

  return {
    session: nextSession,
    parsed,
    reply,
    findingsRevealed: [...new Set(findingsRevealed)],
    scoringEvents,
    stateTransitions: transitioned.transitions,
    neutralPrompt: prompt,
  };
}

export async function advanceCaseWithSemanticRouter(caseData, session, input, options = {}) {
  const parsed = await extractLearnerActions(input, caseData, session, options);
  return advanceCaseWithParsedActions(caseData, session, input, parsed);
}

export async function advanceCaseWithSimulator(caseData, session, input, options = {}) {
  const startedAt = Date.now();
  const parsed = await extractLearnerActions(input, caseData, session, {
    ...options,
    llm: options.actionExtractorLLM || options.llm,
  });
  const deterministicUpdate = advanceCaseWithParsedActions(caseData, session, input, parsed);

  if (deterministicUpdate.session.finished) {
    return {
      ...deterministicUpdate,
      simulator: null,
      latencyMs: Date.now() - startedAt,
    };
  }

  const simulator = await runClinicalSimulatorAgent(
    {
      input,
      caseData,
      diseaseCard: options.diseaseCard || null,
      retrievalCorpus: options.retrievalCorpus || null,
      sessionBefore: session,
      deterministicUpdate,
      locale: options.locale || session.locale || "ru",
    },
    {
      llm: options.simulatorLLM,
      provider: options.modelInfo?.provider,
      model: options.modelInfo?.model,
      simulatorVersion: options.simulatorVersion,
    }
  );

  const additionalFindingIds = simulator.additionalFindingIds || [];
  const revealedFindings = [
    ...new Set([...deterministicUpdate.session.revealedFindings, ...additionalFindingIds]),
  ];
  const messages = deterministicUpdate.session.messages.map((message, index, allMessages) =>
    index === allMessages.length - 1 && message.role === "assistant"
      ? { ...message, content: simulator.reply }
      : message
  );
  const nextSession = {
    ...deterministicUpdate.session,
    revealedFindings,
    messages,
  };

  return {
    ...deterministicUpdate,
    session: nextSession,
    reply: simulator.reply,
    findingsRevealed: [
      ...new Set([...deterministicUpdate.findingsRevealed, ...additionalFindingIds]),
    ],
    simulator,
    latencyMs: Date.now() - startedAt,
  };
}

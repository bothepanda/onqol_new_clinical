import { coreActionsById, operativePrerequisites } from "./coreActions.js";
import { firedKey, selectHeuristics } from "./mentorHeuristics.js";

/**
 * The mentor brief: a deterministic description of what is pedagogically true
 * on this turn.
 *
 * This is the whole safety argument for letting the mentor speak freely. The
 * brief contains action ids, verdicts, authored template text - and no
 * CASE-OWNED patient facts. The mentor agent receives the brief and nothing
 * else, so it cannot leak a finding it was never given, however badly it
 * behaves.
 *
 * It does carry `learnerReasoning`: sentences the learner wrote themselves,
 * quoted exactly and checked against their message before they got here (see
 * core/reasoningState.js). Those are claims the learner has already made out
 * loud, so repeating one back cannot tell them anything they did not know, and
 * being able to quote a learner's own formulation is most of what supervision
 * is. The mentor prompt is told to question them and never to endorse them.
 *
 * Compare with the patient/environment channel (`simulatorAgent.js`), which
 * does see the Case Card and is therefore restricted to copying locked text.
 * Two channels, two different locks, for two different jobs.
 */

export const MENTOR_MOVE = {
  PREREQUISITE_STOP: "prerequisite_stop",
  ESCALATION_APPROPRIATE: "escalation_appropriate",
  ESCALATION_PREMATURE: "escalation_premature",
  UNCERTAINTY_DECLARED: "uncertainty_declared",
  OUT_OF_SCOPE_RECOGNIZED: "out_of_scope_recognized",
  RESOURCE_BLOCKED: "resource_blocked",
  NEUTRAL_PROMPT: "neutral_prompt",
  // Proactive moves. Everything above waits for the learner to do something;
  // these three notice what is not happening. See mentorHeuristics.js.
  SEQUENCE_INVERTED: "sequence_inverted",
  OUTSTANDING_PRIORITY: "outstanding_priority",
  CLOCK: "clock",
  // A question asked because reasoning should be made visible at this point in
  // the case, not because anything is wrong. See mentorHeuristics.js.
  CHECKPOINT: "checkpoint",
};

const ESCALATION_ACTION_IDS = ["call_senior_surgeon", "call_intensive_care"];

const PREREQUISITE_TEMPLATES = {
  consent_not_obtained:
    "Стоп. До операции нужно информированное согласие: пациент должен услышать, что предлагается, какие риски и какие альтернативы.",
  anaesthesia_not_notified:
    "Стоп. Анестезиолог ещё не оповещён. Проверка анестезиологической безопасности входит в Sign In и требует времени до индукции.",
  risk_not_assessed:
    "Операционный риск и сопутствующая патология пока не оценены.",
  checklist_not_performed:
    "Контрольный лист безопасности до разреза ещё не выполнен.",
  theatre_not_notified: "Операционная бригада ещё не оповещена.",
  prophylaxis_not_given:
    "Стоп. Антибиотикопрофилактика до разреза не введена. Это шаг перед операцией, а не после неё.",
};

const PREREQUISITE_FALLBACK = "Перед этим шагом остаётся незакрытое условие.";

export function prerequisiteMeta(caseData, actionId, missingId) {
  const action = [...(caseData.expected_actions || []), ...(caseData.acceptable_alternatives || [])].find(
    (candidate) => candidate.id === actionId
  );
  const declared = (action?.core_prerequisites || operativePrerequisites).find(
    (prerequisite) => prerequisite.action_id === missingId
  );
  return {
    severity: declared?.severity || "advisory",
    reason_id: declared?.reason_id || null,
  };
}

/**
 * Minimum assessment for escalation appropriateness.
 *
 * Calling for help after doing the available minimum is maturity. Calling
 * instead of doing it is avoidance. The difference is what the learner has
 * already completed - so the bar has to be declared, not inferred.
 *
 * Inferring it from the case (say, "every expected initial-assessment action")
 * silently sweeps in things like serial re-examination, which happens over
 * hours. A learner who escalates promptly would then be told off for it. That
 * is a clinical judgement, and it belongs to a reviewer.
 *
 * Returns null when no reviewed bar exists for this case.
 */
export function minimumAssessmentIds(caseData, override = null) {
  if (Array.isArray(override)) return override;
  const declared = caseData.core_library?.minimum_assessment_action_ids;
  return Array.isArray(declared) ? declared : null;
}

function escalationVerdict(caseData, session, actionId, override) {
  const action = coreActionsById.get(actionId);
  const policy = action?.escalation_policy;
  if (!policy) return null;

  if (!policy.requires_minimum_assessment) {
    return { appropriate: true, missing: [], policy, barDeclared: true };
  }

  const minimum = minimumAssessmentIds(caseData, override);
  // Fail open. Without a reviewed bar we do not scold the learner on a guess.
  if (minimum === null || minimum.length === 0) {
    return { appropriate: true, missing: [], policy, barDeclared: false };
  }

  const completed = new Set(session.completedActions || []);
  const missing = minimum.filter((id) => !completed.has(id));
  return { appropriate: missing.length === 0, missing, policy, barDeclared: true };
}

function getCaseAction(caseData, actionId) {
  return [
    ...(caseData.expected_actions || []),
    ...(caseData.acceptable_alternatives || []),
    ...(caseData.unnecessary_actions || []),
    ...(caseData.unsafe_actions || []),
  ].find((candidate) => candidate.id === actionId);
}

function evidenceFor(caseData, actionId) {
  const action = getCaseAction(caseData, actionId);
  const ids = action?.evidence_reference_ids || [];
  return (caseData.references || [])
    .filter((reference) => ids.includes(reference.id))
    .map((reference) => ({
      id: reference.id,
      name: reference.name,
      section: reference.section,
      recommendation: reference.recommendation,
      provenance: reference.provenance,
    }));
}

/**
 * The learner's own sentences, pulled out of Reasoning State for the mentor.
 *
 * Every string here was checked against the learner's message before it was
 * stored, so this function only reads. Empty sections are dropped rather than
 * sent as empty arrays: a mentor handed `{evidence_against: []}` tends to
 * remark on the emptiness, which is the heuristics' job, not the prompt's.
 */
function learnerReasoning(state) {
  if (!state) return null;
  const summary = state.problem_representation?.verbatim || null;
  // A hypothesis is worth showing when the learner said anything about it at
  // all: argued it, ordered it, or flagged it as the one not to miss. Dropping
  // "внематочную исключить нельзя" because it came without an argument would
  // hide the single most useful thing the learner said - and a diagnosis name
  // is a concept id, not a patient fact.
  const hypotheses = (state.differential?.items || [])
    .filter(
      (item) =>
        (item.evidence_for || []).length ||
        (item.evidence_against || []).length ||
        item.dangerous ||
        item.rank !== null
    )
    .map((item) => ({
      concept_id: item.concept_id,
      rank: item.rank,
      dangerous: item.dangerous,
      said_for: item.evidence_for || [],
      said_against: item.evidence_against || [],
    }));
  const investigations = (state.investigations?.items || [])
    .filter((item) => item.justification)
    .map((item) => ({ action_id: item.action_id, said_why: item.justification }));
  const changesThePlan = state.contingency?.trigger_verbatim || [];

  if (!summary && !hypotheses.length && !investigations.length && !changesThePlan.length) {
    return null;
  }
  return {
    note:
      "Quoted from the learner's own messages. These are their claims, not verified facts about the patient.",
    ...(summary ? { patient_summary: summary } : {}),
    ...(hypotheses.length ? { hypotheses } : {}),
    ...(investigations.length ? { investigations } : {}),
    ...(changesThePlan.length ? { would_change_the_plan: changesThePlan } : {}),
  };
}

/**
 * @param {object} params
 * @param {object} params.caseData
 * @param {object} params.session  session state AFTER the deterministic update.
 *        Escalation is judged against everything the learner has done including
 *        this turn, so "осмотрел живот, зову старшего" in one message counts as
 *        assessment first, not as avoidance.
 * @param {object} params.plan             turn plan (parsed actions, warnings)
 * @param {object} [params.deterministicUpdate]  result of applyPlan
 * @param {string[]} [params.minimumAssessment]  override for the escalation bar
 * @returns {{moves: object[], containsPatientFacts: boolean, turnNumber: number}}
 */
export function buildMentorBrief({
  caseData,
  session,
  plan,
  deterministicUpdate = {},
  minimumAssessment = null,
}) {
  const moves = [];
  const performed = new Set(
    (deterministicUpdate.scoringEvents || []).map((event) => event.action_id).filter(Boolean)
  );
  const blocked = new Set(
    (deterministicUpdate.blockedOperations || []).map((operation) => operation.action_id)
  );
  // The learner "went for it" whether the engine let the action through or
  // stopped it. Both deserve a mentor reply.
  const attempted = new Set([...performed, ...blocked]);

  // 1. Prerequisite stops. This is the "система говорила стоп" behaviour.
  const stops = [];
  for (const warning of plan.prerequisiteWarnings || []) {
    if (!attempted.has(warning.action_id)) continue;
    const meta = prerequisiteMeta(caseData, warning.action_id, warning.missing);
    stops.push({
      type: MENTOR_MOVE.PREREQUISITE_STOP,
      action_id: warning.action_id,
      missing_action_id: warning.missing,
      severity: meta.severity,
      reason_id: meta.reason_id,
      template: PREREQUISITE_TEMPLATES[meta.reason_id] || PREREQUISITE_FALLBACK,
      evidence: evidenceFor(caseData, warning.missing),
    });
  }

  // A supervisor names what actually blocks the operation, not a checklist of
  // five things at once. Blocking items always speak; advisory ones only when
  // nothing is blocking, and then at most two.
  const blockingStops = stops.filter((stop) => stop.severity === "blocking");
  const shownStops = blockingStops.length > 0 ? blockingStops : stops.slice(0, 2);
  moves.push(...shownStops);
  const stoppedActionIds = new Set(shownStops.map((stop) => stop.action_id));

  // 2. Escalation, judged in context rather than rewarded flatly.
  for (const actionId of ESCALATION_ACTION_IDS) {
    if (!performed.has(actionId)) continue;
    const verdict = escalationVerdict(caseData, session, actionId, minimumAssessment);
    if (!verdict) continue;
    moves.push({
      type: verdict.appropriate
        ? MENTOR_MOVE.ESCALATION_APPROPRIATE
        : MENTOR_MOVE.ESCALATION_PREMATURE,
      action_id: actionId,
      missing_before_escalation: verdict.missing,
      minimum_assessment_declared: verdict.barDeclared,
      template: verdict.appropriate
        ? verdict.policy.appropriate_feedback
        : verdict.policy.premature_feedback,
      evidence: evidenceFor(caseData, actionId),
    });
  }

  // 3. Declared uncertainty. Normalised, then oriented - never punished.
  if (performed.has("declare_uncertainty")) {
    moves.push({
      type: MENTOR_MOVE.UNCERTAINTY_DECLARED,
      action_id: "declare_uncertainty",
      template:
        "Назвать неопределённость вслух — правильный ход, а не провал. Теперь сузим: каких именно данных тебе не хватает для следующего решения?",
      evidence: evidenceFor(caseData, "declare_uncertainty"),
    });
  }

  // 4. Clinically sensible action the library does not carry yet. Acknowledged,
  //    not scored, and logged as a candidate for the core library.
  for (const conceptId of plan.parsed?.recognizedButUndefined || []) {
    moves.push({
      type: MENTOR_MOVE.OUT_OF_SCOPE_RECOGNIZED,
      concept_id: conceptId,
      template:
        "Это осмысленный шаг, но в этом кейсе он не описан, поэтому в оценку не войдёт. Разберём его отдельно.",
      evidence: [],
    });
  }

  // 5. Resource wall. The deterministic layer already printed what is
  //    unavailable; the mentor turns it into a decision, not a dead end.
  for (const operation of deterministicUpdate.blockedOperations || []) {
    // Already covered by a prerequisite stop for the same action: one reason is
    // enough, and the prerequisite is the more specific one.
    if (stoppedActionIds.has(operation.action_id)) continue;
    moves.push({
      type: MENTOR_MOVE.RESOURCE_BLOCKED,
      action_id: operation.action_id,
      template: "Ресурс недоступен. Что меняешь в плане, исходя из того, что есть?",
      evidence: [],
    });
  }

  // 6. What is NOT happening. See mentorHeuristics.js.
  //
  // Yields to a blocking stop: when the operation is being attempted without
  // consent, that is the only thing worth saying this turn.
  const firedHeuristicKeys = [];
  if (blockingStops.length === 0) {
    const selected = selectHeuristics({
      caseData,
      session,
      attempted,
      alreadyFired: session.workingMemory?.firedHeuristicIds || [],
    });
    const status = session.temporalState?.status || "stable";
    for (const heuristic of selected) {
      firedHeuristicKeys.push(firedKey(heuristic, { status }));
      moves.push({
        type: MENTOR_MOVE[heuristic.type.toUpperCase()] || heuristic.type,
        heuristic_id: heuristic.id,
        severity: heuristic.severity,
        hint_level: heuristic.hint_level,
        spec_section: heuristic.spec_section,
        template: heuristic.mentor_line,
        provenance: heuristic.provenance,
        evidence: [],
      });
    }
  }

  // Silence when there is nothing to say.
  //
  // Asked whether "Что делаешь дальше?" every turn beats saying nothing, the
  // author's answer was "пусть молчит лучше когда нечего сказать" - and
  // SURGICAL_MENTOR_LOGIC.md section 19 says the same: do not stop the learner
  // for every imperfect phrase. So the mentor produces no text at all, and the
  // engine keeps its own operational prompt instead of having it replaced.
  const silent = moves.length === 0;

  // What the deterministic layer already did this turn, by name only.
  //
  // Without this the mentor sees the learner's message and a bare "что дальше?"
  // and reconstructs the rest: asked for an examination, so it answers "начинай
  // с осмотра" - telling the learner to do the very thing whose results are
  // printed directly above the mentor's own reply.
  //
  // Concept labels are action metadata, not patient data, so naming them here
  // does not weaken the no-facts invariant.
  const justPerformed = [...performed]
    .map((actionId) => {
      const action = getCaseAction(caseData, actionId);
      return action ? { action_id: actionId, concept: action.concept || actionId } : null;
    })
    .filter(Boolean);

  return {
    moves,
    justPerformed,
    learnerReasoning: learnerReasoning(session.workingMemory?.reasoningState),
    silent,
    // The engine folds these into working memory so a heuristic speaks once per
    // session. A supervisor who repeats the same remark every turn stops being
    // heard after the second time. Deterioration re-arms; see firedKey.
    firedHeuristicKeys,
    resultsAlreadyDelivered: (deterministicUpdate.findingsRevealed || []).length > 0,
    // Invariant asserted by tests: the brief carries verdicts, not findings.
    containsPatientFacts: false,
    turnNumber: session.workingMemory?.turnNumber || 0,
    phase: session.phase,
    locale: session.locale || "ru",
  };
}

/**
 * Deterministic rendering. This is the fallback when no mentor LLM is
 * configured, and the reference text the LLM is asked to rephrase rather than
 * replace. The trainer is never mute, with or without a model.
 */
export function renderMentorBrief(brief) {
  return brief.moves
    .map((move) => move.template)
    .filter(Boolean)
    .join("\n\n");
}

import { renderMentorBrief } from "./mentorBrief.js";
import { MENTOR_MODE } from "./mentorPolicy.js";
import {
  CLINICAL_RUNTIME_EFFECT,
  ruleAllowsRuntimeEffect,
} from "../governance/clinicalGovernance.js";

/**
 * The mentor channel.
 *
 * Freedom in form, not in content. The mentor may choose tone, phrasing, the
 * socratic question and the moment to stop the learner. It may not decide what
 * is clinically true: every clinical statement it makes has to come from the
 * brief it was handed.
 *
 * What it never receives: the Case Card, hidden findings, the expected action
 * list, the score or future state. Patient facts travel only through the
 * revealed-facts allowlist and are tied to source ids.
 */

// The mentor MAY affirm process ("вызов старшего — зрелое решение"). It may NOT
// confirm the diagnosis or announce the expected clinical decision before the
// debrief. That is a narrower ban than the patient channel's, and deliberately
// so: banning the word "верно" outright is what made V2 unable to encourage.
const DIAGNOSIS_CONFIRMATION_RE =
  /(диагноз[а-яё]*\s+(?:поставлен|сформулирован|определ[её]н)\s+(?:верно|правильно)|(?:верный|правильный)\s+диагноз|это\s+подтверждает\s+диагноз|у\s+пациент(?:а|ки)\s+действительно|диагноз\s+подтвержд[а-яё]+|ты\s+(?:прав|права)\s+в\s+диагнозе|overall\s+score|learner\s+score)/i;

const PRESCRIPTION_RE =
  /(нужно\s+(?:выполнить|сделать)\s+(?:аппендэктомию|лапаротомию|операцию)|правильн[а-яё]+\s+тактика\s+—|следует\s+оперировать\s+сейчас)/i;

// Abstract praise is not a teaching intervention. It consumed the mentor turn
// in the replay without naming a current decision or a concrete reasoning
// behavior. Keep reinforcement anchored to an authored, turn-local move.
const UNANCHORED_META_PRAISE_RE =
  /(это\s+помогает\s+сохранять\s+диагностическое\s+мышление|можно\s+двигаться\s+дальше|сохраня(?:ет|ть)\s+широту\s+диагностического\s+поиска|переходить\s+к\s+следующему\s+решению,?\s+опираясь\s+на\s+данные)/iu;

const MAX_MENTOR_CHARS = 700;
export const MENTOR_MODES = Object.freeze([
  MENTOR_MODE.CONTINUE,
  MENTOR_MODE.REINFORCE,
  MENTOR_MODE.CLARIFY,
  MENTOR_MODE.CHALLENGE,
  MENTOR_MODE.TEACH,
  MENTOR_MODE.SAFETY_STOP,
]);

// Russian past-tense verbs are gendered, so "ты обозначил" assigns the learner
// a gender nobody stated. Catches "ты <verb>ал/ла" with up to two words in
// between ("что ты прямо обозначил"). Deliberately anchored on "ты": a bare
// -л ending elsewhere is usually about the patient or the process, which is
// fine. On a hit the turn falls back to the authored text, which is neutral.
// Note: \b cannot be used here. JavaScript word boundaries are ASCII-based, so
// \bты never matches after a space. Cyrillic-aware guards are used instead, and
// the trailing lookahead keeps "остановило" (neuter, about "что") from firing.
const GENDERED_ADDRESS_RE =
  /(?:^|[^а-яё])ты\s+(?:[а-яё]+\s+){0,2}[а-яё]*(?:ал|ял|ил|ел|ыл|ала|яла|ила|ела|ыла|лся|лась)(?![а-яё])/i;

function parseJsonPayload(payload) {
  if (typeof payload === "object" && payload !== null) return payload;
  const text = String(payload || "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Mentor agent did not return JSON.");
    return JSON.parse(match[0]);
  }
}

function significantTokens(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 5);
}

/**
 * Leak check.
 *
 * The mentor was never given these texts. This is a safety net against the
 * model reconstructing a finding from conversation context: if an unrevealed
 * finding's distinctive wording shows up in mentor output, the turn falls back
 * to deterministic rendering.
 */
export function leaksUnrevealedFinding(mentorText, caseData, revealedFindingIds = []) {
  const revealed = new Set(revealedFindingIds);
  const groups = [caseData.hidden_findings || {}, caseData.available_findings || {}];
  const mentorTokens = new Set(significantTokens(mentorText));

  for (const group of groups) {
    for (const [findingId, finding] of Object.entries(group)) {
      if (revealed.has(findingId)) continue;
      const findingTokens = significantTokens(finding.text);
      if (findingTokens.length === 0) continue;
      const overlap = findingTokens.filter((token) => mentorTokens.has(token));
      // A finding is considered leaked when a distinctive run of its wording
      // reappears. Single shared words (e.g. "живот") are not enough.
      if (overlap.length >= 4) return { leaked: true, findingId, overlap };
    }
  }
  return { leaked: false, findingId: null, overlap: [] };
}

export function validateMentorText(mentorText, caseData, revealedFindingIds = []) {
  const text = String(mentorText || "").trim();
  if (!text) return { ok: false, reason: "empty" };
  if (text.length > MAX_MENTOR_CHARS) return { ok: false, reason: "too_long" };
  if (DIAGNOSIS_CONFIRMATION_RE.test(text)) return { ok: false, reason: "premature_diagnosis_confirmation" };
  if (PRESCRIPTION_RE.test(text)) return { ok: false, reason: "prescribed_expected_decision" };
  if (GENDERED_ADDRESS_RE.test(text)) return { ok: false, reason: "gendered_address" };
  if (UNANCHORED_META_PRAISE_RE.test(text)) return { ok: false, reason: "unanchored_meta_praise" };
  if ((text.match(/\?/g) || []).length > 1) return { ok: false, reason: "multiple_questions" };

  const leak = leaksUnrevealedFinding(text, caseData, revealedFindingIds);
  if (leak.leaked) return { ok: false, reason: "finding_leak", findingId: leak.findingId };

  return { ok: true, reason: null };
}

function normaliseFactText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

/**
 * Every factual excerpt must be copied from one allowed source and cited by id.
 * Free coaching prose remains possible, but the agent cannot smuggle in an
 * uncited number because numbers are the highest-risk clinical inventions.
 */
export function validateMentorPayload(payload, brief, caseData, revealedFindingIds = []) {
  const mode = MENTOR_MODES.includes(payload?.mode) ? payload.mode : null;
  if (!mode) return { ok: false, reason: "invalid_mode" };
  const text = String(payload?.mentor_text || "").trim();
  const policy = brief.mentorPolicy || null;
  if (policy && mode !== policy.mode) return { ok: false, reason: "policy_mode_mismatch" };
  if (policy && (payload?.issue_id || null) !== (policy.issue_id || null)) {
    return { ok: false, reason: "policy_issue_mismatch" };
  }
  if (policy && (payload?.question_domain || null) !== (policy.question_domain || null)) {
    return { ok: false, reason: "policy_question_domain_mismatch" };
  }
  if (mode === MENTOR_MODE.CONTINUE) {
    if (text) return { ok: false, reason: "continue_mode_has_text" };
    if (payload?.issue_id) return { ok: false, reason: "continue_mode_has_issue" };
  } else {
    const base = validateMentorText(text, caseData, revealedFindingIds);
    if (!base.ok) return base;
  }
  const issueIds = new Set((brief.candidateIssues || []).map((issue) => issue.issue_id));
  if (payload?.issue_id && !issueIds.has(payload.issue_id)) {
    return { ok: false, reason: "issue_not_in_brief" };
  }
  const safetyIssue = (brief.candidateIssues || []).find((issue) => issue.safety_critical);
  if (safetyIssue && mode !== MENTOR_MODE.SAFETY_STOP) {
    return { ok: false, reason: "safety_interrupt_required" };
  }
  if (
    safetyIssue &&
    payload?.issue_id &&
    !(brief.candidateIssues || []).find(
      (issue) => issue.issue_id === payload.issue_id && issue.safety_critical
    )
  ) {
    return { ok: false, reason: "safety_issue_required" };
  }
  if (!safetyIssue && (brief.candidateIssues || []).length === 0 && mode !== MENTOR_MODE.CONTINUE) {
    return { ok: false, reason: "no_current_issue" };
  }
  if (mode === MENTOR_MODE.REINFORCE && (text.match(/\?/g) || []).length > 0) {
    return { ok: false, reason: "reinforce_must_not_question" };
  }

  const allowed = new Map(
    (brief.revealedFacts || []).map((fact) => [fact.source_id, normaliseFactText(fact.text)])
  );
  for (const rule of brief.approvedTeachingRules || []) {
    if (!ruleAllowsRuntimeEffect(rule, CLINICAL_RUNTIME_EFFECT.MENTOR_TEACHING)) continue;
    allowed.set(`clinical_rule.${rule.rule_id}`, normaliseFactText(rule.claim));
  }
  const claims = Array.isArray(payload?.factual_claims) ? payload.factual_claims : [];
  let uncitedText = normaliseFactText(payload.mentor_text);

  for (const claim of claims) {
    const sourceText = allowed.get(claim?.source_id);
    const claimText = normaliseFactText(claim?.text);
    if (!sourceText) return { ok: false, reason: "fact_source_not_allowed" };
    if (!claimText || !sourceText.includes(claimText)) {
      return { ok: false, reason: "fact_not_supported_by_source" };
    }
    if (!uncitedText.includes(claimText)) {
      return { ok: false, reason: "declared_fact_missing_from_reply" };
    }
    uncitedText = uncitedText.replace(claimText, " ");
  }

  // A number in the free prose is an uncited clinical value until proven
  // otherwise. Source ids themselves never appear in mentor_text.
  if (/\d/u.test(uncitedText)) return { ok: false, reason: "uncited_numeric_fact" };
  return { ok: true, reason: null };
}

export function buildMentorPrompt({ brief, learnerText, locale = "ru" }) {
  return {
    system: [
      "You are the ON QOL Clinical Mentor: an experienced surgeon supervising a resident during a simulated case.",
      "The deterministic mentor policy has already decided whether and how to intervene. Render that exact policy; do not choose a different mode or issue.",
      "",
      "Modes are CONTINUE, REINFORCE, CLARIFY, CHALLENGE, TEACH, and SAFETY_STOP.",
      "CONTINUE means empty mentor_text. REINFORCE recognizes process without a question. CLARIFY asks for one missing current detail. CHALLENGE restores reasoning or ownership. TEACH follows the supplied scaffolding level. SAFETY_STOP stops the current action.",
      "You MAY choose wording and tone within brief.mentor_policy, but you MUST return its exact mode and issue_id.",
      "You MAY affirm professional behaviour such as recognising the limits of one's own competence.",
      "",
      "You MUST NOT: state or confirm a diagnosis, say whether the learner's diagnosis is right or wrong, announce the expected clinical decision, invent a patient finding, or give a score.",
      "brief.revealed_facts is the complete fact allowlist. It contains only facts already visible to the learner. Never use a fact outside it.",
      "If you use a revealed fact, copy the shortest sufficient excerpt EXACTLY into mentor_text and add the same excerpt plus its source_id to factual_claims. Do not paraphrase facts.",
      "Do not put any number in free coaching prose. A number is allowed only inside an exact cited excerpt from revealed_facts.",
      "",
      "WHAT ALREADY HAPPENED. The application prints the patient and environment response ABOVE your reply. Everything in brief.just_performed has already been carried out this turn and its results are already on the learner's screen.",
      "Never instruct the learner to do something listed in just_performed, and never suggest starting it. \"Начинай с осмотра\" after the examination has been performed is wrong and confusing.",
      "Treat those actions as done AND already read by the learner. Do not open by announcing them (\"осмотр уже выполнен\", \"результаты доступны на экране\") - that is narrating the screen back at someone who just read it. Start from what comes next.",
      "Every clinical teaching claim must come from brief.approved_clinical_teaching_rules. Candidate issues are pedagogical signals, not clinical evidence.",
      "Never use a candidate's legacy wording or source citation as authority. Only a rule with status approved_for_training and allowed_to_state=true may be taught.",
      "",
      "THE LEARNER'S OWN WORDS. brief.learner_reasoning contains sentences the learner wrote, quoted exactly. You MAY quote a fragment back to them and build your question on it - \"ты говоришь «стабильна» — по каким признакам?\" teaches more than \"оцени стабильность\".",
      "These are CLAIMS, not facts about the patient. Never confirm one, never treat one as established, and never repeat one as if it were the case talking. The learner saying a patient is stable does not make the patient stable.",
      "Quote only what is in learner_reasoning, exactly as written. Do not extend a quote, complete a thought the learner left unfinished, or attribute to them anything they did not say.",
      "If learner_reasoning is absent, the learner has articulated nothing quotable. Do not invent a quotation, and do not remark on the absence unless a move asks you to.",
      "",
      "Do not collect old rubric gaps one by one and do not jump to an unrelated topic. Deferred issues belong to debrief and are not in this prompt.",
      "Do not praise a bare declaration of uncertainty or an action the case does not model. Do not use abstract meta-praise such as \"это помогает сохранять диагностическое мышление\" or \"можно двигаться дальше\".",
      "",
      "Speak Russian unless the locale says otherwise. Address the learner informally, as a senior colleague would. Be brief: two to four sentences.",
      "",
      "GRAMMATICAL GENDER. The learner's gender is unknown and must stay unknown. Russian past-tense verbs and short adjectives carry gender, so never use them about the learner: not \"ты сделал\", not \"ты сделала\", not \"ты был прав\".",
      "Use instead: present tense (\"ты зовёшь\", \"ты предлагаешь\"), infinitives (\"назвать неопределённость — правильный ход\"), verbal nouns (\"вызов старшего\", \"осмотр выполнен\"), or impersonal forms (\"что уже сделано\").",
      "The same applies to Kazakh where a gendered form would otherwise appear.",
      "Ask ZERO or ONE focused question. Never stack questions. CONTINUE and REINFORCE contain no question.",
      "Return strict JSON only with mode, issue_id (or null), mentor_text, factual_claims and question_domain.",
    ].join("\n"),
    user: JSON.stringify(
      {
        locale,
        learner_message: learnerText,
        brief: {
          turn_number: brief.turnNumber,
          phase: brief.phase,
          path_state: brief.pathState,
          recent_dialogue: brief.recentDialogue,
          // Action names only - never their results. Tells the mentor what the
          // deterministic layer has already answered above its reply.
          just_performed: brief.justPerformed || [],
          results_already_delivered: Boolean(brief.resultsAlreadyDelivered),
          learner_reasoning: brief.learnerReasoning || null,
          reasoning_delta_this_turn: brief.reasoningDeltaThisTurn,
          accumulated_reasoning_state: brief.accumulatedReasoningState,
          previous_mentor_intervention: brief.previousMentorIntervention,
          previous_mentor_question_contract: brief.previousMentorQuestionContract,
          mentor_policy: brief.mentorPolicy,
          safety_flags: brief.safetyFlags,
          simulator_produced_results: brief.simulatorProducedResults,
          facts_contract: brief.factsContract,
          revealed_facts: brief.revealedFacts || [],
          approved_clinical_teaching_rules: (brief.approvedTeachingRules || []).map((rule) => ({
            rule_id: rule.rule_id,
            status: rule.review_status,
            teaching_point: rule.claim,
            allowed_to_state: true,
            factual_claim_source_id: `clinical_rule.${rule.rule_id}`,
            source_ids: rule.source_ids,
          })),
          candidate_issues: (brief.candidateIssues || []).map((issue) => ({
            issue_id: issue.issue_id,
            type: issue.type,
            severity: issue.severity,
            hint_level: issue.hint_level,
            why_now: issue.why_now,
            reasoning_gap: issue.reasoning_gap,
            safety_critical: issue.safety_critical,
            relevant_to_current_turn: issue.relevant_to_current_turn,
            parameter_safety: issue.parameter_safety,
            clinical_rule_ids: issue.clinical_rule_ids || [],
          })),
        },
        output_schema: {
          mode: MENTOR_MODES.join(" | "),
          issue_id: "candidate issue_id | null",
          mentor_text: "string",
          factual_claims: [{ source_id: "string", text: "exact excerpt copied into mentor_text" }],
          question_domain: "mentor_policy.question_domain | null",
        },
      },
      null,
      2
    ),
  };
}

function modeForFallback(issue) {
  if (!issue) return MENTOR_MODE.CONTINUE;
  if (issue.safety_critical) return MENTOR_MODE.SAFETY_STOP;
  if (["escalation_appropriate", "reasoning_reinforcement"].includes(issue.type)) {
    return MENTOR_MODE.REINFORCE;
  }
  if (issue.type === "contingency_acknowledged") return MENTOR_MODE.REINFORCE;
  return Number(issue.severity || 0) >= 3 ? MENTOR_MODE.CHALLENGE : MENTOR_MODE.CLARIFY;
}

function expectationsForIssue(issue) {
  const id = issue?.issue_id || "";
  if (["no_contingency_plan", "checkpoint_what_changes_the_plan", "deterioration_unanswered"].includes(id)) {
    return ["contingency"];
  }
  if (id === "observation_without_endpoint") return ["observation", "contingency"];
  if (id === "hypothesis_without_stability") return ["stability"];
  if (id === "hypothesis_without_management") return ["management"];
  if (id === "iv_fluid_weight_based_requires_review_v1") return ["contingency"];
  if (id === "contingency_threshold") return ["contingency"];
  return [];
}

function pendingQuestionFor({ mode, text, issue, policy, turnNumber }) {
  if (![MENTOR_MODE.CLARIFY, MENTOR_MODE.CHALLENGE, MENTOR_MODE.TEACH, MENTOR_MODE.SAFETY_STOP].includes(mode)) return null;
  if (!String(text || "").includes("?")) return null;
  const expects = policy?.expected_answer_domains?.length
    ? policy.expected_answer_domains
    : expectationsForIssue(issue);
  if (!expects.length) return null;
  return {
    issue_id: issue.issue_id,
    expects,
    expected_answer_domains: expects,
    asked_turn: turnNumber,
    scaffolding_level: policy?.scaffolding_level || 0,
    safety_critical: Boolean(policy?.safety_critical),
    governance_stop: Boolean(policy?.governance_stop),
  };
}

/**
 * @returns {Promise<{text: string, source: "llm"|"deterministic", rejectionReason: string|null}>}
 */
export async function runMentorAgent({ brief, learnerText, caseData, revealedFindingIds = [] }, options = {}) {
  const fallbackIssue = (brief.candidateIssues || [])[0] || null;
  const policy = brief.mentorPolicy || {
    mode: modeForFallback(fallbackIssue),
    issue_id: fallbackIssue?.issue_id || null,
    scaffolding_level: fallbackIssue?.hint_level || 0,
    expected_answer_domains: expectationsForIssue(fallbackIssue),
    question_domain: expectationsForIssue(fallbackIssue)[0] || null,
  };
  const policyIssue =
    (brief.candidateIssues || []).find((issue) => issue.issue_id === policy.issue_id) ||
    fallbackIssue;
  const fallbackMode = policy.mode;
  const fallbackText = fallbackMode === MENTOR_MODE.CONTINUE
    ? ""
    : policy.fallback_text || fallbackIssue?.fallback_text || renderMentorBrief(brief);
  const deterministic = {
    text: fallbackText,
    mode: fallbackMode,
    issueId: policy.issue_id || null,
    source: "deterministic",
    rejectionReason: null,
    moveTypes: brief.moves.map((move) => move.type),
    pendingQuestion: pendingQuestionFor({
      mode: fallbackMode,
      text: fallbackText,
      issue: policyIssue,
      policy,
      turnNumber: brief.turnNumber,
    }),
    firedHeuristicKeys:
      fallbackMode !== MENTOR_MODE.CONTINUE && policyIssue?.fired_key
        ? [policyIssue.fired_key]
        : [],
  };

  if (!options.llm) return deterministic;

  try {
    const payload = await options.llm(
      buildMentorPrompt({ brief, learnerText, locale: options.locale || brief.locale })
    );
    const parsed = parseJsonPayload(payload);
    const validation = validateMentorPayload(parsed, brief, caseData, revealedFindingIds);
    if (!validation.ok) {
      return { ...deterministic, rejectionReason: validation.reason };
    }
    const selectedIssue =
      (brief.candidateIssues || []).find((issue) => issue.issue_id === parsed.issue_id) ||
      fallbackIssue;
    return {
      text: String(parsed.mentor_text).trim(),
      mode: parsed.mode,
      issueId:
        parsed.mode === MENTOR_MODE.CONTINUE
          ? parsed.issue_id || null
          : parsed.issue_id || policy.issue_id || null,
      source: "llm",
      rejectionReason: null,
      moveTypes: brief.moves.map((move) => move.type),
      pendingQuestion: pendingQuestionFor({
        mode: parsed.mode,
        text: parsed.mentor_text,
        issue: selectedIssue,
        policy,
        turnNumber: brief.turnNumber,
      }),
      firedHeuristicKeys: parsed.mode !== MENTOR_MODE.CONTINUE && selectedIssue?.fired_key
        ? [selectedIssue.fired_key]
        : [],
    };
  } catch {
    return { ...deterministic, rejectionReason: "mentor_agent_error" };
  }
}

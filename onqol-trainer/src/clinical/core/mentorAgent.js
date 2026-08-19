import { renderMentorBrief } from "./mentorBrief.js";
import { MENTOR_MODE } from "./mentorPolicy.js";
import { MENTOR_BEHAVIOR_SPEC, MENTOR_BEHAVIOR_SPEC_SOURCE } from "./mentorBehaviorSpec.js";
import { LEARNER_ADDRESS_FORM, resolveLearnerAddressForm } from "./learnerAddress.js";
import {
  CLINICAL_RUNTIME_EFFECT,
  ruleAllowsRuntimeEffect,
} from "../governance/clinicalGovernance.js";

/**
 * The mentor channel (base rules v2, 19.08.2026).
 *
 * THE INVERSION. Until v3.5 the pipeline was "a deterministic policy decides,
 * the model renders, a validator rejects, a template speaks". The model was
 * starved of context so that it could not invent medicine, and what it lost
 * along with the context was the ability to teach: it could not see what the
 * learner had already done, so it narrated the screen back and praised in the
 * abstract. Replay 91ba7206 died of that.
 *
 * It is now "a strong model with the full context decides and speaks,
 * deterministic post-checks judge the output, one repair, and only then a
 * template". Safety did not move: it moved to the *output*, which is the only
 * place it was ever actually enforceable.
 *
 * What still binds the mentor, checked after generation:
 *   1. the world is deterministic       - leaksUnrevealedFinding
 *   2. numbers come from the knowledge base - allowedNumbers / uncited_numeric_fact
 *   3. no diagnosis before the debrief   - DIAGNOSIS_CONFIRMATION_RE
 *   4. reviewed parameter safety stops    - parameterSafety.js, before execution
 *
 * See BASE_RULES_V2_PROPOSAL.md for the decision and ONQOL_MENTOR_BEHAVIOR_SPEC.md
 * for the behaviour contract, which is fed to the model verbatim as its system
 * prompt rather than paraphrased here.
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

// Length is a function of the teaching move, not a constant. Two to four
// sentences is right for a clarification and wrong for level 3-4 scaffolding,
// where the spec asks for options or an explanation and a 700-character ceiling
// truncated the mentor mid-lesson.
export const MAX_MENTOR_CHARS = 700;
export const MAX_MENTOR_CHARS_TEACHING = 2000;
const TEACHING_SCAFFOLDING_THRESHOLD = 3;

export function maxMentorChars({ mode, scaffoldingLevel = 0 } = {}) {
  return mode === MENTOR_MODE.TEACH && Number(scaffoldingLevel || 0) >= TEACHING_SCAFFOLDING_THRESHOLD
    ? MAX_MENTOR_CHARS_TEACHING
    : MAX_MENTOR_CHARS;
}

export const MENTOR_MODES = Object.freeze([
  MENTOR_MODE.CONTINUE,
  MENTOR_MODE.REINFORCE,
  MENTOR_MODE.CLARIFY,
  MENTOR_MODE.CHALLENGE,
  MENTOR_MODE.TEACH,
  MENTOR_MODE.SAFETY_STOP,
]);

// Russian past-tense verbs are gendered, so "ты обозначил" assigns the learner a
// gender nobody stated - unless the learner has already stated it themselves.
// This is no longer a rejection: v2 replaces the blanket ban (which cut natural
// Russian) with an address form taken from the session setting or mirrored from
// the learner's own forms. The pattern survives as a detector so telemetry can
// still say how often the mentor used a gendered address and whether it matched.
// Note: \b cannot be used here. JavaScript word boundaries are ASCII-based, so
// \bты never matches after a space.
const GENDERED_ADDRESS_RE =
  /(?:^|[^а-яё])ты\s+(?:[а-яё]+\s+){0,2}[а-яё]*(?:ал|ял|ил|ел|ыл|ала|яла|ила|ела|ыла|лся|лась)(?![а-яё])/i;

export { LEARNER_ADDRESS_FORM, resolveLearnerAddressForm };

function addressInstruction(form) {
  if (form === LEARNER_ADDRESS_FORM.FEMININE) {
    return "GRAMMATICAL GENDER. The learner's address form is feminine (from the session setting or from her own past-tense forms). Use feminine forms about her: \"ты сказала\", \"ты была права\". Never switch to masculine.";
  }
  if (form === LEARNER_ADDRESS_FORM.MASCULINE) {
    return "GRAMMATICAL GENDER. The learner's address form is masculine (from the session setting or from his own past-tense forms). Use masculine forms about him: \"ты сказал\", \"ты был прав\". Never switch to feminine.";
  }
  return [
    "GRAMMATICAL GENDER. The learner's gender is not established, so do not assign one. Avoid gendered past tense and short adjectives about the learner: not \"ты сделал\", not \"ты сделала\".",
    "Use present tense (\"ты зовёшь\"), infinitives (\"назвать неопределённость — правильный ход\"), verbal nouns (\"вызов старшего\") or impersonal forms (\"что уже сделано\"). The same applies to Kazakh.",
  ].join("\n");
}

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
 * Under v2 the mentor DOES see the unrevealed findings, marked do_not_mention,
 * because knowing what the case models is what lets it say "УЗИ малого таза
 * здесь не смоделировано" instead of a robotic non-answer. This detector is
 * therefore no longer a safety net against reconstruction from context - it is
 * the enforcement of that marking, and it is the reason the marking is safe to
 * hand over at all.
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

const NUMBER_RE = /\d+(?:[.,]\d+)?/gu;

function numbersIn(text) {
  return (String(text || "").match(NUMBER_RE) || []).map((value) => value.replace(",", "."));
}

/**
 * Every number the mentor is allowed to say, and where it came from.
 *
 * Rule 2 of the base rules: the mentor never takes a number out of model memory.
 * It may repeat a value the learner can already see (a revealed finding, the
 * state line), a value an approved rule states - including an approved dosing
 * rule once one exists - or a value the learner themselves wrote. Anything else
 * is an invention, and inventions are exactly what numbers are worst for.
 */
export function allowedNumberSources(brief) {
  const sources = [];
  for (const fact of brief.revealedFacts || []) {
    sources.push({ source_id: fact.source_id, kind: "revealed_fact", text: fact.text });
  }
  for (const rule of brief.approvedTeachingRules || []) {
    if (!ruleAllowsRuntimeEffect(rule, CLINICAL_RUNTIME_EFFECT.MENTOR_TEACHING)) continue;
    sources.push({ source_id: `clinical_rule.${rule.rule_id}`, kind: "clinical_rule", text: rule.claim });
  }
  for (const rule of brief.approvedDosingRules || []) {
    sources.push({
      source_id: `dosing_rule.${rule.rule_id}`,
      kind: "dosing_rule",
      text: [rule.dose, rule.route, rule.timing, ...(rule.adjustments || [])].filter(Boolean).join(" "),
    });
  }
  for (const [index, turn] of (brief.learnerTurns || []).entries()) {
    sources.push({ source_id: `learner_turn.${index}`, kind: "learner_words", text: turn });
  }
  return sources;
}

export function allowedNumbers(brief) {
  const allowed = new Set();
  for (const source of allowedNumberSources(brief)) {
    for (const value of numbersIn(source.text)) allowed.add(value);
  }
  return allowed;
}

export function validateMentorText(mentorText, caseData, revealedFindingIds = [], options = {}) {
  const text = String(mentorText || "").trim();
  const limit = options.maxChars || MAX_MENTOR_CHARS;
  if (!text) return { ok: false, reason: "empty" };
  if (text.length > limit) return { ok: false, reason: "too_long" };
  if (DIAGNOSIS_CONFIRMATION_RE.test(text)) return { ok: false, reason: "premature_diagnosis_confirmation" };
  if (PRESCRIPTION_RE.test(text)) return { ok: false, reason: "prescribed_expected_decision" };
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
 * The post-checks, run on free output.
 *
 * Rejections here are clinical: a leaked finding, a confirmed diagnosis, an
 * uncited number, a bypassed safety stop. Pedagogical disagreements with the
 * old deterministic policy are not rejections any more - the model owns the
 * choice of mode, issue and scaffolding, and the policy's own answer is kept in
 * `telemetry` so the two can be compared on a replay.
 */
export function validateMentorPayload(payload, brief, caseData, revealedFindingIds = []) {
  const telemetry = [];
  const mode = MENTOR_MODES.includes(payload?.mode) ? payload.mode : null;
  if (!mode) return { ok: false, reason: "invalid_mode", telemetry };
  const text = String(payload?.mentor_text || "").trim();
  const policy = brief.mentorPolicy || null;

  // Shadow comparison only. The regex policy no longer dictates the turn.
  if (policy && mode !== policy.mode) telemetry.push("policy_mode_divergence");
  if (policy && (payload?.issue_id || null) !== (policy.issue_id || null)) {
    telemetry.push("policy_issue_divergence");
  }
  if (policy && (payload?.question_domain || null) !== (policy.question_domain || null)) {
    telemetry.push("policy_question_domain_divergence");
  }

  if (mode === MENTOR_MODE.CONTINUE) {
    if (text) return { ok: false, reason: "continue_mode_has_text", telemetry };
    if (payload?.issue_id) return { ok: false, reason: "continue_mode_has_issue", telemetry };
  } else {
    const base = validateMentorText(text, caseData, revealedFindingIds, {
      maxChars: maxMentorChars({ mode, scaffoldingLevel: payload?.scaffolding_level }),
    });
    if (!base.ok) return { ...base, telemetry };
  }

  const issueIds = new Set((brief.candidateIssues || []).map((issue) => issue.issue_id));
  if (payload?.issue_id && !issueIds.has(payload.issue_id)) {
    // The model may name a current issue the heuristics did not enumerate; that
    // is the point of letting it read the whole case. Recorded, not refused.
    telemetry.push("issue_not_in_brief");
  }

  // Safety is the one place where the deterministic layer still gives orders.
  const safetyIssue = (brief.candidateIssues || []).find((issue) => issue.safety_critical);
  if (safetyIssue && mode !== MENTOR_MODE.SAFETY_STOP) {
    return { ok: false, reason: "safety_interrupt_required", telemetry };
  }
  if (mode === MENTOR_MODE.REINFORCE && (text.match(/\?/g) || []).length > 0) {
    return { ok: false, reason: "reinforce_must_not_question", telemetry };
  }

  if (GENDERED_ADDRESS_RE.test(text)) {
    telemetry.push(
      brief.learnerAddressForm && brief.learnerAddressForm !== LEARNER_ADDRESS_FORM.NEUTRAL
        ? "gendered_address_with_known_form"
        : "gendered_address_without_known_form"
    );
  }

  // Declared excerpts are telemetry now: paraphrase is allowed, because the
  // facts are already on the learner's screen and forcing verbatim quotation is
  // what made the mentor sound like a printer. Numbers are the exception below.
  // Same filter as allowedNumberSources: a rule that is in the brief but not
  // approved for teaching is not a source, whatever the brief calls it.
  const allowedSourceIds = new Set(allowedNumberSources(brief).map((source) => source.source_id));
  for (const claim of Array.isArray(payload?.factual_claims) ? payload.factual_claims : []) {
    if (!allowedSourceIds.has(claim?.source_id)) telemetry.push("fact_source_not_allowed");
    else if (!normaliseFactText(text).includes(normaliseFactText(claim?.text))) {
      telemetry.push("declared_fact_missing_from_reply");
    }
  }

  // Rule 2, enforced. Every number in the reply has to exist in a revealed fact,
  // an approved rule (including dosing rules) or the learner's own words.
  const permitted = allowedNumbers(brief);
  const unsupported = numbersIn(text).filter((value) => !permitted.has(value));
  if (unsupported.length) {
    return {
      ok: false,
      reason: "uncited_numeric_fact",
      unsupportedNumbers: [...new Set(unsupported)],
      telemetry,
    };
  }
  return { ok: true, reason: null, telemetry };
}

/** The short, non-negotiable block that follows the specification. */
export function mentorHardBounds(brief) {
  return [
    "=== HARD BOUNDS (these override anything in the specification above) ===",
    "",
    "1. THE WORLD IS DETERMINISTIC. Findings, values, timing and progression exist only in the case card you were given. Never state a finding that is not in revealed_findings, and never announce a result the learner has not obtained. The case card's unrevealed_findings section is marked do_not_mention: it is there so you know what this case does and does not model, NOT so you can tell the learner. Saying honestly what the case does not simulate is allowed and useful; hinting at what an unperformed test would show is not.",
    "2. NUMBERS COME FROM THE KNOWLEDGE BASE. Every digit in your reply must already appear in a revealed fact, an approved clinical or dosing rule, or the learner's own words. If the base has no number - a dose, a threshold, an interval - discuss it without the number and send the learner to the local formulary. Never take a number from your own memory, not even one you are sure of.",
    "3. NO DIAGNOSTIC CONFIRMATION BEFORE THE DEBRIEF. You may say a hypothesis explains the picture. You may not say the diagnosis is correct, that the learner is right about it, or what the patient definitely has.",
    "4. ZERO OR ONE QUESTION PER TURN. Never stack questions. CONTINUE carries no text at all; REINFORCE carries no question.",
    "",
    "WHAT ALREADY HAPPENED. The application prints the patient and environment response ABOVE your reply. Everything in just_performed has been carried out this turn and its results are already on the learner's screen. Never instruct the learner to start something already done, and do not open by narrating the screen back at them.",
    "THE LEARNER'S CLAIMS ARE NOT FACTS. accumulated_reasoning_state and the transcript contain what the learner said. Quoting it back is good supervision; treating it as established patient truth is not. The learner calling the patient stable does not make her stable.",
    "",
    addressInstruction(brief.learnerAddressForm || LEARNER_ADDRESS_FORM.NEUTRAL),
    "",
    `Speak ${brief.locale === "kk" ? "Kazakh" : "Russian"} unless the locale field says otherwise. Address the learner informally, as a senior colleague would.`,
    `Length limit: ${MAX_MENTOR_CHARS} characters, or ${MAX_MENTOR_CHARS_TEACHING} for TEACH at scaffolding ${TEACHING_SCAFFOLDING_THRESHOLD} or above.`,
    "Return strict JSON only: mode, issue_id (or null), mentor_text, factual_claims, question_domain, scaffolding_level.",
  ].join("\n");
}

export function buildMentorPrompt({ brief, learnerText, locale = "ru", repair = null }) {
  return {
    system: [
      `You are the ON QOL Clinical Mentor. The behaviour contract below is ${MENTOR_BEHAVIOR_SPEC_SOURCE}, reproduced verbatim. Follow it. You decide whether to intervene, which current issue matters most, which mode to use and how much scaffolding to give.`,
      "",
      MENTOR_BEHAVIOR_SPEC,
      "",
      mentorHardBounds(brief),
    ].join("\n"),
    user: JSON.stringify(
      {
        locale,
        learner_message: learnerText,
        // A rejected reply comes back here with the reason, once. See runMentorAgent.
        ...(repair ? { repair_request: repair } : {}),
        brief: {
          turn_number: brief.turnNumber,
          phase: brief.phase,
          path_state: brief.pathState,
          learner_address_form: brief.learnerAddressForm || LEARNER_ADDRESS_FORM.NEUTRAL,
          // The whole session, not the last six lines. Closing a prerequisite
          // with what the learner already said requires having read it.
          transcript: brief.transcript || brief.recentDialogue || [],
          recent_dialogue: brief.recentDialogue,
          case_card: brief.caseCard || null,
          // Action names only - never their results. Tells the mentor what the
          // deterministic layer has already answered above its reply.
          just_performed: brief.justPerformed || [],
          results_already_delivered: Boolean(brief.resultsAlreadyDelivered),
          unrecognized_fragments: brief.unrecognizedFragments || [],
          learner_reasoning: brief.learnerReasoning || null,
          reasoning_delta_this_turn: brief.reasoningDeltaThisTurn,
          accumulated_reasoning_state: brief.accumulatedReasoningState,
          previous_mentor_intervention: brief.previousMentorIntervention,
          previous_mentor_question_contract: brief.previousMentorQuestionContract,
          // Advisory. The deterministic policy's own answer, for you to
          // disagree with when the case says otherwise. Not an instruction.
          deterministic_policy_shadow: brief.mentorPolicy,
          safety_flags: brief.safetyFlags,
          simulator_produced_results: brief.simulatorProducedResults,
          facts_contract: brief.factsContract,
          revealed_facts: brief.revealedFacts || [],
          allowed_numbers: [...allowedNumbers(brief)],
          approved_clinical_teaching_rules: (brief.approvedTeachingRules || []).map((rule) => ({
            rule_id: rule.rule_id,
            status: rule.review_status,
            teaching_point: rule.claim,
            allowed_to_state: true,
            factual_claim_source_id: `clinical_rule.${rule.rule_id}`,
            source_ids: rule.source_ids,
          })),
          approved_dosing_rules: (brief.approvedDosingRules || []).map((rule) => ({
            rule_id: rule.rule_id,
            agent: rule.agent,
            indication: rule.indication,
            dose: rule.dose,
            route: rule.route,
            timing: rule.timing,
            adjustments: rule.adjustments || [],
            factual_claim_source_id: `dosing_rule.${rule.rule_id}`,
            source_ids: rule.source_ids,
          })),
          // Named but unapproved practices the learner used. No teaching text is
          // supplied until a reviewer signs one; say nothing clinical about them.
          legacy_practices_named: brief.legacyPracticesNamed || [],
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
          issue_id: "candidate issue_id, your own current issue name, or null",
          mentor_text: "string",
          factual_claims: [{ source_id: "string", text: "excerpt of what you asserted" }],
          question_domain: "what kind of answer your question expects | null",
          scaffolding_level: "0-4",
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

function pendingQuestionFor({ mode, text, issue, policy, turnNumber, questionDomain = null }) {
  if (![MENTOR_MODE.CLARIFY, MENTOR_MODE.CHALLENGE, MENTOR_MODE.TEACH, MENTOR_MODE.SAFETY_STOP].includes(mode)) return null;
  if (!String(text || "").includes("?")) return null;
  const expects = policy?.expected_answer_domains?.length
    ? policy.expected_answer_domains
    : expectationsForIssue(issue).length
      ? expectationsForIssue(issue)
      : questionDomain
        ? [questionDomain]
        : [];
  if (!expects.length) return null;
  return {
    issue_id: issue?.issue_id || null,
    expects,
    expected_answer_domains: expects,
    asked_turn: turnNumber,
    scaffolding_level: policy?.scaffolding_level || 0,
    safety_critical: Boolean(policy?.safety_critical),
    governance_stop: Boolean(policy?.governance_stop),
  };
}

const REPAIR_EXPLANATIONS = Object.freeze({
  uncited_numeric_fact:
    "в реплике есть число, которого нет ни в раскрытых фактах, ни в одобренных правилах, ни в словах резидента",
  finding_leak: "реплика раскрывает находку, которую резидент ещё не получил",
  premature_diagnosis_confirmation: "реплика подтверждает диагноз до дебрифа",
  prescribed_expected_decision: "реплика называет ожидаемое клиническое решение вместо вопроса",
  unanchored_meta_praise: "похвала абстрактна и не привязана к текущему ходу",
  multiple_questions: "в реплике больше одного вопроса",
  too_long: "реплика длиннее лимита для этого режима",
  safety_interrupt_required: "есть safety-critical сигнал: режим обязан быть SAFETY_STOP",
  reinforce_must_not_question: "REINFORCE не содержит вопроса",
  continue_mode_has_text: "CONTINUE не содержит текста",
  continue_mode_has_issue: "CONTINUE не содержит issue_id",
  invalid_mode: "mode не входит в допустимый список",
  empty: "mentor_text пустой",
});

function repairRequest(validation) {
  const explanation = REPAIR_EXPLANATIONS[validation.reason] || validation.reason;
  const detail = validation.unsupportedNumbers?.length
    ? ` Не подтверждены числа: ${validation.unsupportedNumbers.join(", ")}.`
    : validation.findingId
      ? ` Находка: ${validation.findingId}.`
      : "";
  return {
    rejected_reason: validation.reason,
    instruction_ru: `Реплика отклонена: ${validation.reason} — ${explanation}.${detail} Исправь и верни ту же мысль без нарушения. Контекст прежний.`,
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
    rejectionReasons: [],
    repairAttempted: false,
    telemetry: [],
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

  const locale = options.locale || brief.locale;
  const rejectionReasons = [];
  const telemetry = [];
  let repair = null;

  // Rule 5: a rejection buys one repair, not an immediate retreat to the
  // template. The authored text is the last resort, not the first answer.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let parsed;
    try {
      parsed = parseJsonPayload(
        await options.llm(buildMentorPrompt({ brief, learnerText, locale, repair }))
      );
    } catch {
      rejectionReasons.push("mentor_agent_error");
      return {
        ...deterministic,
        rejectionReason: rejectionReasons[0],
        rejectionReasons,
        repairAttempted: attempt > 0,
        telemetry,
      };
    }
    const validation = validateMentorPayload(parsed, brief, caseData, revealedFindingIds);
    telemetry.push(...(validation.telemetry || []));
    if (!validation.ok) {
      rejectionReasons.push(validation.reason);
      repair = repairRequest(validation);
      continue;
    }

    const selectedIssue =
      (brief.candidateIssues || []).find((issue) => issue.issue_id === parsed.issue_id) ||
      fallbackIssue;
    return {
      text: String(parsed.mentor_text || "").trim(),
      mode: parsed.mode,
      issueId:
        parsed.mode === MENTOR_MODE.CONTINUE
          ? parsed.issue_id || null
          : parsed.issue_id || policy.issue_id || null,
      source: "llm",
      // Null: this reply passed. What it was repaired FROM is in
      // rejectionReasons, which is what the before/after table reads.
      rejectionReason: null,
      rejectionReasons,
      repairAttempted: attempt > 0,
      telemetry,
      scaffoldingLevel: Number(parsed.scaffolding_level || policy.scaffolding_level || 0),
      moveTypes: brief.moves.map((move) => move.type),
      pendingQuestion: pendingQuestionFor({
        mode: parsed.mode,
        text: parsed.mentor_text,
        issue: selectedIssue,
        policy,
        turnNumber: brief.turnNumber,
        questionDomain: parsed.question_domain || null,
      }),
      firedHeuristicKeys: parsed.mode !== MENTOR_MODE.CONTINUE && selectedIssue?.fired_key
        ? [selectedIssue.fired_key]
        : [],
    };
  }

  return {
    ...deterministic,
    rejectionReason: rejectionReasons[rejectionReasons.length - 1] || null,
    rejectionReasons,
    repairAttempted: true,
    telemetry,
  };
}

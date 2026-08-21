import { renderMentorBrief } from "./mentorBrief.js";
import { MENTOR_MODE } from "./mentorPolicy.js";
import { MENTOR_BEHAVIOR_SPEC, MENTOR_BEHAVIOR_SPEC_SOURCE } from "./mentorBehaviorSpec.js";
import {
  LEARNER_ADDRESS_FORM,
  detectGenderedAddress,
  resolveLearnerAddressForm,
} from "./learnerAddress.js";
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
 * It is now "a strong model with the full context chooses among bounded
 * current issues and speaks,
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

const DIRECT_CLINICAL_RECOMMENDATION_RE =
  /(?:^|[.!?]\s*)(?:(?:здесь|сейчас|в\s+этой\s+ситуации)\s+)?(?:(?:нужно|следует|необходимо|лучше|предпочтительнее|оптимально)\s+(?:назначить|ввести|дать|начать|прекратить|отменить|выполнить|сделать|оперировать|перевести|госпитализировать)|(?:назначь|введи|дай|начни|прекрати|отмени|выполни|сделай|оперируй|переведи|госпитализируй|выбери)(?=\s|[.,!?;:]|$)|правильн[а-яё]+\s+тактика\s+—)/iu;

function containsDirectClinicalRecommendation(text) {
  // Quoting the learner's proposed action is supervision, not prescribing it.
  // Remove paired Russian/English quotes before classifying the mentor's own
  // voice; unclosed quotes remain visible and therefore fail conservatively.
  const unquoted = String(text || "")
    .replace(/«[^»]*»/gu, " ")
    .replace(/“[^”]*”/gu, " ")
    .replace(/"[^"]*"/gu, " ");
  return DIRECT_CLINICAL_RECOMMENDATION_RE.test(unquoted);
}

// Abstract praise is not a teaching intervention. It consumed the mentor turn
// in the replay without naming a current decision or a concrete reasoning
// behavior. Keep reinforcement anchored to an authored, turn-local move.
const UNANCHORED_META_PRAISE_RE =
  /(это\s+помогает\s+сохранять\s+диагностическое\s+мышление|можно\s+двигаться\s+дальше|сохраня(?:ет|ть)\s+широту\s+диагностического\s+поиска|переходить\s+к\s+следующему\s+решению,?\s+опираясь\s+на\s+данные)/iu;

// Length is a function of the teaching move, not a constant. Two to four
// sentences is right for a clarification and wrong for level 3-4 scaffolding,
// where the spec asks for options or an explanation and a 700-character ceiling
// truncated the mentor mid-lesson.
export const MAX_MENTOR_CHARS = 1100;
export const MAX_MENTOR_CHARS_TEACHING = 2600;
// Length is style, not safety: over the budget is telemetry, and only a reply
// that has clearly run away is refused. See validateMentorText.
export const MENTOR_HARD_CHAR_CEILING_FACTOR = 2;
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

export { LEARNER_ADDRESS_FORM, detectGenderedAddress, resolveLearnerAddressForm };

function addressInstruction(form) {
  if (form === LEARNER_ADDRESS_FORM.FEMININE) {
    return "GRAMMATICAL GENDER. The learner's address form is feminine (from the session setting or from her own past-tense forms). Use feminine forms about her: \"ты сказала\", \"ты была права\". Never switch to masculine.";
  }
  if (form === LEARNER_ADDRESS_FORM.MASCULINE) {
    return "GRAMMATICAL GENDER. The learner's address form is masculine (from the session setting or from his own past-tense forms). Use masculine forms about him: \"ты сказал\", \"ты был прав\". Never switch to feminine.";
  }
  return [
    "GRAMMATICAL GENDER. The learner's gender is not established, so do not assign one. Avoid gendered past tense and short adjectives about the learner - and note that Russian drops the subject, so \"хорошо, что сохранил\" assigns a gender exactly as \"ты сохранил\" does. Dropping the pronoun is not a way around this rule.",
    "Stay in the SECOND PERSON and the PRESENT TENSE, and use the IMPERATIVE freely. \"ты зовёшь старшего\", \"ты держишь аппендицит в дифференциале\", \"назови дозу\", \"смотри на диурез\", \"считай сам\". Imperatives and present-tense verbs carry no gender at all in Russian, and they are how a surgeon actually speaks on a shift.",
    "THE PASSIVE VOICE IS FORBIDDEN as a way around gender, and this is the most important line in this block. \"Рабочая гипотеза сформулирована\", \"подготовка к операции зафиксирована\", \"назначение записано\", \"вызов старшего — зрелое решение\" are all grammatically correct and all sound like a clerk filling in a form. That register is the single worst defect this mentor has ever had. If a sentence only works in the passive, throw it away and write a question or an instruction instead.",
    "Instead of \"хорошо, что сохранил аппендицит как рабочую гипотезу\" write \"аппендицит из дифференциала ты не выкидываешь — правильно\". Instead of \"ты не сузил дифференциал\" write \"дифференциал у тебя всё ещё широкий\". Instead of \"ты назначил физраствор\" write \"ты льёшь физраствор — сколько и за какое время?\". The same applies to Kazakh.",
    "PAST TENSE IS NOT THE ONLY TRAP. \"сам\", \"одна\", \"готов\", \"уверена\", \"должен\" all assign a gender in the present tense: \"теперь сам определяй тактику\" is as gendered as \"ты определил\". Drop the word - \"теперь определяй тактику\" says the same thing. The voice reference in section 19.1 of the specification is quoted in the masculine because that is how it was recorded; re-cast every line of it to whatever the learner's address form says, and to neutral when it says nothing.",
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

function splitSentences(text) {
  return String(text || "")
    .split(/(?<=[.!?…])\s+|\n+/u)
    .map((sentence) => sentence.replace(/^[\s*#>|-]+/u, "").trim())
    .filter(Boolean);
}

/**
 * Crude prefix stems, for comparing the mentor with its own earlier questions.
 *
 * Russian inflection defeats exact token matching, and six characters is enough
 * to fold "моделируется"/"моделируемого" and "пациенту"/"пациентке" together.
 * This is deliberately NOT used against the engine's text - see
 * duplicatesEngineHousekeeping for why that comparison needs a vocabulary
 * instead. Here both sides are the mentor's own writing on the same topic, and
 * the cost of a false positive is that it escalates a turn early.
 */
function stemmedTokens(text) {
  return significantTokens(text).map((token) => token.slice(0, 6));
}

function questionSentences(text) {
  return splitSentences(text).filter((sentence) => sentence.includes("?"));
}

/**
 * Is this the same question the mentor already asked?
 *
 * Live run 21.08.2026, turns 4 to 7: "почему сменила доступ", four times, four
 * wordings, never answered, patient never moved. The prompt rule alone did not
 * stop it - the model could see its own repeats in the transcript and repeated
 * anyway - so the rule is enforced.
 *
 * TEACH is exempt on purpose. Breaking the unanswered question into the two
 * smaller ones it was hiding is exactly the escalation this is asking for, and
 * those smaller questions necessarily share its words.
 */
export function repeatsRecentQuestion(mentorText, recentQuestions = []) {
  for (const asked of recentQuestions) {
    const askedStems = new Set(stemmedTokens(asked));
    if (askedStems.size < 3) continue;
    for (const sentence of questionSentences(mentorText)) {
      const stems = stemmedTokens(sentence);
      if (stems.length < 3) continue;
      let shared = 0;
      for (const stem of new Set(stems)) if (askedStems.has(stem)) shared += 1;
      if (shared / new Set(stems).size >= 0.5) return { repeated: true, asked, sentence };
    }
  }
  return { repeated: false, asked: null, sentence: null };
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

/**
 * The mentor citing authority.
 *
 * Live run 21.08.2026, turn 7: "По утверждённому правилу, у стабильной взрослой
 * пациентки с неосложнённым аппендицитом лапароскопический доступ является
 * рекомендуемым вариантом." No approved rule in the registry says anything
 * about operative access. The model invented the content AND the citation.
 *
 * Nothing caught it. There is no number in the sentence, so rule 2 does not
 * bite; prescribed_expected_decision had been demoted to telemetry the same
 * day; and the declared factual_claim named a real source_id while quoting
 * something that source does not say - which registered only as
 * declared_fact_missing_from_reply.
 *
 * A fabricated guideline is worse than a fabricated number: the learner cannot
 * check it, and it arrives wearing the reviewers' authority. So an appeal to a
 * rule must be traceable to a rule, and a rule-sourced claim must appear in the
 * reply as written rather than paraphrased. Both refuse.
 */
const RULE_CITATION_RE =
  /(по\s+утвержд[её]нн|согласно\s+утвержд[её]нн|утвержд[её]нн[а-яё]*\s+правил|по\s+одобренн|согласно\s+правил|по\s+правил[уа]|по\s+рекомендаци|согласно\s+рекомендаци|по\s+протокол|согласно\s+протокол|гайдлайн|guideline)/iu;

const RULE_SOURCE_PREFIXES = ["clinical_rule.", "dosing_rule."];

function isRuleSource(sourceId) {
  return RULE_SOURCE_PREFIXES.some((prefix) => String(sourceId || "").startsWith(prefix));
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

/**
 * What a mentor reply may not do.
 *
 * 21.08.2026: only the clinical bounds refuse. A refusal costs a repair round
 * and, failing that, silence - and every stylistic rule that was enforced here
 * was making the mentor MORE wooden, not less: the model does not learn a voice
 * from a rejection, it learns to write the most cautious sentence that clears
 * the regex. Abstract praise was banned by wording and came back reworded
 * ("это хороший диагностический процесс"); it is now prevented structurally by
 * the REINFORCE anchor quote instead. Everything demoted here is still
 * recorded, so a real regression is still visible on a replay.
 *
 * Refuses: empty, a leaked finding, a confirmed diagnosis, a runaway length.
 * Records: length over budget, prescription, unanchored praise, stacked
 * questions.
 */
export function validateMentorText(mentorText, caseData, revealedFindingIds = [], options = {}) {
  const text = String(mentorText || "").trim();
  const limit = options.maxChars || MAX_MENTOR_CHARS;
  const telemetry = [];
  if (!text) return { ok: false, reason: "empty", telemetry };
  if (text.length > limit * MENTOR_HARD_CHAR_CEILING_FACTOR) {
    return { ok: false, reason: "runaway_length", telemetry };
  }
  if (text.length > limit) telemetry.push("over_length_budget");
  if (DIAGNOSIS_CONFIRMATION_RE.test(text)) {
    return { ok: false, reason: "premature_diagnosis_confirmation", telemetry };
  }
  if (containsDirectClinicalRecommendation(text)) {
    telemetry.push("prescribed_expected_decision");
  }
  if (UNANCHORED_META_PRAISE_RE.test(text)) telemetry.push("unanchored_meta_praise");
  if ((text.match(/\?/g) || []).length > 1) telemetry.push("multiple_questions");

  const leak = leaksUnrevealedFinding(text, caseData, revealedFindingIds);
  if (leak.leaked) return { ok: false, reason: "finding_leak", findingId: leak.findingId, telemetry };

  return { ok: true, reason: null, telemetry };
}

/**
 * The simulator explaining itself.
 *
 * This vocabulary belongs to the engine: what the case models, which parameter
 * has no reviewed rule, what was recorded but not applied. Hard bound 1 lets
 * the MENTOR say such a thing too - answering a learner who asks is useful -
 * so the ban is conditional on the engine having already said it this turn.
 * That is the actual defect from the live run of 20.08.2026: on turns 4 and 7
 * the engine printed the housekeeping and the mentor spent its whole turn
 * saying it again, in the passive, while the learner's reasoning went
 * unexamined.
 *
 * A lexical similarity score was tried first and is not usable in Russian:
 * inflection hides real echoes, and a legitimate question about the same drug
 * ("цефазолин ты уже назначил - какую цель профилактики он закрывает?") scores
 * higher than the echo it is meant to catch. The vocabulary is the signal.
 */
const SIMULATOR_META_RE =
  /(не\s+модел[а-яё]*|модел[а-яё]*\s+эффект[а-яё]*|отрецензированн[а-яё]*|не\s+применен[а-яё]*\s+к\s+пациент[а-яё]*|в\s+этой\s+версии|не\s+задан[а-яё]*\s+в\s+карте|не\s+авторизован[а-яё]*|не\s+валидирован[а-яё]*|не\s+прошл[а-яё]+\s+проверку|в\s+пилоте|симулятор[а-яё]*|тренаж[её]р[а-яё]*)/iu;

export function duplicatesEngineHousekeeping(mentorText, engineText) {
  return SIMULATOR_META_RE.test(String(mentorText || "")) &&
    SIMULATOR_META_RE.test(String(engineText || ""));
}

/**
 * Did the mentor say back what the engine already printed above it?
 *
 * Kept as a signal rather than a rule: see duplicatesEngineHousekeeping above
 * for why lexical overlap cannot carry the refusal on its own. Sentence-level,
 * because a shared phrase inside a longer teaching reply is fine and a whole
 * restated sentence is not.
 */
export function paraphrasesEngine(mentorText, engineText) {
  const engineSentences = splitSentences(engineText);
  if (!engineSentences.length) return { paraphrased: false, ratio: 0, sentence: null };
  for (const mentorSentence of splitSentences(mentorText)) {
    const mentorTokens = new Set(significantTokens(mentorSentence));
    if (mentorTokens.size < 4) continue;
    for (const engineSentence of engineSentences) {
      const engineTokens = new Set(significantTokens(engineSentence));
      if (engineTokens.size < 4) continue;
      let shared = 0;
      for (const token of mentorTokens) if (engineTokens.has(token)) shared += 1;
      const ratio = shared / mentorTokens.size;
      if (ratio >= 0.6) return { paraphrased: true, ratio, sentence: mentorSentence };
    }
  }
  return { paraphrased: false, ratio: 0, sentence: null };
}

function normaliseFactText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

/**
 * The post-checks, run on free output.
 *
 * Rejections here are clinical: a leaked finding, a confirmed diagnosis, an
 * uncited number, a bypassed safety stop. Pedagogical disagreements with the
 * old deterministic policy are not rejections any more - the model owns mode,
 * scaffolding and natural wording, and chooses among the deterministic current
 * issues. The policy's own answer is kept in `telemetry` for replay comparison.
 */
function normaliseForAnchor(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * The anchor quote, and why REINFORCE has one.
 *
 * Praise the learner cannot trace to something they just said is not teaching,
 * it is noise, and banning its WORDING never worked: replay 91ba7206 said
 * "сохраняет широту диагностического поиска", the regex learned that sentence,
 * and the live run of 20.08.2026 said "это хороший диагностический процесс"
 * instead. So REINFORCE now has to quote. If nothing in this turn is quotable,
 * there is nothing to reinforce and the mentor should stay quiet or ask.
 */
export function anchorQuoteMatches(anchorQuote, learnerText) {
  const quote = normaliseForAnchor(anchorQuote);
  if (quote.split(" ").filter(Boolean).length < 2) return false;
  return normaliseForAnchor(learnerText).includes(quote);
}

export function validateMentorPayload(payload, brief, caseData, revealedFindingIds = [], options = {}) {
  const telemetry = [];
  const learnerText =
    options.learnerText != null
      ? options.learnerText
      : (brief.learnerTurns || [])[(brief.learnerTurns || []).length - 1] || "";
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
    telemetry.push(...(base.telemetry || []));
    if (!base.ok) return { ...base, telemetry };

    // Rule 7. The engine has already spoken above this reply.
    if (duplicatesEngineHousekeeping(text, brief.engineReplyText)) {
      return { ok: false, reason: "repeats_engine_housekeeping", telemetry };
    }
    const echo = paraphrasesEngine(text, brief.engineReplyText || "");
    if (echo.paraphrased) telemetry.push("echoes_engine_sentence");
  }

  const candidateIssues = brief.candidateIssues || [];
  const issueIds = new Set(candidateIssues.map((issue) => issue.issue_id));
  if (mode !== MENTOR_MODE.CONTINUE && !payload?.issue_id) {
    return { ok: false, reason: "mentor_issue_required", telemetry };
  }
  if (payload?.issue_id && !issueIds.has(payload.issue_id)) {
    // The model remains free to choose among current issues and to phrase the
    // intervention naturally. It may not create a new clinical problem that
    // the deterministic brief cannot review or close on the next turn.
    return { ok: false, reason: "issue_not_in_brief", telemetry };
  }
  const selectedPayloadIssue = candidateIssues.find(
    (issue) => issue.issue_id === payload?.issue_id
  ) || null;

  // A standing risk at an authored irreversible gate is advisory, not a
  // SAFETY_STOP, but it is not optional. CONTINUE or a different issue would
  // consume the held action without returning the promised decision.
  const standingGateIssue = candidateIssues.find(
    (issue) => issue.standing_risk_stage === "irreversible_gate"
  );
  if (standingGateIssue && mode === MENTOR_MODE.CONTINUE) {
    return { ok: false, reason: "standing_gate_intervention_required", telemetry };
  }
  if (standingGateIssue && payload?.issue_id !== standingGateIssue.issue_id) {
    return { ok: false, reason: "standing_gate_issue_required", telemetry };
  }

  // Safety is the one place where the deterministic layer still gives orders.
  const safetyIssue = (brief.candidateIssues || []).find((issue) => issue.safety_critical);
  if (safetyIssue && mode !== MENTOR_MODE.SAFETY_STOP) {
    return { ok: false, reason: "safety_interrupt_required", telemetry };
  }
  // Style, recorded rather than refused: a REINFORCE that ends in a question is
  // usually a CLARIFY the model mislabelled, and refusing it costs the learner
  // the sentence.
  if (mode === MENTOR_MODE.REINFORCE && (text.match(/\?/g) || []).length > 0) {
    telemetry.push("reinforce_with_question");
  }
  if (mode === MENTOR_MODE.REINFORCE && !anchorQuoteMatches(payload?.anchor_quote, learnerText)) {
    return { ok: false, reason: "reinforce_without_anchor", telemetry };
  }
  if (mode !== MENTOR_MODE.REINFORCE && payload?.anchor_quote) {
    if (!anchorQuoteMatches(payload.anchor_quote, learnerText)) telemetry.push("anchor_quote_not_found");
  }

  // Hard bound 8, enforced. It was telemetry for exactly one run; the model
  // read its own repeats in the transcript and repeated regardless.
  //
  // Two checks, because one is not enough. The streak is the reliable one - it
  // counts turns, not words, and the run that prompted this asked one question
  // in four wordings only two of which were lexically close. The wording check
  // below still earns its place for a repeat that comes back after a break.
  if (
    [MENTOR_MODE.CLARIFY, MENTOR_MODE.CHALLENGE].includes(mode) &&
    Number(brief.probingStreak || 0) >= 2
  ) {
    return { ok: false, reason: "third_consecutive_probe", telemetry };
  }
  if (mode !== MENTOR_MODE.TEACH && mode !== MENTOR_MODE.SAFETY_STOP) {
    const repeat = repeatsRecentQuestion(text, brief.recentMentorQuestions || []);
    if (repeat.repeated) {
      return { ok: false, reason: "question_repeated", repeatedQuestion: repeat.asked, telemetry };
    }
  }
  if (Number(brief.unansweredQuestionTurns || 0) >= 2 && (text.match(/\?/g) || []).length > 0) {
    telemetry.push("question_after_two_unanswered_turns");
  }

  /**
   * Gendered address.
   *
   * Telemetry until 21.08.2026, and it flagged the same defect on turn 5 of
   * three consecutive live runs: "ты сказал", "теперь сам определяй", "ты
   * только что выбрал" - every one of them to a learner whose form was not
   * known, every one after a prompt paragraph asking for exactly the opposite.
   * The instruction does not survive contact with a CHALLENGE, where the
   * natural Russian for "you just chose" is the past tense.
   *
   * So it refuses now. This is not style: the pilot cohort is eight residents
   * of mixed gender, the start screen lets them decline to say, and a mentor
   * that guesses is wrong for roughly half of them. Detection is reliable and
   * the repair instruction says exactly how to rewrite, so the cost is one
   * extra call on the turns that trip it.
   *
   * Matching the learner's DECLARED form stays fine - that is the whole point
   * of asking - and is only recorded.
   */
  const genderedAddress = detectGenderedAddress(text);
  if (genderedAddress.matched) {
    const declared = brief.learnerAddressForm || LEARNER_ADDRESS_FORM.NEUTRAL;
    if (declared === LEARNER_ADDRESS_FORM.NEUTRAL) {
      return { ok: false, reason: "gendered_address_without_form", telemetry };
    }
    if (genderedAddress.forms.some((form) => form !== declared)) {
      return { ok: false, reason: "gendered_address_wrong_form", telemetry };
    }
    telemetry.push("gendered_address_with_known_form");
    if (genderedAddress.subjectOmitted && !genderedAddress.viaPronoun) {
      telemetry.push("gendered_address_subject_omitted");
    }
  }

  // Declared excerpts are telemetry now: paraphrase is allowed, because the
  // facts are already on the learner's screen and forcing verbatim quotation is
  // what made the mentor sound like a printer. Numbers are the exception below.
  // Same filter as allowedNumberSources: a rule that is in the brief but not
  // approved for teaching is not a source, whatever the brief calls it.
  const allowedSourceIds = new Set(allowedNumberSources(brief).map((source) => source.source_id));
  const declaredClaims = Array.isArray(payload?.factual_claims) ? payload.factual_claims : [];
  for (const claim of declaredClaims) {
    if (!allowedSourceIds.has(claim?.source_id)) {
      return { ok: false, reason: "fact_source_not_allowed", claimSourceId: claim?.source_id, telemetry };
    } else if (!normaliseFactText(text).includes(normaliseFactText(claim?.text))) {
      // Paraphrase is fine for a fact already on the learner's screen. It is
      // not fine for an approved rule: that is how a rule gets misquoted under
      // the reviewers' name.
      if (isRuleSource(claim.source_id)) {
        return { ok: false, reason: "rule_claim_not_quoted", claimSourceId: claim.source_id, telemetry };
      }
      telemetry.push("declared_fact_missing_from_reply");
    }
  }

  // An appeal to authority has to name the authority it is appealing to.
  if (
    RULE_CITATION_RE.test(text) &&
    !declaredClaims.some((claim) => isRuleSource(claim?.source_id) && allowedSourceIds.has(claim?.source_id))
  ) {
    return { ok: false, reason: "unsourced_rule_citation", telemetry };
  }

  // Natural wording stays free; clinical authority does not. A direct
  // treatment or operative recommendation must be carried by a rule explicitly scoped to
  // the selected issue. Without one, the mentor can challenge the reasoning or
  // ask a question, but it cannot invent the expected treatment.
  if (containsDirectClinicalRecommendation(text)) {
    const scopedRuleIds = new Set([
      ...(selectedPayloadIssue?.clinical_rule_ids || []),
      ...(policy?.allowed_clinical_rule_ids || []),
    ]);
    const hasScopedRuleClaim = declaredClaims.some((claim) => {
      if (!isRuleSource(claim?.source_id) || !allowedSourceIds.has(claim.source_id)) return false;
      const ruleId = String(claim.source_id).replace(/^(?:clinical_rule|dosing_rule)\./u, "");
      return scopedRuleIds.has(ruleId);
    });
    if (!hasScopedRuleClaim) {
      return { ok: false, reason: "unsupported_clinical_recommendation", telemetry };
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
    "4. QUESTIONS. CONTINUE carries no text at all. Outside TEACH, ask at most one question - a resident answering three questions at once answers none of them properly. In TEACH you may lay out a short numbered set of questions once the learner is genuinely stuck, because that is what a senior does at a whiteboard; do not make a habit of it.",
    "5. A LOCAL FORMULARY DOSE IS NOT AN ERROR. The approved dosing rules you hold are international reference rules. Kazakhstan's national formulary and clinical protocol give different figures for some of the same drugs, and the learner was trained on those. When a learner states a dose that differs from your rule, do not correct it, do not substitute the number from your rule, and do not call the answer wrong. Divergence between a local and a reference source is debrief material, never a live correction.",
    "6. AN ORDINARY MISSING RULE IS NOT A SAFETY STOP. When mentor_policy says governance_stop without safety_critical, the pilot simply holds no reviewed rule for what the learner ordered. The order is recorded and is not applied to the patient - but that is a gap in the training content, not danger and not a mistake by the learner. Do not say \"стоп\", \"не прошли проверку\" or \"не валидировано\" about it, and do not ask the learner to revise the parameter: there is no rule to revise it against. Say plainly that the effect is not modelled here, and move the case on. If safety_critical is true, keep SAFETY_STOP: either a reviewed safety rule rejected the parameter or it belongs to an explicitly enumerated high-risk class that fails safe while review is pending.",
    "",
    "7. DO NOT SAY WHAT THE ENGINE ALREADY SAID. The exact text printed above your reply this turn is in engine_reply_this_turn. Explaining the simulator to the learner - that a parameter has no reviewed rule, that an effect is not modelled, that an order was recorded but not applied - is the ENGINE'S job and it has already done it. Restating it in your own words spends your whole turn on housekeeping. You get one intervention per turn: spend it on the learner's reasoning. Concretely: if engine_reply_this_turn already told the learner that something is not modelled, has no reviewed rule, or was recorded without being applied, you may not say that too - your reply is rejected for it. Answering a learner who ASKS about the limits of the case is still allowed and still useful; echoing the engine unprompted is not.",
    "8. DO NOT ASK A THIRD TIME. brief.probing_streak is how many turns running you have been asking instead of teaching, and brief.your_recent_questions is what you asked, verbatim. At a streak of 2, a third CLARIFY or CHALLENGE question is REJECTED - the learner is not going to answer it, and asking again in new words is the single most frustrating thing a supervisor does. Switch: TEACH it at a higher scaffolding level - break the question into the two smaller ones it was hiding, or supply the reasoning and ask them to apply it - or accept it, say plainly that it stays open for the debrief, and move the patient on. Rephrasing is not switching. TEACH is exempt from this rule precisely because breaking the question down is the way out of it.",
    "9. STANDING RISKS DO NOT EXPIRE. A candidate issue with lifecycle=standing_risk remains clinically relevant while its condition is open. At standing_risk_stage=irreversible_gate, name the open risk directly using only fallback_text and approved content, then return one decision to the learner. Do not turn it into a checklist, do not repeat it after the gate intervention, and do not invent a safety stop when safety_critical is false.",
    "10. CHOOSE CONTENT; DO NOT CREATE IT. A speaking reply must select exactly one issue_id from candidate_issues. You remain free to phrase it naturally and to choose the best current candidate, but you may not invent a new clinical issue. A direct treatment or operative recommendation requires a rule explicitly attached to that candidate in clinical_rule_ids and quoted through factual_claims. Without one, ask about the reasoning instead of announcing the expected treatment.",
    "",
    "WHAT ALREADY HAPPENED. The application prints the patient and environment response ABOVE your reply. Everything in just_performed has been carried out this turn and its results are already on the learner's screen. Never instruct the learner to start something already done, and do not open by narrating the screen back at them.",
    "THE LEARNER'S CLAIMS ARE NOT FACTS. accumulated_reasoning_state and the transcript contain what the learner said. Quoting it back is good supervision; treating it as established patient truth is not. The learner calling the patient stable does not make her stable.",
    "",
    addressInstruction(brief.learnerAddressForm || LEARNER_ADDRESS_FORM.NEUTRAL),
    "",
    `Speak ${brief.locale === "kk" ? "Kazakh" : "Russian"} unless the locale field says otherwise. Address the learner informally, as a senior colleague would.`,
    `Length limit: ${MAX_MENTOR_CHARS} characters, or ${MAX_MENTOR_CHARS_TEACHING} for TEACH at scaffolding ${TEACHING_SCAFFOLDING_THRESHOLD} or above.`,
    "REINFORCE REQUIRES AN ANCHOR. When you choose REINFORCE, anchor_quote must be a short, VERBATIM fragment of what the learner wrote THIS turn - the words you are reinforcing, copied exactly. If nothing they wrote this turn is worth quoting back, there is nothing to reinforce: choose CONTINUE, or ask. Praise that does not name the learner's own move is worthless to them.",
    "Return strict JSON only: mode, issue_id (or null), mentor_text, anchor_quote (or null), factual_claims, question_domain, scaffolding_level.",
  ].join("\n");
}

export function buildMentorPrompt({ brief, learnerText, locale = "ru", repair = null }) {
  return {
    system: [
      `You are the ON QOL Clinical Mentor. The behaviour contract below is ${MENTOR_BEHAVIOR_SPEC_SOURCE}, reproduced verbatim. Follow it. You decide whether to intervene, which supplied candidate issue matters most, which mode to use and how much scaffolding to give.`,
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
          // Verbatim. What the learner is reading immediately above your reply.
          engine_reply_this_turn: brief.engineReplyText || "",
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
          unanswered_question_turns: brief.unansweredQuestionTurns || 0,
          // Your own last questions, verbatim. Asking any of them again in new
          // words is refused - see hard bound 8.
          your_recent_questions: brief.recentMentorQuestions || [],
          // Turns running you have been probing without the learner answering.
          probing_streak: brief.probingStreak || 0,
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
            lifecycle: issue.lifecycle || null,
            standing_risk_stage: issue.standing_risk_stage || null,
            why_now: issue.why_now,
            reasoning_gap: issue.reasoning_gap,
            safety_critical: issue.safety_critical,
            relevant_to_current_turn: issue.relevant_to_current_turn,
            parameter_safety: issue.parameter_safety,
            clinical_rule_ids: issue.clinical_rule_ids || [],
            fallback_text: issue.fallback_text || null,
          })),
        },
        output_schema: {
          mode: MENTOR_MODES.join(" | "),
          issue_id: "one candidate issue_id, or null only for CONTINUE",
          mentor_text: "string",
          anchor_quote:
            "REINFORCE only and required there: a short verbatim fragment of the learner's message this turn. null otherwise.",
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
  // The rule's own declaration wins. This table below it covers the ids that
  // are not heuristics - governance and dosing stops - and the rules that have
  // not declared a domain yet. A question whose answer nobody can recognise is
  // worse than no question: replay fe92b8b5 asked the resident what the
  // diagnosis rested on, got three findings back, and answered "уточни, какое
  // действие выполняешь".
  if (issue?.expected_answer_domains?.length) return issue.expected_answer_domains;
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

function pendingQuestionFor({ mode, issue, policy, turnNumber, questionDomain = null }) {
  if (![MENTOR_MODE.CLARIFY, MENTOR_MODE.CHALLENGE, MENTOR_MODE.TEACH, MENTOR_MODE.SAFETY_STOP].includes(mode)) return null;
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
  runaway_length: "реплика вдвое длиннее лимита для этого режима",
  gendered_address_without_form:
    "реплика приписывает резиденту род, а он не заявлен. Перепиши в настоящем времени или императиве: не «ты выбрал», а «ты выбираешь»; не «ты сказал», а «ты говоришь»; не «теперь сам определяй», а «теперь определяй»",
  gendered_address_wrong_form:
    "род в реплике не совпадает с заявленной формой обращения резидента",
  unsourced_rule_citation:
    "реплика ссылается на утверждённое правило или рекомендацию, но не объявляет его в factual_claims с допустимым source_id. Либо сошлись на реальное правило из approved_clinical_teaching_rules, либо убери ссылку на авторитет и скажи это от себя как вопрос",
  rule_claim_not_quoted:
    "объявленная цитата из клинического правила не встречается в реплике дословно — правило нельзя пересказывать своими словами, это подпись рецензента под чужим текстом",
  fact_source_not_allowed:
    "factual_claims ссылается на источник, которого нет среди раскрытых фактов и одобренных правил этого хода",
  mentor_issue_required:
    "говорящая реплика обязана выбрать один issue_id из candidate_issues",
  issue_not_in_brief:
    "выбери один issue_id из candidate_issues; новое клиническое замечание нельзя создавать вне детерминированного брифа",
  unsupported_clinical_recommendation:
    "прямая клиническая рекомендация не поддержана правилом, разрешённым для выбранного issue. Сохрани мысль как вопрос к рассуждению либо используй точный текст scoped approved rule",
  standing_gate_intervention_required:
    "на необратимом гейте открыт standing risk: CONTINUE недопустим, верни одно прямое решение",
  standing_gate_issue_required:
    "на необратимом гейте выбери standing-risk issue, который удерживает действие",
  third_consecutive_probe:
    "это третий ход подряд, когда ты спрашиваешь вместо того чтобы учить. Резидент не ответит и на четвёртый. Переходи в TEACH — разбей вопрос на два меньших или дай рассуждение и попроси применить; либо REINFORCE того, что уже сделано, и двигай пациента дальше",
  question_repeated:
    "ты уже задавал этот вопрос и ответа не получил — третий раз другими словами не поможет. Либо TEACH: разбей его на два меньших или дай рассуждение и попроси применить; либо скажи прямо, что вопрос остаётся к разбору, и двигай пациента дальше",
  repeats_engine_housekeeping:
    "движок этим же ходом уже объяснил резиденту, что здесь не моделируется — не повторяй это своими словами, потрать ход на его рассуждение",
  reinforce_without_anchor:
    "REINFORCE без anchor_quote: процитируй дословно то, что резидент написал этим ходом, или выбери другой режим",
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

  /**
   * What speaks when the model's reply cannot be used.
   *
   * Until 21.08.2026 this was the authored template, and the template is the
   * wooden voice by construction - a rejected reply was replaced by the exact
   * register the whole rewrite exists to get rid of. A senior surgeon who has
   * nothing usable to say says nothing, so the mentor now falls silent and the
   * engine's own closing prompt carries the turn.
   *
   * The one exception is a safety stop. Silence there would drop a warning the
   * deterministic layer has already decided is owed, so the template speaks.
   */
  const silent = {
    ...deterministic,
    text: "",
    mode: MENTOR_MODE.CONTINUE,
    issueId: null,
    // Its own source, not "deterministic". The A/B harness fails a run whose
    // template share is too high, and a mentor that said NOTHING is not a
    // mentor reciting a template - counting it as one hid a real transport
    // failure behind a metric that looked like a quality failure.
    source: "silent",
    pendingQuestion: null,
    firedHeuristicKeys: [],
  };
  const standingGateFallback = policyIssue?.standing_risk_stage === "irreversible_gate";
  const unusableReply =
    fallbackMode === MENTOR_MODE.SAFETY_STOP || standingGateFallback
      ? deterministic
      : silent;

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
    } catch (error) {
      const detail = String(error?.message || "").slice(0, 200);
      rejectionReasons.push(detail ? `mentor_agent_error: ${detail}` : "mentor_agent_error");
      return {
        ...unusableReply,
        rejectionReason: rejectionReasons[0],
        rejectionReasons,
        repairAttempted: attempt > 0,
        telemetry,
      };
    }
    const validation = validateMentorPayload(parsed, brief, caseData, revealedFindingIds, {
      learnerText,
    });
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
    ...unusableReply,
    rejectionReason: rejectionReasons[rejectionReasons.length - 1] || null,
    rejectionReasons,
    repairAttempted: true,
    telemetry,
  };
}

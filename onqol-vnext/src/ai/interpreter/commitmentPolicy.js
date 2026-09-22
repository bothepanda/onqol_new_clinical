import { COMMAND } from "../../core/commands/commandTypes.js";
import { containsWholePhrase, coversAll, locateRanges, normalizeText, rangesOverlap, tokenize } from "./textMatch.js";
import { segmentClauses } from "./clauseParser.js";

/**
 * Commitment status of an interpreted command (interpreter v3A.1).
 *
 * "Did the learner name this action?" and "did the learner COMMIT to it?" are
 * different questions. «может быть, сделаем КТ позже», «если ухудшится, позову
 * старшего», «нужно ли КТ?» and «обсуждаю, а не назначаю кетопрофен» all name an
 * action and none of them is an order. Before this module the deterministic pass
 * and the model both read them as orders, because the wording only ever routed a
 * turn to the model and nothing decided that the reading must not execute.
 *
 * The status is explicit, one enum, and applies to EVERY command type through
 * one gate (`partitionByCommitment`). It is computed from the learner's literal
 * words - never from model output - so the model can neither create nor waive
 * it. A command that is not COMMITTED is withheld from execution and reported
 * (telemetry + a neutral learner-facing note); it is never turned into a
 * different command and never guessed at.
 *
 * Cue lists are DATA (function-word classes: hedge, condition, deferral,
 * negation of the act, question form), not a second parser. They are scoped by
 * clause: a cue affects the fragment it sits in, a leading cue-only clause
 * («Если станет хуже, ...», «Возможно, ...») affects the fragments after it in the
 * same sentence, and a trailing one («КТ, если понадобится») the nearest
 * preceding action fragment. «КТ без контраста» is untouched: only the phrases
 * listed here are cues.
 *
 * Scope is the CLAUSE, never the turn (v3A.1 r2): a cue never crosses a sentence
 * boundary, so «Если станет хуже, КТ. ОАК сейчас.» withholds the CT and executes
 * the CBC. A command whose evidence itself spans several sentences (evidence that
 * cannot be attributed to one clause) is judged sentence by sentence and withheld
 * unless every sentence it touches commits it.
 *
 * Two owner rulings (2026-09-20):
 *  - A question mark alone does not override an explicit order. Bare shorthand
 *    («КТ ОБП?») stays INTERROGATIVE; a sentence carrying present-tense or
 *    imperative action language («назначаю», «делаем», «заказываю», «сделайте»)
 *    is COMMITTED even with a trailing «?». Lexical question forms («ли», «как
 *    думаете», «или нет») are not punctuation and are never lifted.
 *  - «сначала X, затем Y» is a SEQUENCE of two committed actions, not
 *    COMMITTED + FUTURE_PLAN. The ordering is recorded (`commandSequence`); it does
 *    not change how the clinical core executes the commands.
 */
export const COMMITMENT = Object.freeze({
  COMMITTED: "COMMITTED",
  TENTATIVE: "TENTATIVE",
  CONDITIONAL: "CONDITIONAL",
  INTERROGATIVE: "INTERROGATIVE",
  FUTURE_PLAN: "FUTURE_PLAN",
  DECLINED: "DECLINED",
});

export const COMMITMENT_POLICY_VERSION = "commitment-2026-09-20-r3-legacy-wave1";
export const DELAY_CUE = "через <срок>";

/** Types the gate never judges (bookkeeping and pure reads). */
export function isGateExempt(type) {
  return EXEMPT_TYPES.has(type);
}

/** When several cues apply, the most restrictive one is reported. */
const PRIORITY = [COMMITMENT.DECLINED, COMMITMENT.CONDITIONAL, COMMITMENT.INTERROGATIVE, COMMITMENT.FUTURE_PLAN, COMMITMENT.TENTATIVE];

/** Idioms of politeness that contain a conditional word and carry no condition. */
const COURTESY_IDIOMS = ["если можно", "если не сложно", "если вас не затруднит", "если не затруднит", "если вам не сложно", "если вас не затруднит"];

/** Words that state the decision is taken: they lift a hedge or a deferral, never a condition, question or refusal. */
const EXPLICIT_COMMITMENT = ["решил", "решила", "решили", "решаю", "решено", "окончательно", "все же", "всё же", "точно", "безусловно", "однозначно", "принято решение"];

const CUES = Object.freeze({
  [COMMITMENT.TENTATIVE]: [
    "может быть", "может потребоваться", "может понадобиться", "возможно", "вероятно", "наверное", "пожалуй", "скорее всего",
    "думаю о", "думаю над", "подумаю", "подумать о", "обдумываю", "рассматриваю", "рассмотрю", "рассмотреть",
    "склоняюсь", "не уверен", "не исключаю", "не исключено", "вдруг", "допустим", "предположим",
    "обсуждаю", "обсудим", "обсудить", "взвешиваю", "как вариант", "один из вариантов", "в качестве варианта",
    "стоит", "имеет смысл", "целесообразно", "не помешает",
    // Counterfactual «было бы» («можно было бы УЗИ»): an action considered, not ordered. The bare particle is NOT a
    // cue: «я бы попросил ОАК», «надо бы кровь глянуть» are polite requests (owner-verified, interpreterV3A1.test.js). Predicted need («скоро нужна будет
    // операция»): a forecast, not a decision.
    "было бы", "нужна будет", "нужен будет", "нужно будет", "понадобится", "потребуется",
    // The markers the repo's existing high-risk guard already recognises in Kazakh and English.
    "мүмкін", "ойланып көру", "possibly", "potentially", "perhaps", "maybe", "consider", "considering",
  ],
  [COMMITMENT.CONDITIONAL]: [
    "если", "в случае", "при необходимости", "по необходимости", "по показаниям", "по потребности", "при условии",
    "при ухудшении", "при нарастании", "при появлении", "при усилении", "при повышении", "при отсутствии",
    "как только", "по мере", "if needed", "if required", "if",
  ],
  [COMMITMENT.FUTURE_PLAN]: [
    "позже", "попозже", "потом", "затем", "далее", "после этого", "в дальнейшем", "впоследствии", "на следующем этапе", "на потом", "после того как", "после получения", "later",
  ],
  [COMMITMENT.INTERROGATIVE]: [
    "ли", "как думаете", "как думаешь", "как считаете", "как считаешь", "как вы считаете", "а если", "или нет",
  ],
  [COMMITMENT.DECLINED]: [
    "не назнач", "не заказ", "не делаю", "не делаем", "не делать", "не буду", "не будем", "не нужн", "не нужен", "не надо", "не требуется",
    "не понадоб", "не потребу",
    "не показан", "не ставл", "не ставим", "не вводи", "не даю", "не даем", "не давать", "не проводи", "не выполня",
    "нет необходимости", "нет показаний", "нет смысла", "отмен", "отказыва",
  ],
});

/**
 * "Standing" cues that are the ONLY ones evaluated for a fragment reduced to a
 * single bare word ("может," / "возможно,"): the bare particle "может" has no
 * safe phrase form ("может ли" is a question, "он может быть" a statement).
 */
const BARE_TENTATIVE_FRAGMENT = new Set(["может", "наверное", "возможно", "пожалуй"]);

/**
 * Commands whose wording is inquiry by nature. A question mark on «Где болит?»
 * does not make it a deliberation, so INTERROGATIVE-by-punctuation does not
 * apply. Hedge, condition, deferral and refusal still do: «может быть, спрошу
 * про аллергию позже» is not a question asked now.
 */
const INQUIRY_TYPES = new Set([COMMAND.ASK_PATIENT, COMMAND.TAKE_HISTORY, COMMAND.ASK_FASTING_HISTORY, COMMAND.REQUEST_STATUS]);

/**
 * Types the gate never applies to: bookkeeping (a recorded thought is not an
 * action) and pure reads that change nothing and consume no clinical time.
 */
const EXEMPT_TYPES = new Set([COMMAND.STATE_REASONING, COMMAND.ANSWER_MENTOR, COMMAND.REQUEST_STATUS, COMMAND.REPEAT_LAST]);

/**
 * Statuses a type ignores because its own matcher already handles them. The
 * operative-decision phrases are authored content that contains negation on
 * purpose («дренаж не ставлю», «ничего не делаю, ушиваю»); matching them is the
 * job of `matchPendingOperativeDecision`, which is negation-aware. Hedge,
 * condition, deferral and question still apply.
 */
/**
 * Cues a type ignores because the wording IS the order. «Ничего не давать через
 * рот» is the nil-by-mouth order itself, not a refusal to give something; the
 * refusal cues «не давать / не вводить» therefore do not apply to SET_NPO, while
 * «нулевой стол не нужен» (a real refusal) is still caught by «не нужн».
 */
const IGNORED_CUES = Object.freeze({
  [COMMAND.SET_NPO]: new Set(["не давать", "не даю", "не даем", "не вводи"]),
  // A delay is the parameter of these, not a deferral of them.
  [COMMAND.REASSESS]: new Set([DELAY_CUE]), [COMMAND.WAIT]: new Set([DELAY_CUE]), [COMMAND.PRESCRIBE_MONITORING]: new Set([DELAY_CUE]),
});

const IGNORED_STATUSES = Object.freeze({
  [COMMAND.OPERATIVE_DECISION]: new Set([COMMITMENT.DECLINED]),
  // Asking the patient is a question by nature: the particle "ли" («бывает ли
  // аллергия?») and a question mark are the action itself, not a deliberation.
  ...Object.fromEntries([...INQUIRY_TYPES].map((type) => [type, new Set([COMMITMENT.INTERROGATIVE])])),
});


/**
 * Explicit action language: present-tense (imperfective) first-person and
 * imperative forms of the verbs a resident uses to give an order. They are EXACT
 * tokens, never stems (the «пожалуй»/«пожалуйста» trap). Perfective future
 * («сделаем», «закажу», «назначим») is deliberately absent: with a question mark it
 * is the proposal «shall we?», not an order. An infinitive («назначить КТ?») is a
 * question about the act and is absent too.
 *
 * It lifts ONLY the punctuation-derived question form. A hedge, a condition, a
 * deferral, a refusal and a lexical question («ли», «как думаете») stand.
 */
const EXPLICIT_ACTION_WORDS = new Set([
  "назначаю", "назначаем", "назначь", "назначьте",
  "заказываю", "заказываем", "закажи", "закажите",
  "делаю", "делаем", "сделай", "сделайте",
  "провожу", "проводим", "проведи", "проведите",
  "выполняю", "выполняем", "выполни", "выполните",
  "ввожу", "вводим", "введи", "введите", "вводи", "вводите",
  "ставлю", "ставим", "поставь", "поставьте",
  "отправляю", "отправляем", "отправь", "отправьте",
  "беру", "берем", "возьми", "возьмите",
  "даю", "даем", "дай", "дайте",
  "вызываю", "вызываем", "позови", "позовите",
  "начинаю", "начинаем", "организую", "организуем", "организуй", "организуйте",
]);

/** Words that open an ordered sequence, and the connectives that step it. */
const SEQUENCE_OPENERS = ["сначала", "вначале", "первым делом", "для начала", "прежде всего"];
const SEQUENCE_CONNECTIVES = ["затем", "потом", "далее", "после этого", "после чего", "следом", "следом за этим"];

/**
 * Single-word cues that must match as EXACT words. `containsWholePhrase` lets a
 * stem of five or more letters carry an inflectional ending, which is right for
 * «отмен» (отмените, отменяю) and wrong for a cue that is a prefix of a common
 * unrelated word: «пожалуй» (perhaps) would match «пожалуйста» (please), «потом»
 * would match «потому что», «возможно» would match «возможность», «допустим»
 * «допустимо». These are matched as whole tokens.
 */
const EXACT_WORD_CUES = new Set([
  "пожалуй", "возможно", "вероятно", "наверное", "допустим", "предположим", "вдруг", "потом", "затем", "далее", "позже", "попозже", "стоит", "если",
  "мүмкін", "possibly", "potentially", "perhaps", "maybe", "consider", "considering", "later", "if",
]);

function cueMatches(text, status) {
  const tokens = tokenize(text);
  return CUES[status].filter((cue) => (EXACT_WORD_CUES.has(cue) ? tokens.includes(cue) : containsWholePhrase(text, cue)));
}

function stripCourtesy(text) {
  let out = text;
  for (const idiom of COURTESY_IDIOMS) out = out.split(idiom).join(" ");
  return out;
}

/**
 * The turn's clauses (clauseParser.js: the single segmentation the deterministic pass reads too),
 * each with its token range over `tokenize(rawText)`.
 */
export function segmentFragments(rawText) {
  return segmentClauses(rawText).map((clause) => ({ ...clause }));
}

/**
 * A stated delay attached to an action («КТ через 72 часа») schedules it: the learner has not ordered it now.
 * The same words are the PARAMETER of a reassessment, a wait or a monitoring plan («переоценка через 48 часов»),
 * so those types ignore this cue (IGNORED_CUES), and a fragment that also carries such a word is not read as a
 * deferral at all («госпитализация в ОРИТ с переоценкой через 48 часов»).
 */
const DELAY_PATTERN = /(?:^|\s)через\s+\d+(?:[.,]\d+)?\s*(?:мин|ч(?:$|\s|[.,;!?])|час|сут|дн|дня|дней|нед)/;
const DELAY_AS_PARAMETER = /переоцен|наблюд|контрол|монитор|(?:^|\s)жд[уа]|подожд|повторн/;

function annotate(fragment) {
  const text = stripCourtesy(fragment.text);
  const cues = {};
  for (const status of PRIORITY) {
    const found = cueMatches(text, status);
    if (status === COMMITMENT.FUTURE_PLAN && DELAY_PATTERN.test(text) && !DELAY_AS_PARAMETER.test(text)) found.push(DELAY_CUE);
    if (status === COMMITMENT.TENTATIVE && found.length === 0 && tokenize(text).length === 1 && BARE_TENTATIVE_FRAGMENT.has(tokenize(text)[0])) found.push(tokenize(text)[0]);
    if (found.length) cues[status] = found;
  }
  const explicit = EXPLICIT_COMMITMENT.filter((word) => containsWholePhrase(text, word));
  const action = tokenize(text).some((token) => EXPLICIT_ACTION_WORDS.has(token));
  return { ...fragment, cues, explicit, action, startsWithCue: startsWithAnyCue(text, cues), question: fragment.terminator === "?" };
}

/** Focus and connective particles that may precede a cue without changing what it governs («только если …», «а если …»). */
const LEADING_PARTICLE = /^(?:(?:только|лишь|а|но|и|ну|тогда|уже|же|это|то)\s+)+/;

function startsWithAnyCue(text, cues) {
  const head = text.trim().replace(LEADING_PARTICLE, "");
  return PRIORITY.some((status) => (cues[status] ?? []).some((cue) => head.startsWith(cue)));
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

/** Every whole-word (never stem) occurrence of a listed phrase, longest phrase first at a position, in text order. */
function phraseHits(text, phrases) {
  const hits = [];
  for (const phrase of [...phrases].sort((x, y) => y.length - x.length)) {
    let index = text.indexOf(phrase);
    while (index !== -1) {
      const before = index === 0 ? "" : text[index - 1];
      const after = text[index + phrase.length] ?? "";
      if (!WORD_CHAR.test(before) && !WORD_CHAR.test(after) && !hits.some((hit) => hit.at === index)) hits.push({ at: index, phrase });
      index = text.indexOf(phrase, index + 1);
    }
  }
  return hits.sort((x, y) => x.at - y.at);
}

/**
 * Sequence semantics: «сначала X, затем Y» is an ORDERED pair of committed
 * actions. After a sequence opener, a step connective («затем», «потом», «далее»,
 * «после этого») is ordering, not deferral, so it no longer counts as a
 * FUTURE_PLAN cue. Every other deferral («позже», «на потом», «после получения»)
 * still does, and so does a connective with no opener before it («КТ, потом»).
 *
 * Returns the opener and the connectives as global token offsets, or null.
 */
function resolveSequence(fragments) {
  const globalPosition = (fragment, at) => fragment.range[0] + tokenize(fragment.text.slice(0, at)).length;
  let opener = null;
  for (const fragment of fragments) {
    const [hit] = phraseHits(fragment.text, SEQUENCE_OPENERS);
    if (hit) { opener = { marker: hit.phrase, position: globalPosition(fragment, hit.at) }; break; }
  }
  if (!opener) return null;
  const connectives = [];
  for (const fragment of fragments) {
    const words = new Set();
    for (const hit of phraseHits(fragment.text, SEQUENCE_CONNECTIVES)) {
      const position = globalPosition(fragment, hit.at);
      if (position <= opener.position) continue;
      connectives.push({ word: hit.phrase, position });
      words.add(hit.phrase);
    }
    if (words.size === 0) continue;
    const consumed = new Set([...words].flatMap((word) => [word, ...word.split(" ")]));
    const remaining = (fragment.cues[COMMITMENT.FUTURE_PLAN] ?? []).filter((cue) => !consumed.has(cue));
    if (remaining.length) fragment.cues[COMMITMENT.FUTURE_PLAN] = remaining; else delete fragment.cues[COMMITMENT.FUTURE_PLAN];
    fragment.startsWithCue = startsWithAnyCue(stripCourtesy(fragment.text), fragment.cues);
  }
  return { opener, connectives };
}

/** Does a fragment's sentence carry explicit action language? A question mark on it is then only punctuation. */
function sentenceHasAction(fragments, fragment) {
  return fragments.some((other) => other.sentence === fragment.sentence && other.action);
}

/** Question form by punctuation: bare shorthand only. Explicit action language in the sentence lifts it. */
function questionCue(fragments, fragment, type) {
  if (!fragment.question || INQUIRY_TYPES.has(type) || sentenceHasAction(fragments, fragment)) return null;
  return { [COMMITMENT.INTERROGATIVE]: ["?"] };
}

/** Does this text open with a hedge / condition / deferral / refusal cue (a clause that governs another fragment)? */
export function isCommitmentClause(text) {
  return segmentFragments(text).map(annotate).some((fragment) => fragment.startsWithCue);
}

/** Text of the fragment(s) an evidence span sits in: the clause a semantic candidate was read from. */
export function enclosingFragmentText(rawText, spans) {
  const ranges = locateRanges(tokenize(rawText), spans ?? []);
  if (!ranges) return normalizeText((spans ?? []).join(" "));
  return segmentFragments(rawText).filter((fragment) => rangesOverlap([fragment.range], ranges)).map((fragment) => fragment.text).join(" ");
}

function strongest(statuses) {
  return PRIORITY.find((status) => statuses.has(status)) ?? null;
}

/**
 * Commitment of each command in the turn.
 *
 * Scope is the clause: every judgment below is made inside ONE sentence. A command
 * whose evidence touches several sentences is judged in each and is committed only
 * when all of them commit it (evidence that cannot be attributed to a clause fails
 * closed rather than borrowing the most favourable sentence).
 *
 * @param {{rawText: string, commands: object[]}} input
 * @returns {Map<string, {status: string, cues: string[], scope: string}>} keyed by command id
 */
export function assessCommitment({ rawText, commands }) {
  const fragments = segmentFragments(rawText).map(annotate);
  resolveSequence(fragments);
  const tokenCount = tokenize(rawText).length;
  const rawTokens = tokenize(rawText);
  const actionable = commands.filter((command) => !EXEMPT_TYPES.has(command.type));

  const spans = new Map(actionable.map((command) => [command.id, locateRanges(rawTokens, [command.sourceText ?? ""])]));
  const carriers = new Set(); // fragments that carry at least one command of this turn
  for (const command of actionable) {
    const span = spans.get(command.id);
    if (!span) continue;
    fragments.forEach((fragment, index) => { if (rangesOverlap([fragment.range], span)) carriers.add(index); });
  }

  const result = new Map();
  for (const command of commands) {
    if (EXEMPT_TYPES.has(command.type)) { result.set(command.id, { status: COMMITMENT.COMMITTED, cues: [], scope: "exempt" }); continue; }
    const span = spans.get(command.id);

    if (span == null) {
      // Unknown extent: judge the words the command was read from, on their own.
      const own = segmentFragments(command.sourceText ?? "").map(annotate);
      resolveSequence(own);
      result.set(command.id, judgeIn({ pool: own, own: own.map((_, index) => index), type: command.type, carriers, where: "source_text", local: false }));
      continue;
    }

    const broad = fragments.length > 1 && coversAll(span, tokenCount);
    const own = fragments.map((fragment, index) => ({ fragment, index })).filter(({ fragment }) => broad || rangesOverlap([fragment.range], span)).map(({ index }) => index);
    result.set(command.id, judgeAcrossSentences({ pool: fragments, own, type: command.type, carriers, where: broad ? "whole_turn" : "fragment" }));
  }
  return result;
}

/**
 * Judge one command inside ONE sentence: `pool` is the annotated clause list, `own` the indexes of the
 * clauses the command was read from, `carriers` the clauses that carry any command of the turn.
 */
function judgeIn({ pool, own, type, carriers, where, local }) {
  const ignored = IGNORED_STATUSES[type] ?? new Set();
  const ignoredCues = IGNORED_CUES[type] ?? new Set();
  const found = new Map(); // status -> cues
  let scope = where;
  let explicit = false;
  const add = (cues, label) => {
    for (const [status, listed] of Object.entries(cues)) {
      const list = listed.filter((cue) => !ignoredCues.has(cue));
      if (ignored.has(status) || list.length === 0) continue;
      if (!found.has(status)) { found.set(status, []); scope = label; }
      found.get(status).push(...list);
    }
  };
  for (const index of own) {
    const fragment = pool[index];
    add(fragment.cues, where);
    add(questionCue(pool, fragment, type) ?? {}, where);
    explicit ||= fragment.explicit.length > 0;
  }
  if (local && own.length) {
    const ownSet = new Set(own);
    const first = Math.min(...own);
    const lastOwn = Math.max(...own);
    pool.forEach((fragment, index) => {
      if (ownSet.has(index) || carriers.has(index) || fragment.sentence !== pool[first].sentence) return;
      if (!fragment.startsWithCue) return;
      // A leading cue-only clause governs what follows it; a trailing one, the
      // action fragment right before it. Both stop at the sentence boundary, and
      // at a clause that turns the sentence («но …») or states the decision.
      if (index < first) add(scopeSurvivingBreakers(pool, index, first, fragment.cues), "leading_clause");
      else if (index > lastOwn && nearestCarrierBefore(carriers, index) === lastOwn && !opensNewStep(fragment)) add(scopeSurvivingBreakers(pool, lastOwn, index, fragment.cues), "trailing_clause");
    });
  }
  if (explicit) { found.delete(COMMITMENT.TENTATIVE); found.delete(COMMITMENT.FUTURE_PLAN); }
  const status = strongest(new Set(found.keys())) ?? COMMITMENT.COMMITTED;
  return { status, cues: status === COMMITMENT.COMMITTED ? [] : [...new Set(found.get(status))], scope: status === COMMITMENT.COMMITTED ? "none" : scope };
}

/**
 * «Операцию, потом наблюдение»: a step connective that opens a clause WITH content of its own starts the next step; the
 * deferral it carries belongs to that step, not to the action before it. («КТ, позже» and «КТ, если понадобится» are different:
 * a postponement adverb or a condition qualifies the action it trails.)
 */
function opensNewStep(fragment) {
  const text = fragment.text.trim();
  const connective = SEQUENCE_CONNECTIVES.find((word) => text === word || text.startsWith(`${word} `));
  return Boolean(connective) && tokenize(text).length > tokenize(connective).length;
}

/** An adversative opener turns the sentence; nothing said before it governs what follows it. */
const ADVERSATIVE_OPENER = /^(?:но|однако|зато)(?:\s|$)/;

/**
 * The cues of a governing clause that still reach across the clauses strictly between it and the command:
 * an adversative clause («…, но я решил») ends every cue's scope, an explicit-decision clause ends a hedge's
 * or deferral's (never a condition, question or refusal - the same rule the command's own clause follows).
 */
function scopeSurvivingBreakers(pool, from, to, cues) {
  const between = pool.slice(Math.min(from, to) + 1, Math.max(from, to));
  if (between.some((clause) => ADVERSATIVE_OPENER.test(clause.text))) return {};
  if (!between.some((clause) => clause.explicit.length > 0)) return cues;
  return Object.fromEntries(Object.entries(cues).filter(([status]) => status !== COMMITMENT.TENTATIVE && status !== COMMITMENT.FUTURE_PLAN));
}

/** A command whose evidence touches several sentences is judged in each and committed only when all of them commit it. */
function judgeAcrossSentences({ pool, own, type, carriers, where }) {
  const bySentence = new Map();
  for (const index of own) bySentence.set(pool[index].sentence, [...(bySentence.get(pool[index].sentence) ?? []), index]);
  const judgments = [...bySentence.values()].map((indexes) => judgeIn({ pool, own: indexes, type, carriers, where, local: true }));
  if (judgments.length <= 1) return judgments[0] ?? { status: COMMITMENT.COMMITTED, cues: [], scope: "none" };
  // Evidence spanning several clauses cannot be attributed to one of them.
  const blocking = judgments.filter((judgment) => judgment.status !== COMMITMENT.COMMITTED);
  if (blocking.length === 0) return judgments[0];
  const status = strongest(new Set(blocking.map((judgment) => judgment.status)));
  return { status, cues: [...new Set(blocking.filter((judgment) => judgment.status === status).flatMap((judgment) => judgment.cues))], scope: "multi_sentence_evidence" };
}

/**
 * Clause-level commitment (interpreter v3B). The deterministic pass reads a clause, knows which
 * clauses carry a command, and asks for each command's commitment directly from the clause(s) it
 * came from - no token-range search after the fact.
 *
 * @param {{clauses: object[], carriers: Set<number>, indexes: number[], type: string}} input
 *   `clauses` from `analyzeClauses`; `carriers` the indexes of the clauses that yielded any command.
 */
export function judgeClauseCommand({ clauses, carriers, indexes, type }) {
  if (EXEMPT_TYPES.has(type)) return { status: COMMITMENT.COMMITTED, cues: [], scope: "exempt" };
  return judgeAcrossSentences({ pool: clauses, own: indexes, type, carriers, where: "clause" });
}

/**
 * The command kinds a clause is probed with when nothing was read from it: an ordinary order, a question to the
 * patient (a question form is not a refusal there), a reassessment (a stated delay is its parameter) and nil-by-mouth
 * (whose own wording contains a prohibition).
 */
const PROBE_TYPES = Object.freeze([COMMAND.ORDER_TEST, COMMAND.ASK_PATIENT, COMMAND.REASSESS, COMMAND.SET_NPO]);

/**
 * Would the gate withhold whatever could be read from this clause? True when its own words, or a clause governing it
 * (a leading «если …», a sequence-less «потом»), make every kind of command non-committed. A second reading of such a
 * clause cannot change what executes, so it is not worth a model call.
 */
export function clauseWithheldForEveryKind({ clauses, carriers, index }) {
  return PROBE_TYPES.every((type) => judgeClauseCommand({ clauses, carriers, indexes: [index], type }).status !== COMMITMENT.COMMITTED);
}

/**
 * The turn as annotated clauses: cues, explicit-action words, question form and the ordered
 * sequence («сначала X, затем Y») resolved. Annotation is over the learner's literal words only.
 *
 * @returns {{clauses: object[], sequence: null | {opener: object, connectives: object[]}}}
 */
export function analyzeClauses(rawText) {
  const clauses = segmentFragments(rawText).map(annotate);
  const sequence = resolveSequence(clauses);
  return { clauses, sequence };
}

/**
 * Ordered-sequence metadata for the commands that will execute («сначала X,
 * затем Y»). It records the ordering the learner stated; it does not change how
 * the clinical core executes them (each is still an independent, committed
 * command). Null when the turn states no sequence of at least two steps.
 *
 * @returns {null | {marker: string, steps: {step: number, connective: string|null, commandIds: string[]}[]}}
 */
export function assessSequence({ rawText, commands }) {
  const fragments = segmentFragments(rawText).map(annotate);
  const sequence = resolveSequence(fragments);
  if (!sequence || sequence.connectives.length === 0) return null;
  const rawTokens = tokenize(rawText);
  const boundaries = [...sequence.connectives].sort((a, b) => a.position - b.position);
  const steps = new Map();
  for (const command of commands) {
    if (EXEMPT_TYPES.has(command.type)) continue;
    const span = locateRanges(rawTokens, [command.sourceText ?? ""]);
    if (!span) continue;
    const start = Math.min(...span.map(([from]) => from));
    const end = Math.max(...span.map(([, to]) => to));
    if (start < sequence.opener.position) continue; // stated before the sequence opened
    // A connective steps the sequence for the command it introduces: at its start or
    // one particle in («а потом КТ»). One deeper inside a shared fragment
    // («ОАК затем КТ») it cannot say which of that fragment's commands follows it.
    const step = 1 + boundaries.filter((boundary) => boundary.position <= start + 1 && boundary.position < end).length;
    steps.set(step, [...(steps.get(step) ?? []), command.id]);
  }
  if (steps.size < 2) return null;
  const ordered = [...steps.keys()].sort((a, b) => a - b);
  return {
    marker: sequence.opener.marker,
    steps: ordered.map((step, index) => ({ step: index + 1, connective: index === 0 ? null : boundaries[Math.min(step - 2, boundaries.length - 1)].word, commandIds: steps.get(step) })),
  };
}

/** Commands reordered so a stated sequence executes in its stated order (stable; commands outside the sequence keep their slots). */
export function orderBySequence(commands, sequence) {
  if (!sequence) return commands;
  const rank = new Map();
  sequence.steps.forEach(({ step, commandIds }) => commandIds.forEach((id) => rank.set(id, step)));
  const slots = commands.map((command, index) => index).filter((index) => rank.has(commands[index].id));
  const sorted = slots.map((index) => commands[index]).sort((a, b) => rank.get(a.id) - rank.get(b.id));
  const out = [...commands];
  slots.forEach((slot, position) => { out[slot] = sorted[position]; });
  return out;
}

function nearestCarrierBefore(carriers, index) {
  let best = -1;
  for (const carrier of carriers) if (carrier < index && carrier > best) best = carrier;
  return best;
}

/**
 * The single execution gate. `committed` may execute; `withheld` may not, and
 * each carries the reason. Order is preserved.
 */
export function partitionByCommitment({ rawText, commands }) {
  const assessment = assessCommitment({ rawText, commands });
  const committed = [];
  const withheld = [];
  for (const command of commands) {
    const commitment = assessment.get(command.id) ?? { status: COMMITMENT.COMMITTED, cues: [], scope: "none" };
    if (commitment.status === COMMITMENT.COMMITTED) committed.push(command);
    else withheld.push({ command, commitment });
  }
  return { committed, withheld, assessment };
}

/** Recorded form of a withheld command: what it was, why it was not executed. Never contains anything the learner did not say. */
export function summarizeWithheld(withheld) {
  return withheld.map(({ command, commitment }) => ({
    id: command.id, type: command.type, params: command.params, sourceText: command.sourceText,
    commitment: { status: commitment.status, cues: commitment.cues, scope: commitment.scope },
  }));
}

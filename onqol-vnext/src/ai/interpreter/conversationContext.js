import { containsWholePhrase, normalizeText, tokenize } from "./textMatch.js";

/**
 * Conversational context channel (ON QOL Mentor Spec §11).
 *
 *   «A short learner reply must be interpreted in the context of the mentor's
 *    previous question.»
 *
 * A reply like «реанимацию», «антибиотики да», «первый вариант» or «нет, не нужно»
 * is not meaningless free text and not a generic order: it answers the question
 * the system asked immediately before. Before this module the interpreter saw only the
 * learner's words, so an elliptical answer was routed like any other fragment and
 * either matched nothing («реанимацию» is a noun; the lexicon knows «в реанимацию») or
 * matched the wrong thing.
 *
 * Two pure steps, no I/O, no model:
 *
 *  1. `buildConversationFrame(turnContext)` reads the previous system utterance
 *     (the mentor's or hospital's words) into a frame: the questions it asked, their
 *     kind (yes/no, choice, wh, expectation), the subject domains they touch and the
 *     options they LITERALLY offered.
 *  2. `resolveFrameReply({ frame, replyText })` decides whether a short reply is an
 *     answer to one of those questions and, if so, how to read it. It never produces a
 *     command itself: it returns the text the ordinary deterministic matcher should
 *     read, plus WHERE the identity of the act came from.
 *
 * Where the identity comes from is the safety rule of this module:
 *
 *   learner  - the learner's own word names the act («реанимацию»); the question only
 *              supplies the slot it fills («куда?» -> «в»). Any command type may result.
 *   system   - the identity is the QUESTION's word («КТ нужна?» - «да»). The learner
 *              agreed to something they did not name, so: never a protected
 *              (high-consequence) type, never a dose / route / volume / duration / rate
 *              taken from the question, and the result is judged like any other command
 *              (an incomplete one becomes a clarification, not a guess).
 *
 * The domain and cue tables below are DATA, not per-sentence rules: extending coverage
 * means adding a stem here, never a branch.
 */
export const CONTEXT_POLICY_VERSION = "conversation-context-2026-09-20-r1";

export const QUESTION_KIND = Object.freeze({
  YES_NO: "yes_no",
  CHOICE: "choice",
  WH: "wh",
  ASK: "ask",
});

/** Subject domains a question can be about. Stems of >= 5 letters take an inflectional ending; shorter entries match whole words. */
export const QUESTION_DOMAINS = Object.freeze({
  disposition: ["госпитализ", "отделение", "реанимаци", "орит", "палат", "куда", "перевод", "выписк", "домой"],
  investigation: ["исследован", "анализ", "обследован", "кт", "мрт", "узи", "рентген", "лаборатор", "диагностик"],
  operative_plan: ["операци", "оперативн", "оперир", "резекци", "вмешательств", "сигмоидэктом", "колэктом"],
  operative_access: ["доступ", "лапаротом", "лапароскоп"],
  infusion: ["инфузи", "жидкост", "раствор", "литр", "объем"],
  analgesia: ["обезбол", "анальгез", "анальгетик", "опиоид"],
  antibiotics: ["антибиотик", "антибактери", "антибы"],
  monitoring: ["мониторинг", "мониторить", "отслежив", "контрол", "наблюд"],
  nutrition: ["питани", "голод", "кормить", "кормлен"],
  consultation: ["консультац", "вызвать", "позвать", "специалист", "анестезиолог", "хирург"],
  examination: ["осмотр", "пальпац", "аускультац", "перкусси"],
  history: ["анамнез", "опрос", "расспрос"],
  tactics: ["тактик", "что делаешь", "что будешь делать", "что предпримешь", "план"],
});

/** Questions that ask for the learner's REASONING or expectation, not for an act. A noun answer to one is not an order. */
const EXPECTATION_CUES = [
  "почему", "зачем", "обоснуй", "что думаешь", "что ожидаешь", "что покажет", "на чем основано", "какие данные",
  "дифференциальн", "рабочий диагноз", "основной диагноз", "что заставит", "что именно наблюдаешь", "что отслеживаешь", "что подтвердит",
  "что увидишь", "что предполагаешь", "как думаешь", "как считаешь",
];

/** Imperative asks that request an answer without being phrased as a question. */
const IMPERATIVE_ASKS = ["уточни", "ответь", "отвечай", "назови", "сформулируй", "опиши", "перечисли", "объясни", "обоснуй", "поясни"];

const WH_WORDS = ["какой", "какая", "какое", "какие", "каком", "какую", "что", "куда", "сколько", "чем", "когда", "почему", "зачем", "как", "где", "кто", "откуда"];

const AFFIRM_PHRASES = ["да", "конечно", "разумеется", "безусловно", "согласен", "согласна", "верно", "именно так", "нужна", "нужны", "нужен", "нужно", "надо", "необходима", "необходимо", "показана", "показаны", "показано"];
const NEGATE_PHRASES = ["нет", "не нужна", "не нужны", "не нужен", "не нужно", "не надо", "не требуется", "не показана", "не показаны", "не показано", "не считаю нужным"];
/** Words that may accompany a polarity answer without adding content. */
const POLARITY_FILLERS = new Set(["сейчас", "срочно", "немедленно", "обязательно", "конечно", "тоже", "так", "это", "вот"]);

const ORDINALS = Object.freeze({
  первое: 0, первый: 0, первая: 0, первую: 0, первому: 0,
  второе: 1, второй: 1, вторая: 1, вторую: 1,
  третье: 2, третий: 2, третья: 2, третью: 2,
});
const LAST_ORDINALS = new Set(["последнее", "последний", "последняя", "последнюю"]);
const ORDINAL_FILLERS = new Set(["вариант", "вариантом", "вариантов", "из", "этих", "пожалуй", "выбираю", "беру", "думаю"]);

/** Verbs of doing something. A reply that carries one is a statement of an act, not an elliptical answer. */
const ACTION_VERB_STEMS = [
  "назнач", "закаж", "сдела", "провед", "провест", "введ", "вводи", "постав", "ставл", "дат", "даю", "даем", "взят", "беру", "вызв", "позв", "начат", "начин", "начн",
  "выполн", "оцен", "контролир", "наблюд", "подтверд", "исключ", "отправ", "организ", "госпитализир", "перевест", "переводи", "оперир", "проводим", "делаем", "делаю",
];

/** Slot prepositions: in the question «куда?», the noun answer «реанимацию» means «в реанимацию». */
const SLOT_PREPOSITION = Object.freeze({ disposition: "в " });
/** The command types a slot answer may produce; anything else is not an answer to that slot. */
const SLOT_TYPES = Object.freeze({ disposition: ["DISPOSITION"] });

const SENTENCE_SPLIT = /(?<=[.?!…:])\s+|\n+/;

function domainsOf(normalized) {
  return Object.entries(QUESTION_DOMAINS).filter(([, stems]) => stems.some((stem) => containsWholePhrase(normalized, stem))).map(([domain]) => domain);
}

function startsWithWh(tokens) {
  return tokens.length > 0 && WH_WORDS.includes(tokens[0]);
}

/**
 * Literal options of a choice question: «куда — отделение или реанимация?»,
 * «какая тактика — консервативная, эндоскопическая, повторная операция?». Only what the
 * question itself lists after its dash / colon (or around an «или»).
 */
export function extractOptions(normalizedQuestion) {
  const stripped = normalizedQuestion.replace(/[?!.…]+$/g, "").trim();
  const afterDash = stripped.split(/\s[-–—]\s|:\s/).pop();
  const scope = afterDash !== stripped ? afterDash : stripped;
  const parts = /(?:^|\s)или(?:\s|$)/.test(scope) || afterDash !== stripped ? scope.split(/(?:^|\s)или(?:\s|$)|,\s*/) : [];
  const options = parts.map((part) => part.trim()).filter((part) => part && tokenize(part).length <= 4);
  return options.length >= 2 ? options : [];
}

function classifyQuestion(text, index) {
  const normalized = normalizeText(text);
  const tokens = tokenize(normalized);
  const questionMark = /\?\s*$/.test(text.trim());
  const imperative = IMPERATIVE_ASKS.some((cue) => tokens[0] === cue || normalized.startsWith(`${cue} `));
  if (!questionMark && !imperative) return null;
  const options = extractOptions(normalized);
  const yesNo = tokens.includes("ли") || /да или нет/.test(normalized);
  const expectation = EXPECTATION_CUES.some((cue) => containsWholePhrase(normalized, cue));
  let kind = QUESTION_KIND.ASK;
  if (yesNo) kind = QUESTION_KIND.YES_NO;
  else if (options.length >= 2) kind = QUESTION_KIND.CHOICE;
  else if (startsWithWh(tokens) || questionMark) kind = QUESTION_KIND.WH;
  return { index, text: text.trim(), normalized, kind, options, domains: domainsOf(normalized), expectation };
}

/**
 * Frame of the immediately preceding system utterance.
 *
 * Sources, in order of richness: the utterance text itself (`precedingPrompt`), the
 * mentor's recorded open-question text, then the structural `expects` of the mentor's open
 * question. An open hospital clarification is reported as its own field; answering it stays
 * with the clarification path (`completeFromClarification`), which the frame only orders first.
 *
 * @returns {null | {source: string, text: string|null, questions: object[], expectation: boolean, clarification: object|null}}
 */
export function buildConversationFrame(turnContext = {}) {
  const mentor = turnContext.openMentorQuestion ?? null;
  const promptText = (typeof turnContext.precedingPrompt === "string" && turnContext.precedingPrompt.trim())
    || (typeof mentor?.textRu === "string" && mentor.textRu.trim())
    || (typeof mentor?.text === "string" && mentor.text.trim())
    || null;
  const clarification = turnContext.openClarification?.commandType ? turnContext.openClarification : null;

  if (promptText) {
    const questions = promptText.split(SENTENCE_SPLIT).map((sentence, index) => classifyQuestion(sentence, index)).filter(Boolean)
      .map((question, position) => ({ ...question, index: position }));
    return {
      source: turnContext.precedingPrompt ? "prompt_text" : "mentor_open_question", text: promptText, questions,
      expectation: questions.length > 0 && questions.every((question) => question.expectation), clarification,
    };
  }
  if (mentor) {
    // No text was kept: the structural `expects` still says what kind of answer is wanted.
    return { source: "mentor_open_question", text: null, questions: [], expectation: (mentor.expects ?? []).length > 0, clarification };
  }
  if (clarification) return { source: "hospital_clarification", text: null, questions: [], expectation: false, clarification };
  return null;
}

/** What is safe to show a model: the system's own words and their structure, nothing the learner said. */
export function frameForModel(frame) {
  if (!frame || (frame.questions.length === 0 && !frame.expectation)) return null;
  return {
    source: frame.source,
    expectsReasoningOnly: frame.expectation,
    questions: frame.questions.map((question) => ({ text: question.text, kind: question.kind, domains: question.domains, ...(question.options.length ? { options: question.options } : {}) })),
  };
}

function hasActionVerb(tokens) {
  return tokens.some((token) => ACTION_VERB_STEMS.some((stem) => token.startsWith(stem)));
}

function phrasePresent(normalized, phrases) {
  return phrases.find((phrase) => containsWholePhrase(normalized, phrase)) ?? null;
}

/** Tokens of the reply that are not filler, polarity words or the subject noun of the addressed question. */
function residue(tokens, question) {
  const known = new Set([...POLARITY_FILLERS, ...AFFIRM_PHRASES.flatMap(tokenize), ...NEGATE_PHRASES.flatMap(tokenize)]);
  return tokens.filter((token) => !known.has(token) && !questionSubject(question).has(token) && !/^(?:и|а|ну|же|пока|только)$/.test(token));
}

function questionSubject(question) {
  return new Set(tokenize(question.normalized).filter((token) => token.length > 3));
}

/**
 * How does a short reply answer the frame's questions? `null` = it does not (read it
 * like any other fragment).
 *
 * @returns {null | {via: "polarity"|"ordinal"|"slot", questionIndex: number, polarity?: "affirm"|"negate",
 *   probeTexts: string[], identitySource: "learner"|"system"}}
 */
export function resolveFrameReply({ frame, replyText }) {
  if (!frame || frame.questions.length === 0) return null;
  const normalized = normalizeText(replyText);
  const tokens = tokenize(normalized);
  if (tokens.length === 0 || tokens.length > 6 || hasActionVerb(tokens)) return null;

  // 1. An ordinal pointing at the options a question literally listed.
  const ordinal = tokens.find((token) => token in ORDINALS || LAST_ORDINALS.has(token));
  if (ordinal !== undefined && tokens.every((token) => token === ordinal || ORDINAL_FILLERS.has(token))) {
    const choices = frame.questions.filter((question) => question.kind === QUESTION_KIND.CHOICE);
    if (choices.length === 1) {
      const [choice] = choices;
      const pick = LAST_ORDINALS.has(ordinal) ? choice.options.length - 1 : ORDINALS[ordinal];
      if (choice.options[pick]) return { via: "ordinal", questionIndex: choice.index, probeTexts: [withSlot(choice, choice.options[pick])], identitySource: "system" };
    }
    return null;
  }

  // 2. Yes / no (or a stated need) to a yes/no question.
  const negate = phrasePresent(normalized, NEGATE_PHRASES);
  const affirm = negate ? null : phrasePresent(normalized, AFFIRM_PHRASES);
  if (negate || affirm) {
    const yesNo = frame.questions.filter((question) => question.kind === QUESTION_KIND.YES_NO);
    const replyDomains = domainsOf(normalized);
    const addressed = yesNo.length === 1 ? yesNo[0] : yesNo.filter((question) => replyDomains.some((domain) => question.domains.includes(domain)));
    const question = Array.isArray(addressed) ? (addressed.length === 1 ? addressed[0] : null) : addressed;
    if (question && residue(tokens, question).length <= 1) {
      return { via: "polarity", questionIndex: question.index, polarity: negate ? "negate" : "affirm", probeTexts: [question.text], identitySource: "system" };
    }
    return null;
  }

  // 3. A bare noun answering a where/which-kind question: the question supplies the slot's preposition.
  if (tokens.length <= 4) {
    for (const question of frame.questions) {
      if (question.expectation) continue;
      for (const domain of question.domains) {
        if (SLOT_PREPOSITION[domain] && !normalized.startsWith(SLOT_PREPOSITION[domain])) {
          return { via: "slot", questionIndex: question.index, probeTexts: [`${SLOT_PREPOSITION[domain]}${normalized}`], identitySource: "learner", slotTypes: SLOT_TYPES[domain] };
        }
      }
    }
  }
  return null;
}

function withSlot(question, option) {
  for (const domain of question.domains) if (SLOT_PREPOSITION[domain] && !option.startsWith(SLOT_PREPOSITION[domain])) return `${SLOT_PREPOSITION[domain]}${option}`;
  return option;
}

/** Is the whole turn a nominal answer to an expectation question (reasoning), not an order? */
export function isExpectationAnswer({ frame, replyText }) {
  if (!frame?.expectation) return false;
  const tokens = tokenize(replyText);
  return tokens.length > 0 && !hasActionVerb(tokens);
}

/**
 * How the mentor addresses the learner.
 *
 * Russian past-tense verbs and short adjectives carry grammatical gender, so
 * "ты обозначил" assigns a gender nobody stated. V3.5 solved that by rejecting
 * every gendered address, which cut natural Russian and made the mentor sound
 * like a form letter - and it was doing so in replay 91ba7206 while the learner
 * herself wrote "я же сделала все это выше".
 *
 * Base rules v2 replaces the ban with an address form: the session setting if
 * the cohort declared one, otherwise the learner's own past-tense forms, and
 * neutral phrasing when neither says anything. Nothing here infers gender from
 * a name; only what the learner wrote about themselves counts.
 */

export const LEARNER_ADDRESS_FORM = Object.freeze({
  NEUTRAL: "neutral",
  FEMININE: "feminine",
  MASCULINE: "masculine",
});

// Only a closed set of particles may sit between "я" and the verb, so
// "я вижу что была боль" (about the patient) does not count as self-reference.
const SELF_PARTICLE = "(?:не|уже|же|это|тоже|всё|все|сразу|потом|тогда|только|ещё|еще)";
const SELF_FEMININE_RE = new RegExp(
  `(?:^|[^а-яё])я\\s+(?:${SELF_PARTICLE}\\s+){0,2}[а-яё]{2,}(?:ла|лась)(?![а-яё])`,
  "iu"
);
const SELF_MASCULINE_RE = new RegExp(
  `(?:^|[^а-яё])я\\s+(?:${SELF_PARTICLE}\\s+){0,2}[а-яё]{2,}(?:[аяиеы]л|лся)(?![а-яё])`,
  "iu"
);

/**
 * The session setting wins. Otherwise the learner's own forms decide, and if
 * they never used one - or used both - the mentor stays neutral, which is the
 * pre-v2 behaviour and always safe.
 */
export function resolveLearnerAddressForm({ sessionSetting = null, learnerTurns = [] } = {}) {
  if (Object.values(LEARNER_ADDRESS_FORM).includes(sessionSetting)) {
    return { form: sessionSetting, source: "session_setting" };
  }
  let feminine = 0;
  let masculine = 0;
  for (const turn of learnerTurns) {
    const text = String(turn || "");
    if (SELF_FEMININE_RE.test(text)) feminine += 1;
    else if (SELF_MASCULINE_RE.test(text)) masculine += 1;
  }
  if (feminine && !masculine) {
    return { form: LEARNER_ADDRESS_FORM.FEMININE, source: "learner_self_reference" };
  }
  if (masculine && !feminine) {
    return { form: LEARNER_ADDRESS_FORM.MASCULINE, source: "learner_self_reference" };
  }
  return { form: LEARNER_ADDRESS_FORM.NEUTRAL, source: "default_neutral" };
}

/**
 * Gendered address, detected in the mentor's own words.
 *
 * The first detector was bound to the pronoun: `ты\s+…л/ла`. Russian drops the
 * subject constantly, so "хорошо, что сохранил аппендицит как рабочую гипотезу"
 * assigns the learner a gender and said nothing to telemetry - which is what the
 * live run of 20.08.2026 showed on turn 2. The pronoun case was the smaller half.
 *
 * Two shapes are recognised. With the pronoun the subject is explicit and the
 * reading is certain. Without it the subject is dropped after a subordinating
 * connector ("хорошо, что сохранил", "раз выбрал"). A gendered verb that follows
 * its own noun - "боль началась", "аппендикс располагался" - has a subject and is
 * not matched.
 *
 * Sentence-initial verb forms are deliberately excluded. Russian permits both
 * learner-addressed "Сохранил гипотезу" and patient descriptions such as
 * "Появилась тошнота" there, and suffix matching cannot separate them reliably.
 * The live defect used a connector, so it is caught without turning patient
 * events into telemetry noise.
 */
const GENDERED_PAST = "[а-яё]{2,}(?:[аяиеы]л|ла|лся|лась)";
// A list, not morphology: short adjectives are not derivable from a suffix the
// way past tense is. These are the ones a supervisor uses about a learner.
// 21.08.2026: сам/сама joined the list. The live run said "теперь сам определяй"
// to a resident whose form was not yet known - a determiner, not an adjective,
// but it assigns a gender exactly the same way and nothing was watching for it.
const GENDERED_SHORT_ADJECTIVE =
  "(?:прав|права|уверен|уверена|точен|точна|внимателен|внимательна|осторожен|осторожна|готов|готова|должен|должна|обязан|обязана|сам|сама|один|одна)";
const GENDERED_TOKEN = `(?:${GENDERED_PAST}|${GENDERED_SHORT_ADJECTIVE})`;
// Only particles may sit between the boundary and the verb. Anything else - a
// noun - is the subject, and then the verb is not about the learner.
const ADDRESS_PARTICLE = "(?:не|уже|же|сразу|тоже|всё|все|только|ещё|еще|верно|правильно)";
// High-precision lead-ins used by a mentor when responding to the learner. A
// bare `что сохранил` anywhere in the sentence is not enough: in "пациентка
// сказала, что поступила" the omitted subject is still the patient.
const ADDRESS_LEAD_IN =
  "(?:хорошо|верно|важно|правильно|полезно|логично|видно|вижу|заметно|спасибо)";
const ADDRESS_CLAUSE_CONNECTOR = "(?:что|раз|если)";
const GENDERED_ADDRESS_PRONOUN_RE = new RegExp(
  `(?:^|[^а-яё])ты\\s+(?:[а-яё]+\\s+){0,2}(${GENDERED_TOKEN})(?![а-яё])`,
  "giu"
);
const GENDERED_ADDRESS_SUBJECT_OMITTED_RE = new RegExp(
  `(?:^${ADDRESS_CLAUSE_CONNECTOR}\\s+|(?:^|[.!?…]\\s+)${ADDRESS_LEAD_IN}\\s*,?\\s+${ADDRESS_CLAUSE_CONNECTOR}\\s+)(?:${ADDRESS_PARTICLE}\\s+){0,2}(${GENDERED_TOKEN})(?![а-яё])`,
  "giu"
);

function genderedMatches(pattern, text) {
  const found = [];
  for (const match of String(text || "").matchAll(pattern)) {
    const token = String(match[1] || "").toLowerCase();
    found.push(token);
  }
  return found;
}

/**
 * @returns {{matched: boolean, viaPronoun: boolean, subjectOmitted: boolean, tokens: string[]}}
 */
export function detectGenderedAddress(text) {
  const pronoun = genderedMatches(GENDERED_ADDRESS_PRONOUN_RE, text);
  const omitted = genderedMatches(GENDERED_ADDRESS_SUBJECT_OMITTED_RE, text);
  const tokens = [...new Set([...pronoun, ...omitted])];
  return {
    matched: pronoun.length > 0 || omitted.length > 0,
    viaPronoun: pronoun.length > 0,
    subjectOmitted: omitted.length > 0,
    tokens,
    // WHICH gender was assigned, not just that one was. Telemetry could get by
    // without it; a refusal cannot - "ты выбрал" said to a learner who declared
    // the feminine form is a different defect from "ты выбрал" said to a
    // learner who declared nothing, and only one of them is a mismatch.
    forms: [...new Set(tokens.map(genderOfToken).filter(Boolean))],
  };
}

const FEMININE_TOKEN_RE = /(?:ла|лась|сама|одна|права|уверена|точна|внимательна|осторожна|готова|должна|обязана)$/u;

export function genderOfToken(token) {
  const word = String(token || "").toLowerCase();
  if (!word) return null;
  if (FEMININE_TOKEN_RE.test(word)) return LEARNER_ADDRESS_FORM.FEMININE;
  return LEARNER_ADDRESS_FORM.MASCULINE;
}

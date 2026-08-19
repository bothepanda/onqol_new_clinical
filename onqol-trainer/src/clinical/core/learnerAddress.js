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

/**
 * Reviewed lexicon for the deterministic interpreter fallback.
 *
 * This is a content unit, not model output (Foundation Spec §48): synonym
 * resolution ("ОАК" -> cbc, "лапара" -> laparoscopic) is authored and stable,
 * the same way a drug dose is authored and stable. A real LLM-backed
 * interpreter (see docs/KNOWN_GAPS.md) may extend coverage to typos and novel
 * phrasing, but must resolve to these same command/param vocabularies - it
 * may never invent a new one at inference time.
 */
export const TEST_SYNONYMS = Object.freeze({
  "оак": "cbc",
  "клинический анализ крови": "cbc",
  "бхак": "chemistry",
  "биохимия": "chemistry",
  "срб": "crp",
  "крп": "crp",
  "оам": "urinalysis",
  "хгч": "betahcg",
  "узи": "ultrasound_abdomen",
  "узи живота": "ultrasound_abdomen",
  "узи брюшной полости": "ultrasound_abdomen",
  "кт": "ct_abdomen",
  "кт обп": "ct_abdomen",
  "кт живота": "ct_abdomen",
  "кт брюшной полости": "ct_abdomen",
});

export const REGION_SYNONYMS = Object.freeze({
  "живот": "abdomen",
  "брюшная полость": "abdomen",
  "рот": "mouth",
  "ротовая полость": "mouth",
  "ноги": "legs",
  "нижние конечности": "legs",
  "пах": "groin",
  "паховая область": "groin",
  "неврологический": "neuro",
  "неврологию": "neuro",
  "прямая кишка": "rectal",
  "ректально": "rectal",
});

// Entries of five characters or more are matched as STEMS that may carry a
// Russian inflectional ending, so "лапароскопическ" also covers
// "лапароскопически", "лапароскопическую", "лапароскопическая" without
// enumerating every case form (see `containsWholeWordPhrase` in
// interpretTurn.js). Shorter entries stay strict whole-word matches.
export const APPROACH_SYNONYMS = Object.freeze({
  "лапароскопическ": "laparoscopic",
  "лапароскопи": "laparoscopic",
  "лапара": "laparoscopic",
  "открытым доступом": "open",
  "лапаротом": "open",
});

export const DRUG_SYNONYMS = Object.freeze({
  "кетопрофен": "ketoprofen",
  "кеторолак": "ketorolac",
  "цефазолин": "cefazolin",
  "метронидазол": "metronidazole",
});

export const STAFF_SYNONYMS = Object.freeze({
  "старший хирург": "seniorSurgeon",
  "старшего": "seniorSurgeon",
  "анестезиолог": "anesthesiologist",
  "реаниматолог": "icuPhysician",
  "рентгенолог": "radiologist",
  "радиолог": "radiologist",
});

/**
 * Preoperative actions, as the learner actually says them (task brief §4.1).
 * These map to REAL domain commands - there is deliberately no learner-facing
 * "mark preop item complete" phrasing, because there is no such command.
 *
 * NOTE ON REGEX AND CYRILLIC: `\w` and `\b` are defined against
 * `[A-Za-z0-9_]` in a non-unicode JS regex, so they do NOT match Cyrillic
 * letters. A pattern like /анестезиолог\w* на осмотр/ silently never matches
 * "анестезиолога на осмотр" - it fails by doing nothing, not by erroring,
 * which is the worst way for an interpreter to be wrong. Every optional
 * word-tail here is written `[а-яё]*` for that reason. The same trap
 * previously ate the "и" conjunction splitter; see `interpretTurn.js`.
 */
export const PREOP_PATTERNS = Object.freeze({
  SET_NPO: [/(^|\s)npo(\s|$)/i, /нулевой стол/i, /ничего внутрь/i, /голод/i, /не корм/i],
  ESTABLISH_IV_ACCESS: [/венозн[а-яё]* доступ/i, /перифер[а-яё]* катетер/i, /внутривенн[а-яё]* доступ/i, /кубитальн/i, /катетеризи[а-яё]* вен/i],
  GIVE_ANTIBIOTIC_PROPHYLAXIS: [/антибиотикопрофилактик/i, /профилактик[а-яё]* антибиотик/i, /антибиотик[а-яё]* до разреза/i, /периоперационн[а-яё]* профилактик/i],
  REQUEST_ANESTHESIA_REVIEW: [/осмотр[а-яё]* анестезиолог/i, /анестезиолог[а-яё]* на осмотр/i, /показать анестезиолог/i, /консультац[а-яё]* анестезиолог/i],
});

/** Postoperative destinations (task brief §4.1 "Disposition"). */
export const DISPOSITION_SYNONYMS = Object.freeze({
  "в отделение": "surgical_ward",
  "в хирургическое отделение": "surgical_ward",
  "в палату": "surgical_ward",
  "в орит": "icu",
  "в реанимацию": "icu",
  "в пробуждение": "recovery",
  "в палату пробуждения": "recovery",
});

/** Monitoring parameters a learner may prescribe (Foundation Spec §21). */
export const MONITORING_TARGETS = Object.freeze({
  "витальн": "vitals",
  "давлен": "blood_pressure",
  "чсс": "heart_rate",
  "температур": "temperature",
  "диурез": "urine_output",
  "боль": "pain",
  "дренаж": "drain_output",
  "сатурац": "spo2",
});

/** Phrases that mean "tell me what's happening now", not a mentor question. */
export const STATUS_QUERY_PATTERNS = Object.freeze([
  /что с пациентом( сейчас)?/i,
  /как (он|она|пациент)( сейчас)?/i,
  /как(ая|ие) (боль|витальные|показатели)( сейчас)?/i,
  /что по витальным/i,
  /дай текущ/i,
  /текущее состояние/i,
]);

export const STUCK_PATTERNS = Object.freeze([/^не знаю/i, /^не помню/i, /^не уверен/i]);

/** Discharge / transfer, the two non-fatal terminal states (Foundation Spec §56). */
export const DISCHARGE_PATTERNS = Object.freeze([/выпис/i, /на амбулаторн\w* лечение/i]);
export const TRANSFER_PATTERNS = Object.freeze([/перевод\w* в друг/i, /перевести в друг/i, /транспортиров\w* в /i]);

// Operative-decision phrasing is deliberately NOT listed here. There is no
// table of operation names anywhere in `src/ai/` or `src/core/`: when a
// decision is pending, the interpreter matches the learner's words against
// that decision's own `matches_ru` phrases supplied by disease content
// (`operative.yaml`), passed in via `turnContext.pendingDecisionOptions`.
// Adding a second disease therefore adds zero interpreter vocabulary for its
// operations (Core Foundation Spec §63/§71, task brief P0-6).

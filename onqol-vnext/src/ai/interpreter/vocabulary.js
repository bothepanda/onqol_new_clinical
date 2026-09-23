/**
 * Reviewed lexicon for the deterministic interpreter fallback.
 *
 * This is a content unit, not model output (Core Runtime Spec §48): synonym
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
  "бх": "chemistry", // the ordinary short form of «БХАК» (biochemistry): unreviewed lexicon addition, see docs/LEGACY_REAL_LANGUAGE_REMEDIATION.md
  "биохимия": "chemistry",
  "срб": "crp",
  "крп": "crp",
  "оам": "urinalysis",
  "общий анализ мочи": "urinalysis",
  "хгч": "betahcg",
  "бета-хгч": "betahcg",
  "лактат": "lactate",
  "кщс": "abg",
  "газы крови": "abg",
  "кислотно-щелочное состояние": "abg",
  "кислотно щелочное состояние": "abg",
  "тропонин": "troponin",
  "коагулограмма": "coagulation",
  "коагулограмму": "coagulation",
  "мно": "coagulation",
  "группа крови": "blood_group_rh",
  "группу крови": "blood_group_rh",
  "резус": "blood_group_rh",
  "узи": "ultrasound_abdomen",
  "узи живота": "ultrasound_abdomen",
  "узи брюшной полости": "ultrasound_abdomen",
  "узи обп": "ultrasound_abdomen",
  // Pelvic / transvaginal ultrasound is a DIFFERENT study and is NOT in the
  // supported investigation set (trajectories.yaml#investigation_timing). It is
  // resolved to its own id so a qualified request ("узи малого таза", "узи ОМТ")
  // never silently collapses onto the abdominal study - executeCommand then
  // returns UNSUPPORTED_CONTENT and the learner is told so, honestly (Core
  // Runtime Spec §50, wave §7/§20-E). Adding real pelvic-US content is a
  // separate clinical-review item.
  "узи малого таза": "pelvic_ultrasound",
  "узи омт": "pelvic_ultrasound",
  "омт": "pelvic_ultrasound",
  "узи органов малого таза": "pelvic_ultrasound",
  "трансвагинальное узи": "pelvic_ultrasound",
  "тваги": "pelvic_ultrasound",
  "кт": "ct_abdomen",
  "кт обп": "ct_abdomen",
  "кт живота": "ct_abdomen",
  "кт брюшной полости": "ct_abdomen",
});

/**
 * Imaging language. DATA lists, used by the deterministic pass and by
 * semantic-candidate validation so both apply one definition.
 *
 * MODALITY terms name a kind of imaging study (modeled or not). A fragment that
 * contains one is about a study, never a physical examination:
 * «осмотрите живот ультразвуком» must not become an abdominal palpation. The
 * exam path is skipped; if the lexicon cannot resolve the study the fragment stays
 * an unrecognised request (and is offered to the semantic model), because the
 * learner has already said which kind of study they mean - asking «Какое
 * исследование?» would ask them something they answered.
 *
 * CATEGORY terms name imaging in general without a modality («сделайте
 * визуализацию живота»). That IS an under-specified request, so the answer is a
 * question, not a guess and not an examination.
 *
 * Whole-word matching (`containsWholePhrase`): a short abbreviation ("кт", "узи")
 * must never be found inside a longer word.
 */
export const IMAGING_MODALITY_TERMS = Object.freeze([
  "узи", "ультразвук", "сонограф", "эхограф", "кт", "мскт", "компьютерн", "томограф", "рентген", "мрт", "магнитно-резонанс", "флюорограф",
]);
export const IMAGING_CATEGORY_TERMS = Object.freeze(["визуализ", "снимок", "снимк"]);

export const REGION_SYNONYMS = Object.freeze({
  "живот": "abdomen",
  "брюшная полость": "abdomen",
  "рот": "mouth",
  "ротовая полость": "mouth",
  "ноги": "legs",
  "нижние конечности": "legs",
  "пах": "groin",
  "паховая область": "groin",
  "неврологическ": "neuro",  // stem: неврологический / неврологического статуса / неврологическое состояние
  "неврологию": "neuro",
  // Wave B: examination regions a postoperative volume assessment needs.
  // Region ids are shared vocabulary (shared/interaction/concepts.yaml).
  "перфузия": "perfusion",
  "перфузию": "perfusion",
  "капиллярное наполнение": "perfusion",
  "кожные покровы": "perfusion",
  "кожу": "perfusion",
  "слизистые": "perfusion",
  "вены шеи": "neck_veins",
  "шейные вены": "neck_veins",
  "яремные вены": "neck_veins",
  "лёгкие": "cardiorespiratory",
  "легкие": "cardiorespiratory",
  "лёгких": "cardiorespiratory",
  "легких": "cardiorespiratory",
  "аускультация": "cardiorespiratory",
  "аускультацию": "cardiorespiratory",
  "тоны сердца": "cardiorespiratory",
  "сердце": "cardiorespiratory",
  "дренаж": "catheter",
  "дренажи": "catheter",
  "катетер": "catheter",
  "мочевой катетер": "catheter",
  "прямая кишка": "rectal",
  "прямой киш": "rectal",   // прямой кишки (genitive)
  "прямую киш": "rectal",   // прямую кишку (accusative)
  "ректально": "rectal",
});

/**
 * Focused history questions that can be answered from facts already present
 * in the generated patient. These patterns identify the QUESTION TOPIC only;
 * the interpreter never supplies the answer, and the command handler may
 * still refuse a topic whose fact is not modeled in the current case.
 */
export const FOCUSED_HISTORY_PATTERNS = Object.freeze({
  nausea_vomiting: [/рвот/i, /тошнот/i],
  bowel: [/стул/i, /дефекац/i, /кишечник.*работ/i],
  urination: [/мочеиспуск/i, /дизур/i, /мочил[а-яё]*/i],
  allergies: [/аллерг/i],
  medications: [/антикоагулянт/i, /постоянн[а-яё]* препарат/i, /лекарств[а-яё]* принима/i, /что принима/i],
  chronic_conditions: [/хроническ[а-яё]* заболев/i, /сопутствующ[а-яё]* заболев/i],
  prior_operations: [/раньше оперир/i, /перенес[а-яё]* операц/i, /операци[а-яё]* был/i],
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

/**
 * Drug names the interpreter can resolve.
 *
 * RECOGNISING A NAME IS NOT THE SAME AS SUPPORTING THE DRUG, and both halves
 * of that matter. `executeCommand` looks the resolved `drugId` up in the
 * reviewed formulary and returns UNSUPPORTED_CONTENT for anything absent from
 * it, which is how Core Runtime Spec §50's three-way distinction gets spoken to
 * the learner ("this order is not supported by the current version" - never
 * "not in stock").
 *
 * That mechanism only works if the name reaches the command layer at all.
 * `formulary.yaml` deliberately lists metamizole under `not_in_reference_set`
 * precisely so that ordering it "resolves as unsupported_content" - but with
 * no synonym here it never became a command, so the learner typed a real
 * order and got total silence, and the content's stated intent was defeated.
 * The excluded names are therefore resolvable, and the formulary lookup - not
 * this table - is what refuses them.
 */
export const DRUG_SYNONYMS = Object.freeze({
  "кетопрофен": "ketoprofen",
  "кетотоп": "ketoprofen",   // common RU brand / resident slang for ketoprofen
  "кетонал": "ketoprofen",   // common RU brand for ketoprofen
  "кеторолак": "ketorolac",
  "кетанов": "ketorolac",    // common RU brand for ketorolac
  "парацетамол": "paracetamol",
  "ибупрофен": "ibuprofen",
  "трамадол": "tramadol",
  "цефазолин": "cefazolin",
  "метронидазол": "metronidazole",
  "цефокситин": "cefoxitin",
  "цефотетан": "cefotetan",
  "клиндамицин": "clindamycin",
  "азтреонам": "aztreonam",
  "гентамицин": "gentamicin",
  "эноксапарин": "enoxaparin",
  "клексан": "enoxaparin",
  // Recognised so the refusal is an honest, spoken simulator limitation.
  // NOT in the formulary: see `formulary.yaml#not_in_reference_set` (matrix
  // M02 NEEDS SOURCE) and docs/review/APP004_ANALGESIA_REVIEW_TABLE.md.
  "метамизол": "metamizole",
  "анальгин": "metamizole",
  "димедрол": "diphenhydramine",
  "дифенгидрамин": "diphenhydramine",
  // Generic loop diuretic; a formulary drug (Wave B), not a disease term.
  "фуросемид": "furosemide",
  "лазикс": "furosemide",
});

/**
 * Infusion solutions the interpreter can name, resolved to the formulary's
 * `fluids` ids (shared/medications/formulary.yaml). As with drugs, naming a
 * solution is not supporting it: `executeCommand` looks the id up in the
 * reviewed formulary. «кристаллоид» keeps the pre-existing generic id.
 * Longest phrase wins, so «рингер-лактат» is never read as bare «рингер».
 */
export const FLUID_SYNONYMS = Object.freeze({
  "рингер-лактат": "ringers_lactate",
  "рингер лактат": "ringers_lactate",
  "рингера лактат": "ringers_lactate",
  "лактат рингера": "ringers_lactate",
  "рингер": "ringers_no_lactate",
  "стерофундин": "sterofundin",
  "хартман": "hartmann",
  "физраствор": "normal_saline",
  "физ раствор": "normal_saline",
  "физ р-р": "normal_saline",
  "nacl": "normal_saline",
  "натрия хлорид": "normal_saline",
  "гелофузин": "gelofusine",
  "альбумин": "albumin",
  "глюкоз": "glucose_5_percent",
  "бикарбонат": "sodium_bicarbonate",
  "кристаллоид": "crystalloid",
});

/**
 * Biochemistry analytes (matrix V07, task §8).
 *
 * "БХАК" alone is an incomplete order - the lab asks which values are needed,
 * and these are the names it understands. Nothing is added that the learner
 * did not say.
 */
export const CHEMISTRY_ANALYTE_SYNONYMS = Object.freeze({
  "креатинин": "creatinine",
  "мочевин": "urea",
  "электролит": "electrolytes",
  "хлорид": "electrolytes",
  "натрий": "electrolytes",
  "калий": "electrolytes",
  "глюкоз": "glucose",
  "билирубин": "bilirubin",
  "алт": "alt_ast",
  "аст": "alt_ast",
  "трансаминаз": "alt_ast",
  "амилаз": "amylase",
  "общий белок": "total_protein",
});

export const STAFF_SYNONYMS = Object.freeze({
  "старший хирург": "surgeon",
  "старшего": "surgeon",
  "хирург": "surgeon",
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
  SET_NPO: [/(^|\s)npo(\s|$)/i, /нулевой стол/i, /ничего внутрь/i, /не корм/i],
  // Matrix PR02: asking WHEN the patient last ate and drank is a distinct
  // action from ordering nil-by-mouth, and only this one completes the
  // fasting assessment.
  ASK_FASTING_HISTORY: [
    /когда (последний раз )?(ел|ела|кушал|принимал[а]? пищу)/i,
    /последний раз ел/i,
    /последний прием пищи/i,
    /последний приём пищи/i,
    /когда пил/i,
    /что и когда ел/i,
    /время последнего приема пищи/i,
    /время последнего приёма пищи/i,
    /натощак/i,
  ],
  // Matrix PO05: early oral intake as tolerated after recovery.
  ORDER_ORAL_INTAKE: [/разрешаю пить/i, /можно пить/i, /разрешаю жидкость/i, /стол по переносимости/i, /дие[тт][а-яё]* по переносимости/i, /начина[а-яё]* пить/i],
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

/** Monitoring parameters a learner may prescribe (Core Runtime Spec §21). */
export const MONITORING_TARGETS = Object.freeze({
  "витальн": "vitals",
  "давлен": "blood_pressure",
  "ад": "blood_pressure", // «АД»: whole word only (deterministicInterpreter.extractMonitoringTargets)
  "чсс": "heart_rate",
  "температур": "temperature",
  "диурез": "urine_output",
  "боль": "pain",
  "дренаж": "drain_output",
  "сатурац": "spo2",
  // Wave B: things a reassessment may observe (shared clinical vocabulary).
  "пульс": "heart_rate",
  "перфуз": "perfusion",
  "капилляр": "perfusion",
  "вены шеи": "neck_veins",
  "шейные вены": "neck_veins",
  "легк": "cardiorespiratory",
  "лёгк": "cardiorespiratory",
  "дыхан": "cardiorespiratory",
});

/**
 * Phrases that mean "tell me what's happening now", not a mentor question
 * (Contract §6).
 *
 * BOTH RUSSIAN WORD ORDERS (PBC-6). "какая боль сейчас" and "как сейчас
 * боль" are the same question, and only the first was matched - the second
 * fell through to CLINICAL_REASONING and the learner got total silence in
 * reply to a direct question about their patient. Russian puts the adverb on
 * either side of the noun freely, so both orders are listed rather than
 * relying on one canonical phrasing.
 */
export const STATUS_QUERY_PATTERNS = Object.freeze([
  /что с пациентом( сейчас)?/i,
  /^\s*как (он|она|пациент)( сейчас)?/i,
  /как(ая|ие) (боль|витальные|показатели)( сейчас)?/i,
  // adverb-first order: "как сейчас боль?", "как сейчас витальные?"
  /как сейчас (боль|витальные|показатели|пациент|он|она)/i,
  // subject in the middle: "как у неё сейчас боль?", "как у пациента дела с болью?"
  /^\s*как у (не[её]|него|пациент[а-яё]*) [^.!?]*(боль|витальн|показател|состоян|дел)/i,
  /что сейчас с (пациентом|болью)/i,
  /что по витальным/i,
  /что с витальными/i,
  /дай текущ/i,
  /текущее состояние/i,
  /текущие показатели/i,
]);

export const STUCK_PATTERNS = Object.freeze([/^не знаю/i, /^не помню/i, /^не уверен/i]);

/**
 * Discharge / transfer, the two non-fatal terminal states (Core Runtime Spec
 * §56, Contract §24).
 *
 * THE CYRILLIC `\w` TRAP, CAUGHT A FOURTH TIME (PBC-24). Every pattern here
 * that needed an inflectional tail was written with `\w*`, which - exactly as
 * this file's own note above warns for PREOP_PATTERNS - matches nothing in
 * Cyrillic. The result was that safe TRANSFER, one of only three natural
 * terminal states the contract recognises, was reachable through a single
 * phrasing: the bare infinitive "перевести в другой...". The natural
 * first-person forms a resident actually types - "перевожу в другой
 * стационар", "переводим в другую больницу", "транспортирую в область" - all
 * failed silently and produced no response at all.
 *
 * That mattered most precisely where transfer is the right answer: in a
 * Real Hospital with no CT and no laparoscopy stack (Contract §3.2), where
 * "available only after transfer" is the whole point of the mode.
 *
 * Tails are `[а-яё]*` for the same reason they are in PREOP_PATTERNS.
 */
export const DISCHARGE_PATTERNS = Object.freeze([/выпис/i, /на амбулаторн[а-яё]* лечение/i]);
export const TRANSFER_PATTERNS = Object.freeze([
  /перевод[а-яё]* в друг/i,
  /перевож[а-яё]* в друг/i,
  /перевест[а-яё]* в друг/i,
  /переве[зд][а-яё]* в друг/i,
  /транспортир[а-яё]* в /i,
  /транспортировк[а-яё]* в /i,
  // "в другой стационар" / "в областную больницу" as a destination phrase,
  // which is how the decision is most often stated once the constraint is
  // already on the table.
  /отправ[а-яё]* в друг/i,
  /направ[а-яё]* в друг/i,
]);

// Operative-decision phrasing is deliberately NOT listed here. There is no
// table of operation names anywhere in `src/ai/` or `src/core/`: when a
// decision is pending, the interpreter matches the learner's words against
// that decision's own `matches_ru` phrases supplied by disease content
// (`operative.yaml`), passed in via `turnContext.pendingDecisionOptions`.
// Adding a second disease therefore adds zero interpreter vocabulary for its
// operations (Core Runtime Spec §63/§71, task brief P0-6).

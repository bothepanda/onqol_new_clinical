// V3.5 appendicitis phenotypes.
//
// SOURCE
//
// Every range below is copied verbatim from CLAUDE_CODE_ONQOL_V3_5_ADDENDUM.md
// sections 4.1-4.3, authored by the surgeon. Nothing here is inferred, rounded,
// widened or filled in. Where the addendum is silent, the field is absent and
// the validator reports it - it is never guessed.
//
// WHAT THESE RANGES ARE NOT
//
// Addendum 4.2, verbatim: "Эти диапазоны нужны только для генерации
// правдоподобного синтетического пациента. Они не дают баллы и не используются
// как diagnostic cutoffs до clinical review."
//
// So: a range is a statement about which patients this case may contain. It is
// NOT a threshold for intervention, and no rule may read it as one. That
// distinction is the reason `authoring_range` is in the field names.
//
// PHENOTYPE VERSUS MODIFIER
//
// ONQOL_FULL_CLINICAL_LIBRARY_MASTER_PLAN.md 13.1 is explicit: a disease
// phenotype describes how the disease presents, and "женщина репродуктивного
// возраста" or "пожилой" are POPULATION MODIFIERS applied on top. The addendum's
// APP-002 mixes the two ("классический ... у женщины репродуктивного возраста").
//
// Resolved the way the master plan asks: `presentation_phenotype` carries the
// disease shape, `default_modifiers` carries the demographic layer, and
// APP-001..005 are named preset combinations of the two - which is exactly what
// master plan 13.1 says they should be ("только проверенные preset combinations
// для V3.5, а не вечная схема всей библиотеки").

/** Copied from addendum 4.1 / 4.2. Ranges are inclusive. */
const range = (min, max) => Object.freeze({ min, max });

export const PRESENTATION_PHENOTYPES = Object.freeze([
  "early_subtle",
  "classic",
  "pelvic",
  "retrocecal",
  "late_complicated",
]);

export const DISEASE_TRUTHS = Object.freeze([
  "uncomplicated_inflammation",
  "gangrene_necrosis",
  "perforation",
  "abscess",
  "diffuse_peritonitis",
]);

/**
 * Population modifiers referenced by V3.5 presets.
 *
 * The full catalogue is master plan section 8 (ten modifiers). Only the ones a
 * V3.5 preset actually uses are declared here; the rest arrive with their own
 * cards and are not stubbed out in advance.
 */
export const V35_MODIFIERS = Object.freeze({
  "MOD-PREGNANCY-POSSIBLE": Object.freeze({
    modifier_id: "MOD-PREGNANCY-POSSIBLE",
    title_ru: "Возможная беременность",
    // The safety branch this modifier switches on. Without the modifier these
    // actions are not merely unscored - they do not belong to the case at all.
    // Addendum 7: "Pregnancy actions не применяются к пациенту без возможной
    // беременности."
    enables_action_ids: ["pregnancy_test", "pelvic_gynecologic_screen", "pelvic_ultrasound"],
    enables_dangerous_alternatives: ["differential_ectopic"],
    review_status: "NEEDS_CLINICAL_REVIEW",
  }),
});

/**
 * @typedef {Object} Phenotype
 * @property {string} preset_id            APP-001..APP-005
 * @property {string} presentation_phenotype
 * @property {string[]} disease_truths     morphologies this preset may carry
 * @property {string[]} default_modifiers
 * @property {string} runtime_status       learner_active | faculty_preview
 * @property {string} key_skill_ru
 */

/** @type {Phenotype[]} */
export const APPENDICITIS_PHENOTYPES = Object.freeze([
  Object.freeze({
    preset_id: "APP-001",
    presentation_phenotype: "early_subtle",
    title_ru: "Ранний маловыраженный неосложнённый аппендицит",
    disease_truths: ["uncomplicated_inflammation"],
    default_modifiers: [],
    runtime_status: "learner_active",
    key_skill_ru:
      "Не закрывать диагноз преждевременно, построить active observation и timed reassessment",
    presentation: Object.freeze({
      hours_from_onset: range(3, 8),
      pain_score: range(3, 6),
      story_ru:
        "Околопупочная или ранняя боль справа внизу, миграция неубедительна, анорексия, тошнота возможна",
      examination_ru:
        "Локальная болезненность без убедительного дефанса, перитонеальные признаки отрицательные или сомнительные",
    }),
    authoring_ranges: Object.freeze({
      heart_rate: range(72, 96),
      temperature_c: range(36.7, 37.7),
      systolic_bp: range(105, 140),
      respiratory_rate: range(14, 20),
      wbc: range(8, 13),
      crp: range(2, 35),
    }),
    imaging: Object.freeze({
      ultrasound_ru: "Отрицательное или неубедительное допустимо",
      ct_ru: "Ранние признаки воспаления без осложнений",
      operative_truth_ru: "Воспалённый аппендикс без некроза, перфорации и абсцесса",
    }),
    default_trajectory: "TRJ-SERIAL-EVOLUTION",
  }),

  Object.freeze({
    preset_id: "APP-002",
    presentation_phenotype: "classic",
    title_ru: "Классический неосложнённый аппендицит у женщины репродуктивного возраста",
    disease_truths: ["uncomplicated_inflammation"],
    // The demographic half of the addendum's title, kept where the master plan
    // says it belongs.
    default_modifiers: ["MOD-PREGNANCY-POSSIBLE"],
    runtime_status: "learner_active",
    first_vertical_build: true,
    key_skill_ru:
      "Problem representation, beta-hCG, опасная гинекологическая альтернатива, решение при ограниченной визуализации",
    presentation: Object.freeze({
      hours_from_onset: range(6, 14),
      pain_score: range(5, 8),
      story_ru:
        "Миграция в правую подвздошную область, боль сильнее при движении и кашле, анорексия, 1-2 эпизода рвоты",
      examination_ru:
        "Локальная болезненность, защитное напряжение или локальные перитонеальные признаки",
    }),
    authoring_ranges: Object.freeze({
      heart_rate: range(86, 104),
      temperature_c: range(37.3, 38.1),
      systolic_bp: range(105, 135),
      respiratory_rate: range(16, 22),
      wbc: range(11, 16),
      crp: range(20, 80),
    }),
    imaging: Object.freeze({
      ultrasound_ru: "Воспалённый несжимаемый аппендикс или limited visualization",
      ct_ru: "Воспаление без абсцесса и перфорации",
      operative_truth_ru: "Неосложнённый аппендицит",
    }),
    default_trajectory: "TRJ-STABLE",
  }),

  Object.freeze({
    preset_id: "APP-003",
    presentation_phenotype: "pelvic",
    title_ru: "Неосложнённый тазовый аппендицит",
    disease_truths: ["uncomplicated_inflammation"],
    // Addendum 4.2 speaks of "репродуктивный вариант APP-003", so the modifier
    // is compatible but not automatic.
    default_modifiers: [],
    compatible_modifiers: ["MOD-PREGNANCY-POSSIBLE"],
    runtime_status: "learner_active",
    key_skill_ru:
      "Не закрепиться на урологическом или гинекологическом дистракторе, обновлять differential",
    presentation: Object.freeze({
      hours_from_onset: range(8, 24),
      pain_score: range(4, 8),
      story_ru:
        "Надлобковая или глубокая тазовая боль, тенезмы, учащённое мочеиспускание или дискомфорт",
      examination_ru:
        "Максимум болезненности ниже типичной точки, классический дефанс может отсутствовать",
    }),
    authoring_ranges: Object.freeze({
      heart_rate: range(82, 106),
      temperature_c: range(37.1, 38.2),
      systolic_bp: range(100, 135),
      respiratory_rate: range(16, 22),
      wbc: range(10, 16),
      crp: range(20, 100),
    }),
    imaging: Object.freeze({
      ultrasound_ru:
        "Аппендикс может не визуализироваться, тазовые органы оцениваются отдельно",
      ct_ru: "Тазовое расположение и воспаление без абсцесса",
      operative_truth_ru:
        "Тазовый воспалённый аппендикс, небольшой реактивный выпот допустим",
    }),
    default_trajectory: "TRJ-SERIAL-EVOLUTION",
  }),

  Object.freeze({
    preset_id: "APP-004",
    presentation_phenotype: "retrocecal",
    title_ru: "Ретроцекальный аппендицит со слабой передней перитонеальной симптоматикой",
    disease_truths: ["uncomplicated_inflammation"],
    default_modifiers: [],
    runtime_status: "learner_active",
    // Addendum 4: "learner on для стабильного варианта; complicated modifier
    // preview only". The complicated branch is not authored here at all, which
    // is why it cannot be selected.
    complicated_variant_status: "faculty_preview",
    key_skill_ru:
      "Понимать ограничения осмотра и УЗИ, выбирать КТ, наблюдение или безопасный маршрут",
    presentation: Object.freeze({
      hours_from_onset: range(10, 30),
      pain_score: range(4, 8),
      story_ru:
        "Правый фланк, поясница или правое подреберье, усиление при ходьбе или разгибании бедра",
      examination_ru: "Слабые передние признаки, латеральная болезненность, psoas sign возможен",
    }),
    authoring_ranges: Object.freeze({
      heart_rate: range(88, 112),
      temperature_c: range(37.4, 38.5),
      systolic_bp: range(100, 135),
      respiratory_rate: range(16, 24),
      wbc: range(11, 18),
      crp: range(40, 140),
    }),
    imaging: Object.freeze({
      ultrasound_ru: "Ограничение кишечным газом и глубиной",
      ct_ru: "Ретроцекальное расположение, morphology фиксирована seed",
      operative_truth_ru:
        "Ретроцекальный воспалённый аппендикс; complicated modifier только preview",
    }),
    default_trajectory: "TRJ-STABLE",
  }),

  Object.freeze({
    preset_id: "APP-005",
    presentation_phenotype: "late_complicated",
    title_ru: "Перфорация, распространённый перитонит и сепсис",
    disease_truths: ["perforation", "diffuse_peritonitis"],
    default_modifiers: [],
    // Addendum 1: faculty preview only, "пока движок нестабильного пациента и
    // клинические правила не прошли review". The engine cannot yet show a
    // patient improving in response to resuscitation, and an unstable patient
    // who does not respond to correct treatment teaches the wrong lesson.
    runtime_status: "faculty_preview",
    inactivity_reason_ru:
      "Движок нестабильного пациента не реализован: физиология ответа на лечение отсутствует, поэтому правильные действия резидента не изменили бы состояние. Клинические правила септического пути не проходили review.",
    key_skill_ru: "Stability first, parallel resuscitation and source control, ICU planning",
    presentation: Object.freeze({
      hours_from_onset: range(24, 72),
      pain_score: range(7, 10),
      story_ru: "Диффузная боль, повторная рвота, слабость, жажда, снижение диуреза",
      examination_ru: "Распространённые перитонеальные признаки и возможная гипоперфузия",
    }),
    authoring_ranges: Object.freeze({
      heart_rate: range(105, 140),
      temperature_c: range(38.0, 39.5),
      // Addendum 4.2 allows an alternative low branch in a compatible severe
      // seed. Declared, not merged into the range above, so a generator has to
      // choose the branch explicitly rather than interpolate through it.
      temperature_c_severe_alternative: Object.freeze({ below: 36.0 }),
      systolic_bp: range(80, 110),
      respiratory_rate: range(22, 34),
      wbc: range(14, 24),
      wbc_severe_alternative: "leukopenia_in_compatible_severe_seed",
      crp: range(120, 350),
    }),
    imaging: Object.freeze({
      ultrasound_ru:
        "Свободная жидкость возможна, неполное исследование не должно задерживать urgent pathway",
      ct_ru: "Перфорация, свободная жидкость/газ и распространённое воспаление",
      operative_truth_ru:
        "Перфорация с гнойной контаминацией и распространённым перитонитом",
    }),
    default_trajectory: "TRJ-SEPTIC-SHOCK",
  }),
]);

/**
 * Coherence rules, addendum 4.2, verbatim in intent.
 *
 * These are refusals, not preferences: a generated patient that violates one is
 * rejected rather than adjusted. "Не генерировать shock vitals при uncomplicated
 * morphology" is not a nudge toward plausibility - a patient with uncomplicated
 * inflammation and a systolic of 80 is a different disease, and shipping one
 * would teach a resident that the two go together.
 */
export const COHERENCE_RULES = Object.freeze([
  Object.freeze({
    id: "no_shock_vitals_with_uncomplicated_morphology",
    statement_ru: "Не генерировать shock vitals при uncomplicated morphology.",
    review_status: "NEEDS_CLINICAL_REVIEW",
  }),
  Object.freeze({
    id: "no_normal_perfusion_with_diffuse_purulent_peritonitis",
    statement_ru:
      "Не генерировать normal perfusion, low inflammatory burden и diffuse purulent peritonitis одновременно.",
    review_status: "NEEDS_CLINICAL_REVIEW",
  }),
  Object.freeze({
    id: "pregnancy_status_frozen_before_session",
    statement_ru:
      "Pregnancy status фиксируется до сессии; beta-hCG раскрывается только после запроса.",
    applies_to_modifiers: ["MOD-PREGNANCY-POSSIBLE"],
    review_status: "NEEDS_CLINICAL_REVIEW",
  }),
  Object.freeze({
    id: "negative_hcg_excludes_pregnancy_not_confirms_appendicitis",
    statement_ru:
      "Отрицательный beta-hCG исключает текущую беременность в рамках authored case, но не подтверждает аппендицит.",
    review_status: "NEEDS_CLINICAL_REVIEW",
  }),
  Object.freeze({
    id: "nonspecific_urinalysis_is_not_a_uti",
    statement_ru:
      "Неспецифические изменения ОАМ не превращаются в ИМП без совместимого symptom/lab cluster.",
    review_status: "NEEDS_CLINICAL_REVIEW",
  }),
  Object.freeze({
    id: "negative_ultrasound_does_not_change_hidden_truth",
    statement_ru: "Отрицательное или неинформативное УЗИ не меняет hidden truth.",
    review_status: "NEEDS_CLINICAL_REVIEW",
  }),
  Object.freeze({
    id: "severe_preset_needs_coherent_organ_dysfunction_cluster",
    statement_ru:
      "APP-005 должен иметь согласованный organ dysfunction cluster, а не случайный набор тяжёлых значений.",
    applies_to_presets: ["APP-005"],
    review_status: "NEEDS_CLINICAL_REVIEW",
  }),
]);

export const phenotypesById = new Map(
  APPENDICITIS_PHENOTYPES.map((phenotype) => [phenotype.preset_id, phenotype])
);

/** Presets the learner randomizer may select. Addendum 1 and 14 (Safety). */
export function learnerSelectablePhenotypes() {
  return APPENDICITIS_PHENOTYPES.filter(
    (phenotype) => phenotype.runtime_status === "learner_active"
  );
}

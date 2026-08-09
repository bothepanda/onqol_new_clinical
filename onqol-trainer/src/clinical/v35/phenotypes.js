// Appendicitis phenotype cards and the V3.5 case presets built from them.
//
// TWO DIFFERENT THINGS, DELIBERATELY SEPARATED
//
// A PHENOTYPE is a disease-specific way of presenting: classic, pelvic,
// retrocecal. It is a property of the appendix, not of the patient.
//
// A CASE PRESET (`APP-001`..`APP-005`) is a reviewed COMBINATION of layers:
// phenotype + morphology + population modifiers + trajectory + resource
// profile. Master plan 13.1: presets are "только проверенные preset
// combinations для V3.5, а не вечная схема всей библиотеки".
//
// The addendum's tables are indexed by APP-xxx and therefore conflate the two -
// APP-002 is "классический ... у женщины репродуктивного возраста", which is a
// phenotype and a modifier welded together. Unwelded here, so that the second
// nosology reuses the layers instead of copying the presets.
//
// WHAT A RANGE IS
//
// Addendum 4.2, verbatim: "Эти диапазоны нужны только для генерации
// правдоподобного синтетического пациента. Они не дают баллы и не используются
// как diagnostic cutoffs до clinical review."
//
// A range is the envelope of patients a phenotype may contain. It is not a
// threshold for intervention, and `authoring_ranges` is named so that any rule
// wanting to read one as a cutoff has to rename it first - which is a reviewable
// diff rather than a silent reinterpretation.
//
// THE ENVELOPE IS NOT A SEVERITY ORDER
//
// APP-004's authored heart-rate envelope (88-112) sits higher than APP-002's
// (86-104). That is the addendum's authoring, and it is FLAGGED, not encoded as
// a rule: a retrocecal appendix is in a different place, which is not the same
// as a sicker patient. The generator never derives physiological load from the
// phenotype for exactly this reason - see patientGenerator.js.

const range = (min, max) => Object.freeze({ min, max });

export const PHENOTYPE_IDS = Object.freeze([
  "early_subtle",
  "classic",
  "pelvic",
  "retrocecal",
  "late_complicated",
]);

/** Morphology, addendum 3. The disease truth a case may carry. */
export const MORPHOLOGIES = Object.freeze([
  "uncomplicated_inflammation",
  "gangrene_necrosis",
  "perforation",
  "abscess",
  "diffuse_peritonitis",
]);

/** Trajectory ids, master plan 9. Declared here, authored with their own cards. */
export const TRAJECTORY_IDS = Object.freeze([
  "TRJ-STABLE",
  "TRJ-SERIAL-EVOLUTION",
  "TRJ-RESPONDS-TO-TREATMENT",
  "TRJ-NONRESPONSE",
  "TRJ-PROGRESSIVE-DETERIORATION",
  "TRJ-SEPTIC-SHOCK",
  "TRJ-RECURRENCE-READMISSION",
]);

/**
 * Kazakhstan resource profiles, addendum 10.
 *
 * Ids only at this stage. Wiring them onto the existing facility templates in
 * v25/scenarioEngine.js is separate work: the code today speaks a third
 * vocabulary (limited/enhanced/maximal), master plan 13.3 keeps four capability
 * levels, and reconciling three vocabularies is its own change.
 *
 * A resource profile decides what help is AVAILABLE. It never touches the
 * patient's hidden physiology; a test asserts this.
 */
export const RESOURCE_PROFILE_IDS = Object.freeze([
  "KZ-R1-DISTRICT",
  "KZ-R2-URBAN",
  "KZ-R3-TERTIARY",
]);

export const V35_MODIFIERS = Object.freeze({
  "MOD-PREGNANCY-POSSIBLE": Object.freeze({
    modifier_id: "MOD-PREGNANCY-POSSIBLE",
    title_ru: "Возможная беременность",
    // What the modifier switches ON. Without it these actions do not belong to
    // the case at all - not "present but worth zero". A patient who cannot be
    // pregnant is not being tested on beta-hCG.
    enables_action_ids: [
      "pregnancy_test",
      "pelvic_gynecologic_screen",
      "pelvic_ultrasound",
      "gynecology_consult",
    ],
    enables_dangerous_alternatives: ["differential_ectopic"],
    // V3.5 authors no physiological delta for this modifier, and none is
    // invented. It changes what must be done, not what the patient's pulse is.
    physiology_delta: null,
    // Owner decision, 09.08.2026: reproductive potential runs to 50, and 46 is
    // not an automatic boundary. The modifier is MANDATORY for a woman in this
    // band rather than optional - see PREGNANCY_BRANCH_RULE.
    demographics: Object.freeze({ sex: "female", age: range(18, 50) }),
    clinical_review_status: "pending",
  }),
});

/**
 * When the pregnancy safety branch is compulsory.
 *
 * Owner decision, 09.08.2026, replacing an earlier fix of mine that solved the
 * problem the wrong way. That version kept women out of presets with no
 * pregnancy branch by drawing them at 46+, which quietly made three of four
 * presets stop presenting young women at all - and appendicitis in young women
 * is common.
 *
 * The branch is now attached to the PATIENT, not to the preset: draw the patient
 * from one adult population, and if she falls in the band, the case acquires the
 * branch. A preset never has to anticipate her.
 *
 * NEEDS_CLINICAL_REVIEW.
 */
export const PREGNANCY_BRANCH_RULE = Object.freeze({
  modifier_id: "MOD-PREGNANCY-POSSIBLE",
  sex: "female",
  age: range(18, 50),
  statement_ru:
    "Женщина 18-50 лет: модификатор обязателен. Женщина 51-75: допустим кейс без него. Мужчина 18-75: не применяется.",
  clinical_review_status: "pending",
});

/**
 * One adult population for everybody, addendum-independent owner decision.
 * Explicitly NOT split by sex: an age range that depends on sex was an artefact
 * of the previous fix, not a clinical statement.
 */
export const BASE_ADULT_AGE = range(18, 75);

/**
 * Blood values that belong to the adult population, not to appendicitis.
 *
 * Surgeon's correction, 09.08.2026: haemoglobin and platelets do not vary with
 * where the appendix sits. Removing them from the phenotype tables removes an
 * implied claim that they do.
 *
 * Anaemia, haemoconcentration and thrombocytopenia arrive through a modifier or
 * a compatible organ-dysfunction cluster - never as a side effect of the
 * presentation. MOD-PREGNANCY-POSSIBLE means she could be pregnant, not that she
 * is, so it moves nothing here.
 */
export const POPULATION_BLOOD = Object.freeze({
  haemoglobin: Object.freeze({
    female: range(120, 155),
    male: range(130, 170),
  }),
  // Hard envelope with a narrower target: extremes exist but are uncommon, so
  // the distribution is centred rather than uniform across the whole envelope.
  platelets: Object.freeze({
    envelope: range(150, 400),
    target_p5_p95: range(170, 350),
  }),
  clinical_review_status: "reviewed_provisional",
  eligible_for_scoring: false,
});

/**
 * Phenotype cards. Authoring data from addendum 4.1-4.3, copied verbatim.
 *
 * @typedef {Object} PhenotypeCard
 * @property {string} phenotype_id
 * @property {string[]} compatible_morphologies
 * @property {object} presentation      hours_from_onset, pain_score, RU text
 * @property {object} authoring_ranges  the envelope, never a cutoff
 * @property {object} imaging
 */
export const PHENOTYPES = Object.freeze({
  early_subtle: Object.freeze({
    phenotype_id: "early_subtle",
    title_ru: "Ранняя маловыраженная презентация",
    compatible_morphologies: ["uncomplicated_inflammation"],
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
      // Generated jointly with WBC from the shared burden, then ANC is derived.
      neutrophil_percent: range(65, 82),
      crp: range(2, 35),
    }),
    imaging: Object.freeze({
      ultrasound_ru: "Отрицательное или неубедительное допустимо",
      ct_ru: "Ранние признаки воспаления без осложнений",
      operative_truth_ru: "Воспалённый аппендикс без некроза, перфорации и абсцесса",
    }),
    clinical_review_status: "pending",
  }),

  classic: Object.freeze({
    phenotype_id: "classic",
    title_ru: "Классическая презентация",
    compatible_morphologies: ["uncomplicated_inflammation"],
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
      // Generated jointly with WBC from the shared burden, then ANC is derived.
      neutrophil_percent: range(72, 88),
      crp: range(20, 80),
    }),
    imaging: Object.freeze({
      ultrasound_ru: "Воспалённый несжимаемый аппендикс или limited visualization",
      ct_ru: "Воспаление без абсцесса и перфорации",
      operative_truth_ru: "Неосложнённый аппендицит",
    }),
    clinical_review_status: "pending",
  }),

  pelvic: Object.freeze({
    phenotype_id: "pelvic",
    title_ru: "Тазовое расположение",
    compatible_morphologies: ["uncomplicated_inflammation"],
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
      // Generated jointly with WBC from the shared burden, then ANC is derived.
      neutrophil_percent: range(70, 88),
      crp: range(20, 100),
    }),
    imaging: Object.freeze({
      ultrasound_ru: "Аппендикс может не визуализироваться, тазовые органы оцениваются отдельно",
      ct_ru: "Тазовое расположение и воспаление без абсцесса",
      operative_truth_ru: "Тазовый воспалённый аппендикс, небольшой реактивный выпот допустим",
    }),
    clinical_review_status: "pending",
  }),

  retrocecal: Object.freeze({
    phenotype_id: "retrocecal",
    title_ru: "Ретроцекальное расположение",
    compatible_morphologies: ["uncomplicated_inflammation"],
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
      // Generated jointly with WBC from the shared burden, then ANC is derived.
      neutrophil_percent: range(72, 90),
      crp: range(40, 140),
    }),
    imaging: Object.freeze({
      ultrasound_ru: "Ограничение кишечным газом и глубиной",
      ct_ru: "Ретроцекальное расположение, morphology фиксирована seed",
      operative_truth_ru: "Ретроцекальный воспалённый аппендикс",
    }),
    // Raised by the owner, 09.08.2026. The authored envelope for this phenotype
    // is higher than the classic one across every inflammatory variable, which
    // asserts that a retrocecal position is itself more severe. Position and
    // severity are different claims. The generator does not encode the
    // implication; a reviewer decides whether the envelope stays.
    review_flag: Object.freeze({
      id: "retrocecal_envelope_implies_greater_severity",
      question_ru:
        "Ретроцекальная локализация сама по себе не означает более тяжёлую физиологию. Диапазоны ЧСС 88-112, T 37.4-38.5, WBC 11-18 и CRP 40-140 выше классических. Это авторское решение о более позднем обращении (10-30 часов против 6-14), или диапазоны надо сблизить с классическими?",
      raised_by: "owner",
      status: "NEEDS_CLINICAL_REVIEW",
    }),
    clinical_review_status: "pending",
  }),

  late_complicated: Object.freeze({
    phenotype_id: "late_complicated",
    title_ru: "Поздняя осложнённая презентация",
    compatible_morphologies: ["perforation", "diffuse_peritonitis", "abscess"],
    presentation: Object.freeze({
      hours_from_onset: range(24, 72),
      pain_score: range(7, 10),
      story_ru: "Диффузная боль, повторная рвота, слабость, жажда, снижение диуреза",
      examination_ru: "Распространённые перитонеальные признаки и возможная гипоперфузия",
    }),
    authoring_ranges: Object.freeze({
      heart_rate: range(105, 140),
      temperature_c: range(38.0, 39.5),
      systolic_bp: range(80, 110),
      respiratory_rate: range(22, 34),
      wbc: range(14, 24),
      // Generated jointly with WBC from the shared burden, then ANC is derived.
      neutrophil_percent: range(80, 95),
      crp: range(120, 350),
    }),
    // Addendum 4.2 allows an alternative low branch in a compatible severe seed.
    // Declared as a branch, never merged into the range above: a generator must
    // choose it explicitly rather than interpolate through normal values.
    severe_alternative_branch: Object.freeze({
      temperature_c_below: 36.0,
      wbc: "leukopenia",
      requires_morphology: ["diffuse_peritonitis"],
      clinical_review_status: "pending",
    }),
    imaging: Object.freeze({
      ultrasound_ru:
        "Свободная жидкость возможна, неполное исследование не должно задерживать urgent pathway",
      ct_ru: "Перфорация, свободная жидкость/газ и распространённое воспаление",
      operative_truth_ru: "Перфорация с гнойной контаминацией и распространённым перитонитом",
    }),
    clinical_review_status: "pending",
  }),
});

/**
 * Case presets: reviewed combinations of the layers above.
 *
 * @typedef {Object} CasePreset
 * @property {string} case_preset_id        APP-001..APP-005
 * @property {string} phenotype_id
 * @property {string} morphology            the disease truth this preset carries
 * @property {string[]} population_modifier_ids
 * @property {string} trajectory_id
 * @property {string} resource_profile_id
 * @property {string} runtime_status        learner_active | faculty_preview
 */
export const CASE_PRESETS = Object.freeze([
  Object.freeze({
    case_preset_id: "APP-001",
    title_ru: "Ранний маловыраженный неосложнённый аппендицит",
    phenotype_id: "early_subtle",
    morphology: "uncomplicated_inflammation",
    // Empty: the pregnancy branch is attached to the patient by
    // PREGNANCY_BRANCH_RULE, not declared per preset. Owner decision (a).
    population_modifier_ids: [],
    compatible_modifier_ids: ["MOD-PREGNANCY-POSSIBLE"],
    trajectory_id: "TRJ-SERIAL-EVOLUTION",
    resource_profile_id: "KZ-R1-DISTRICT",
    runtime_status: "learner_active",
    key_skill_ru:
      "Не закрывать диагноз преждевременно, построить active observation и timed reassessment",
  }),
  Object.freeze({
    case_preset_id: "APP-002",
    title_ru: "Классический неосложнённый аппендицит у женщины репродуктивного возраста",
    phenotype_id: "classic",
    morphology: "uncomplicated_inflammation",
    // The demographic half of the addendum's title, moved to where the master
    // plan says it belongs.
    population_modifier_ids: ["MOD-PREGNANCY-POSSIBLE"],
    trajectory_id: "TRJ-STABLE",
    resource_profile_id: "KZ-R1-DISTRICT",
    runtime_status: "learner_active",
    first_vertical_build: true,
    key_skill_ru:
      "Problem representation, beta-hCG, опасная гинекологическая альтернатива, решение при ограниченной визуализации",
  }),
  Object.freeze({
    case_preset_id: "APP-003",
    title_ru: "Неосложнённый тазовый аппендицит",
    phenotype_id: "pelvic",
    morphology: "uncomplicated_inflammation",
    // Addendum 4.2 speaks of a "репродуктивный вариант APP-003": compatible,
    // not automatic.
    population_modifier_ids: [],
    compatible_modifier_ids: ["MOD-PREGNANCY-POSSIBLE"],
    trajectory_id: "TRJ-SERIAL-EVOLUTION",
    resource_profile_id: "KZ-R2-URBAN",
    runtime_status: "learner_active",
    key_skill_ru:
      "Не закрепиться на урологическом или гинекологическом дистракторе, обновлять differential",
  }),
  Object.freeze({
    case_preset_id: "APP-004",
    title_ru: "Ретроцекальный аппендицит со слабой передней перитонеальной симптоматикой",
    phenotype_id: "retrocecal",
    morphology: "uncomplicated_inflammation",
    population_modifier_ids: [],
    compatible_modifier_ids: ["MOD-PREGNANCY-POSSIBLE"],
    trajectory_id: "TRJ-STABLE",
    resource_profile_id: "KZ-R1-DISTRICT",
    runtime_status: "learner_active",
    key_skill_ru:
      "Понимать ограничения осмотра и УЗИ, выбирать КТ, наблюдение или безопасный маршрут",
  }),
  Object.freeze({
    case_preset_id: "APP-005",
    title_ru: "Перфорация, распространённый перитонит и сепсис",
    phenotype_id: "late_complicated",
    morphology: "diffuse_peritonitis",
    population_modifier_ids: [],
    compatible_modifier_ids: ["MOD-PREGNANCY-POSSIBLE"],
    trajectory_id: "TRJ-SEPTIC-SHOCK",
    resource_profile_id: "KZ-R3-TERTIARY",
    runtime_status: "faculty_preview",
    inactivity_reason_ru:
      "Движок нестабильного пациента не реализован: физиология ответа на лечение отсутствует, поэтому правильные действия резидента не изменили бы состояние. Клинические правила септического пути не проходили review.",
    key_skill_ru: "Stability first, parallel resuscitation and source control, ICU planning",
  }),
]);

export const presetsById = new Map(
  CASE_PRESETS.map((preset) => [preset.case_preset_id, preset])
);

/** Coherence rules, addendum 4.2. Refusals, not preferences. */
export const COHERENCE_RULES = Object.freeze([
  Object.freeze({
    id: "no_shock_vitals_with_uncomplicated_morphology",
    statement_ru: "Не генерировать shock vitals при uncomplicated morphology.",
    clinical_review_status: "pending",
  }),
  Object.freeze({
    id: "no_normal_perfusion_with_diffuse_purulent_peritonitis",
    statement_ru:
      "Не генерировать normal perfusion, low inflammatory burden и diffuse purulent peritonitis одновременно.",
    clinical_review_status: "pending",
  }),
  Object.freeze({
    id: "pregnancy_status_frozen_before_session",
    statement_ru:
      "Pregnancy status фиксируется до сессии; beta-hCG раскрывается только после запроса.",
    clinical_review_status: "pending",
  }),
  Object.freeze({
    id: "negative_hcg_excludes_pregnancy_not_confirms_appendicitis",
    statement_ru:
      "Отрицательный beta-hCG исключает текущую беременность в рамках authored case, но не подтверждает аппендицит.",
    clinical_review_status: "pending",
  }),
  Object.freeze({
    id: "nonspecific_urinalysis_is_not_a_uti",
    statement_ru:
      "Неспецифические изменения ОАМ не превращаются в ИМП без совместимого symptom/lab cluster.",
    clinical_review_status: "pending",
  }),
  Object.freeze({
    id: "negative_ultrasound_does_not_change_hidden_truth",
    statement_ru: "Отрицательное или неинформативное УЗИ не меняет hidden truth.",
    clinical_review_status: "pending",
  }),
  Object.freeze({
    id: "severe_preset_needs_coherent_organ_dysfunction_cluster",
    statement_ru:
      "APP-005 должен иметь согласованный organ dysfunction cluster, а не случайный набор тяжёлых значений.",
    clinical_review_status: "pending",
  }),
]);

/** Presets the learner randomizer may select. Addendum 1 and 14 (Safety). */
export function learnerSelectablePresets() {
  return CASE_PRESETS.filter((preset) => preset.runtime_status === "learner_active");
}

/** Everything a preset points at, resolved. Throws on a dangling reference. */
export function resolvePreset(casePresetId) {
  const preset = presetsById.get(casePresetId);
  if (!preset) throw new Error(`Unknown case preset "${casePresetId}".`);
  const phenotype = PHENOTYPES[preset.phenotype_id];
  if (!phenotype) {
    throw new Error(`Preset "${casePresetId}" names unknown phenotype "${preset.phenotype_id}".`);
  }
  const modifiers = preset.population_modifier_ids.map((id) => {
    const modifier = V35_MODIFIERS[id];
    if (!modifier) throw new Error(`Preset "${casePresetId}" names unknown modifier "${id}".`);
    return modifier;
  });
  return { preset, phenotype, modifiers };
}

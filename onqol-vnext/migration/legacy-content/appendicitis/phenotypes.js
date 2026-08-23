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
// WHAT A PHENOTYPE OWNS, AND WHAT IT DOES NOT
//
// It owns LOCALISATION: where the pain is, what the history sounds like, what
// the abdomen feels like, whether a psoas sign appears, what the urinalysis
// shows, whether the appendix is visible on ultrasound, and where it is found on
// CT and at operation.
//
// PRESENTATION TEXT IS VARIANTS, NOT A MENU
//
// The authored sentences describe what a phenotype MAY look like: "правый фланк,
// поясница или правое подреберье". That is an authoring envelope, and it was
// being printed to the learner verbatim - so the handoff read like a list of
// options rather than a patient. A patient has one pain site, not three.
//
// Each sentence is therefore split into the choices it contained, and one
// patient gets one of each. The split is MECHANICAL: every fragment is the
// surgeon's own wording, and `authored_source_ru` keeps the original sentence
// next to it so the split can be checked at a glance. Nothing was added, and
// `split_status: MECHANICAL_SPLIT_NEEDS_CONFIRMATION` says it is a machine's
// reading of a human's sentence until a human confirms it.
//
// It owns NO PHYSIOLOGY. Heart rate, temperature, pressure, white count and CRP
// are produced by morphology, absolute disease time, inflammatory burden,
// trajectory, modifiers and physiologic reserve - see PHYSIOLOGY_ENVELOPES and
// patientGenerator.js. Per-phenotype physiology envelopes were removed on
// 09.08.2026: they made a retrocecal appendix a sicker patient by definition,
// and they counted disease time twice, once as a window position and again as a
// higher envelope.
//
// The remaining phenotype numbers - the onset window and the pain score - are
// presentation facts, not physiology: a retrocecal appendix genuinely is found
// later because its signs are subtle, and that lateness now drives physiology
// through the shared time term rather than through a private envelope.

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
 * Each preset declares one of these ids. buildV35Case freezes it as the effective
 * profile, and createV25Session passes that id to scenarioEngine. Reference mode
 * is an explicit, logged full-resource override; real mode no longer randomises
 * a competing facility template.
 *
 * The capability rows are still review-gated workflow assumptions. Runtime
 * wiring makes them consistent, not clinically validated.
 */
export const DECLARED_RESOURCE_PROFILE_IDS = Object.freeze([
  "KZ-R1-DISTRICT",
  "KZ-R2-URBAN",
  "KZ-R3-TERTIARY",
]);

export const V35_MODIFIERS = Object.freeze({
  "MOD-PREGNANCY-POSSIBLE": Object.freeze({
    modifier_id: "MOD-PREGNANCY-POSSIBLE",
    title_ru: "Возможная беременность",
    // What the modifier makes EXPECTED is pregnancy status and the dangerous
    // ectopic alternative - nothing else. Pelvic ultrasound, the pelvic
    // examination and a gynaecology consultation stay orderable for every
    // patient and expected for none: they become clinically relevant when
    // something triggers them (a positive or unknown pregnancy result, pelvic
    // findings, bleeding, instability, or a stated gynaecologic differential),
    // not because the patient is a woman of reproductive age.
    enables_action_ids: ["pregnancy_test"],
    conditionally_relevant_action_ids: [
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
 * Physiology belongs to the MORPHOLOGY, not to the phenotype.
 *
 * Surgeon's instruction, 09.08.2026: remove phenotype-specific envelopes for
 * CRP, white count, temperature, heart rate and haemodynamics. Those are
 * produced by morphology, absolute disease time, inflammatory burden,
 * trajectory, modifiers and physiologic reserve. Where the appendix sits changes
 * where it hurts and what imaging shows - not how high the CRP goes.
 *
 * WHERE THESE NUMBERS COME FROM
 *
 * The union of the ranges the surgeon authored across the four uncomplicated
 * presentations (addendum 4.2). Nothing is invented and nothing is narrowed: the
 * lower edge is early_subtle's, the upper edge is retrocecal's, and absolute
 * disease time is what now moves a patient between them - which is exactly the
 * difference those separate envelopes were encoding.
 *
 * A CRP of 140 therefore remains reachable, as a rare high-burden uncomplicated
 * patient, and no longer arrives because a case was labelled retrocecal.
 */
export const PHYSIOLOGY_ENVELOPES = Object.freeze({
  uncomplicated: Object.freeze({
    applies_to_morphologies: ["uncomplicated_inflammation"],
    heart_rate: range(72, 112),
    temperature_c: range(36.7, 38.5),
    systolic_bp: range(100, 140),
    respiratory_rate: range(14, 24),
    wbc: range(8, 18),
    neutrophil_percent: range(65, 90),
    crp: range(2, 140),
    derived_from: "union of authored ranges for early_subtle, classic, pelvic, retrocecal",
    // The individual per-phenotype ranges were authored; this union of them was
    // not, and the CRP-over-time gradient it produces is explicitly unvalidated
    // (see early_subtle.review_flag). Pending, not reviewed_provisional.
    clinical_review_status: "pending",
  }),
  complicated: Object.freeze({
    applies_to_morphologies: ["abscess", "gangrene_necrosis", "perforation", "diffuse_peritonitis"],
    heart_rate: range(88, 140),
    temperature_c: range(37.4, 39.5),
    systolic_bp: range(80, 130),
    respiratory_rate: range(16, 34),
    wbc: range(11, 24),
    neutrophil_percent: range(75, 95),
    crp: range(40, 350),
    derived_from: "late_complicated authored ranges, widened downward to meet the uncomplicated set",
    clinical_review_status: "pending",
  }),
  eligible_for_scoring: false,
});

/** Which envelope a morphology uses. */
export function physiologyEnvelopeFor(morphology) {
  for (const envelope of [PHYSIOLOGY_ENVELOPES.uncomplicated, PHYSIOLOGY_ENVELOPES.complicated]) {
    if (envelope.applies_to_morphologies.includes(morphology)) return envelope;
  }
  throw new Error(`No physiology envelope declared for morphology "${morphology}".`);
}

/**
 * Phenotype cards. Authoring data from addendum 4.1-4.3, copied verbatim.
 *
 * @typedef {Object} PhenotypeCard
 * @property {string} phenotype_id
 * @property {string[]} compatible_morphologies
 * @property {object} presentation      hours_from_onset, pain_score, RU text
 * @property {object} presentation      onset window, pain, story, examination
 * @property {object} imaging
 */
export const PHENOTYPES = Object.freeze({
  early_subtle: Object.freeze({
    phenotype_id: "early_subtle",
    title_ru: "Ранняя маловыраженная презентация",
    // Raised by the surgeon, 09.08.2026, and NOT acted on: values are not to be
    // adjusted by hand before clinical review.
    //
    // APP-001 presents at a median of 5 hours and carries a median CRP of
    // 39 mg/L, which is not obviously right for the first hours of an
    // uncomplicated appendicitis. Measured across 100 000 seeds of the learner
    // presets, uncomplicated morphology:
    //
    //   часы    n        p5   p25   p50   p75   p95   макс
    //   0-6     19053     4    24    39    55    76   102
    //   7-12    36464     6    26    42    57    78   103
    //   13-24   37594    10    31    47    62    84   110
    //   25+      6889    16    37    52    67    88   113
    //
    // The gradient across the first day is +13 mg/L at the median. If a CRP
    // should be near-normal in the first six hours and climb steeply after
    // twelve, the shared time term is too weak - LOAD_COMPOSITION.time_shift is
    // 0.15 - and the fix is a reviewed time-response curve, not a narrower
    // envelope for this phenotype. That would put physiology back inside the
    // phenotype, which is what was just removed.
    review_flag: Object.freeze({
      id: "early_crp_gradient_not_validated",
      question_ru:
        "При медиане 5 часов CRP p50 = 39 мг/л, а к 25+ часам только 52. Правдоподобен ли такой слабый подъём за первые сутки? Если нет, нужна отрецензированная кривая ответа CRP от времени (сейчас линейный сдвиг 0.15), а не отдельный конверт для раннего фенотипа.",
      measured_on: "100000 seeds, 09.08.2026",
      status: "NEEDS_CLINICAL_REVIEW",
    }),
    compatible_morphologies: ["uncomplicated_inflammation"],
    presentation: Object.freeze({
      hours_from_onset: range(3, 8),
      pain_score: range(3, 6),
      pain_sites_ru: ["в околопупочной области", "в нижних отделах живота справа"],
      // "чёткого перемещения боли не отмечает" - owner, 09.08.2026. Neither
      // "миграция боли неубедительна" (jargon) nor "боль не перемещалась" (a
      // firm negative, which destroys the ambiguity this phenotype exists for).
      history_fixed_ru: ["чёткого перемещения боли не отмечает", "аппетита нет"],
      history_optional_ru: ["была тошнота"],
      examination_slots: Object.freeze({
        contour: "обычный",
        palpation: "мягкий",
        tenderness: "локальная умеренная",
        guarding: "нет",
        peristalsis: "выслушивается",
      }),
      // Two readings of "перитонеальные признаки отрицательные или сомнительные".
      examination_slot_choices: Object.freeze({
        rebound: ["отрицательный", "сомнительный"],
      }),
      authored_source_ru: Object.freeze({
        story:
          "Околопупочная или ранняя боль справа внизу, миграция неубедительна, анорексия, тошнота возможна",
        examination:
          "Локальная болезненность без убедительного дефанса, перитонеальные признаки отрицательные или сомнительные",
      }),
      split_status: "MECHANICAL_SPLIT_NEEDS_CONFIRMATION",
    }),
    imaging: Object.freeze({
      ultrasound_variants_ru: [
        "Убедительных УЗ-признаков острого аппендицита не выявлено.",
        "Аппендикс достоверно не визуализирован, исследование неинформативно.",
      ],
      ct_ru:
        "КТ-признаки острого аппендицита без признаков перфорации, абсцесса или другой локальной осложнённости.",
      operative_truth_ru:
        "Аппендикс воспалительно изменён, без признаков некроза, перфорации и абсцесса.",
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
      pain_sites_ru: ["в правой подвздошной области"],
      history_fixed_ru: [
        // Pain that "moved" has to have moved FROM somewhere - owner, 09.08.2026.
        // Migration is the classic phenotype's signature, and it only reads as
        // migration if the starting point is named.
        "боль началась около пупка и переместилась в правую подвздошную область",
        "боль усиливается при движении и кашле",
        "аппетита нет",
      ],
      // One episode is not "рвота, 1 эпизод" in speech - a patient says it
      // happened once. The counted form only appears from two.
      history_counted_ru: Object.freeze({
        template: "рвота была {n} {раз}",
        singular_ru: "рвота была однократно",
        range: range(1, 2),
      }),
      examination_slots: Object.freeze({
        contour: "обычный",
        // Soft wall with local guarding is exactly how the owner's own sample
        // examination reads: "при пальпации мягкий, локально болезненный ...
        // определяется локальное защитное напряжение мышц".
        palpation: "мягкий",
        tenderness: "локальная",
        max_point: "точка Мак-Бурнея",
        // The localisation is named once, by `tenderness`; the guarding line no
        // longer repeats it (owner, 09.08.2026).
        guarding: "локальное",
        rebound: "положительный локально",
        peristalsis: "выслушивается",
      }),
      // Rovsing is drawn, not fixed: it is a supporting sign, and a sign that is
      // positive in every single classic patient becomes the key that hands the
      // learner the diagnosis. Owner, 09.08.2026 - the classic picture is absent
      // in a substantial share of real patients.
      examination_slot_choices: Object.freeze({
        rovsing: ["положительный", "отрицательный"],
        percussion: ["есть", "нет"],
      }),
      authored_source_ru: Object.freeze({
        story:
          "Миграция в правую подвздошную область, боль сильнее при движении и кашле, анорексия, 1-2 эпизода рвоты",
        examination:
          "Локальная болезненность, защитное напряжение или локальные перитонеальные признаки",
      }),
      split_status: "MECHANICAL_SPLIT_NEEDS_CONFIRMATION",
    }),
    imaging: Object.freeze({
      ultrasound_variants_ru: [
        "Визуализируется увеличенный в диаметре несжимаемый аппендикс с признаками воспаления.",
        "Аппендикс визуализирован не полностью, исследование неинформативно.",
      ],
      // Owner left the classic CT blank in WORDING_REVIEW.md; this follows the
      // wording she gave the other four. Open question 6.
      ct_ru: "КТ-признаки острого аппендицита без признаков перфорации и абсцесса.",
      operative_truth_ru:
        "Воспалительно изменённый аппендикс без признаков перфорации и абсцесса.",
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
      // "в нижних отделах живота" was pulled back on 09.08.2026: it had drifted
      // into the early phenotype's site and half the pelvic patients lost the
      // localisation that makes this phenotype what it is.
      pain_sites_ru: ["в надлонной области", "глубоко внизу живота"],
      history_fixed_ru: ["частые болезненные позывы к дефекации"],
      history_variants_ru: ["учащённое мочеиспускание", "дискомфорт при мочеиспускании"],
      examination_slots: Object.freeze({
        contour: "обычный",
        // MZ RK protocol: in a pelvic appendix the abdomen stays soft and the
        // obturator (Cope) sign may appear. Owner, 09.08.2026.
        palpation: "мягкий",
        max_point: "ниже",
        peristalsis: "выслушивается",
      }),
      examination_slot_choices: Object.freeze({
        guarding: ["нет", "слабое"],
        // The anatomy makes this the phenotype the obturator sign belongs to;
        // scattering it across the others would be decoration.
        obturator: ["положительный", "отрицательный"],
      }),
      // NO AUTHORED RECTAL EXAMINATION - WITHDRAWN 19.08.2026.
      //
      // This phenotype briefly carried a fixed DRE finding: normal sphincter
      // tone, right/anterior rectal-wall tenderness, no blood. The cited
      // evidence does not support it. Takada 2015 found poor overall diagnostic
      // performance for DRE, and in the limited pelvic subgroup sensitivity was
      // about 0.38 with specificity not established - which cannot justify
      // giving EVERY pelvic patient the same positive sign.
      //
      // It is not replaced by an invented probability. DRE stays recognised and
      // answers that the patient-specific result is not modelled.
      authored_source_ru: Object.freeze({
        story:
          "Надлобковая или глубокая тазовая боль, тенезмы, учащённое мочеиспускание или дискомфорт",
        examination:
          "Максимум болезненности ниже типичной точки, классический дефанс может отсутствовать",
      }),
      split_status: "MECHANICAL_SPLIT_NEEDS_CONFIRMATION",
    }),
    imaging: Object.freeze({
      ultrasound_ru: "Аппендикс достоверно не визуализирован; органы малого таза оценены отдельно.",
      ct_ru:
        "Аппендикс расположен в малом тазу, увеличен и воспалительно изменён; признаков абсцесса нет.",
      operative_truth_ru:
        "Аппендикс расположен в малом тазу, воспалительно изменён; в малом тазу небольшое количество реактивного выпота.",
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
      pain_sites_ru: ["в правом боку", "в пояснице справа", "в правом подреберье"],
      // The second "боль" is gone - the site line already opens with it.
      history_variants_ru: ["усиливается при ходьбе", "усиливается при разгибании правого бедра"],
      examination_slots: Object.freeze({
        contour: "обычный",
        // The anterior wall is quiet: this is the phenotype's whole point, and
        // it is now said by the peritoneal sign rather than by a summary line.
        // MZ RK protocol: in a retrocecal/retroperitoneal appendix the anterior
        // wall may show neither guarding nor a Blumberg sign. Owner, 09.08.2026.
        rebound: "отрицательный",
        guarding: "нет",
        // Follows this patient's site, whichever of the three they drew.
        max_point: "по локализации боли",
        peristalsis: "выслушивается",
      }),
      // Drawn, not fixed: one special test should not be positive in 100 % of
      // retrocecal patients.
      examination_slot_choices: Object.freeze({
        psoas: ["положительный", "отрицательный"],
      }),
      authored_source_ru: Object.freeze({
        story:
          "Правый фланк, поясница или правое подреберье, усиление при ходьбе или разгибании бедра",
        examination: "Слабые передние признаки, латеральная болезненность, psoas sign возможен",
      }),
      split_status: "MECHANICAL_SPLIT_NEEDS_CONFIRMATION",
    }),
    imaging: Object.freeze({
      ultrasound_ru:
        "Аппендикс достоверно не визуализирован, кишечные газы в большом количестве.",
      // Was "Ретроцекальное расположение, morphology фиксирована seed" - a
      // developer's note printed to the learner as a radiology report.
      ct_ru: "Аппендикс расположен ретроцекально, увеличен и воспалительно изменён.",
      operative_truth_ru: "Аппендикс расположен ретроцекально, воспалительно изменён.",
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
      pain_sites_ru: ["по всему животу"],
      history_fixed_ru: [
        "многократная рвота",
        "выраженная слабость",
        "жажда",
        // "мочи стало меньше", not "мочеиспускание стало реже": the carried fact
        // is reduced volume, and frequency is a different claim (owner, 09.08.2026).
        "мочи стало меньше",
      ],
      examination_slots: Object.freeze({
        contour: "вздут",
        // No `palpation` slot: the guarding line already says the wall is rigid,
        // and saying it twice was the reason the two slots were split.
        tenderness: "разлитая",
        guarding: "распространённое",
        rebound: "положительный во всех отделах",
        percussion: "диффузная",
        peristalsis: "ослаблена",
      }),
      // Hypoperfusion is a circulatory finding, not an abdominal slot: it stays
      // as a free line appended after the examination.
      examination_extra_ru: ["признаки периферической гипоперфузии"],
      authored_source_ru: Object.freeze({
        story: "Диффузная боль, повторная рвота, слабость, жажда, снижение диуреза",
        examination: "Распространённые перитонеальные признаки и возможная гипоперфузия",
      }),
      split_status: "MECHANICAL_SPLIT_NEEDS_CONFIRMATION",
    }),
    imaging: Object.freeze({
      ultrasound_ru:
        "Определяется свободная жидкость в брюшной полости; визуализация аппендикса ограничена.",
      ct_ru:
        "КТ-признаки перфорации аппендикса: свободная жидкость и/или свободный газ, выраженные воспалительные изменения окружающих тканей.",
      operative_truth_ru:
        "Перфорация аппендикса, гнойный экссудат в брюшной полости, разлитой перитонит.",
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
 * @property {string} declared_resource_profile_id  not in force; see above
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
    declared_resource_profile_id: "KZ-R1-DISTRICT",
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
    declared_resource_profile_id: "KZ-R1-DISTRICT",
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
    declared_resource_profile_id: "KZ-R2-URBAN",
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
    declared_resource_profile_id: "KZ-R1-DISTRICT",
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
    declared_resource_profile_id: "KZ-R3-TERTIARY",
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

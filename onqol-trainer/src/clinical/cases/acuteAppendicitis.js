import { appendicitisEvidence } from "../evidence/appendicitisEvidence.js";

export const acuteAppendicitisCase = {
  case_id: "app-acute-basic-001",
  case_version: "1.2.0",
  disease_card_id: "acute_appendicitis",
  // Which disease card and retrieval package this case and its variants use.
  // Carried on the case so the UI never names a case id literally; V2.5 and V3
  // variants inherit it.
  browser_content_key: "app-acute-basic-001",
  disease_card_version: "0.2.0",
  scoring_rubric_version: "1.1.0",
  router_version: "0.3.1",
  status: "active",
  category: "emergency_surgery",
  supported_locales: ["ru", "kk"],
  default_locale: "ru",
  training_level: "resident",
  resource_setting: "basic",
  title: "Острая боль в правой подвздошной области",
  specialty: "Экстренная абдоминальная хирургия",
  difficulty: "junior",
  target_level: "резидент общей хирургии",
  learning_objectives: [
    "Собрать минимально достаточные данные при боли в правой подвздошной области.",
    "Использовать шкалу риска как инструмент маршрутизации, а не как диагноз.",
    "Не пропустить беременность у женщины репродуктивного возраста.",
    "Выбрать тактику для вероятного неосложнённого аппендицита с учётом доступных ресурсов.",
    "Разобрать расхождение WSES 2025 и КП РК по антибиотикам при наблюдении.",
  ],
  initial_presentation: {
    text:
      "Женщина, 34 года. Доставлена в приемное отделение районной больницы в 02:40. Боль началась около пупка 8 часов назад, через 3 часа сместилась в правую подвздошную область. Была двукратная рвота в начале. Температура 37,8 C, ЧСС 96/мин, АД 118/72 мм рт.ст., ЧД 18/мин, SpO2 98% на room air. КТ нет. УЗИ-специалист будет с 09:00. Лапароскопической стойки нет. Областная больница в 2,5 часах пути. С чего начнешь?",
  },
  patient_state: {
    phase: "presentation",
    diagnosis_truth: "uncomplicated_acute_appendicitis_high_probability",
    resource_level: "basic",
    sex: "female",
    age: 34,
    pregnancy_possible: true,
    hemodynamics: "stable",
    time_from_onset_hours: 8,
    transfer_time_hours: 2.5,
  },
  information_policy: {
    locked_fact_sources: ["initial_presentation", "patient_state", "available_findings", "hidden_findings"],
    inferable_findings: [],
    unknown_behavior: "State that the requested patient fact is unavailable; do not invent a normal or abnormal result.",
  },
  inferable_findings: [],
  available_findings: {
    focused_history: {
      title: "Анамнез",
      text:
        "Боль мигрировала из околопупочной области вправо вниз. Аппетита нет. Диареи нет. Дизурии нет. Последняя менструация 24 дня назад, задержки не отмечает. Аллергий на лекарства не знает.",
    },
    abdominal_exam: {
      title: "Осмотр живота",
      text:
        "Живот не вздут. Локальная болезненность и мышечный дефанс в правой подвздошной области. Локальный симптом Щеткина-Блюмберга положительный справа внизу. В остальных отделах живот мягкий.",
    },
    pelvic_gynecologic_screen: {
      title: "Гинекологический скрининг",
      text:
        "Выделений и маточного кровотечения нет. Выраженной болезненности при смещении шейки матки по данным дежурного осмотра нет. Эти данные не заменяют тест на беременность.",
    },
    cbc: {
      title: "ОАК",
      text: "Hb 126 г/л, лейкоциты 13,8 x 10^9/л, нейтрофилы 84%, тромбоциты 248 x 10^9/л.",
    },
    urinalysis: {
      title: "Общий анализ мочи",
      text: "Без лейкоцитурии и нитритов. Эритроциты 0-1 в поле зрения.",
    },
    pregnancy_test: {
      title: "Тест на беременность",
      // Отрицательный мочевой тест снижает вероятность, но не исключает
      // беременность: ложноотрицательные результаты особенно значимы при боли
      // и кровотечении, и описаны пропущенные эктопические беременности.
      text:
        "Мочевой beta-hCG отрицательный. Беременность менее вероятна, но не исключена: при сохраняющемся клиническом подозрении нужны количественный сывороточный beta-hCG, повторное исследование и соответствующая визуализация.",
    },
    crp: {
      title: "С-реактивный белок",
      text:
        "С-реактивный белок в этой версии не моделируется: временная кривая и диапазоны ещё не прошли клиническое ревью.",
      modelled: false,
    },
    biochemistry: {
      title: "Биохимия крови",
      text:
        "Креатинин 72 мкмоль/л, мочевина 4,8 ммоль/л, билирубин общий 12 мкмоль/л, АЛТ 22 Ед/л, АСТ 19 Ед/л.",
    },
    abdominal_ultrasound: {
      title: "УЗИ брюшной полости",
      text: "Сейчас недоступно: врач УЗД будет с 09:00.",
      delayed: true,
    },
    pelvic_ultrasound: {
      title: "УЗИ органов малого таза",
      text: "Сейчас недоступно: врач УЗД будет с 09:00.",
      delayed: true,
    },
    ct_abdomen: {
      title: "КТ брюшной полости",
      text: "КТ в этом стационаре недоступна.",
      unavailable: true,
    },
  },
  hidden_findings: {
    operative_finding: {
      title: "Интраоперационная находка",
      text:
        "Червеобразный отросток гиперемирован, утолщен, без перфорации, абсцесса и распространенного перитонита. Картина соответствует неосложненному острому аппендициту.",
    },
  },
  state_transitions: [
    {
      id: "enough_initial_data",
      when_all_done: ["focused_history", "abdominal_exam", "cbc", "urinalysis", "pregnancy_test"],
      next_phase: "diagnosis",
      message: "Как интерпретируешь результаты и что делаешь дальше?",
    },
    {
      id: "diagnosis_named",
      when_any_done: ["diagnosis_acute_appendicitis", "risk_stratification"],
      next_phase: "management",
      message: "Что думаешь и что будешь делать дальше?",
    },
    {
      id: "definitive_management",
      when_all_done: ["open_appendectomy_here", "preop_single_antibiotic_prophylaxis"],
      next_phase: "ready_to_finish",
      reveal: ["operative_finding"],
      message: "Как оцениваешь ситуацию сейчас и что делаешь?",
    },
  ],
  expected_actions: [
    {
      id: "focused_history",
      phase: "initial assessment",
      concept: "focused history",
      intent_type: "request_history",
      router_description: "relevant focused history and symptom timeline",
      accepted_phrasings: ["анамнез", "опрос", "жалобы", "история боли", "менструация"],
      importance: "important",
      score_weight: 8,
      domain: "Initial assessment",
      critical: false,
      time_window: "early",
      prerequisites: [],
      effects_on_case: { reveal: "focused_history" },
      feedback_if_done: "Собран фокусированный анамнез, включая динамику боли и гинекологический контекст.",
      feedback_if_missed: "Фокусированный анамнез был неполным: миграция боли и репродуктивный контекст важны для риска и дифдиагноза.",
      evidence_reference_ids: ["wses-2025-rec-1"],
    },
    {
      id: "abdominal_exam",
      phase: "initial assessment",
      concept: "abdominal examination",
      intent_type: "request_examination",
      router_description: "abdominal physical examination, palpation, guarding, peritoneal signs",
      accepted_phrasings: ["осмотр живота", "пальпация", "перитонеальные", "щеткина", "дефанс"],
      importance: "important",
      score_weight: 10,
      domain: "Initial assessment",
      critical: false,
      time_window: "early",
      prerequisites: [],
      effects_on_case: { reveal: "abdominal_exam" },
      feedback_if_done: "Оценены локальные перитонеальные признаки и распространенность процесса.",
      feedback_if_missed: "Не хватило явной оценки живота и локальных перитонеальных признаков.",
      evidence_reference_ids: ["wses-2025-rec-1"],
    },
    {
      id: "pregnancy_test",
      phase: "investigations",
      concept: "pregnancy test",
      intent_type: "request_test",
      router_description: "pregnancy test, beta-hCG, HCG, bHCG",
      accepted_phrasings: ["тест на беременность", "хгч", "hcg", "beta-hcg", "беременность"],
      importance: "critical",
      score_weight: 14,
      domain: "Patient safety",
      critical: true,
      time_window: "early",
      prerequisites: [],
      effects_on_case: { reveal: "pregnancy_test" },
      feedback_if_done:
        "Статус беременности оценён, мочевой тест отрицательный. Это снижает вероятность связанных с беременностью альтернатив, но не исключает их полностью и не подтверждает аппендицит: при сохраняющемся подозрении нужен количественный сывороточный beta-hCG.",
      feedback_if_missed:
        "Статус беременности у женщины репродуктивного возраста не был установлен: без него нельзя надёжно оценить внематочную беременность и нельзя безопасно планировать лучевую диагностику и операцию.",
      evidence_reference_ids: [
        "acep-pregnancy-test-abdominal-pain",
        "acr-pelvic-pain-reproductive-age",
      ],
    },
    {
      id: "cbc",
      phase: "investigations",
      concept: "complete blood count",
      intent_type: "request_test",
      router_description: "CBC, complete blood count, leukocytes",
      accepted_phrasings: ["оак", "общий анализ крови", "лейкоциты", "cbc"],
      importance: "important",
      score_weight: 8,
      domain: "Investigations",
      critical: false,
      time_window: "early",
      prerequisites: [],
      effects_on_case: { reveal: "cbc" },
      feedback_if_done: "ОАК использован как часть клинико-лабораторной стратификации.",
      feedback_if_missed: "ОАК не был запрошен, хотя он входит в базовую оценку риска.",
      evidence_reference_ids: ["wses-2025-rec-1"],
    },
    {
      id: "urinalysis",
      phase: "investigations",
      concept: "urinalysis",
      intent_type: "request_test",
      router_description: "urinalysis, urine test",
      accepted_phrasings: ["оам", "общий анализ мочи", "моча", "urinalysis"],
      // Условно ожидаемое, а не обязательное для каждого фенотипа: ОАМ оправдан
      // при мочевых симптомах, тазовом или ретроцекальном расположении и
      // соответствующем дифференциальном ряде. Рекомендация WSES 1 не является
      // достаточным основанием штрафовать за его отсутствие у всех подряд.
      importance: "conditional",
      conditionally_relevant_when: [
        "urinary_symptoms",
        "pelvic_appendix",
        "retrocaecal_appendix",
        "urological_differential_raised",
      ],
      score_weight: 0,
      eligible_for_scoring: false,
      domain: "Investigations",
      critical: false,
      time_window: "early",
      prerequisites: [],
      effects_on_case: { reveal: "urinalysis" },
      feedback_if_done: "ОАМ помогает отличить урологический дистрактор.",
      feedback_if_missed:
        "ОАМ не запрашивался. Это не обязательный шаг у каждого пациента, но при мочевых симптомах или тазовом расположении отростка он закрывает урологический дистрактор.",
      evidence_reference_ids: ["wses-2025-rec-1"],
    },
    {
      id: "risk_stratification",
      phase: "diagnostic reasoning",
      concept: "risk stratification",
      intent_type: "diagnosis",
      router_description:
        // PAS is a paediatric score and APP-001..004 are adult cases, so the adult
        // slice never names it. "pas" stays in accepted_phrasings below: a
        // resident who types it must still be understood, and understanding an
        // input is not the same as suggesting it.
        "qualitative risk stratification with AIR or AAS in adults, no numeric score",
      accepted_phrasings: ["air", "aas", "pas", "шкала", "стратификация", "высокий риск"],
      importance: "important",
      score_weight: 8,
      domain: "Diagnostic reasoning",
      critical: false,
      time_window: "before management",
      prerequisites: ["focused_history", "abdominal_exam"],
      effects_on_case: {},
      feedback_if_done:
        "Шкала/страта риска использована как маршрутизация. У взрослых это AIR или AAS. Числовые пороги не внесены и не оцениваются.",
      feedback_if_missed: "Риск не был явно стратифицирован: важно отделять высокую вероятность от абсолютной уверенности.",
      evidence_reference_ids: ["wses-2025-rec-1"],
    },
    {
      id: "diagnosis_acute_appendicitis",
      phase: "diagnostic reasoning",
      concept: "working diagnosis acute appendicitis",
      intent_type: "diagnosis",
      router_description: "learner proposes acute appendicitis as working diagnosis",
      accepted_phrasings: ["аппендицит", "острый аппендицит", "неосложненный аппендицит"],
      importance: "critical",
      score_weight: 14,
      domain: "Diagnostic reasoning",
      critical: true,
      time_window: "before management",
      prerequisites: [],
      effects_on_case: {},
      feedback_if_done:
        "Гипотеза острого аппендицита хорошо объясняет миграцию боли и локальные признаки. Что в этой картине могло бы её опровергнуть и чем вы это проверите?",
      feedback_if_missed: "Рабочий диагноз не был сформулирован как острый аппендицит, несмотря на типичную миграцию боли и локальные признаки.",
      evidence_reference_ids: ["wses-2025-rec-1"],
    },
    {
      id: "differential_ectopic",
      phase: "diagnostic reasoning",
      concept: "ectopic pregnancy differential",
      intent_type: "diagnosis",
      router_description: "learner includes ectopic pregnancy in differential diagnosis",
      accepted_phrasings: ["внематочная", "гинеколог", "аднексит", "беременность"],
      importance: "critical",
      score_weight: 8,
      domain: "Patient safety",
      critical: true,
      time_window: "early",
      prerequisites: [],
      effects_on_case: {},
      feedback_if_done: "Внематочная беременность удержана в дифференциальном ряду и проверена безопасным минимумом.",
      feedback_if_missed: "Внематочная беременность не была явно удержана как опасный дистрактор.",
      evidence_reference_ids: ["wses-2025-rec-1"],
    },
    {
      id: "pelvic_gynecologic_screen",
      phase: "initial assessment",
      concept: "pelvic gynecologic examination",
      intent_type: "request_examination",
      router_description: "explicit pelvic or gynecologic examination request",
      accepted_phrasings: ["гинекологический осмотр", "осмотр гинеколога", "бимануальный", "cmt"],
      importance: "useful",
      score_weight: 0,
      domain: "Patient safety",
      critical: false,
      time_window: "early",
      prerequisites: [],
      effects_on_case: { reveal: "pelvic_gynecologic_screen" },
      feedback_if_done: "Гинекологический осмотр был запрошен явно.",
      feedback_if_missed: "Гинекологический осмотр не был запрошен явно.",
      evidence_reference_ids: [],
    },
    {
      id: "open_appendectomy_here",
      phase: "management",
      concept: "appendectomy at current hospital",
      intent_type: "management",
      router_description: "appendectomy, local operation, surgical management here",
      accepted_phrasings: ["аппендэктомия", "операция здесь", "оперировать здесь", "лапаротомия", "мак-бурней", "волковича"],
      importance: "critical",
      score_weight: 18,
      domain: "Management",
      critical: true,
      time_window: "within 24 hours",
      prerequisites: ["diagnosis_acute_appendicitis"],
      effects_on_case: {},
      feedback_if_done:
        "Выбрана аппендэктомия в текущем стационаре: при базовом оснащении это допустимый путь к контролю источника. У стабильного взрослого с неосложнённым аппендицитом операция в пределах 24 часов от госпитализации приемлема, и назначение её на утро внутри этого окна ошибкой не является. 24 часа — это потолок, а не цель, до которой нужно ждать: ухудшение, подозрение на осложнённый процесс или отсутствие переоценки требуют вмешаться раньше.",
      feedback_if_missed: "Тактика не дошла до контроля источника при высокой вероятности аппендицита.",
      evidence_reference_ids: ["wses-2025-rec-9-1", "rk-appendicitis-2018-resource"],
    },
    {
      id: "iv_access",
      phase: "management",
      concept: "intravenous access",
      intent_type: "management",
      router_description: "establish peripheral IV access",
      accepted_phrasings: ["венозный доступ", "периферический катетер", "ставлю вену", "катетер"],
      importance: "useful",
      score_weight: 0,
      domain: "Initial assessment",
      critical: false,
      time_window: "early",
      prerequisites: [],
      effects_on_case: {},
      feedback_if_done: "Венозный доступ обозначен.",
      feedback_if_missed: "Венозный доступ не был явно обозначен.",
      evidence_reference_ids: [],
    },
    {
      id: "iv_fluids",
      phase: "management",
      concept: "intravenous fluids",
      intent_type: "management",
      router_description: "intravenous fluids or crystalloid infusion",
      accepted_phrasings: ["инфузия", "кристаллоиды", "физраствор", "капельница"],
      importance: "useful",
      score_weight: 0,
      domain: "Management",
      critical: false,
      time_window: "if indicated",
      prerequisites: [],
      effects_on_case: {},
      feedback_if_done: "Инфузия обозначена.",
      feedback_if_missed: "Инфузия не была явно обозначена.",
      evidence_reference_ids: [],
    },
    {
      id: "surgical_consult",
      phase: "management",
      concept: "surgical consult",
      intent_type: "management",
      router_description: "call surgeon or request surgical review",
      accepted_phrasings: ["вызвать хирурга", "консультация хирурга", "дежурный хирург"],
      importance: "useful",
      score_weight: 0,
      domain: "Prioritization",
      critical: false,
      time_window: "early",
      prerequisites: [],
      effects_on_case: {},
      feedback_if_done: "Хирургический осмотр запрошен.",
      feedback_if_missed: "Хирургический осмотр не был явно запрошен.",
      evidence_reference_ids: [],
    },
    {
      id: "gynecology_consult",
      phase: "management",
      concept: "gynecology consult",
      intent_type: "management",
      router_description: "call gynecologist or request gynecology review",
      accepted_phrasings: ["вызвать гинеколога", "консультация гинеколога", "гинеколог"],
      importance: "useful",
      score_weight: 0,
      domain: "Patient safety",
      critical: false,
      time_window: "if differential remains",
      prerequisites: [],
      effects_on_case: {},
      feedback_if_done: "Гинекологическая консультация запрошена.",
      feedback_if_missed: "Гинекологическая консультация не была явно запрошена.",
      evidence_reference_ids: [],
    },
    {
      id: "active_observation",
      phase: "management",
      concept: "active observation",
      intent_type: "management",
      router_description: "active observation with reassessment",
      accepted_phrasings: ["наблюдение", "активное наблюдение", "динамическое наблюдение"],
      importance: "alternative",
      score_weight: 0,
      domain: "Prioritization",
      critical: false,
      time_window: "if uncertainty",
      prerequisites: [],
      effects_on_case: {},
      feedback_if_done: "Активное наблюдение обозначено.",
      feedback_if_missed: "Активное наблюдение не было обозначено.",
      evidence_reference_ids: [],
    },
    {
      id: "serial_reexamination",
      phase: "initial assessment",
      concept: "serial reexamination",
      intent_type: "request_examination",
      router_description: "repeat clinical examination over time",
      accepted_phrasings: ["повторный осмотр", "переоценка", "осмотр через несколько часов"],
      importance: "alternative",
      score_weight: 0,
      domain: "Prioritization",
      critical: false,
      time_window: "if observation",
      prerequisites: [],
      effects_on_case: {},
      feedback_if_done: "Повторный осмотр обозначен.",
      feedback_if_missed: "Повторный осмотр не был обозначен.",
      evidence_reference_ids: [],
    },
    {
      id: "preop_single_antibiotic_prophylaxis",
      phase: "management",
      concept: "single preoperative antibiotic prophylaxis",
      intent_type: "management",
      router_description: "single preoperative antibiotic prophylaxis",
      accepted_phrasings: ["профилактика", "антибиотик перед операцией", "однократно", "за 30 минут"],
      importance: "critical",
      score_weight: 10,
      domain: "Management",
      critical: true,
      time_window: "preoperative",
      // Was ["open_appendectomy_here"]: a preoperative action that required the
      // operation to have happened first. That inverted the sequence it exists
      // to teach and made `controlled_with_antibiotic_gap` the normal path -
      // operate, then be asked what was forgotten. Prophylaxis stands alone.
      prerequisites: [],
      effects_on_case: {},
      feedback_if_done:
        "Назначена однократная предоперационная антибиотикопрофилактика по локальному утверждённому протоколу. Если аппендэктомия выполняется в пределах 24 часов, лечебный курс только за ожидание не добавляется.",
      feedback_if_missed:
        "Не была обозначена однократная предоперационная антибиотикопрофилактика по локальному утверждённому протоколу. Препарат и доза берутся из локального формуляра и в тренажёре не задаются.",
      evidence_reference_ids: ["wses-2025-rec-15-1"],
    },
    {
      id: "analgesia",
      phase: "management",
      concept: "analgesia",
      intent_type: "management",
      router_description: "analgesia, pain control",
      accepted_phrasings: ["обезбол", "анальгезия", "нпвс", "кеторолак"],
      importance: "useful",
      score_weight: 4,
      domain: "Prioritization",
      critical: false,
      time_window: "early",
      prerequisites: [],
      effects_on_case: {},
      feedback_if_done: "Симптоматическая помощь не забыта.",
      feedback_if_missed: "Обезболивание не было явно сформулировано.",
      evidence_reference_ids: [],
    },
    {
      id: "npo",
      phase: "management",
      concept: "nil per os",
      intent_type: "management",
      router_description: "nil per os, fasting before possible operation",
      accepted_phrasings: ["голод", "npo", "ничего через рот", "не есть"],
      importance: "useful",
      score_weight: 3,
      domain: "Prioritization",
      critical: false,
      time_window: "preoperative",
      prerequisites: [],
      effects_on_case: {},
      feedback_if_done: "Предоперационный режим обозначен.",
      feedback_if_missed: "Предоперационный режим не был явно обозначен.",
      evidence_reference_ids: [],
    },
  ],
  acceptable_alternatives: [
    {
      id: "abdominal_ultrasound",
      maps_to: "abdominal_ultrasound",
      concept: "abdominal ultrasound",
      intent_type: "request_test",
      router_description: "abdominal ultrasound, abdominal sonography, UZI OBP",
      accepted_phrasings: ["узи", "узи живота", "узи обп", "сонография", "ультразвук"],
      domain: "Investigations",
      score_weight: 2,
      feedback:
        "Запрос УЗИ приемлем как ресурсная ветвь, но ожидать его 6 часов при высокой вероятности не нужно.",
      evidence_reference_ids: ["wses-2025-rec-3-1"],
    },
    {
      id: "pelvic_ultrasound",
      maps_to: "pelvic_ultrasound",
      concept: "pelvic ultrasound",
      intent_type: "request_test",
      router_description: "pelvic ultrasound, ultrasound of pelvic organs, OMT ultrasound",
      accepted_phrasings: ["узи омт", "узи органов малого таза", "омт", "pelvic ultrasound"],
      domain: "Investigations",
      score_weight: 1,
      feedback: "УЗИ органов малого таза запрошено.",
      evidence_reference_ids: [],
    },
    {
      // NONOPERATIVE MANAGEMENT IS AN OPTION, NOT AN ERROR.
      //
      // This used to sit in `unsafe_actions` with a penalty, which turned a
      // conditional guideline recommendation into a mistake and taught the
      // resident that surgery is the only defensible answer. WSES R5.1 says the
      // opposite: antibiotics are acceptable for SELECTED adults. What the case
      // cannot establish is whether this patient is one of them - so the plan is
      // neither accepted nor marked wrong; the missing condition is what gets
      // asked about, and nothing here moves a score.
      id: "antibiotic_observation_course",
      maps_to: "antibiotic_observation_course",
      concept: "antibiotic-first nonoperative management",
      intent_type: "management",
      router_description:
        "conservative or nonoperative management with antibiotics, including a plan chosen because imaging, laparoscopy, or transfer is difficult",
      accepted_phrasings: [
        "курс антибиотиков",
        "антибиотики пока наблюдаем",
        "антибиотики на сутки",
        "эмпирическая терапия",
        "консервативно антибиотиками",
        "консервативное лечение антибиотиками",
      ],
      domain: "Management",
      score_weight: 0,
      eligible_for_scoring: false,
      critical: false,
      feedback:
        "Антибактериальная терапия — приемлемая альтернатива операции у отобранных взрослых с подтверждённым неосложнённым аппендицитом: при адекватном наблюдении, доступной переоценке и возможности операции спасения, и при совместном решении с пациентом. Нужно учитывать аппендиколит и риск того, что процесс окажется осложнённым. Пока эти условия в кейсе не установлены, план нельзя ни принять, ни назвать ошибкой — назови, что именно обеспечит наблюдение и переоценку.",
      evidence_reference_ids: ["wses-2025-rec-5-1"],
    },
    {
      // CRP stays a recognized request and returns no number. The generated
      // time-response curve is explicitly unvalidated, and a `review_status`
      // flag does not stop a learner absorbing the pattern anyway - so the
      // value is not shown, and nothing depends on it.
      id: "crp",
      maps_to: "crp",
      concept: "c-reactive protein",
      intent_type: "request_test",
      router_description: "CRP, C-reactive protein",
      accepted_phrasings: ["crp", "срб", "с-реактивный белок"],
      domain: "Investigations",
      score_weight: 0,
      eligible_for_scoring: false,
      critical: false,
      feedback:
        "СРБ в этой версии не моделируется: временная кривая и диапазоны ещё не прошли клиническое ревью. Решение здесь на него не опирается.",
      evidence_reference_ids: ["wses-2025-rec-1"],
    },
    {
      id: "biochemistry",
      maps_to: "biochemistry",
      concept: "blood biochemistry",
      intent_type: "request_test",
      router_description: "blood biochemistry, creatinine, urea, ALT, AST, bilirubin",
      accepted_phrasings: ["биохимия", "бхак", "креатинин", "мочевина", "алт", "аст"],
      domain: "Investigations",
      score_weight: 1,
      feedback: "Биохимия допустима для общей предоперационной оценки, но не ключевая для этого решения.",
      evidence_reference_ids: [],
    },
    {
      // Пальцевое ректальное исследование. Available to order, never expected
      // and never scored: DRE has low diagnostic value in acute appendicitis,
      // so requiring it of every patient would teach the wrong reflex.
      //
      // Its findings are authored per phenotype (v35/examSlots.js). Where the
      // phenotype authored none, the flags below stay as written and the
      // learner is told the result is not modelled rather than handed an
      // invented normal.
      id: "rectal_exam",
      maps_to: "rectal_exam",
      concept: "digital rectal examination",
      intent_type: "request_examination",
      router_description: "digital rectal examination, per rectum examination",
      accepted_phrasings: ["при", "ректальное исследование", "пальцевое ректальное", "per rectum"],
      domain: "Initial assessment",
      score_weight: 0,
      eligible_for_scoring: false,
      critical: false,
      expected_for_this_patient: false,
      finding_status: "not_authorized_for_patient_variant",
      unavailable_reason_ru:
        "Пальцевое ректальное исследование пока не смоделировано в этом кейсе: результат не подписан клиницистом.",
      feedback:
        "ПРИ распознаётся и допустимо, но не является обязательным шагом при подозрении на острый аппендицит и не оценивается: рутинное ПРИ не подтверждает и не исключает диагноз.",
      evidence_reference_ids: ["takada-2015-dre"],
    },
  ],
  unnecessary_actions: [
    {
      id: "ct_abdomen",
      concept: "CT abdomen",
      intent_type: "request_test",
      maps_to: "ct_abdomen",
      router_description: "CT abdomen, abdominal CT with or without contrast",
      accepted_phrasings: ["кт", "компьютерная томография", "контраст"],
      domain: "Investigations",
      penalty: 4,
      feedback:
        "КТ недоступна на заданном уровне ресурса. Запрос понятен в enhanced/maximal, но в этом кейсе не должен стопорить решение.",
      evidence_reference_ids: ["wses-2025-rec-3-1"],
    },
    {
      id: "wait_for_ultrasound",
      concept: "wait for ultrasound",
      intent_type: "management",
      router_description: "wait until ultrasound becomes available",
      accepted_phrasings: ["ждать узи", "подождать узи", "до утра", "в 9"],
      domain: "Prioritization",
      // Штраф снят: одна фраза «до утра» покрывает и активное наблюдение с
      // повторным осмотром, и ожидание визуализации при промежуточном риске, и
      // необоснованную отсрочку принятого решения. Это разные решения, и пока
      // тренажёр их не различает, наказывать за них нельзя - тем более что
      // текст обратной связи сам говорит, что утро внутри 24 часов не ошибка.
      // Разделение на три концепта - отдельная задача авторинга.
      penalty: 0,
      score_weight: 0,
      eligible_for_scoring: false,
      critical: false,
      feedback:
        "Ожидание УЗИ само по себе ошибкой не является: плановая операция на утро у стабильного пациента в пределах 24 часов допустима. Проблемой оно становится, когда съедает окно контроля источника или подменяет переоценку. Что именно даст вам это ожидание и что заставит вмешаться раньше?",
      evidence_reference_ids: ["wses-2025-rec-3-1", "wses-2025-rec-9-1"],
    },
    {
      // Conditional recommendation, low certainty. Routine postoperative
      // antibiotics are usually not recommended - which is not a prohibition,
      // so this carries no penalty, no safety stop and no score. It is a
      // debrief conversation.
      id: "postop_antibiotics_uncomplicated",
      concept: "postoperative antibiotics for uncomplicated appendicitis",
      intent_type: "management",
      router_description: "postoperative antibiotics after uncomplicated appendectomy",
      accepted_phrasings: ["послеоперационные антибиотики", "антибиотики после операции", "5 дней антибиотиков"],
      domain: "Management",
      penalty: 0,
      score_weight: 0,
      eligible_for_scoring: false,
      critical: false,
      recommendation_strength: "conditional",
      recommendation_certainty: "low",
      feedback:
        "После аппендэктомии по поводу подтверждённого неосложнённого аппендицита WSES предлагает не назначать послеоперационные антибиотики рутинно. Рекомендация условная, уверенность низкая: клинически обоснованное отклонение допустимо, разбираем это в дебрифе. Если есть данные за осложнённую инфекцию, это уже осложнённый путь, а не исключение из правила.",
      evidence_reference_ids: ["wses-2025-rec-17-1"],
    },
  ],
  unsafe_actions: [
    {
      id: "transfer_before_source_control",
      concept: "transfer before source control",
      intent_type: "management",
      router_description: "transfer to regional hospital before local treatment",
      accepted_phrasings: ["перевести", "транспортировать", "в областную", "эвакуация"],
      domain: "Prioritization",
      penalty: 16,
      critical: false,
      source_type: "operationalized",
      eligible_for_scoring: false,
      feedback:
        "Перевод в областную больницу до локального лечения здесь оставлен как discussion point, но по v0.2 operationalized transfer rules не score'ятся до отдельной клинической валидации.",
      evidence_reference_ids: ["wses-2025-rec-9-1", "rk-appendicitis-2018-resource"],
    },
  ],
  critical_omissions: [
    "pregnancy_test",
    "diagnosis_acute_appendicitis",
    "open_appendectomy_here",
    "preop_single_antibiotic_prophylaxis",
  ],
  // Which omissions only become omissions once something else has happened.
  //
  // Antibiotic prophylaxis is owed before an incision. A learner who never
  // decided on an operation has one gap - no operative decision - not two. The
  // first live run reported both, which made a single unfinished decision look
  // like two separate critical failures.
  dependent_omissions: {
    preop_single_antibiotic_prophylaxis: ["open_appendectomy_here"],
  },
  diagnostic_milestones: ["focused_history", "abdominal_exam", "pregnancy_test", "cbc", "urinalysis", "diagnosis_acute_appendicitis"],
  management_milestones: ["open_appendectomy_here", "preop_single_antibiotic_prophylaxis"],
  end_conditions: {
    // End commands must name the case/session. A bare "завершить" collides
    // with ordinary procedure language such as "контроль источника завершён".
    user_commands: ["конец кейса", "завершить кейс", "завершить сессию", "finish", "end case"],
    ready_phase: "ready_to_finish",
  },
  scoring: {
    domains: [
      "Initial assessment",
      "Diagnostic reasoning",
      "Investigations",
      "Prioritization",
      "Management",
      "Patient safety",
    ],
    max_score: 113,
    passing_score: 70,
  },
  feedback: {
    key_learning_points: [
      {
        text:
          "При боли в правой подвздошной области шкала риска помогает маршрутизировать, но не заменяет клинический диагноз.",
        evidence_reference_ids: ["wses-2025-rec-1"],
      },
      {
        text:
          "При базовом оснащении отсутствие КТ не останавливает решение: шкала риска, клинические данные и доступные базовые исследования могут быть достаточны.",
        evidence_reference_ids: ["wses-2025-rec-3-1"],
      },
      {
        text:
          "Для пациентки, у которой беременность возможна, минимально необходимое действие — определить статус беременности; результат исследования может быть отрицательным или положительным.",
        evidence_reference_ids: ["wses-2025-rec-1"],
        review_status: "NEEDS_CLINICAL_REVIEW: источник по внематочной беременности должен быть внесен отдельно.",
      },
      {
        text:
          "Если пациент выбран на операцию по поводу неосложненного аппендицита, WSES рекомендует выполнить аппендэктомию в пределах 24 часов.",
        evidence_reference_ids: ["wses-2025-rec-9-1"],
      },
      {
        text:
          "Антибиотики при неосложненном аппендиците, выбранном на операцию: однократная предоперационная профилактика да, курс во время ожидания нет. Для КП РК 2018 v0.2 требует scope review, потому что там речь о diagnostically uncertain intermediate-risk observation.",
        evidence_reference_ids: ["wses-2025-rec-15-1"],
      },
    ],
  },
  // Disease progression, declared by the case rather than baked into the generic
  // temporal engine.
  //
  // What moved here: the engine used to worsen this patient whenever the clock
  // passed 240 minutes OR the learner waited for an ultrasound - the same code
  // path, so an emergency-department process target behaved like a biological
  // threshold for every disease. Only the second half is a clinical statement
  // about appendicitis, and it belongs to this card.
  //
  // NEEDS_CLINICAL_REVIEW: the magnitudes below are carried over unchanged from
  // the previous implementation. They were never reviewed there either; moving
  // them did not validate them. A reviewer owns whether waiting six hours for an
  // ultrasound produces exactly this picture.
  temporal_progression_rules: [
    {
      id: "delay_awaiting_imaging",
      when: { actions: ["wait_for_ultrasound"] },
      effects: {
        status: "delayed_source_control",
        pain_delta: 1,
        min_temperature_c: 38.3,
        min_heart_rate: 108,
        peritonism: "local_more_expressive",
        flags: ["delay_risk"],
      },
      rationale_for_reviewer:
        "Ожидание визуализации вместо решения откладывает контроль источника; неосложнённый аппендицит при этом прогрессирует. Величины не отрецензированы.",
      provenance: "CARRIED_OVER_UNREVIEWED",
      review_status: "NEEDS_CLINICAL_REVIEW",
      runtime_status: "faculty_review_only",
      eligible_for_scoring: false,
    },
  ],
  references: appendicitisEvidence.references,
  resource_context: {
    level: "basic",
    available: ["clinical_exam", "cbc", "urinalysis", "pregnancy_test", "basic_biochemistry", "open_surgery"],
    delayed: ["ultrasound_operator_after_09_00"],
    unavailable: ["ct", "mri", "laparoscopy", "interventional_radiology"],
    transfer: "2.5 hours to higher-level regional hospital",
    provenance_note:
      "Resource context follows corpus methodology and Kazakhstan protocol resource language. It is scenario context, not an independent clinical recommendation.",
  },
};

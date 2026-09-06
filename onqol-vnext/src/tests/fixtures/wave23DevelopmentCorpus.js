const a = (type, params = {}) => ({ type, params });
const q = (topic) => ({ topic });
const e = (overrides = {}) => ({
  actions: [], patientQuestions: [], actionAmbiguities: [], unresolvedFragments: [],
  reasoningDomains: [], reasoningConcepts: [], mentorAnswerDomains: [], mentorAnswered: null,
  mentorCompleteness: null, ...overrides,
});

function fixtures(prefix, category, rows) {
  return rows.map(([text, expected, turnContext = {}], index) => Object.freeze({
    id: `D-${prefix}${String(index + 1).padStart(2, "0")}`,
    category,
    locale: "ru",
    text,
    source: "Wave 2.3 semantic-language development fixture; no imported clinical truth",
    turnContext: Object.freeze(turnContext),
    expected: Object.freeze(e(expected)),
  }));
}

const HISTORY = fixtures("H", "history", [
  ["сначала опрошу пациентку", { actions: [a("TAKE_HISTORY")] }],
  ["соберу анамнез по порядку", { actions: [a("TAKE_HISTORY")] }],
  ["давайте подробно расспросим", { actions: [a("TAKE_HISTORY")] }],
  ["уточню жалобы и историю боли", { actions: [a("TAKE_HISTORY")] }],
  ["опрос пациента полностью", { actions: [a("TAKE_HISTORY")] }],
  ["хочу собрать анамнез заболевания", { actions: [a("TAKE_HISTORY")] }],
  ["расспрашиваю про начало симптомов", { actions: [a("TAKE_HISTORY")] }],
  ["сперва жалобы, потом анамнез", { actions: [a("TAKE_HISTORY")] }],
  ["анамнез соберу сам", { actions: [a("TAKE_HISTORY")] }],
  ["опросите её нормально", { actions: [a("TAKE_HISTORY")] }],
  ["расспрошу, как всё началось", { actions: [a("TAKE_HISTORY")] }],
  ["собираю историю нынешней болезни", { actions: [a("TAKE_HISTORY")] }],
  ["можно начать с опроса", { actions: [a("TAKE_HISTORY")] }],
  ["опрос и уточнение жалоб", { actions: [a("TAKE_HISTORY")] }],
  ["подробный анамнез, пожалуйста", { actions: [a("TAKE_HISTORY")] }],
]);

const EXAMINATION = fixtures("E", "examination", [
  ["осмотрю живот", { actions: [a("EXAMINE", { region: "abdomen" })] }],
  ["пальпирую живот справа и слева", { actions: [a("EXAMINE", { region: "abdomen" })] }],
  ["пощупаю живот аккуратно", { actions: [a("EXAMINE", { region: "abdomen" })] }],
  ["проведу общий осмотр пациентки", { actions: [a("EXAMINE", { region: "general" })] }],
  ["быстрый осмотр целиком", { actions: [a("EXAMINE", { region: "general" })] }],
  ["живот пасматреть и пропальпировать", { actions: [a("EXAMINE", { region: "abdomen" })] }],
  ["осматриваю брюшную полость", { actions: [a("EXAMINE", { region: "abdomen" })] }],
  ["проверю болезненность живота", { actions: [a("EXAMINE", { region: "abdomen" })] }],
  ["полный физикальный осмотр", { actions: [a("EXAMINE", { region: "general" })] }],
  ["сначала посмотрю пациента целиком", { actions: [a("EXAMINE", { region: "general" })] }],
  ["пальпация живота", { actions: [a("EXAMINE", { region: "abdomen" })] }],
  ["осмотр брюшной стенки", { actions: [a("EXAMINE", { region: "abdomen" })] }],
  ["осмотрю сердце и лёгкие", { actions: [a("EXAMINE", { region: "cardiorespiratory" })] }],
  ["проверю руки и ноги", { actions: [a("EXAMINE", { region: "extremities" })] }],
  ["осмотр без уточнения области", { actionAmbiguities: ["ambiguous_target"] }],
]);

const INVESTIGATIONS = fixtures("T", "investigations", [
  ["назначаю ОАК", { actions: [a("ORDER_TEST", { testId: "cbc" })] }],
  ["СРБ, пожалуйста", { actions: [a("ORDER_TEST", { testId: "crp" })] }],
  ["возьмём общий анализ мочи", { actions: [a("ORDER_TEST", { testId: "urinalysis" })] }],
  ["нужен бета-ХГЧ", { actions: [a("ORDER_TEST", { testId: "betahcg" })] }],
  ["сделайте УЗИ живота", { actions: [a("ORDER_TEST", { testId: "ultrasound_abdomen" })] }],
  ["закажу КТ ОБП", { actions: [a("ORDER_TEST", { testId: "ct_abdomen" })] }],
  ["биохимия: креатинин", { actions: [a("ORDER_TEST", { testId: "chemistry", analytes: ["creatinine"] })] }],
  ["БХАК с электролитами", { actions: [a("ORDER_TEST", { testId: "chemistry", analytes: ["electrolytes"] })] }],
  ["креатинин и электролиты в биохимии", { actions: [a("ORDER_TEST", { testId: "chemistry", analytes: ["creatinine", "electrolytes"] })] }],
  ["ОАК и СРБ", { actions: [a("ORDER_TEST", { testId: "cbc" }), a("ORDER_TEST", { testId: "crp" })] }],
  ["моча плюс ХГЧ", { actions: [a("ORDER_TEST", { testId: "urinalysis" }), a("ORDER_TEST", { testId: "betahcg" })] }],
  ["УЗИ, а затем КТ живота", { actions: [a("ORDER_TEST", { testId: "ultrasound_abdomen" }), a("ORDER_TEST", { testId: "ct_abdomen" })] }],
  ["общий анализ крови, срочно", { actions: [a("ORDER_TEST", { testId: "cbc" })] }],
  ["БХАК без уточнений", { actionAmbiguities: ["missing_required_parameter"] }],
  ["МРТ брюшной полости", { unresolvedFragments: ["unsupported_concept"] }],
]);

const COMPOUND = fixtures("C", "compound_action", [
  ["опрос, осмотр живота и ОАК", { actions: [a("TAKE_HISTORY"), a("EXAMINE", { region: "abdomen" }), a("ORDER_TEST", { testId: "cbc" })] }],
  ["соберу анамнез, возьму СРБ и мочу", { actions: [a("TAKE_HISTORY"), a("ORDER_TEST", { testId: "crp" }), a("ORDER_TEST", { testId: "urinalysis" })] }],
  ["осмотрю живот, сделаю УЗИ и КТ ОБП", { actions: [a("EXAMINE", { region: "abdomen" }), a("ORDER_TEST", { testId: "ultrasound_abdomen" }), a("ORDER_TEST", { testId: "ct_abdomen" })] }],
  ["поставьте вену и позовите хирурга", { actions: [a("ESTABLISH_IV_ACCESS"), a("CALL_STAFF", { role: "surgeon" })] }],
  ["ничего не есть, венозный доступ, анестезиолог", { actions: [a("SET_NPO"), a("ESTABLISH_IV_ACCESS"), a("REQUEST_ANESTHESIA_REVIEW")] }],
  ["парацетамол 1 г в/в и повторно оценить боль через 30 минут", { actions: [a("ORDER_MEDICATION", { drugId: "paracetamol", dose: "1 г", doseMg: 1000, route: "iv" }), a("REASSESS", { targets: ["pain"], afterMinutes: 30 })] }],
  ["физраствор 500 мл за час и контрол витальных", { actions: [a("ORDER_INFUSION", { fluidId: "crystalloid", volumeMl: 500, durationMinutes: 60 }), a("PRESCRIBE_MONITORING", { targets: ["vitals"] })] }],
  ["ОАК, СРБ, УЗИ живота", { actions: [a("ORDER_TEST", { testId: "cbc" }), a("ORDER_TEST", { testId: "crp" }), a("ORDER_TEST", { testId: "ultrasound_abdomen" })] }],
  ["уточню боль, осмотрю живот и назначу ОАМ", { actions: [a("ASK_PATIENT", { topic: "pain" }), a("EXAMINE", { region: "abdomen" }), a("ORDER_TEST", { testId: "urinalysis" })], patientQuestions: [q("pain")] }],
  ["когда началось? потом ОАК и ХГЧ", { actions: [a("ASK_PATIENT", { topic: "onset" }), a("ORDER_TEST", { testId: "cbc" }), a("ORDER_TEST", { testId: "betahcg" })], patientQuestions: [q("onset")] }],
  ["опросить, осмотреть и позвать гинеколога", { actions: [a("TAKE_HISTORY"), a("EXAMINE", { region: "general" }), a("CALL_STAFF", { role: "gynecologist" })] }],
  ["кетопрофен 100 мг в/м, затем переоценить боль", { actions: [a("ORDER_MEDICATION", { drugId: "ketoprofen", dose: "100 мг", doseMg: 100, route: "im" }), a("REASSESS", { targets: ["pain"] })] }],
  ["ОАК и непонятный суперскан", { actions: [a("ORDER_TEST", { testId: "cbc" })], unresolvedFragments: ["unsupported_concept"] }],
  ["осмотр живота, биохимия с креатинином, ничего внутрь", { actions: [a("EXAMINE", { region: "abdomen" }), a("ORDER_TEST", { testId: "chemistry", analytes: ["creatinine"] }), a("SET_NPO")] }],
  ["вызвать хирурга, дать парацетамол 1 г в/в и ждать 20 минут", { actions: [a("CALL_STAFF", { role: "surgeon" }), a("ORDER_MEDICATION", { drugId: "paracetamol", dose: "1 г", doseMg: 1000, route: "iv" }), a("WAIT", { afterMinutes: 20 })] }],
]);

const QUESTIONS = fixtures("P", "patient_question", [
  ["где сейчас болит?", { actions: [a("ASK_PATIENT", { topic: "pain" })], patientQuestions: [q("pain")] }],
  ["когда всё началось?", { actions: [a("ASK_PATIENT", { topic: "onset" })], patientQuestions: [q("onset")] }],
  ["тошнило или была рвота?", { actions: [a("ASK_PATIENT", { topic: "nausea_vomiting" })], patientQuestions: [q("nausea_vomiting")] }],
  ["есть проблемы с мочеиспусканием?", { actions: [a("ASK_PATIENT", { topic: "urinary" })], patientQuestions: [q("urinary")] }],
  ["когда были последние месячные?", { actions: [a("ASK_PATIENT", { topic: "gynecologic" })], patientQuestions: [q("gynecologic")] }],
  ["аллергия на препараты есть?", { actions: [a("ASK_PATIENT", { topic: "allergies" })], patientQuestions: [q("allergies")] }],
  ["что из лекарств уже принимали?", { actions: [a("ASK_PATIENT", { topic: "medications" })], patientQuestions: [q("medications")] }],
  ["когда последний раз ели и пили?", { actions: [a("ASK_FASTING_HISTORY")], patientQuestions: [q("fasting")] }],
  ["боль куда-нибудь отдаёт?", { actions: [a("ASK_PATIENT", { topic: "pain" })], patientQuestions: [q("pain")] }],
  ["рвота была сегодня?", { actions: [a("ASK_PATIENT", { topic: "nausea_vomiting" })], patientQuestions: [q("nausea_vomiting")] }],
]);

const REASONING = fixtures("R", "reasoning_only", [
  ["думаю, это острый аппендицит", { reasoningDomains: ["workingDiagnosis"], reasoningConcepts: ["workingDiagnosis:acute_appendicitis"] }],
  ["рабочий диагноз — аппендицит", { reasoningDomains: ["workingDiagnosis"], reasoningConcepts: ["workingDiagnosis:acute_appendicitis"] }],
  ["аппендицит вероятен, но я не уверен", { reasoningDomains: ["workingDiagnosis"], reasoningConcepts: ["workingDiagnosis:acute_appendicitis"] }],
  ["внематочная остаётся в дифференциале", { reasoningDomains: ["differential"], reasoningConcepts: ["differential:ectopic_pregnancy"] }],
  ["внематочную считаю менее вероятной", { reasoningDomains: ["differential"], reasoningConcepts: ["differential:ectopic_pregnancy"] }],
  ["внематочную беременность исключил", { reasoningDomains: ["differential"], reasoningConcepts: ["differential:ectopic_pregnancy"] }],
  ["давление и пульс нормальные, гемодинамически стабильна", { reasoningDomains: ["stabilityAssessment"] }],
  ["гемодинамически нестабильна", { reasoningDomains: ["stabilityAssessment"] }],
  ["стабильность пока неясна", { reasoningDomains: ["stabilityAssessment"] }],
  ["из-за локальной боли хочу уточнить диагноз", { reasoningDomains: ["rationale"] }],
  ["УЗИ нужно, чтобы проверить альтернативу", { reasoningDomains: ["rationale"] }],
  ["план — наблюдение", { reasoningDomains: ["managementIntent"] }],
  ["намерен лечить неоперативно", { reasoningDomains: ["managementIntent"] }],
  ["буду повторно оценивать боль и давление", { reasoningDomains: ["reassessmentPlan"] }],
  ["повторная оценка через час", { reasoningDomains: ["reassessmentPlan"] }],
  ["если давление упадёт, позову старшего", { reasoningDomains: ["contingencyPlan"] }],
  ["при резком ухудшении поменяю план", { reasoningDomains: ["contingencyPlan"] }],
  ["рассматриваю перевод в хирургическое отделение", { reasoningDomains: ["dispositionIntent"] }],
  ["хочу обсудить случай с хирургом", { reasoningDomains: ["consultationIntent"] }],
  ["ОАК, СРБ и УЗИ", {}],
]);

const mentorContext = (id, text, expectedDomains) => ({ openMentorQuestion: { id, text, expectedDomains } });
const MENTOR = fixtures("A", "mentor_answer", [
  ["резкое ухудшение или падение давления", { mentorAnswerDomains: ["contingency"], mentorAnswered: true, mentorCompleteness: "sufficient" }, mentorContext("change-plan", "Что заставит тебя поменять план?", ["contingency"])],
  ["если усилится боль", { mentorAnswerDomains: ["contingency"], mentorAnswered: true, mentorCompleteness: "partial" }, mentorContext("change-plan", "Что заставит тебя поменять план?", ["contingency"])],
  ["боль, давление, температура и ЧСС", { mentorAnswerDomains: ["observation_targets"], mentorAnswered: true, mentorCompleteness: "sufficient" }, mentorContext("monitor", "Что именно будешь отслеживать?", ["observation_targets"])],
  ["давление и пульс", { mentorAnswerDomains: ["observation_targets"], mentorAnswered: true, mentorCompleteness: "partial" }, mentorContext("monitor", "Что именно будешь отслеживать?", ["observation_targets"])],
  ["чтобы не пропустить ухудшение", { mentorAnswerDomains: ["rationale"], mentorAnswered: true, mentorCompleteness: "sufficient" }, mentorContext("why", "Зачем нужна повторная оценка?", ["rationale"])],
  ["из-за риска осложнения", { mentorAnswerDomains: ["rationale"], mentorAnswered: true, mentorCompleteness: "partial" }, mentorContext("why", "Почему ты выбрал этот шаг?", ["rationale"])],
  ["не знаю", { mentorAnswered: false, mentorCompleteness: "none" }, mentorContext("why", "Почему ты выбрал этот шаг?", ["rationale"])],
  ["ну, посмотрим", { mentorAnswered: false, mentorCompleteness: "vague" }, mentorContext("change-plan", "Что заставит тебя поменять план?", ["contingency"])],
  ["если давление упадёт, позову хирурга", { actions: [a("CALL_STAFF", { role: "surgeon" })], reasoningDomains: ["contingencyPlan"], mentorAnswerDomains: ["contingency"], mentorAnswered: true, mentorCompleteness: "sufficient" }, mentorContext("change-plan", "Что заставит тебя поменять план?", ["contingency"])],
  ["усиление боли; и возьмите ОАК", { actions: [a("ORDER_TEST", { testId: "cbc" })], mentorAnswerDomains: ["contingency"], mentorAnswered: true, mentorCompleteness: "partial" }, mentorContext("change-plan", "Что заставит тебя поменять план?", ["contingency"])],
]);

const VAGUE = fixtures("V", "vague_or_unsupported", [
  ["сделайте что-нибудь", { actionAmbiguities: ["ambiguous_action"] }],
  ["нормальная диагностика", { actionAmbiguities: ["ambiguous_action"] }],
  ["давайте по стандарту", { actionAmbiguities: ["ambiguous_action"] }],
  ["что-нибудь от боли", { actionAmbiguities: ["ambiguous_target"] }],
  ["проверьте всё", { actionAmbiguities: ["ambiguous_target"] }],
  ["ПЭТ-КТ живота", { unresolvedFragments: ["unsupported_concept"] }],
  ["поставьте артериальный катетер", { unresolvedFragments: ["unsupported_concept"] }],
  ["сделайте генетический тест", { unresolvedFragments: ["unsupported_concept"] }],
  ["подключите ЭКМО", { unresolvedFragments: ["unsupported_concept"] }],
  ["непонятно что дальше", { actionAmbiguities: ["unrecognized_fragment"] }],
]);

const TENTATIVE = fixtures("M", "tentative_or_ambiguous_management", [
  ["можно подготовить к потенциальной операции", { actionAmbiguities: ["tentative_not_committed"], reasoningDomains: ["managementIntent"] }],
  ["можно подумать о лапароскопии", { actionAmbiguities: ["tentative_not_committed"], reasoningDomains: ["managementIntent"] }],
  ["если станет хуже, тогда прооперируем", { actionAmbiguities: ["tentative_not_committed"], reasoningDomains: ["contingencyPlan", "managementIntent"] }],
  ["вероятно, понадобится перевод", { actionAmbiguities: ["tentative_not_committed"], reasoningDomains: ["dispositionIntent"] }],
  ["рассмотрим наблюдение", { actionAmbiguities: ["tentative_not_committed"], reasoningDomains: ["managementIntent"] }],
  ["может быть, вызовем хирурга", { actionAmbiguities: ["tentative_not_committed"], reasoningDomains: ["consultationIntent"] }],
  ["цефазолин 2", { unresolvedFragments: ["missing_required_parameter"] }],
  ["морфин 5", { unresolvedFragments: ["missing_required_parameter"] }],
  ["поставьте ЦВК", { unresolvedFragments: ["unsupported_concept"] }],
  ["возможно, потом выпишем домой", { actionAmbiguities: ["tentative_not_committed"], reasoningDomains: ["dispositionIntent"] }],
]);

export const WAVE23_DEVELOPMENT_METADATA = Object.freeze({
  corpusId: "wave23-development-2026-08-29.1",
  fixtureCount: 120,
  composition: Object.freeze({ history: 15, examination: 15, investigations: 15, compound_action: 15, patient_question: 10, reasoning_only: 20, mentor_answer: 10, vague_or_unsupported: 10, tentative_or_ambiguous_management: 10 }),
  purpose: "development-only prompt/schema/model selection; never clinical truth",
});

export const WAVE23_DEVELOPMENT_CORPUS = Object.freeze([
  ...HISTORY, ...EXAMINATION, ...INVESTIGATIONS, ...COMPOUND, ...QUESTIONS,
  ...REASONING, ...MENTOR, ...VAGUE, ...TENTATIVE,
]);

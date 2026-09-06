// FROZEN HOLDOUT. Do not edit after Candidate 3 prompt/schema/model selection begins.
// Any post-inspection tuning requires a new Candidate 4 and a new holdout.
const a = (type, params = {}) => ({ type, params });
const q = (topic) => ({ topic });
const expected = (overrides = {}) => ({
  actions: [], patientQuestions: [], actionAmbiguities: [], unresolvedFragments: [],
  reasoningDomains: [], reasoningConcepts: [], mentorAnswerDomains: [], mentorAnswered: null,
  mentorCompleteness: null, ...overrides,
});

function fixture(id, category, text, gold = {}, turnContext = {}) {
  return Object.freeze({
    id, category, locale: "ru", text,
    source: "Wave 2.3 untouched semantic-language holdout; no imported clinical truth",
    turnContext: Object.freeze(turnContext),
    expected: Object.freeze(expected(gold)),
  });
}

const mentor = (id, text, expectedDomains) => ({ openMentorQuestion: { id, text, expectedDomains } });

export const WAVE23_HOLDOUT_METADATA = Object.freeze({
  corpusId: "wave23-untouched-holdout-2026-08-29.1",
  frozenAt: "2026-08-29T20:20:00+05:00",
  frozenBeforeFinalCandidateTuning: true,
  fixtureCount: 80,
  taskCoverage: Object.freeze({ actionFocused: 40, reasoningFocused: 25, contextualMentor: 15 }),
  repetitionsPerCandidate: 3,
  purpose: "untouched final Candidate 3 comparison only; never tune against these results",
});

export const WAVE23_HOLDOUT_CORPUS = Object.freeze([
  fixture("H-A01", "action_history", "начну с подробного расспроса", { actions: [a("TAKE_HISTORY")] }),
  fixture("H-A02", "action_history", "собираю жалобы и анамнез", { actions: [a("TAKE_HISTORY")] }),
  fixture("H-A03", "action_history", "поговорю с пациенткой о начале болезни", { actions: [a("TAKE_HISTORY")] }),
  fixture("H-A04", "action_history", "опросите по симптомам", { actions: [a("TAKE_HISTORY")] }),
  fixture("H-A05", "action_history", "хочу уточнить всю историю", { actions: [a("TAKE_HISTORY")] }),
  fixture("H-A06", "action_history", "анамнез заболевания подробно", { actions: [a("TAKE_HISTORY")] }),
  fixture("H-A07", "action_history", "расспросить о жалобах", { actions: [a("TAKE_HISTORY")] }),
  fixture("H-A08", "action_history", "сперва нормальный опрос", { actions: [a("TAKE_HISTORY")] }),

  fixture("H-A09", "action_examination", "проведу пальпацию живота", { actions: [a("EXAMINE", { region: "abdomen" })] }),
  fixture("H-A10", "action_examination", "осматриваю живот полностью", { actions: [a("EXAMINE", { region: "abdomen" })] }),
  fixture("H-A11", "action_examination", "общий осмотр с головы до ног", { actions: [a("EXAMINE", { region: "general" })] }),
  fixture("H-A12", "action_examination", "посмотрю её целиком", { actions: [a("EXAMINE", { region: "general" })] }),
  fixture("H-A13", "action_examination", "аускультация сердца и лёгких", { actions: [a("EXAMINE", { region: "cardiorespiratory" })] }),
  fixture("H-A14", "action_examination", "проверяю конечности", { actions: [a("EXAMINE", { region: "extremities" })] }),
  fixture("H-A15", "action_examination", "живот пощюпать", { actions: [a("EXAMINE", { region: "abdomen" })] }),
  fixture("H-A16", "action_examination", "осмотреть", { actionAmbiguities: ["ambiguous_target"] }),

  fixture("H-A17", "action_investigation", "общий анализ крови сейчас", { actions: [a("ORDER_TEST", { testId: "cbc" })] }),
  fixture("H-A18", "action_investigation", "закажите С-реактивный белок", { actions: [a("ORDER_TEST", { testId: "crp" })] }),
  fixture("H-A19", "action_investigation", "берём анализ мочи", { actions: [a("ORDER_TEST", { testId: "urinalysis" })] }),
  fixture("H-A20", "action_investigation", "проверим бета ХГЧ", { actions: [a("ORDER_TEST", { testId: "betahcg" })] }),
  fixture("H-A21", "action_investigation", "ультразвук живота", { actions: [a("ORDER_TEST", { testId: "ultrasound_abdomen" })] }),
  fixture("H-A22", "action_investigation", "компьютерная томография живота", { actions: [a("ORDER_TEST", { testId: "ct_abdomen" })] }),
  fixture("H-A23", "action_investigation", "биохимия с креатинином и электролитами", { actions: [a("ORDER_TEST", { testId: "chemistry", analytes: ["creatinine", "electrolytes"] })] }),
  fixture("H-A24", "action_investigation", "сделайте ПЭТ брюшной полости", { unresolvedFragments: ["unsupported_concept"] }),

  fixture("H-A25", "action_patient_question", "покажите, где боль сильнее", { actions: [a("ASK_PATIENT", { topic: "pain" })], patientQuestions: [q("pain")] }),
  fixture("H-A26", "action_patient_question", "с какого времени болит?", { actions: [a("ASK_PATIENT", { topic: "onset" })], patientQuestions: [q("onset")] }),
  fixture("H-A27", "action_patient_question", "вас тошнило, рвало?", { actions: [a("ASK_PATIENT", { topic: "nausea_vomiting" })], patientQuestions: [q("nausea_vomiting")] }),
  fixture("H-A28", "action_patient_question", "мочиться не больно?", { actions: [a("ASK_PATIENT", { topic: "urinary" })], patientQuestions: [q("urinary")] }),
  fixture("H-A29", "action_patient_question", "возможна беременность?", { actions: [a("ASK_PATIENT", { topic: "gynecologic" })], patientQuestions: [q("gynecologic")] }),
  fixture("H-A30", "action_patient_question", "на что есть аллергия?", { actions: [a("ASK_PATIENT", { topic: "allergies" })], patientQuestions: [q("allergies")] }),
  fixture("H-A31", "action_patient_question", "какие таблетки принимали?", { actions: [a("ASK_PATIENT", { topic: "medications" })], patientQuestions: [q("medications")] }),
  fixture("H-A32", "action_patient_question", "давно ели или пили?", { actions: [a("ASK_FASTING_HISTORY")], patientQuestions: [q("fasting")] }),

  fixture("H-A33", "action_compound", "анамнез, пальпация живота, кровь и моча", { actions: [a("TAKE_HISTORY"), a("EXAMINE", { region: "abdomen" }), a("ORDER_TEST", { testId: "cbc" }), a("ORDER_TEST", { testId: "urinalysis" })] }),
  fixture("H-A34", "action_compound", "венозный доступ, голод и вызов хирурга", { actions: [a("ESTABLISH_IV_ACCESS"), a("SET_NPO"), a("CALL_STAFF", { role: "surgeon" })] }),
  fixture("H-A35", "action_compound", "парацетамол 1000 мг в/в, контроль боли через час", { actions: [a("ORDER_MEDICATION", { drugId: "paracetamol", dose: "1000 мг", doseMg: 1000, route: "iv" }), a("REASSESS", { targets: ["pain"], afterMinutes: 60 })] }),
  fixture("H-A36", "action_compound", "сначала УЗИ и ОАК, затем позвать гинеколога", { actions: [a("ORDER_TEST", { testId: "ultrasound_abdomen" }), a("ORDER_TEST", { testId: "cbc" }), a("CALL_STAFF", { role: "gynecologist" })] }),
  fixture("H-A37", "action_vague", "сделайте всё нужное", { actionAmbiguities: ["ambiguous_action"] }),
  fixture("H-A38", "action_tentative", "может, потом лапароскопия", { actionAmbiguities: ["tentative_not_committed"] }),
  fixture("H-A39", "action_incomplete", "морфин пять", { unresolvedFragments: ["missing_required_parameter"] }),
  fixture("H-A40", "action_unsupported", "установите центральную линию", { unresolvedFragments: ["unsupported_concept"] }),

  fixture("H-R01", "reasoning_diagnosis", "основной диагноз у меня аппендицит", { reasoningDomains: ["workingDiagnosis"], reasoningConcepts: ["workingDiagnosis:acute_appendicitis"] }),
  fixture("H-R02", "reasoning_diagnosis", "скорее всего острый аппендицит", { reasoningDomains: ["workingDiagnosis"], reasoningConcepts: ["workingDiagnosis:acute_appendicitis"] }),
  fixture("H-R03", "reasoning_diagnosis", "аппендицит возможен, уверенности пока нет", { reasoningDomains: ["workingDiagnosis"], reasoningConcepts: ["workingDiagnosis:acute_appendicitis"] }),
  fixture("H-R04", "reasoning_differential", "держу в уме внематочную беременность", { reasoningDomains: ["differential"], reasoningConcepts: ["differential:ectopic_pregnancy"] }),
  fixture("H-R05", "reasoning_differential", "внематочная теперь менее вероятна", { reasoningDomains: ["differential"], reasoningConcepts: ["differential:ectopic_pregnancy"] }),
  fixture("H-R06", "reasoning_differential", "внематочную больше не рассматриваю", { reasoningDomains: ["differential"], reasoningConcepts: ["differential:ectopic_pregnancy"] }),
  fixture("H-R07", "reasoning_stability", "по давлению и пульсу она стабильна", { reasoningDomains: ["stabilityAssessment"] }),
  fixture("H-R08", "reasoning_stability", "пациентка сейчас нестабильна", { reasoningDomains: ["stabilityAssessment"] }),
  fixture("H-R09", "reasoning_stability", "не могу пока оценить стабильность", { reasoningDomains: ["stabilityAssessment"] }),
  fixture("H-R10", "reasoning_rationale", "анализ нужен, потому что хочу проверить воспаление", { reasoningDomains: ["rationale"] }),
  fixture("H-R11", "reasoning_rationale", "выбираю УЗИ, чтобы уточнить причину боли", { reasoningDomains: ["rationale"] }),
  fixture("H-R12", "reasoning_management", "мой план пока наблюдать", { reasoningDomains: ["managementIntent"] }),
  fixture("H-R13", "reasoning_management", "ориентируюсь на неоперативную тактику", { reasoningDomains: ["managementIntent"] }),
  fixture("H-R14", "reasoning_reassessment", "буду следить за болью, температурой и пульсом", { reasoningDomains: ["reassessmentPlan"] }),
  fixture("H-R15", "reasoning_reassessment", "через два часа заново оценю состояние", { reasoningDomains: ["reassessmentPlan"] }),
  fixture("H-R16", "reasoning_contingency", "при гипотонии немедленно изменю тактику", { reasoningDomains: ["contingencyPlan"] }),
  fixture("H-R17", "reasoning_contingency", "если боль резко усилится, пересмотрю решение", { reasoningDomains: ["contingencyPlan"] }),
  fixture("H-R18", "reasoning_disposition", "думаю о направлении в хирургическую палату", { reasoningDomains: ["dispositionIntent"] }),
  fixture("H-R19", "reasoning_consultation", "планирую совет с гинекологом", { reasoningDomains: ["consultationIntent"] }),
  fixture("H-R20", "reasoning_negative", "ОАК и КТ живота", {}),
  fixture("H-R21", "reasoning_negative", "пальпирую живот", {}),
  fixture("H-R22", "reasoning_compound", "считаю аппендицит ведущим, но внематочную не снимаю", { reasoningDomains: ["workingDiagnosis", "differential"], reasoningConcepts: ["workingDiagnosis:acute_appendicitis", "differential:ectopic_pregnancy"] }),
  fixture("H-R23", "reasoning_compound", "она стабильна, поэтому пока наблюдаю", { reasoningDomains: ["stabilityAssessment", "rationale", "managementIntent"] }),
  fixture("H-R24", "reasoning_compound", "если температура вырастет, повторю оценку", { reasoningDomains: ["contingencyPlan", "reassessmentPlan"] }),
  fixture("H-R25", "reasoning_negative", "резкое ухудшение", {}),

  fixture("H-M01", "mentor_sufficient", "гипотония, тахикардия или усиление боли", { mentorAnswerDomains: ["contingency"], mentorAnswered: true, mentorCompleteness: "sufficient" }, mentor("change", "Какие признаки изменят твой план?", ["contingency"])),
  fixture("H-M02", "mentor_partial", "падение давления", { mentorAnswerDomains: ["contingency"], mentorAnswered: true, mentorCompleteness: "partial" }, mentor("change", "Какие признаки изменят твой план?", ["contingency"])),
  fixture("H-M03", "mentor_sufficient", "боль, температура, давление и частота пульса", { mentorAnswerDomains: ["observation_targets"], mentorAnswered: true, mentorCompleteness: "sufficient" }, mentor("targets", "Что конкретно отслеживаешь?", ["observation_targets"])),
  fixture("H-M04", "mentor_partial", "температуру и боль", { mentorAnswerDomains: ["observation_targets"], mentorAnswered: true, mentorCompleteness: "partial" }, mentor("targets", "Что конкретно отслеживаешь?", ["observation_targets"])),
  fixture("H-M05", "mentor_sufficient", "чтобы вовремя заметить ухудшение", { mentorAnswerDomains: ["rationale"], mentorAnswered: true, mentorCompleteness: "sufficient" }, mentor("reason", "Зачем повторять оценку?", ["rationale"])),
  fixture("H-M06", "mentor_partial", "чтобы проверить динамику", { mentorAnswerDomains: ["rationale"], mentorAnswered: true, mentorCompleteness: "partial" }, mentor("reason", "Зачем повторять оценку?", ["rationale"])),
  fixture("H-M07", "mentor_unknown", "честно, не знаю", { mentorAnswered: false, mentorCompleteness: "none" }, mentor("reason", "Почему выбран этот тест?", ["rationale"])),
  fixture("H-M08", "mentor_evasion", "это потом решим", { mentorAnswered: false, mentorCompleteness: "vague" }, mentor("change", "Когда поменяешь тактику?", ["contingency"])),
  fixture("H-M09", "mentor_action_plus_answer", "при падении давления вызову хирурга и дам физраствор 500 мл болюсом", { actions: [a("CALL_STAFF", { role: "surgeon" }), a("ORDER_INFUSION", { fluidId: "crystalloid", volumeMl: 500, bolus: true })], mentorAnswerDomains: ["contingency"], mentorAnswered: true, mentorCompleteness: "sufficient" }, mentor("change", "Что сделаешь при ухудшении?", ["contingency"])),
  fixture("H-M10", "mentor_action_plus_answer", "если боль усилится, повторю осмотр живота", { actions: [a("EXAMINE", { region: "abdomen" })], mentorAnswerDomains: ["contingency"], mentorAnswered: true, mentorCompleteness: "partial" }, mentor("change", "Что заставит тебя пересмотреть план?", ["contingency"])),
  fixture("H-M11", "mentor_short_context", "резкая гипотония", { mentorAnswerDomains: ["contingency"], mentorAnswered: true, mentorCompleteness: "partial" }, mentor("change", "Что будет порогом эскалации?", ["contingency"])),
  fixture("H-M12", "mentor_short_context", "ЧСС и давление", { mentorAnswerDomains: ["observation_targets"], mentorAnswered: true, mentorCompleteness: "partial" }, mentor("targets", "Какие показатели мониторируешь?", ["observation_targets"])),
  fixture("H-M13", "mentor_deflection", "а что вы посоветуете?", { mentorAnswered: false, mentorCompleteness: "vague" }, mentor("reason", "Обоснуй свой выбор", ["rationale"])),
  fixture("H-M14", "mentor_sufficient", "изменение боли покажет, работает ли план", { mentorAnswerDomains: ["rationale"], mentorAnswered: true, mentorCompleteness: "sufficient" }, mentor("reason", "Почему отслеживаешь боль?", ["rationale"])),
  fixture("H-M15", "mentor_action_only", "возьмите ОАК", { actions: [a("ORDER_TEST", { testId: "cbc" })], mentorAnswered: false, mentorCompleteness: "none" }, mentor("reason", "Почему выбран этот тест?", ["rationale"])),
]);

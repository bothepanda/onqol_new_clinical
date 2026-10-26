import { MODEL_INTERPRETATION_SCHEMA_VERSION } from "../../ai/interpreter/modelOutputSchema.js";

const command = (type, params = {}) => ({ type, params });
const reasoning = (reasoningDelta) => ({ reasoningDelta });

function fixture(id, category, text, expectedCommands = [], options = {}) {
  const ambiguities = (options.ambiguities ?? []).map((value) => canonicalIssue(value, text));
  const unresolvedFragments = (options.unresolvedFragments ?? []).map((value) => canonicalIssue(value, text, "unrecognized_fragment"));
  const patientQuestions = (options.patientQuestions ?? []).map((question) => ({
    topic: question.topic,
    evidenceSpans: question.evidenceSpans ?? [question.evidence ?? text],
  }));
  const expected = {
    commands: expectedCommands,
    commandTypes: expectedCommands.map((item) => item.type),
    reasoningDomains: Object.keys(options.reasoningDelta ?? {}),
    patientQuestionTopics: (options.patientQuestions ?? []).map((item) => item.topic),
    mentorAnswerDomains: options.mentorAnswerDelta?.domains ?? [],
    unresolvedFragments,
    ambiguities,
  };
  const modelOutput = options.modelOutput ?? {
    clinicalActions: expectedCommands.map((item) => ({ ...item, evidenceSpans: [text], statedParameters: [] })),
    reasoningDelta: options.reasoningDelta ?? {},
    mentorAnswerDelta: options.mentorAnswerDelta ?? {},
    patientQuestions,
    ambiguities,
    unresolvedFragments,
    meta: { schemaVersion: MODEL_INTERPRETATION_SCHEMA_VERSION, confidence: options.confidence ?? 0.9 },
  };
  const suite = options.suite ?? (["M04", "V04"].includes(id) ? "safety_probe" : ["A03", "A04"].includes(id) ? "resilience" : "semantic");
  return { id, category, suite, source: options.source ?? "vNext regression", locale: options.locale ?? "ru", text, expected, modelOutput, providerFailure: options.providerFailure ?? null, turnContext: options.turnContext ?? {} };
}

function canonicalIssue(value, text, fallback = "ambiguous_action") {
  if (value && typeof value === "object") return value;
  const reasons = {
    examination_region_missing: "ambiguous_target",
    chemistry_analytes_missing: "missing_required_parameter",
    route_missing: "missing_route",
    infusion_parameters_missing: "missing_required_parameter",
    vague_command: "ambiguous_action",
  };
  return { evidenceSpan: text, reason: reasons[value] ?? fallback };
}

export const WAVE2_SHADOW_CORPUS = Object.freeze([
  fixture("H01", "history", "опрос пациента", [command("TAKE_HISTORY")]),
  fixture("H02", "history", "соберу анамнез", [command("TAKE_HISTORY")]),
  fixture("H03", "history", "расспрошу подробно", [command("TAKE_HISTORY")], { source: "sanitized V3.5 replay" }),
  fixture("H04", "history", "анамнез и осмотр живота", [command("TAKE_HISTORY"), command("EXAMINE", { region: "abdomen" })], { source: "V3.5 semantic-router test" }),

  fixture("E01", "examination", "живот", [command("EXAMINE", { region: "abdomen" })]),
  fixture("E02", "examination", "пальпирую живот", [command("EXAMINE", { region: "abdomen" })], { source: "V3.5 semantic-router test" }),
  fixture("E03", "examination", "живот пасматреть", [command("EXAMINE", { region: "abdomen" })], { source: "V3.5 semantic-router typo" }),
  fixture("E04", "examination", "осмотрю пациента", [command("EXAMINE", {})], { ambiguities: ["examination_region_missing"] }),
  fixture("E05", "examination", "физикалық қарап, анамнез жинаймын", [command("EXAMINE", { region: "general" }), command("TAKE_HISTORY")], { locale: "kk", source: "V3.5 semantic-router test" }),

  fixture("T01", "investigation", "ОАК", [command("ORDER_TEST", { testId: "cbc" })]),
  fixture("T02", "investigation", "СРБ", [command("ORDER_TEST", { testId: "crp" })]),
  fixture("T03", "investigation", "ОАМ", [command("ORDER_TEST", { testId: "urinalysis" })]),
  fixture("T04", "investigation", "ХГЧ", [command("ORDER_TEST", { testId: "betahcg" })]),
  fixture("T05", "investigation", "КТ ОБП", [command("ORDER_TEST", { testId: "ct_abdomen" })]),
  fixture("T06", "investigation", "УЗИ живота", [command("ORDER_TEST", { testId: "ultrasound_abdomen" })]),
  fixture("T07", "investigation", "БХАК", [command("ORDER_TEST", { testId: "chemistry" })], { ambiguities: ["chemistry_analytes_missing"] }),
  fixture("T08", "investigation", "БХАК: креатинин и электролиты", [command("ORDER_TEST", { testId: "chemistry", analytes: ["creatinine", "electrolytes"] })]),
  fixture("T09", "investigation", "ОАК, СРБ и ОАМ", [command("ORDER_TEST", { testId: "cbc" }), command("ORDER_TEST", { testId: "crp" }), command("ORDER_TEST", { testId: "urinalysis" })]),
  fixture("T10", "investigation", "общий анализ крови и КТ живота", [command("ORDER_TEST", { testId: "cbc" }), command("ORDER_TEST", { testId: "ct_abdomen" })], { source: "sanitized V3.5 replay" }),

  fixture("C01", "compound", "опрос, живот, ОАК и КТ ОБП", [command("TAKE_HISTORY"), command("EXAMINE", { region: "abdomen" }), command("ORDER_TEST", { testId: "cbc" }), command("ORDER_TEST", { testId: "ct_abdomen" })]),
  fixture("C02", "compound", "поставлю вену, возьму ОАК и вызову хирурга", [command("ESTABLISH_IV_ACCESS"), command("ORDER_TEST", { testId: "cbc" }), command("CALL_STAFF", { role: "surgeon" })]),
  fixture("C03", "compound", "голод, венозный доступ и осмотр анестезиолога", [command("SET_NPO"), command("ESTABLISH_IV_ACCESS"), command("REQUEST_ANESTHESIA_REVIEW")]),
  fixture("C04", "compound", "в отделение, vitals каждые 4 часа", [command("DISPOSITION", { destination: "surgical_ward" }), command("PRESCRIBE_MONITORING", { targets: ["vitals"], intervalMinutes: 240 })]),
  fixture("C05", "compound", "переоценю боль и витальные через час", [command("REASSESS", { targets: ["pain", "vitals"], afterMinutes: 60 })]),
  fixture("C06", "compound", "ОАК и что-то странное", [command("ORDER_TEST", { testId: "cbc" })], { unresolvedFragments: ["что-то странное"] }),
  fixture("C07", "compound", "думаю аппендицит, исключаю внематочную, ОАК и ХГЧ", [command("ORDER_TEST", { testId: "cbc" }), command("ORDER_TEST", { testId: "betahcg" })], { reasoningDelta: { workingDiagnosis: { stated: true, conceptId: "acute_appendicitis" }, differential: { items: [{ conceptId: "ectopic_pregnancy", status: "active" }] } }, source: "V3.5 reasoning test" }),
  fixture("C08", "compound", "не уверен в диагнозе, но осмотрю живот и закажу ОАК", [command("EXAMINE", { region: "abdomen" }), command("ORDER_TEST", { testId: "cbc" })], { reasoningDelta: { workingDiagnosis: { uncertaintyExpressed: true } } }),

  fixture("M01", "medication", "кетопрофен 100 мг в/м", [command("ORDER_MEDICATION", { drugId: "ketoprofen", dose: "100 мг", doseMg: 100, route: "im" })]),
  fixture("M02", "medication", "парацетамол 1 г в/в", [command("ORDER_MEDICATION", { drugId: "paracetamol", dose: "1 г", doseMg: 1000, route: "iv" })]),
  fixture("M03", "medication", "кетопрофен 100 мг", [command("ORDER_MEDICATION", { drugId: "ketoprofen", dose: "100 мг", doseMg: 100 })], { ambiguities: ["route_missing"] }),
  fixture("M04", "medication", "цефазолин 2", [], { modelOutput: {
    clinicalActions: [{ type: "GIVE_ANTIBIOTIC_PROPHYLAXIS", params: { drugId: "cefazolin", dose: "2 г", doseMg: 2000, route: "iv" }, evidenceSpans: ["цефазолин 2"], statedParameters: ["dose", "dose_unit", "route"] }],
    reasoningDelta: {}, mentorAnswerDelta: {}, patientQuestions: [], ambiguities: [], unresolvedFragments: [],
    meta: { schemaVersion: MODEL_INTERPRETATION_SCHEMA_VERSION, confidence: 0.8 },
  }, source: "non-invention adversarial" }),
  fixture("M05", "medication", "антибиотикопрофилактика цефазолин 2 г в/в", [command("GIVE_ANTIBIOTIC_PROPHYLAXIS", { drugId: "cefazolin", dose: "2 г", doseMg: 2000, route: "iv" })]),
  // «физраствор» names 0.9% NaCl; the original draft label predates the
  // normal_saline concept (relabelled 2026-10-26, linguistic, not clinical).
  fixture("M06", "medication", "физраствор 500 мл за час", [command("ORDER_INFUSION", { fluidId: "normal_saline", volumeMl: 500, durationMinutes: 60 })]),
  fixture("M07", "medication", "прокапаем его нормально", [command("ORDER_INFUSION", {})], { ambiguities: ["infusion_parameters_missing"] }),

  fixture("V01", "vague_or_unsupported", "сделайте что-нибудь", [], { ambiguities: ["vague_command"] }),
  fixture("V02", "vague_or_unsupported", "МРТ живота", [], { unresolvedFragments: [{ evidenceSpan: "МРТ живота", reason: "unsupported_concept" }] }),
  fixture("V03", "vague_or_unsupported", "поставьте центральную линию", [], { unresolvedFragments: [{ evidenceSpan: "поставьте центральную линию", reason: "unsupported_concept" }] }),
  fixture("V04", "vague_or_unsupported", "можно подготовить к потенциальной операции", [], { modelOutput: {
    clinicalActions: [{ type: "COMMIT_MANAGEMENT_PLAN", params: { intent: "operative" }, evidenceSpans: ["можно подготовить к потенциальной операции"], statedParameters: [] }],
    reasoningDelta: {}, mentorAnswerDelta: {}, patientQuestions: [], ambiguities: [], unresolvedFragments: [],
    meta: { schemaVersion: MODEL_INTERPRETATION_SCHEMA_VERSION, confidence: 0.76 },
  }, source: "non-invention adversarial" }),
  fixture("V05", "vague_or_unsupported", "не знаю", [], { mentorAnswerDelta: { stuck: true }, source: "current mentor regression" }),

  fixture("R01", "reasoning", "думаю, это аппендицит", [], reasoning({ workingDiagnosis: { stated: true, conceptId: "acute_appendicitis" } })),
  fixture("R02", "reasoning", "внематочная пока в дифференциале", [], reasoning({ differential: { items: [{ conceptId: "ectopic_pregnancy", status: "active" }] } })),
  fixture("R03", "reasoning", "внематочную считаю менее вероятной", [], reasoning({ differential: { items: [{ conceptId: "ectopic_pregnancy", status: "deprioritized" }] } })),
  fixture("R04", "reasoning", "я исключил внематочную", [], reasoning({ differential: { items: [{ conceptId: "ectopic_pregnancy", status: "ruled_out" }] } })),
  fixture("R05", "reasoning", "пациент стабилен", [], reasoning({ stability: { stated: true, learnerAssessment: "stable" } })),
  fixture("R06", "reasoning", "начинаю наблюдение, повторный осмотр через час", [], reasoning({ observation: { active: true, reassessmentIntervalStated: true } })),
  fixture("R07", "reasoning", "от наблюдения отказываюсь", [], reasoning({ observation: { active: false } })),
  fixture("R08", "reasoning", "рабочий диагноз не уверен", [], reasoning({ workingDiagnosis: { stated: true, uncertaintyExpressed: true } })),

  fixture("P01", "patient_question", "где именно болит?", [command("ASK_PATIENT", { topic: "pain" })], { patientQuestions: [{ topic: "pain", evidence: "где именно болит" }] }),
  fixture("P02", "patient_question", "когда началась боль?", [command("ASK_PATIENT", { topic: "onset" })], { patientQuestions: [{ topic: "onset", evidence: "когда началась боль" }] }),
  fixture("P03", "patient_question", "тошнило или рвало?", [command("ASK_PATIENT", { topic: "nausea_vomiting" })], { patientQuestions: [{ topic: "nausea_vomiting", evidence: "тошнило или рвало" }] }),
  fixture("P04", "patient_question", "когда последний раз ел и пил?", [command("ASK_FASTING_HISTORY")], { patientQuestions: [{ topic: "fasting", evidence: "когда последний раз ел и пил" }] }),

  fixture("A01", "mentor_answer", "сначала оценю стабильность", [], { mentorAnswerDelta: { domains: ["stability"] }, source: "V3.5 mentor-answer pattern", turnContext: { openMentorQuestion: { id: "first-assessment", text: "Что оценишь сначала?", expectedDomains: ["stability"] } } }),
  fixture("A02", "mentor_answer", "потому что нужно исключить опасную альтернативу", [], { mentorAnswerDelta: { domains: ["differential", "rationale"] }, turnContext: { openMentorQuestion: { id: "why-test", text: "Почему нужен этот тест?", expectedDomains: ["differential", "rationale"] } } }),
  fixture("A03", "provider_failure", "ОАК", [command("ORDER_TEST", { testId: "cbc" })], { providerFailure: "timeout" }),
  fixture("A04", "schema_failure", "живот", [command("EXAMINE", { region: "abdomen" })], { modelOutput: { clinicalActions: [] } }),
  fixture("A05", "english_sanity", "check the abdomen and CBC", [command("EXAMINE", { region: "abdomen" }), command("ORDER_TEST", { testId: "cbc" })], { locale: "en", source: "sanity fixture" }),
]);

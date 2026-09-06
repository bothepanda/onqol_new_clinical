const action = (type, params, evidenceSpans) => ({ type, params, evidenceSpans });

const fixture = (id, category, text, options = {}) => Object.freeze({
  id,
  category,
  locale: options.locale ?? "ru",
  text,
  source: options.source ?? "new Wave 2.2 holdout wording",
  turnContext: Object.freeze(options.turnContext ?? {}),
  expected: Object.freeze({
    commands: Object.freeze(options.actions ?? []),
    reasoningDomains: Object.freeze(options.reasoningDomains ?? []),
    patientQuestionTopics: Object.freeze(options.patientQuestionTopics ?? []),
    mentorAnswerDomains: Object.freeze(options.mentorAnswerDomains ?? []),
    ambiguities: Object.freeze(options.ambiguities ?? []),
    unresolvedFragments: Object.freeze(options.unresolvedFragments ?? []),
  }),
});

export const WAVE22_HOLDOUT_METADATA = Object.freeze({
  corpusId: "wave22-holdout-2026-08-29.1",
  frozenBeforeInterpreterRevision: true,
  frozenAt: "2026-08-29T00:00:00+05:00",
  fixtureCount: 30,
  purpose: "unseen final evaluation only; never use for prompt or schema tuning",
});

export const WAVE22_HOLDOUT_CORPUS = Object.freeze([
  fixture("HO-H01", "history", "давайте сперва нормально расспросим", {
    actions: [action("TAKE_HISTORY", {}, ["расспросим"])],
    source: "behavioral wording adapted from an unused legacy-session pattern",
  }),
  fixture("HO-H02", "history", "соберу жалобы и историю этой боли", {
    actions: [action("TAKE_HISTORY", {}, ["соберу жалобы и историю этой боли"])],
  }),

  fixture("HO-E01", "examination", "пощупаю живот, особенно справа внизу", {
    actions: [action("EXAMINE", { region: "abdomen" }, ["пощупаю живот"])],
  }),
  fixture("HO-E02", "examination", "быстро осматрю её целиком", {
    actions: [action("EXAMINE", { region: "general" }, ["осматрю её целиком"])],
  }),

  fixture("HO-T01", "investigation", "дайте общий анализ крови", {
    actions: [action("ORDER_TEST", { testId: "cbc" }, ["общий анализ крови"])],
  }),
  fixture("HO-T02", "investigation", "нужны моча и бета-ХГЧ", {
    actions: [
      action("ORDER_TEST", { testId: "urinalysis" }, ["моча"]),
      action("ORDER_TEST", { testId: "betahcg" }, ["бета-ХГЧ"]),
    ],
  }),
  fixture("HO-T03", "investigation", "закажу биохимию: креатинин, электролиты", {
    actions: [action("ORDER_TEST", { testId: "chemistry", analytes: ["creatinine", "electrolytes"] }, ["биохимию: креатинин, электролиты"])],
  }),

  fixture("HO-C01", "compound", "расспрошу, осмотрю живот и возьму ОАК", {
    actions: [
      action("TAKE_HISTORY", {}, ["расспрошу"]),
      action("EXAMINE", { region: "abdomen" }, ["осмотрю живот"]),
      action("ORDER_TEST", { testId: "cbc" }, ["ОАК"]),
    ],
  }),
  fixture("HO-C02", "compound", "вену поставьте, пациенту ничего не есть и позовите хирурга", {
    actions: [
      action("ESTABLISH_IV_ACCESS", {}, ["вену поставьте"]),
      action("SET_NPO", {}, ["ничего не есть"]),
      action("CALL_STAFF", { role: "surgeon" }, ["позовите хирурга"]),
    ],
  }),
  fixture("HO-C03", "compound", "проверю живот, ОАК, СРБ, потом уточню когда началась боль", {
    actions: [
      action("EXAMINE", { region: "abdomen" }, ["проверю живот"]),
      action("ORDER_TEST", { testId: "cbc" }, ["ОАК"]),
      action("ORDER_TEST", { testId: "crp" }, ["СРБ"]),
      action("ASK_PATIENT", { topic: "onset" }, ["когда началась боль"]),
    ],
    patientQuestionTopics: ["onset"],
  }),
  fixture("HO-C04", "compound", "парацетамол 1 г внутривенно и переоценить боль через 30 минут", {
    actions: [
      action("ORDER_MEDICATION", { drugId: "paracetamol", dose: "1 г", doseMg: 1000, route: "iv" }, ["парацетамол 1 г внутривенно"]),
      action("REASSESS", { targets: ["pain"], afterMinutes: 30 }, ["переоценить боль через 30 минут"]),
    ],
  }),
  fixture("HO-C05", "compound", "думаю про аппендицит; сделайте УЗИ живота и ОАК", {
    actions: [
      action("ORDER_TEST", { testId: "ultrasound_abdomen" }, ["УЗИ живота"]),
      action("ORDER_TEST", { testId: "cbc" }, ["ОАК"]),
    ],
    reasoningDomains: ["workingDiagnosis"],
  }),

  fixture("HO-P01", "patient_question", "где сейчас болит сильнее всего?", {
    actions: [action("ASK_PATIENT", { topic: "pain" }, ["где сейчас болит сильнее всего"])] ,
    patientQuestionTopics: ["pain"],
  }),
  fixture("HO-P02", "patient_question", "аллергия на лекарства есть?", {
    actions: [action("ASK_PATIENT", { topic: "allergies" }, ["аллергия на лекарства есть"])],
    patientQuestionTopics: ["allergies"],
  }),
  fixture("HO-P03", "patient_question", "что уже принимали от боли?", {
    actions: [action("ASK_PATIENT", { topic: "medications" }, ["что уже принимали от боли"])],
    patientQuestionTopics: ["medications"],
  }),

  fixture("HO-R01", "reasoning", "больше всего похоже на острый аппендицит", {
    reasoningDomains: ["workingDiagnosis"],
  }),
  fixture("HO-R02", "reasoning", "внематочная всё ещё возможна, не снимаю её", {
    reasoningDomains: ["differential"],
  }),
  fixture("HO-R03", "reasoning", "если станет хуже, пересмотрю тактику", {
    reasoningDomains: ["contingency"],
  }),

  fixture("HO-A01", "mentor_answer", "падение давления или резкое усиление боли", {
    mentorAnswerDomains: ["contingency"],
    turnContext: { openMentorQuestion: { id: "change-plan", text: "Что заставит тебя поменять план?", expectedDomains: ["contingency"] } },
  }),
  fixture("HO-A02", "mentor_answer", "боль, давление, температуру и пульс", {
    mentorAnswerDomains: ["observation_targets"],
    reasoningDomains: ["observation"],
    turnContext: { openMentorQuestion: { id: "observe-what", text: "Что именно наблюдаешь?", expectedDomains: ["observation_targets"] } },
  }),
  fixture("HO-A03", "mentor_answer", "чтобы не пропустить ухудшение", {
    mentorAnswerDomains: ["rationale"],
    turnContext: { openMentorQuestion: { id: "why-reassess", text: "Зачем нужна повторная оценка?", expectedDomains: ["rationale"] } },
  }),

  fixture("HO-V01", "vague_or_unsupported", "сделайте нормальную диагностику", {
    ambiguities: [{ evidenceSpan: "нормальную диагностику", reason: "ambiguous_action" }],
  }),
  fixture("HO-V02", "vague_or_unsupported", "ПЭТ-КТ брюшной полости", {
    unresolvedFragments: [{ evidenceSpan: "ПЭТ-КТ брюшной полости", reason: "unsupported_concept" }],
  }),
  fixture("HO-V03", "vague_or_unsupported", "поставим артериальный катетер", {
    unresolvedFragments: [{ evidenceSpan: "поставим артериальный катетер", reason: "unsupported_concept" }],
  }),
  fixture("HO-V04", "vague_or_unsupported", "что-нибудь для боли", {
    ambiguities: [{ evidenceSpan: "что-нибудь для боли", reason: "ambiguous_target" }],
  }),
  fixture("HO-V05", "vague_or_unsupported", "давайте по стандарту", {
    ambiguities: [{ evidenceSpan: "по стандарту", reason: "ambiguous_action" }],
  }),

  fixture("HO-M01", "tentative_management", "возможно, потом понадобится операция", {
    reasoningDomains: ["management"],
    ambiguities: [{ evidenceSpan: "возможно, потом понадобится операция", reason: "tentative_not_committed" }],
  }),
  fixture("HO-M02", "tentative_management", "можно рассмотреть перевод в другой стационар", {
    reasoningDomains: ["disposition"],
    ambiguities: [{ evidenceSpan: "можно рассмотреть перевод в другой стационар", reason: "tentative_not_committed" }],
  }),
  fixture("HO-M03", "tentative_management", "если потребуется, установим дренаж", {
    reasoningDomains: ["management"],
    ambiguities: [{ evidenceSpan: "если потребуется, установим дренаж", reason: "tentative_not_committed" }],
  }),
  fixture("HO-M04", "tentative_management", "перевожу в хирургическое отделение", {
    actions: [action("DISPOSITION", { destination: "surgical_ward" }, ["перевожу в хирургическое отделение"])],
  }),
]);

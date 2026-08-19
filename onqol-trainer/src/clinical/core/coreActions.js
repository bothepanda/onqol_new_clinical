// Universal clinical action library.
//
// These are the actions a competent surgeon performs regardless of nosology:
// consent, team notification, escalation, hand-over, documentation. Before this
// library existed they could not exist anywhere, because the router vocabulary
// was built from a single disease case file, so a learner saying
// "предупрежу анестезиолога" produced `unknown` and the trainer stayed silent.
//
// Scoring discipline: every core action ships with `eligible_for_scoring: false`.
// The trainer recognises the action, talks about it, and uses it in the
// prerequisite graph from day one, but it does not move the score until a
// clinician signs the weight off. This mirrors how the repository already
// handles operationalized transfer/source-control rules.
//
// Locale: `accepted_phrasings` are Russian only. Kazakh surgical phrasing is a
// separate reviewed workstream (see MVP-akselerator.md section 6); inventing it
// here would put unreviewed clinical language into the router.

const NOT_SCOREABLE_UNTIL_REVIEW =
  "NEEDS_CLINICAL_REVIEW: weight and criticality not yet signed off by a reviewer.";

/**
 * @typedef {Object} CoreAction
 * @property {string} id
 * @property {"alternative"|"unsafe"} bucket  Target bucket when composed into a case.
 * @property {string[]} evidence_reference_ids
 * @property {Object} [escalation_policy]  Context rules for appropriateness scoring.
 */

/** @type {CoreAction[]} */
export const coreActions = [
  // --- Периоперационная безопасность ------------------------------------
  {
    id: "informed_consent",
    bucket: "alternative",
    core: true,
    phase: "management",
    concept: "informed consent",
    intent_type: "management",
    router_description:
      "obtaining informed consent, explaining the proposed operation, its risks and alternatives to the patient",
    accepted_phrasings: [
      "информированное согласие",
      "согласие на операцию",
      "подписать согласие",
      "объясню риски",
      "объясню пациенту операцию",
      "обсужу альтернативы",
    ],
    importance: "important",
    score_weight: 0,
    penalty: 0,
    domain: "Patient safety",
    critical: false,
    time_window: "before_operation",
    prerequisites: [],
    eligible_for_scoring: false,
    review_status: NOT_SCOREABLE_UNTIL_REVIEW,
    feedback_if_done:
      "Согласие получено до операции: пациенту объяснены предполагаемое вмешательство, риски и альтернативы.",
    feedback_if_missed:
      "Информированное согласие не прозвучало. По объективу безопасной хирургии ВОЗ подтверждение согласия предшествует индукции анестезии.",
    evidence_reference_ids: ["who-safe-surgery-consent", "who-ssc-sign-in"],
  },
  {
    id: "notify_anesthesia",
    bucket: "alternative",
    core: true,
    phase: "management",
    concept: "notify anaesthesia team",
    intent_type: "management",
    router_description:
      "informing or calling the anaesthesiologist, requesting anaesthesia assessment before an operation",
    accepted_phrasings: [
      "предупредить анестезиолога",
      "вызвать анестезиолога",
      "сообщить анестезиологу",
      "анестезиолог осмотрит",
      "поднять анестезиолога",
      "консультация анестезиолога",
    ],
    importance: "important",
    score_weight: 0,
    penalty: 0,
    domain: "Patient safety",
    critical: false,
    time_window: "before_operation",
    prerequisites: [],
    eligible_for_scoring: false,
    review_status: NOT_SCOREABLE_UNTIL_REVIEW,
    feedback_if_done:
      "Анестезиологическая служба оповещена заранее: оценка риска и подготовка идут параллельно, а не после подачи в операционную.",
    feedback_if_missed:
      "Анестезиолог не был оповещён. Проверка анестезиологической безопасности входит в Sign In и требует времени до индукции.",
    evidence_reference_ids: ["who-ssc-sign-in"],
  },
  {
    id: "notify_operating_team",
    bucket: "alternative",
    core: true,
    phase: "management",
    concept: "notify operating theatre team",
    intent_type: "management",
    router_description:
      "informing the operating theatre, scrub team or on-call surgical staff that a case is coming",
    accepted_phrasings: [
      "предупредить операционную",
      "поднять операционную бригаду",
      "сообщить операционной сестре",
      "готовить операционную",
      "вызвать бригаду",
    ],
    importance: "supporting",
    score_weight: 0,
    penalty: 0,
    domain: "Patient safety",
    critical: false,
    time_window: "before_operation",
    prerequisites: [],
    eligible_for_scoring: false,
    review_status: NOT_SCOREABLE_UNTIL_REVIEW,
    feedback_if_done: "Операционная бригада оповещена, время на развёртывание учтено.",
    feedback_if_missed:
      "Готовность операционной не была организована отдельным действием — на низком уровне ресурса это часть тайминга решения.",
    evidence_reference_ids: ["who-ssc-time-out"],
  },
  {
    id: "who_sign_in",
    bucket: "alternative",
    core: true,
    phase: "management",
    concept: "WHO Sign In before induction",
    intent_type: "management",
    router_description:
      "performing WHO Sign In before induction of anaesthesia",
    accepted_phrasings: [
      "sign in",
      "чек-лист до индукции",
      "чек лист перед наркозом",
      "проверка до анестезии",
    ],
    importance: "important",
    score_weight: 0,
    penalty: 0,
    domain: "Patient safety",
    critical: false,
    time_window: "before_induction",
    prerequisites: [],
    eligible_for_scoring: false,
    review_status: NOT_SCOREABLE_UNTIL_REVIEW,
    feedback_if_done: "Sign In выполнен до индукции анестезии.",
    feedback_if_missed:
      "Sign In до индукции анестезии не зафиксирован.",
    evidence_reference_ids: ["who-ssc-sign-in"],
  },
  {
    id: "who_time_out",
    bucket: "alternative",
    core: true,
    phase: "management",
    concept: "WHO Time Out before incision",
    intent_type: "management",
    router_description: "performing WHO Time Out with the operating team before skin incision",
    accepted_phrasings: [
      "time out",
      "тайм-аут",
      "чек-лист перед разрезом",
      "командная проверка перед разрезом",
    ],
    importance: "important",
    score_weight: 0,
    penalty: 0,
    domain: "Patient safety",
    critical: false,
    time_window: "before_incision",
    prerequisites: [],
    eligible_for_scoring: false,
    review_status: NOT_SCOREABLE_UNTIL_REVIEW,
    feedback_if_done: "Time Out выполнен командой до разреза.",
    feedback_if_missed: "Time Out до разреза не зафиксирован.",
    evidence_reference_ids: ["who-ssc-time-out"],
  },
  {
    id: "who_sign_out",
    bucket: "alternative",
    core: true,
    phase: "postoperative care",
    concept: "WHO Sign Out before leaving theatre",
    intent_type: "management",
    router_description:
      "performing WHO Sign Out before the patient leaves the operating theatre",
    accepted_phrasings: [
      "sign out",
      "чек-лист перед выходом из операционной",
      "проверка перед выездом из операционной",
      "закрывающий чек-лист операции",
    ],
    importance: "important",
    score_weight: 0,
    penalty: 0,
    domain: "Patient safety",
    critical: false,
    time_window: "before_leaving_theatre",
    prerequisites: [],
    eligible_for_scoring: false,
    review_status: NOT_SCOREABLE_UNTIL_REVIEW,
    feedback_if_done: "Sign Out выполнен до выхода пациента из операционной.",
    feedback_if_missed: "Sign Out перед выходом из операционной не зафиксирован.",
    evidence_reference_ids: ["who-ssc-sign-out"],
  },
  {
    id: "preop_risk_assessment",
    bucket: "alternative",
    core: true,
    phase: "management",
    concept: "preoperative risk and comorbidity assessment",
    intent_type: "management",
    router_description:
      "preoperative risk assessment, comorbidity review, ASA class, cardiac or respiratory risk before surgery",
    accepted_phrasings: [
      "оценка операционного риска",
      "сопутствующие заболевания",
      "коморбидность",
      "asa",
      "предоперационная оценка",
      "аллергологический анамнез",
    ],
    importance: "important",
    score_weight: 0,
    penalty: 0,
    domain: "Patient safety",
    critical: false,
    time_window: "before_operation",
    prerequisites: [],
    eligible_for_scoring: false,
    review_status: NOT_SCOREABLE_UNTIL_REVIEW,
    feedback_if_done: "Операционный риск и сопутствующая патология оценены до вмешательства.",
    feedback_if_missed: "Предоперационная оценка риска и сопутствующей патологии не прозвучала.",
    evidence_reference_ids: ["eras-emergency-laparotomy-prehab"],
  },
  {
    id: "vte_risk_assessment",
    bucket: "alternative",
    core: true,
    phase: "management",
    concept: "venous thromboembolism risk assessment",
    intent_type: "management",
    router_description:
      "assessing venous thromboembolism risk and deciding on thromboprophylaxis",
    accepted_phrasings: [
      "тромбопрофилактика",
      "профилактика тромбоэмболии",
      "риск тэла",
      "вте",
      "компрессионный трикотаж",
      "низкомолекулярный гепарин",
    ],
    importance: "supporting",
    score_weight: 0,
    penalty: 0,
    domain: "Patient safety",
    critical: false,
    time_window: "before_operation",
    prerequisites: [],
    eligible_for_scoring: false,
    review_status:
      "NEEDS_CLINICAL_REVIEW: agent and dosing must come from a Kazakhstan formulary layer, not from this library.",
    feedback_if_done: "Риск венозной тромбоэмболии оценён и решение о профилактике принято.",
    feedback_if_missed: "Оценка риска венозной тромбоэмболии не прозвучала.",
    evidence_reference_ids: ["eras-emergency-laparotomy-prehab"],
  },
  {
    id: "vital_signs_reassessment",
    bucket: "alternative",
    core: true,
    phase: "initial assessment",
    concept: "vital signs monitoring and reassessment",
    intent_type: "request_examination",
    router_description:
      "rechecking vital signs, monitoring haemodynamics, repeating observations over time",
    accepted_phrasings: [
      "повторю витальные",
      "контроль гемодинамики",
      "мониторинг",
      "перемерю давление",
      "контроль чсс",
      "динамика витальных",
    ],
    importance: "supporting",
    score_weight: 0,
    penalty: 0,
    domain: "Prioritization",
    critical: false,
    time_window: "any",
    prerequisites: [],
    eligible_for_scoring: false,
    review_status: NOT_SCOREABLE_UNTIL_REVIEW,
    feedback_if_done: "Витальные показатели переоценены в динамике.",
    feedback_if_missed: "Повторной оценки витальных показателей в динамике не было.",
    evidence_reference_ids: ["eras-emergency-laparotomy-prehab"],
  },

  {
    // Gap found by checking the library against the Fiser ABSITE contents,
    // chapter 16 Critical Care: recognising SIRS/sepsis is a competence every
    // emergency surgical case needs, and no disease card carried it.
    id: "recognize_sepsis",
    bucket: "alternative",
    core: true,
    phase: "diagnostic reasoning",
    concept: "recognise sepsis or systemic inflammatory response",
    intent_type: "diagnosis",
    router_description:
      "recognising sepsis, septic shock, systemic inflammatory response or organ dysfunction in a surgical patient",
    accepted_phrasings: [
      "сепсис",
      "признаки сепсиса",
      "септический шок",
      "ссво",
      "sirs",
      "qsofa",
      "органная дисфункция",
      "системная воспалительная реакция",
    ],
    importance: "important",
    score_weight: 0,
    penalty: 0,
    domain: "Patient safety",
    critical: false,
    time_window: "any",
    prerequisites: [],
    eligible_for_scoring: false,
    review_status: NOT_SCOREABLE_UNTIL_REVIEW,
    feedback_if_done:
      "Системный ответ на инфекцию оценён отдельно от локальной картины — это меняет срочность контроля источника.",
    feedback_if_missed:
      "Оценка системного ответа не прозвучала. При внутрибрюшной инфекции признаки органной дисфункции меняют сроки вмешательства.",
    evidence_reference_ids: ["wses-iai-2021-sepsis"],
  },

  // --- Эскалация и границы компетентности --------------------------------
  {
    id: "call_senior_surgeon",
    bucket: "alternative",
    core: true,
    phase: "management",
    concept: "escalate to senior surgeon",
    intent_type: "management",
    router_description:
      "calling the senior or on-call consultant surgeon for help, advice or supervision",
    accepted_phrasings: [
      "позову старшего",
      "вызову заведующего",
      "приглашу более опытного",
      "доложу старшему",
      "позвоню дежурному хирургу",
      "нужна помощь старшего",
    ],
    importance: "important",
    score_weight: 0,
    penalty: 0,
    domain: "Professionalism and escalation",
    critical: false,
    time_window: "any",
    prerequisites: [],
    eligible_for_scoring: false,
    review_status: NOT_SCOREABLE_UNTIL_REVIEW,
    escalation_policy: {
      // Appropriateness is contextual, not absolute. Calling for help after
      // doing the available minimum is maturity; calling instead of doing it
      // is avoidance. The case declares what its minimum is.
      requires_minimum_assessment: true,
      appropriate_feedback:
        "Вызов старшего после выполненного доступного минимума — это зрелое поведение, а не слабость. Знать границы своей компетентности и вовремя их назвать — рабочий навык.",
      premature_feedback:
        "Вызов старшего здесь опередил доступную тебе оценку. Старшему нужна твоя картина: что уже сделано и что именно тебя остановило.",
    },
    feedback_if_done: "Эскалация выполнена и обозначена явно.",
    feedback_if_missed: "Возможности привлечь старшего коллегу в разборе не прозвучало.",
    evidence_reference_ids: ["base-clinical-limits-of-competence", "who-handover-sbar"],
  },
  {
    id: "call_intensive_care",
    bucket: "alternative",
    core: true,
    phase: "management",
    concept: "escalate to intensive care or anaesthesia for an unstable patient",
    intent_type: "management",
    router_description:
      "calling intensive care, resuscitation team or anaesthesia for an unstable or deteriorating patient",
    accepted_phrasings: [
      "позову реаниматолога",
      "вызову реанимацию",
      "перевод в орит",
      "реанимационная бригада",
      "нужен реаниматолог",
    ],
    importance: "important",
    score_weight: 0,
    penalty: 0,
    domain: "Professionalism and escalation",
    critical: false,
    time_window: "any",
    prerequisites: [],
    eligible_for_scoring: false,
    review_status: NOT_SCOREABLE_UNTIL_REVIEW,
    escalation_policy: {
      requires_minimum_assessment: false,
      appropriate_feedback:
        "Привлечение реанимационной службы при нестабильности — правильный и своевременный шаг.",
      premature_feedback:
        "Пациент по имеющимся данным стабилен. Назови, какой именно параметр заставляет тебя думать о реанимационной поддержке.",
    },
    feedback_if_done: "Реанимационная служба привлечена.",
    feedback_if_missed: "Привлечение реанимационной службы не обсуждалось.",
    evidence_reference_ids: ["base-clinical-limits-of-competence"],
  },
  {
    id: "declare_uncertainty",
    bucket: "alternative",
    core: true,
    phase: "diagnostic reasoning",
    concept: "explicitly declare diagnostic or management uncertainty",
    intent_type: "diagnosis",
    router_description:
      "the learner explicitly states they are unsure, do not know what to do next, or names what data they are missing",
    accepted_phrasings: [
      "я не знаю",
      "не уверен",
      "не уверена",
      "затрудняюсь",
      "мне не хватает данных",
      "не понимаю что дальше",
      "сомневаюсь",
    ],
    importance: "supporting",
    score_weight: 0,
    penalty: 0,
    domain: "Professionalism and escalation",
    critical: false,
    time_window: "any",
    prerequisites: [],
    eligible_for_scoring: false,
    review_status: NOT_SCOREABLE_UNTIL_REVIEW,
    feedback_if_done:
      "Неопределённость названа явно — это делает рассуждение проверяемым и позволяет помочь точечно.",
    feedback_if_missed: "",
    evidence_reference_ids: ["base-clinical-uncertainty-disclosure"],
  },
  {
    id: "structured_handover",
    bucket: "alternative",
    core: true,
    phase: "management",
    concept: "structured clinical hand-over",
    intent_type: "management",
    router_description:
      "giving a structured hand-over or referral summary to another clinician, SBAR-style report",
    accepted_phrasings: [
      "доложу по sbar",
      "передам смену",
      "структурированный доклад",
      "передача пациента",
      "доложу ситуацию",
    ],
    importance: "supporting",
    score_weight: 0,
    penalty: 0,
    domain: "Professionalism and escalation",
    critical: false,
    time_window: "any",
    prerequisites: [],
    eligible_for_scoring: false,
    review_status: NOT_SCOREABLE_UNTIL_REVIEW,
    feedback_if_done: "Передача выполнена структурно: ситуация, фон, оценка, предложение.",
    feedback_if_missed: "Структура передачи информации другому врачу не прозвучала.",
    evidence_reference_ids: ["who-handover-sbar", "base-closed-loop-communication"],
  },
  {
    id: "postoperative_reassessment",
    bucket: "alternative",
    core: true,
    phase: "postoperative care",
    concept: "structured postoperative reassessment",
    intent_type: "request_examination",
    router_description:
      "a structured postoperative review covering observations, pain, abdomen, urine output, oral intake, bowel recovery, wound and active problems",
    accepted_phrasings: [
      "послеоперационный осмотр",
      "осмотр на следующий день",
      "обход после операции",
      "оценю восстановление после операции",
      "проверю боль живот диурез питание и рану",
    ],
    importance: "important",
    score_weight: 0,
    penalty: 0,
    domain: "Patient safety",
    critical: false,
    time_window: "after_source_control",
    prerequisites: [],
    eligible_for_scoring: false,
    review_status:
      "NEEDS_CLINICAL_REVIEW: runtime records the learner's structured review; no unreviewed postoperative values or recovery thresholds are generated.",
    feedback_if_done: "Послеоперационная переоценка зафиксирована как отдельный этап.",
    feedback_if_missed: "Послеоперационная переоценка перед выпиской не зафиксирована.",
    evidence_reference_ids: [],
  },
  {
    id: "discharge_and_followup",
    bucket: "alternative",
    core: true,
    phase: "disposition",
    concept: "discharge plan, follow-up and return precautions",
    intent_type: "management",
    router_description:
      "declaring discharge readiness, medication reconciliation, instructions, follow-up and explicit return precautions after treatment",
    accepted_phrasings: [
      "план выписки",
      "выпишу с рекомендациями",
      "критерии возврата",
      "когда обратиться повторно",
      "контроль после выписки",
      "наблюдение по месту жительства",
    ],
    importance: "important",
    score_weight: 0,
    penalty: 0,
    domain: "Patient safety",
    critical: false,
    time_window: "after_postoperative_reassessment",
    prerequisites: [],
    eligible_for_scoring: false,
    review_status:
      "NEEDS_CLINICAL_REVIEW: the engine validates pathway order only; disease-specific recovery criteria, medicines and follow-up intervals remain unauthored.",
    feedback_if_done: "План выписки, наблюдения и возврата за помощью зафиксирован.",
    feedback_if_missed: "Без плана наблюдения и критериев возврата стабильный путь не завершён.",
    evidence_reference_ids: [],
  },

  // --- Коммуникация и документация ---------------------------------------
  {
    id: "explain_to_patient",
    bucket: "alternative",
    core: true,
    phase: "management",
    concept: "explain the situation to the patient",
    intent_type: "management",
    router_description:
      "explaining the working diagnosis, the plan or the waiting time to the patient or family",
    accepted_phrasings: [
      "объясню пациентке",
      "объясню пациенту",
      "поговорю с родственниками",
      "расскажу что происходит",
      "информирую семью",
    ],
    importance: "supporting",
    score_weight: 0,
    penalty: 0,
    domain: "Professionalism and escalation",
    critical: false,
    time_window: "any",
    prerequisites: [],
    eligible_for_scoring: false,
    review_status: NOT_SCOREABLE_UNTIL_REVIEW,
    feedback_if_done: "Пациент проинформирован о происходящем и о плане.",
    feedback_if_missed: "Разговор с пациентом о плане в разборе не прозвучал.",
    evidence_reference_ids: ["who-safe-surgery-consent"],
  },
  {
    id: "document_decision",
    bucket: "alternative",
    core: true,
    phase: "management",
    concept: "document the clinical decision and its rationale",
    intent_type: "management",
    router_description:
      "writing the decision, its rationale or the timeline into the medical record",
    accepted_phrasings: [
      "запишу в историю",
      "документирую решение",
      "оформлю запись",
      "зафиксирую в карте",
      "внесу в историю болезни",
    ],
    importance: "supporting",
    score_weight: 0,
    penalty: 0,
    domain: "Professionalism and escalation",
    critical: false,
    time_window: "any",
    prerequisites: [],
    eligible_for_scoring: false,
    review_status: NOT_SCOREABLE_UNTIL_REVIEW,
    feedback_if_done: "Решение и его обоснование зафиксированы в документации.",
    feedback_if_missed: "Фиксация решения и его обоснования в документации не прозвучала.",
    evidence_reference_ids: ["who-handover-sbar"],
  },
];

export const coreActionsById = new Map(coreActions.map((action) => [action.id, action]));

/**
 * Core actions that a case may attach as prerequisites to an operative action.
 * Severity is advisory here: the engine records a warning, the mentor layer
 * decides whether to stop the learner. Nothing in this list blocks by itself.
 */
export const operativePrerequisites = [
  { action_id: "informed_consent", severity: "blocking", reason_id: "consent_not_obtained" },
  { action_id: "notify_anesthesia", severity: "blocking", reason_id: "anaesthesia_not_notified" },
  { action_id: "preop_risk_assessment", severity: "advisory", reason_id: "risk_not_assessed" },
  { action_id: "notify_operating_team", severity: "advisory", reason_id: "theatre_not_notified" },
];

// The WHO checkpoints are NOT here, by the owner's decision of 20.08.2026
// (CDR-18). Sign In, Time Out and Sign Out are run in theatre, largely by the
// nursing team; gating a resident's path on their reciting the words taught the
// password, not the medicine, and it is what ended replay 91ba7206. What the
// checkpoints are actually about - consent, the anaesthetist, a ready team - is
// gated above, on its own terms. The three actions remain performable and
// recordable; they simply stop blocking anything.

/**
 * Domains introduced by the core library that may not exist in a disease case.
 */
export const coreDomains = ["Professionalism and escalation"];

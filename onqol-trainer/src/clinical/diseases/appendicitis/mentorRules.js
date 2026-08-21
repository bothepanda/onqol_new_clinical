// Appendicitis-specific mentor coaching.
//
// The core library (core/mentorHeuristics.js) describes reasoning patterns and
// may name only core-library action ids or intent types. Anything that names an
// id owned by this disease card belongs here, and travels with the case as
// `caseData.mentor_rules`.
//
// The split matters for a concrete reason. Before it, a universal rule asserted
// "УЗИ ОБП и ОМТ всегда перед КТ" for every patient and every nosology. That is
// a disease-level sequence at best, and as a universal law it would be wrong the
// moment a second disease arrived. What is portable is the question the core now
// asks instead: what clinical question does this scan answer.
//
// Same discipline as core: expert opinion, labelled as such, never scoreable
// until a reviewer signs it off.

import { HINT, SEVERITY } from "../../core/mentorHeuristics.js";

const AUTHORED = "EXPERT_OPINION_UNREVIEWED";

/** @type {import("../../core/mentorHeuristics.js").MentorHeuristic[]} */
export const appendicitisMentorRules = [
  {
    // Analgesia is a general emergency-surgery principle, but `analgesia` is an
    // id owned by this case, so the rule lives here. If the action is ever
    // promoted into the core library, move this rule to core unchanged.
    id: "appendicitis_analgesia_withheld",
    type: "outstanding_priority",
    severity: SEVERITY.REASONING_ERROR,
    hint_level: HINT.OPEN,
    lifecycle: "standing_risk",
    escalate_before: ["appendectomy_procedure_start"],
    escalation_severity: SEVERITY.REASONING_ERROR,
    escalation_hint_level: HINT.EXPLICIT,
    escalation_mentor_line:
      "До начала операции обезболивание всё ещё не назначено. Назови препарат и путь введения.",
    spec_section: "9. Management must follow diagnosis",
    disease: "appendicitis",
    when: {
      not_completed: ["analgesia"],
      completed: ["abdominal_exam"],
      min_turn: 2,
    },
    // The author's own wording was "Пациент жалуется на крайне сильную боль,
    // может стоит помочь?" - which asserts a patient state the mentor channel is
    // not allowed to know. Same intent, stated as an omission instead.
    mentor_line: "Живот осмотрен, а обезболивание так и не назначено. Может, стоит помочь?",
    expected_answer_domains: ["current_decision"],
    debrief_line_ru:
      "Обезболивание не было назначено, а его отсрочка не была обоснована.",
    rationale_for_reviewer:
      "Автор: «да, пациент не должен страдать, надо обезболить; после осмотра — можно». Убеждение, что анальгетик «смажет картину», не подтверждается. ОТКРЫТО: исходная формулировка автора называла силу боли; переписано, чтобы не утверждать факт о пациенте.",
    provenance: AUTHORED,
    eligible_for_scoring: false,
  },
  {
    id: "appendicitis_handover_omits_analgesia",
    type: "outstanding_priority",
    severity: SEVERITY.MINOR_GAP,
    hint_level: HINT.EXPLICIT,
    spec_section: "22. Consultation and escalation",
    disease: "appendicitis",
    when: {
      attempted: ["call_senior_surgeon"],
      completed: ["analgesia"],
    },
    mentor_line:
      "Когда докладываешь старшему — скажи, какой была боль при поступлении, чем обезболено, в какой дозе и сколько раз. Иначе старший увидит другого пациента, а не твоего.",
    debrief_line_ru:
      "В передаче не были названы обезболивание и его эффект.",
    rationale_for_reviewer:
      "Автор: «если после обезбола вызывается старший, то резидент должен доложить о степени боли при поступлении и что сделали обезбол (и дозу/кратность/препарат)». Обезболенный живот выглядит иначе — принимающий врач должен знать, что смотрит на пролеченную картину.",
    provenance: AUTHORED,
    eligible_for_scoring: false,
  },
  {
    // The disease-specific half of premature closure. Core notices that no
    // dangerous alternative was reasoned about at all; this notices which one
    // matters in this patient profile.
    id: "appendicitis_ectopic_not_excluded",
    type: "outstanding_priority",
    severity: SEVERITY.IMPORTANT_OMISSION,
    hint_level: HINT.FOCUSED,
    lifecycle: "standing_risk",
    escalate_before: ["appendectomy_procedure_start"],
    escalation_severity: SEVERITY.IMPORTANT_OMISSION,
    escalation_hint_level: HINT.EXPLICIT,
    escalation_mentor_line:
      "До начала операции закрой опасную альтернативу: внематочная беременность исключена или нет?",
    spec_section: "5. Working diagnosis and dangerous alternatives",
    disease: "appendicitis",
    when: {
      completed: ["diagnosis_acute_appendicitis"],
      not_completed: ["pregnancy_test", "differential_ectopic"],
    },
    mentor_line:
      "Прежде чем идти дальше с этим диагнозом — что в этом случае обязательно нужно исключить, и чем именно?",
    expected_answer_domains: ["current_decision"],
    debrief_line_ru:
      "Внематочная беременность не была исключена явно.",
    rationale_for_reviewer:
      "У пациентки репродуктивного возраста внематочная беременность — то, что нельзя пропустить, и это свойство профиля пациента, а не универсальное правило. Формулировка не называет альтернативу вслух: подсказка уровня 3, а не готовый ответ.",
    provenance: AUTHORED,
    eligible_for_scoring: false,
  },
];

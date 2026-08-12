// The sixteen patient-path states, CLAUDE_CODE_ONQOL_V3_5_ADDENDUM.md 6.
//
// The stable learner path is consumed by v35/runtimePath.js. The three
// complication states remain explicitly faculty-preview until their clinical
// modules are authored; they cannot be selected in learner mode.
//
// `mentor_focus_ru` is copied from addendum 8.2 where that table names the
// stage. Where it does not, the field is absent rather than invented - a mentor
// question is authored clinical content like any other.

/** @type {string[]} Canonical order. Addendum 6, verbatim. */
export const PATH_STATE_IDS = Object.freeze([
  "ems_handoff",
  "primary_assessment",
  "data_gathering",
  "differential_1",
  "tests_and_treatment",
  "reassessment",
  "decision",
  "preop",
  "operation",
  "postop_destination",
  "ward_care",
  "deterioration",
  "complication_workup",
  "source_control_2",
  "discharge",
  "complete",
]);

const NEEDS_AUTHORING = "NEEDS_AUTHORING";

/**
 * Fields addendum 6 requires on every state:
 *   learner_goal, mentor_focus RU/KZ, entry_conditions, allowed_transitions,
 *   required_action_contracts, optional_action_contracts,
 *   revealed_information_policy, time_behavior, exit_conditions, safety_stops,
 *   unscoreable_teaching_points.
 *
 * `allowed_transitions` and the contract lists are structural and authored here.
 * KZ text is uniformly absent: the project has no Kazakh for any of this yet,
 * and machine-translating clinical prompts is not language review.
 */
const state = (id, entry) =>
  Object.freeze({
    state_id: id,
    mentor_focus_kk: NEEDS_AUTHORING,
    unscoreable_teaching_points: [],
    safety_stops: [],
    optional_action_contracts: [],
    ...entry,
  });

export const PATH_STATES = Object.freeze([
  state("ems_handoff", {
    learner_goal_ru: "Принять передачу бригады и понять, что известно до осмотра.",
    entry_conditions: ["session_start"],
    allowed_transitions: ["primary_assessment"],
    required_action_contracts: [],
    revealed_information_policy: "handoff_only",
    time_behavior: "clock_starts",
    exit_conditions: ["learner_responds"],
  }),
  state("primary_assessment", {
    learner_goal_ru: "Определить, есть ли непосредственная угроза жизни, до диагностики.",
    mentor_focus_ru: "Пациент стабилен? Какие данные это подтверждают?",
    entry_conditions: ["ems_handoff_complete"],
    allowed_transitions: ["data_gathering", "tests_and_treatment"],
    required_action_contracts: ["assess_stability"],
    optional_action_contracts: ["initial_resuscitation"],
    revealed_information_policy: "on_request",
    time_behavior: "runs",
    exit_conditions: ["stability_addressed"],
    safety_stops: ["unstable_patient_left_untreated"],
    reasoning_snapshot: "primary_assessment",
  }),
  state("data_gathering", {
    learner_goal_ru: "Собрать данные, которых не хватает для формулировки проблемы.",
    mentor_focus_ru: "Представь проблему одним предложением.",
    entry_conditions: ["primary_assessment_complete"],
    allowed_transitions: ["differential_1", "tests_and_treatment"],
    required_action_contracts: ["focused_history", "focused_examination"],
    optional_action_contracts: ["reproductive_safety_screen"],
    revealed_information_policy: "on_request",
    time_behavior: "runs",
    exit_conditions: ["history_and_examination_done"],
  }),
  state("differential_1", {
    learner_goal_ru: "Сформулировать пациента и назвать ранжированные гипотезы.",
    mentor_focus_ru: "Что вероятнее всего и что опаснее всего пропустить?",
    entry_conditions: ["data_gathering_complete"],
    allowed_transitions: ["tests_and_treatment", "decision"],
    required_action_contracts: ["problem_representation", "rank_hypotheses"],
    optional_action_contracts: ["diagnostic_justification"],
    revealed_information_policy: "on_request",
    time_behavior: "runs",
    exit_conditions: ["hypotheses_ranked"],
    reasoning_snapshot: "first_differential",
  }),
  state("tests_and_treatment", {
    learner_goal_ru: "Назначить исследования с понятной целью и начать необходимое лечение.",
    mentor_focus_ru: "Как результат изменит твоё решение?",
    entry_conditions: ["differential_stated_or_urgent_need"],
    allowed_transitions: ["reassessment", "decision"],
    required_action_contracts: ["test_justification"],
    optional_action_contracts: [
      "targeted_laboratory_workup",
      "urinalysis",
      "pregnancy_test",
      "targeted_ultrasound",
      "ct_abdomen",
      "supportive_care",
    ],
    revealed_information_policy: "results_after_turnaround",
    time_behavior: "runs",
    exit_conditions: ["results_available_or_decision_possible"],
    reasoning_snapshot: "key_test_results",
  }),
  state("reassessment", {
    learner_goal_ru: "Переоценить пациента после времени, лечения или результата.",
    entry_conditions: ["intervention_or_result_or_elapsed_time"],
    allowed_transitions: ["decision", "tests_and_treatment", "deterioration"],
    required_action_contracts: ["timed_reassessment"],
    optional_action_contracts: ["active_observation"],
    revealed_information_policy: "on_request",
    time_behavior: "runs",
    exit_conditions: ["reassessment_recorded"],
  }),
  state("decision", {
    learner_goal_ru: "Принять решение и назвать, что его изменит.",
    mentor_focus_ru: "Почему это нужно делать сейчас и что заставит сменить план?",
    entry_conditions: ["sufficient_data_for_next_step"],
    allowed_transitions: ["preop", "ward_care", "discharge", "reassessment"],
    required_action_contracts: [
      "working_diagnosis_and_severity",
      "management_decision",
      "contingency_and_escalation",
    ],
    revealed_information_policy: "on_request",
    time_behavior: "runs",
    exit_conditions: ["decision_stated"],
    reasoning_snapshot: "definitive_decision",
  }),
  state("preop", {
    learner_goal_ru: "Подготовить пациента и операционную к вмешательству.",
    entry_conditions: ["operative_decision_made"],
    allowed_transitions: ["operation", "decision"],
    required_action_contracts: [
      "preop_readiness",
      "antimicrobial_strategy",
      "surgical_safety_check",
    ],
    revealed_information_policy: "on_request",
    time_behavior: "runs",
    exit_conditions: ["all_blocking_prerequisites_met"],
    // The existing V3 behaviour, kept: the operation is stopped before it
    // reaches the patient, not commented on afterwards.
    safety_stops: ["incision_without_blocking_prerequisites"],
  }),
  state("operation", {
    learner_goal_ru: "Выполнить контроль источника и принять интраоперационные решения.",
    mentor_focus_ru: "Какой доступ и объём безопасны в этой ситуации?",
    entry_conditions: ["preop_complete"],
    allowed_transitions: ["postop_destination"],
    required_action_contracts: ["source_control"],
    optional_action_contracts: [
      "operative_approach_and_conversion",
      "intraoperative_systematic_review",
      "operative_documentation",
    ],
    revealed_information_policy: "operative_findings_on_entry",
    time_behavior: "runs",
    exit_conditions: ["source_controlled"],
  }),
  state("postop_destination", {
    learner_goal_ru: "Выбрать безопасное место для пациента после операции.",
    mentor_focus_ru: "Почему пациенту безопасно именно здесь?",
    entry_conditions: ["operation_complete"],
    allowed_transitions: ["ward_care"],
    required_action_contracts: ["postoperative_destination"],
    revealed_information_policy: "on_request",
    time_behavior: "runs",
    exit_conditions: ["destination_chosen"],
    reasoning_snapshot: "postoperative_destination",
  }),
  state("ward_care", {
    learner_goal_ru: "Вести пациента после вмешательства и замечать отклонения от нормы.",
    entry_conditions: ["destination_chosen"],
    allowed_transitions: ["deterioration", "discharge"],
    required_action_contracts: ["daily_postoperative_reassessment"],
    optional_action_contracts: ["postoperative_recovery_plan"],
    revealed_information_policy: "daily_rounds",
    time_behavior: "days",
    exit_conditions: ["recovery_or_deterioration"],
  }),
  state("deterioration", {
    learner_goal_ru: "Распознать ухудшение и вернуться к оценке стабильности.",
    mentor_focus_ru: "Что опасно прямо сейчас и нужен ли новый source control?",
    entry_conditions: ["postoperative_deterioration_triggered"],
    allowed_transitions: ["complication_workup", "source_control_2"],
    required_action_contracts: ["assess_stability", "postoperative_deterioration_rescue"],
    revealed_information_policy: "on_request",
    time_behavior: "runs",
    exit_conditions: ["deterioration_acknowledged"],
    safety_stops: ["deterioration_normalised_without_assessment"],
    reasoning_snapshot: "deterioration",
    // Addendum 1 and 11: preview only until the complication module is reviewed.
    runtime_status: "faculty_preview",
  }),
  state("complication_workup", {
    learner_goal_ru: "Построить новый дифференциал ухудшения и локализовать источник.",
    entry_conditions: ["deterioration_acknowledged"],
    allowed_transitions: ["source_control_2", "ward_care"],
    required_action_contracts: ["problem_representation", "rank_hypotheses"],
    optional_action_contracts: ["ct_abdomen", "targeted_laboratory_workup"],
    revealed_information_policy: "results_after_turnaround",
    time_behavior: "runs",
    exit_conditions: ["source_localised_or_excluded"],
    runtime_status: "faculty_preview",
  }),
  state("source_control_2", {
    learner_goal_ru: "Выбрать дренирование, повторную операцию или перевод.",
    entry_conditions: ["source_localised"],
    allowed_transitions: ["ward_care"],
    required_action_contracts: ["source_control"],
    revealed_information_policy: "on_request",
    time_behavior: "runs",
    exit_conditions: ["second_source_control_decided"],
    runtime_status: "faculty_preview",
  }),
  state("discharge", {
    learner_goal_ru: "Доказать готовность к выписке и назвать критерии возврата.",
    mentor_focus_ru: "Что доказывает готовность к выписке?",
    entry_conditions: ["recovery_criteria_met"],
    allowed_transitions: ["complete"],
    required_action_contracts: ["discharge_and_followup"],
    revealed_information_policy: "on_request",
    time_behavior: "days",
    exit_conditions: ["discharge_plan_stated"],
  }),
  state("complete", {
    learner_goal_ru: "Разбор: сравнить оптимальный, безопасный локальный путь и цену ограничений.",
    entry_conditions: ["discharge_complete"],
    allowed_transitions: [],
    required_action_contracts: [],
    revealed_information_policy: "debrief_reveals_hidden_truth",
    time_behavior: "stopped",
    exit_conditions: ["debrief_shown"],
  }),
]);

export const pathStatesById = new Map(PATH_STATES.map((entry) => [entry.state_id, entry]));

/**
 * The stable path addendum 14 requires to actually reach discharge.
 *
 * Declared rather than derived: "there exists a route through the graph" is a
 * weaker claim than "this is the route a stable patient takes", and the test
 * needs the second one.
 */
export const STABLE_PATH = Object.freeze([
  "ems_handoff",
  "primary_assessment",
  "data_gathering",
  "differential_1",
  "tests_and_treatment",
  "reassessment",
  "decision",
  "preop",
  "operation",
  "postop_destination",
  "ward_care",
  "discharge",
  "complete",
]);

/** Reasoning snapshots, addendum 9. Read off the states that declare one. */
export const REASONING_SNAPSHOT_POINTS = Object.freeze([
  "primary_assessment",
  "first_differential",
  "key_test_results",
  "definitive_decision",
  "postoperative_destination",
  "deterioration",
]);

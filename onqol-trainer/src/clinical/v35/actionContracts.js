// The thirty-two canonical clinical action contracts, addendum 7.
//
// WHAT A CONTRACT IS
//
// A contract is a clinical intention: "every test needs a stated purpose",
// "readiness before the incision". A leaf action is the thing the learner
// actually does, and it already exists in the case or the core library. One leaf
// may serve several contracts; a contract may have no leaf yet.
//
// Addendum 7, verbatim: "Contract сам по себе не получает score. Score остаётся
// на reviewed leaf rule или reviewed reasoning criterion." So this layer is a
// vocabulary for the mentor and the rubric, not a second scoring system, and
// nothing here carries a weight.
//
// THREE CONTRACTS RESOLVE TO REASONING, NOT TO ACTIONS
//
// `problem_representation`, `diagnostic_justification` and `test_justification`
// are marked "new if absent" in the addendum. They are not actions and should
// never become actions: summarising a patient is not something the deterministic
// layer performs, it is something the learner says. They resolve to the
// reasoning flags built in core/reasoningState.js, via `reasoning_flags`.
//
// Making them actions would break an invariant that already has a test:
// "reasoning fields never create a completed action".

import { coreActionsById } from "../core/coreActions.js";

const NEEDS_LEAF_AUTHORING = "NEEDS_LEAF_AUTHORING";

/**
 * @typedef {Object} ActionContract
 * @property {number} number             1..32, addendum ordering
 * @property {string} contract_id
 * @property {string} content_ru
 * @property {string[]} aliases          existing leaf action ids
 * @property {string[]} [reasoning_flags] flags from core/reasoningState.js
 * @property {string} [gap]              NEEDS_LEAF_AUTHORING when no leaf exists
 */

/** @type {ActionContract[]} */
export const ACTION_CONTRACTS = Object.freeze([
  { number: 1, contract_id: "assess_stability", content_ru: "ABC, перфузия, витальные, органная дисфункция, срочность", aliases: ["vital_signs_reassessment", "recognize_sepsis"], reasoning_flags: ["stability_stated"] },
  { number: 2, contract_id: "initial_resuscitation", content_ru: "Мониторинг, кислород по показаниям, венозный доступ, инфузия/кровь по показаниям, ранний вызов помощи", aliases: ["iv_access", "iv_fluids", "call_intensive_care"] },
  { number: 3, contract_id: "focused_history", content_ru: "Хронология, миграция, ЖКТ/мочевые/гинекологические симптомы, прошлые эпизоды, сопутствующее, лекарства и аллергия", aliases: ["focused_history"] },
  { number: 4, contract_id: "focused_examination", content_ru: "Общее состояние, живот, перитонеальные признаки и прицельный осмотр", aliases: ["abdominal_exam"] },
  { number: 5, contract_id: "reproductive_safety_screen", content_ru: "Менструальный, акушерский и гинекологический анамнез, тазовый скрининг когда применимо", aliases: ["pelvic_gynecologic_screen"], requires_modifier: "MOD-PREGNANCY-POSSIBLE" },
  { number: 6, contract_id: "problem_representation", content_ru: "Синтез одним предложением: популяция, синдром, время, тяжесть, дискриминаторы", aliases: [], reasoning_flags: ["problem_representation_stated"] },
  { number: 7, contract_id: "rank_hypotheses", content_ru: "Наиболее вероятное, опасное для пропуска и разумный конкурент", aliases: ["differential_ectopic"], reasoning_flags: ["multiple_hypotheses_stated", "differential_ranked", "dangerous_alternative_named"] },
  { number: 8, contract_id: "diagnostic_justification", content_ru: "Данные за и против ведущих гипотез", aliases: [], reasoning_flags: ["hypothesis_evidence_for_stated", "hypothesis_evidence_against_stated"] },
  { number: 9, contract_id: "test_justification", content_ru: "Клинический вопрос и как результат меняет действие", aliases: [], reasoning_flags: ["investigation_justified", "contingency_trigger_named"] },
  { number: 10, contract_id: "targeted_laboratory_workup", content_ru: "ОАК/CRP/биохимия/тесты органной дисфункции по состоянию", aliases: ["cbc", "crp", "biochemistry"] },
  { number: 11, contract_id: "urinalysis", content_ru: "Мочевой дискриминатор, интерпретируемый в контексте", aliases: ["urinalysis"] },
  { number: 12, contract_id: "pregnancy_test", content_ru: "beta-hCG когда беременность возможна", aliases: ["pregnancy_test"], requires_modifier: "MOD-PREGNANCY-POSSIBLE" },
  { number: 13, contract_id: "targeted_ultrasound", content_ru: "УЗИ брюшной полости/малого таза по вопросу и популяции", aliases: ["abdominal_ultrasound", "pelvic_ultrasound"] },
  { number: 14, contract_id: "ct_abdomen", content_ru: "КТ когда меняет решение и доступна", aliases: ["ct_abdomen"] },
  { number: 15, contract_id: "supportive_care", content_ru: "Обезболивание, противорвотное, голод и гидратация по состоянию", aliases: ["analgesia", "npo"] },
  { number: 16, contract_id: "active_observation", content_ru: "Явная цель наблюдения, мониторинг и критерии выхода", aliases: ["active_observation"], reasoning_flags: ["observation_plan_complete"] },
  { number: 17, contract_id: "timed_reassessment", content_ru: "Повторные витальные/осмотр после времени, лечения или результата", aliases: ["serial_reexamination", "vital_signs_reassessment"], reasoning_flags: ["reassessment_stated"] },
  { number: 18, contract_id: "working_diagnosis_and_severity", content_ru: "Рабочий диагноз плюс осложнённость и утверждение о стабильности", aliases: ["diagnosis_acute_appendicitis"], reasoning_flags: ["leading_hypothesis_named", "stability_stated"] },
  { number: 19, contract_id: "management_decision", content_ru: "Наблюдать, госпитализировать, оперировать, выбранный NOM, перевести или выписать — с обоснованием", aliases: ["appendectomy_here", "transfer_before_source_control"], reasoning_flags: ["management_plan_stated", "management_rationale_stated"] },
  { number: 20, contract_id: "contingency_and_escalation", content_ru: "План «если — то», триггеры, время пересмотра, эскалация к старшему/ОРИТ", aliases: ["call_senior_surgeon", "declare_uncertainty"], reasoning_flags: ["contingency_stated", "contingency_trigger_named"] },
  { number: 21, contract_id: "preop_readiness", content_ru: "Показание и срочность, анестезия, операционная, согласие, риск и уровень наблюдения", aliases: ["informed_consent", "notify_anesthesia", "notify_operating_team", "preop_risk_assessment"] },
  { number: 22, contract_id: "antimicrobial_strategy", content_ru: "Профилактика против терапевтических антибиотиков по морфологии и контексту", aliases: ["preop_single_antibiotic_prophylaxis", "antibiotic_observation_course", "postop_antibiotics_uncomplicated"] },
  { number: 23, contract_id: "surgical_safety_check", content_ru: "Sign In, Time Out и Sign Out как отдельные контрольные точки", aliases: ["who_sign_in", "who_time_out", "who_sign_out"] },
  { number: 24, contract_id: "operative_approach_and_conversion", content_ru: "Выбор лапароскопического/открытого доступа, выполнимость и план конверсии", aliases: [], gap: NEEDS_LEAF_AUTHORING },
  { number: 25, contract_id: "intraoperative_systematic_review", content_ru: "Ревизия, когда находки не совпадают с ожидаемой анатомией; оценка контаминации", aliases: [], gap: NEEDS_LEAF_AUTHORING },
  { number: 26, contract_id: "source_control", content_ru: "Удалить или контролировать источник и контаминированный материал по авторской ветви", aliases: ["appendectomy_here"] },
  { number: 27, contract_id: "operative_documentation", content_ru: "Морфология, контаминация, полнота контроля, кровопотеря, препарат и план", aliases: ["document_decision"], partial_alias: true },
  { number: 28, contract_id: "postoperative_destination", content_ru: "Выбор ПИТ/отделение/ОРИТ с мониторингом и возможностью спасения", aliases: ["structured_handover", "call_intensive_care"] },
  { number: 29, contract_id: "daily_postoperative_reassessment", content_ru: "Витальные, боль, живот, диурез, питание, восстановление кишечника, рана и список проблем", aliases: ["postoperative_reassessment"] },
  { number: 30, contract_id: "postoperative_recovery_plan", content_ru: "Мультимодальное обезболивание, питание, мобилизация, ревизия устройств и оценка ВТЭ", aliases: ["vte_risk_assessment"], partial_alias: true },
  { number: 31, contract_id: "postoperative_deterioration_rescue", content_ru: "Распознать ухудшение, стабилизировать заново, построить новый дифференциал, локализовать источник и выбрать дренирование или повторную операцию", aliases: ["recognize_sepsis", "call_intensive_care"], partial_alias: true },
  { number: 32, contract_id: "discharge_and_followup", content_ru: "Готовность, лекарства, инструкции, наблюдение и триггеры возврата", aliases: ["discharge_and_followup", "explain_to_patient", "structured_handover", "document_decision"] },
].map((contract) =>
  Object.freeze({
    aliases: [],
    reasoning_flags: [],
    // Addendum 7: a contract never carries a score. Repeated on every entry so
    // it survives anyone copying one row into a new file.
    eligible_for_scoring: false,
    ...contract,
  })
));

export const contractsById = new Map(
  ACTION_CONTRACTS.map((contract) => [contract.contract_id, contract])
);

/**
 * Every leaf action id a contract claims to reuse.
 *
 * Used by the validator: an alias that resolves to nothing means the contract
 * silently covers no action, and the mentor would reference a step the engine
 * never sees.
 */
export function declaredAliasIds() {
  return [...new Set(ACTION_CONTRACTS.flatMap((contract) => contract.aliases))];
}

/**
 * Which leaf ids exist in a given case, plus the core library.
 *
 * Core actions are composed into every case, but this resolves against both so
 * the check does not depend on composition having run.
 */
export function resolvableActionIds(caseData) {
  const ids = new Set(coreActionsById.keys());
  for (const group of [
    caseData?.expected_actions,
    caseData?.acceptable_alternatives,
    caseData?.unnecessary_actions,
    caseData?.unsafe_actions,
  ]) {
    for (const action of group || []) ids.add(action.id);
  }
  return ids;
}

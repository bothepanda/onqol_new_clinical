/**
 * Clinical evidence governance boundary.
 *
 * This module does not contain clinical truth. It decides whether a structured
 * rule is authorised to have a particular runtime effect. Language generation,
 * legacy transcripts and source metadata alone can never grant that authority.
 */

export const CLINICAL_GOVERNANCE_VERSION = "clinical-governance-v1.0";
export const SOURCE_REGISTRY_VERSION = "source-registry-v1.0";
export const CLINICAL_RULE_REGISTRY_VERSION = "clinical-rule-registry-v1.0";
export const DOSING_RULE_REGISTRY_VERSION = "dosing-rule-registry-v0.1";

export const CLINICAL_RULE_STATUS = Object.freeze({
  DRAFT: "draft",
  REVIEWED: "reviewed",
  APPROVED: "approved_for_training",
  DEPRECATED: "deprecated",
});

export const CLINICAL_RUNTIME_EFFECT = Object.freeze({
  PATIENT_TRUTH: "patient_truth",
  MENTOR_TEACHING: "mentor_teaching",
  SAFETY_VERDICT: "safety_verdict",
  AUTHORITATIVE_CORRECTION: "authoritative_correction",
  CRITICAL_PATHWAY_TRANSITION: "critical_pathway_transition",
  SCORING: "scoring",
});

export const HIGH_RISK_RULE_TYPES = Object.freeze([
  "dosing_rule",
  "medication_dose",
  "fluid_dose",
  "fluid_rate",
  "anticoagulation",
  "antibiotic",
  "blood_product",
  "vasoactive_drug",
  "airway_parameter",
  "ventilation_parameter",
  "invasive_procedure",
  "operative_indication",
  "source_control_timing",
  "icu_criterion",
  "transfer_criterion",
  "contraindication",
  "emergency_threshold",
]);

/**
 * Source registry.
 *
 * `last_checked` means one thing only: a named person opened the document and
 * confirmed its imprint on that date. It is not a statement that the source is
 * legally in force, and it grants no runtime authority by itself - a rule still
 * has to be approved separately.
 *
 * Entries below were checked at the clinical review of 19.08.2026 by Сарина Т.Т.
 * The Kazakhstan protocol is the one case where the two questions come apart:
 * its text is verified, its current normative status is not.
 */
export const SOURCE_REGISTRY = Object.freeze([
  Object.freeze({
    source_id: "WSES2025",
    organization: "World Society of Emergency Surgery",
    title:
      "Diagnosis and Treatment of Acute Appendicitis: 2025 Edition of the World Society of Emergency Surgery Jerusalem Guidelines",
    year_version: "2025 edition; publication year 2026",
    edition_year: 2025,
    publication_year: 2026,
    identifier: "10.1001/jamasurg.2025.6218",
    jurisdiction: "reference",
    last_checked: "2026-08-19",
    checked_by: "Сарина Т.Т.",
    status: "verified",
    migrated_from: "src/clinical/diseases/appendicitis/appendicitis.core.yaml",
    legacy_v1: false,
  }),
  Object.freeze({
    source_id: "APPAC_5Y",
    organization: "APPAC randomized clinical trial investigators",
    title:
      "Five-Year Follow-up of Antibiotic Therapy for Uncomplicated Acute Appendicitis in the APPAC Randomized Clinical Trial",
    year_version: "JAMA 2018;320(12):1259-1265",
    publication_year: 2018,
    identifier: "10.1001/jama.2018.13201",
    jurisdiction: "reference",
    last_checked: "2026-08-19",
    checked_by: "Сарина Т.Т.",
    status: "verified",
    legacy_v1: false,
  }),
  Object.freeze({
    // Adds a horizon to the same cohort. Explicitly NOT a replacement for the
    // five-year entry: the two report different endpoints and both are needed
    // to state either one honestly.
    source_id: "APPAC_10Y",
    organization: "APPAC randomized clinical trial investigators",
    title:
      "Antibiotic Therapy for Uncomplicated Acute Appendicitis: Ten-Year Follow-Up of the APPAC Randomized Clinical Trial",
    year_version: "JAMA, published online 2026-01-21",
    publication_year: 2026,
    identifier: "10.1001/jama.2025.25921",
    jurisdiction: "reference",
    last_checked: "2026-08-19",
    checked_by: "Сарина Т.Т.",
    status: "verified",
    extends: "APPAC_5Y",
    legacy_v1: false,
  }),
  Object.freeze({
    source_id: "PERFECT_ABX_2025",
    organization: "PERFECT-Antibiotics trial investigators",
    title:
      "Role of Preoperative Antibiotic Treatment While Awaiting Appendectomy: The PERFECT-Antibiotics Randomized Clinical Trial",
    year_version: "JAMA Surgery 2025",
    publication_year: 2025,
    identifier: "10.1001/jamasurg.2025.1212",
    jurisdiction: "reference",
    last_checked: "2026-08-19",
    checked_by: "Сарина Т.Т.",
    status: "verified",
    supporting_only: true,
    legacy_v1: false,
  }),
  Object.freeze({
    source_id: "SAGES_APPENDICITIS",
    organization: "Society of American Gastrointestinal and Endoscopic Surgeons",
    title: "Guideline for the Diagnosis and Treatment of Appendicitis",
    year_version: "SAGES guideline, accessed 2026-08-19",
    identifier:
      "https://www.sages.org/publications/guidelines/guideline-for-the-diagnosis-and-treatment-of-appendicitis/",
    jurisdiction: "reference",
    last_checked: "2026-08-19",
    checked_by: "Сарина Т.Т.",
    status: "verified",
    legacy_v1: false,
  }),
  Object.freeze({
    source_id: "KZ_AA_2018",
    organization:
      "Объединенная комиссия по качеству медицинских услуг Министерства здравоохранения Республики Казахстан",
    title: "Клинический протокол диагностики и лечения: Острый аппендицит",
    year_version: "2018; approval 2019-03-04; protocol 61",
    publication_year: 2018,
    identifier: "protocol-61",
    jurisdiction: "KZ",
    last_checked: "2026-08-19",
    checked_by: "Сарина Т.Т.",
    // Text verified, force of law not. Keeping one status field for both would
    // let "the PDF opens" pass for "the protocol is current".
    status: "text_verified",
    normative_status: "requires_separate_confirmation",
    normative_status_note:
      "Официальный текст протокола и его выходные данные проверены 19.08.2026. Доступность PDF не подтверждает, что протокол остаётся действующим нормативным документом на эту дату; статус требует подтверждения по официальному реестру или решению уполномоченного органа.",
    migrated_from: "src/clinical/diseases/appendicitis/appendicitis.core.yaml",
    legacy_v1: false,
  }),
  Object.freeze({
    // Added 20.08.2026 for the first dosing rules. The surgical-prophylaxis
    // guideline the reference doses are copied from, word for word.
    source_id: "ASHP_SAP_2013",
    organization: "ASHP / IDSA / SIS / SHEA",
    title: "Clinical Practice Guidelines for Antimicrobial Prophylaxis in Surgery",
    year_version: "2013",
    publication_year: 2013,
    identifier:
      "https://www.idsociety.org/practice-guideline/antimicrobial-prophylaxis-in-surgery/",
    jurisdiction: "reference",
    last_checked: "2026-08-20",
    checked_by: "Каукенова Б.Н., MD",
    check_method: "сверка с PDF первоисточника",
    status: "text_verified",
    // The 2013 text is what the rules quote. A successor edition was still in
    // development on the date above, and recording that here stops "the current
    // guideline" being read into a rule that quotes the 2013 one.
    normative_status: "superseding_edition_in_development_as_of_2026_08_20",
    legacy_v1: false,
  }),
  Object.freeze({
    // The Kazakhstan formulary. Present so that a rule may RECORD how the local
    // formulary differs, never so that the difference can be taught as an error.
    source_id: "KNF_RK",
    organization: "Казахстанский национальный формуляр (КНФ РК)",
    title: "Монографии КНФ РК: цефазолин (405), метронидазол (445)",
    year_version: "монографии, сверены 20.08.2026",
    identifier: "https://knf.kz/ru/content/monograph?id=405; https://knf.kz/ru/content/monograph?id=445",
    jurisdiction: "KZ",
    last_checked: "2026-08-20",
    checked_by: "Каукенова Б.Н., MD",
    check_method: "сверка с монографией knf.kz",
    // Same split as KZ_AA_2018: the monograph text opened and was read; whether
    // that monograph is the current binding edition is a separate question.
    status: "text_verified",
    normative_status: "requires_separate_confirmation",
    normative_status_note:
      "Текст монографий КНФ проверен 20.08.2026. Доступность страницы не подтверждает, что редакция является действующей на эту дату.",
    legacy_v1: false,
  }),
]);

const REVIEWERS = Object.freeze(["Сарина Т.Т.", "Каукенова Б.Н., MD"]);
const REVIEWED_AT = "2026-08-19";
const NEXT_REVIEW_DUE = "2028-08-19";

/**
 * Who signed and on what basis.
 *
 * Recorded separately from `reviewed_by` because the two signatures do not mean
 * the same thing. The independent reviewer's verdict was "approved after
 * required amendments"; the amendments were applied the same day and she
 * confirmed the amended text, so the chain closes on 19.08.2026.
 */
export const CLINICAL_RULE_SIGNATURES = Object.freeze({
  independent_clinical: Object.freeze({
    reviewer: "Сарина Т.Т.",
    role: "independent clinical reviewer: wording against source, strength not overstated, conditions correct",
    basis: "written clinical review of package v1.3, 19.08.2026",
    verdict: "approved_after_required_amendments",
    amendments_applied_at: "2026-08-19",
    reconfirmation_of_amended_text: "confirmed",
    reconfirmed_at: "2026-08-19",
  }),
  local_applicability: Object.freeze({
    reviewer: "Каукенова Б.Н., MD",
    role: "applicability in Kazakhstan, consistency with КП МЗ РК, how the wording reads to a resident",
    basis: "signature given 19.08.2026",
    verdict: "approved",
    note: "Author of the original disease card, so this signature is not an independent check of the sources.",
  }),
});

// Every rule in this package teaches and nothing more. No rule scores, stops a
// simulation, or overrides a learner: scoring is off for the first pilot, and
// several of these are conditional recommendations at low or very low certainty
// that must never harden into a verdict. Widening this list is a clinical
// decision, not a code change.
const TEACHING_ONLY = Object.freeze(["mentor_teaching"]);

function approvedRule(fields) {
  return Object.freeze({
    module: "acute_appendicitis",
    jurisdiction: "reference",
    exceptions: [],
    resource_context: [],
    review_status: CLINICAL_RULE_STATUS.APPROVED,
    reviewed_by: REVIEWERS,
    reviewed_at: REVIEWED_AT,
    next_review_due: NEXT_REVIEW_DUE,
    supersedes: null,
    allowed_runtime_effects: TEACHING_ONLY,
    evidence_strength: "as_reported_by_source",
    tests: ["src/clinical/__tests__/clinicalGovernance.test.js"],
    legacy_v1: false,
    ...fields,
  });
}

/**
 * The twelve rules the mentor is allowed to say out loud.
 *
 * `claim` is the approved English statement; the learner-facing Russian and
 * Kazakh wording lives in the disease card locales and has to match it. A rule
 * absent from this registry cannot be spoken at runtime, whatever the evidence
 * file says.
 */
export const CLINICAL_RULE_REGISTRY = Object.freeze([
  approvedRule({
    rule_id: "APP-A1-WSES-R1",
    rule_type: "diagnostic_pathway",
    claim:
      "In a stable adult with suspected acute appendicitis, a validated risk stratification score (AIR or AAS) may be used alongside history, examination and laboratory results to estimate pretest probability and choose further investigation. The score alone neither establishes nor excludes the diagnosis.",
    conditions: ["adult", "stable", "suspected_appendicitis"],
    source_ids: ["WSES2025"],
    risk_class: "moderate",
    constraint:
      "Numeric cutoffs are not reproduced at runtime until the primary validation studies are verified. Naming a score is not a numeric calculation and is never scored.",
  }),
  approvedRule({
    rule_id: "APP-A2-WSES-R3.1",
    rule_type: "diagnostic_pathway",
    claim:
      "Imaging choice follows clinical probability, the diagnostic question, patient factors and availability. Ultrasound is acceptable first-line where CT is unavailable or radiation minimization is prioritized; if it is inconclusive and suspicion persists, low-dose CT where available and appropriate. Where CT is unavailable the next step follows risk and may be active observation with reassessment, transfer or an operative decision. In obesity (BMI 30+) and age 65+, CT is preferred first-line. In pregnancy, MRI after negative or inconclusive ultrasound, provided it causes no clinically significant delay.",
    conditions: ["adult", "suspected_appendicitis"],
    source_ids: ["WSES2025"],
    risk_class: "moderate",
    constraint: "No effective dose in millisieverts is stated to a learner; that belongs to the local radiology protocol.",
  }),
  approvedRule({
    rule_id: "APP-A3-WSES-R5.1",
    rule_type: "operative_indication",
    claim:
      "In a carefully selected, haemodynamically stable adult with radiologically confirmed uncomplicated appendicitis and no appendicolith, antibiotic therapy may be offered as an alternative to appendectomy within shared decision-making, given reliable monitoring, rapid reassessment and access to surgery on failure, deterioration or recurrence. The patient has to be told that initial success does not exclude recurrence and a later appendectomy.",
    conditions: [
      "adult",
      "stable",
      "radiologically_confirmed_uncomplicated",
      "no_appendicolith",
      "monitoring_available",
      "rescue_surgery_available",
      "shared_decision_making",
    ],
    source_ids: ["WSES2025", "APPAC_5Y", "APPAC_10Y"],
    risk_class: "high",
    constraint:
      "A nonoperative plan is never wrong merely for being nonoperative. Where the selection facts are not established, the plan cannot be judged and the missing condition is what the mentor asks about. Recurrence percentages are reviewer and debrief material, never a required answer and never scored.",
  }),
  approvedRule({
    rule_id: "APP-A4-WSES-R9.1",
    rule_type: "source_control_timing",
    claim:
      "In a stable adult with uncomplicated acute appendicitis selected for surgery, perform laparoscopic appendectomy within 24 hours of admission. Twenty-four hours is the upper bound of acceptable delay, not a target to wait out.",
    conditions: ["adult", "stable", "uncomplicated", "selected_for_surgery"],
    exceptions: [
      "haemodynamic_instability",
      "generalized_peritonitis",
      "sepsis",
      "clinical_deterioration",
      "suspected_complicated_appendicitis",
    ],
    source_ids: ["WSES2025", "PERFECT_ABX_2025"],
    risk_class: "high",
    resource_context: ["laparoscopy_available"],
    constraint:
      "Scheduling surgery for the morning inside the window is NOT an error, provided the patient is stable, reassessed and shows no sign of complicated disease. The mentor intervenes on deterioration, suspicion of complicated disease, absent reassessment, or leaving the window.",
    supersedes: "APP-WSES-R9.1",
  }),
  approvedRule({
    rule_id: "APP-A5-WSES-R15.1",
    rule_type: "antibiotic",
    claim:
      "Give one preoperative prophylactic antibiotic dose to an adult undergoing laparoscopic appendectomy for uncomplicated appendicitis, in the perioperative window before incision or induction, according to the approved local protocol. Do not start a separate treatment course merely because the patient is waiting, where the appendicitis is confirmed uncomplicated and surgery is planned within 24 hours.",
    conditions: ["adult", "uncomplicated", "undergoing_appendectomy"],
    source_ids: ["WSES2025", "PERFECT_ABX_2025"],
    risk_class: "high",
    constraint: "No molecule, dose, interval or local combination is ever named at runtime.",
  }),
  approvedRule({
    rule_id: "APP-A6-WSES-R17.1",
    rule_type: "antibiotic",
    claim:
      "After laparoscopic appendectomy for confirmed uncomplicated acute appendicitis, WSES suggests against giving postoperative antibiotics routinely. Conditional recommendation, low certainty. If intraoperative or postoperative findings indicate complicated infection, the patient moves to the complicated pathway and this rule no longer applies to them.",
    conditions: ["adult", "confirmed_uncomplicated", "after_appendectomy"],
    source_ids: ["WSES2025"],
    risk_class: "high",
    constraint:
      "Never a safety stop, a critical error or a penalty. A clinically justified deviation is discussed in the debrief in the light of the intraoperative picture and the local protocol.",
  }),
  approvedRule({
    rule_id: "APP-A7-WSES-R12",
    rule_type: "invasive_procedure",
    claim:
      "At diagnostic laparoscopy for suspected appendicitis, where the appendix looks macroscopically normal and no other intra-abdominal or pelvic pathology explaining the presentation has been found, removing the appendix may be considered.",
    conditions: ["diagnostic_laparoscopy", "macroscopically_normal_appendix", "no_other_pathology_found"],
    source_ids: ["WSES2025"],
    risk_class: "high",
    constraint:
      "Conditional, very low certainty. Not scored and never a safety stop. Absence of other pathology has to be established before the decision, not asserted after it.",
  }),
  approvedRule({
    rule_id: "APP-B1-WSES-R16.1",
    rule_type: "antibiotic",
    claim:
      "In an adult with complicated acute appendicitis, start therapeutic antibiotic treatment before surgery, particularly where immediate operation is not possible. The chosen therapeutic regimen has to provide the required perioperative cover according to the local protocol.",
    conditions: ["adult", "complicated", "awaiting_appendectomy"],
    source_ids: ["WSES2025"],
    risk_class: "high",
    constraint:
      "Prophylactic and therapeutic intent differ, but this does not mandate two parallel courses or duplicated agents. Whether a separate perioperative dose is needed, the regimen, its timing and redosing follow the approved hospital protocol.",
  }),
  approvedRule({
    rule_id: "APP-B2-WSES-R18.1",
    rule_type: "antibiotic",
    claim:
      "After laparoscopic appendectomy for complicated acute appendicitis in an adult, give postoperative antibiotic therapy. Duration is not fixed here: it follows the adequacy of source control and rule APP-B3.",
    conditions: ["adult", "complicated", "after_appendectomy"],
    source_ids: ["WSES2025"],
    risk_class: "high",
    constraint:
      "Applies once complicated appendicitis has been established by machine-checkable criteria. Those criteria are not yet defined, so this rule cannot drive runtime behaviour until they are.",
    blocked_on: "machine_definition_of_complicated_appendicitis",
  }),
  approvedRule({
    rule_id: "APP-B3-WSES-R19.1",
    rule_type: "antibiotic",
    claim:
      "In an adult after laparoscopic appendectomy for complicated appendicitis with adequate source control, a short postoperative antibiotic course of 2-3 days is suggested rather than a routine 5-7 days.",
    conditions: ["adult", "complicated", "after_appendectomy", "adequate_source_control"],
    source_ids: ["WSES2025"],
    risk_class: "high",
    constraint:
      "Where source control is inadequate or the course suggests a persisting focus, the system's move is to reassess the source and look for complications, never to extend antibiotics automatically. The figure 2-3 days may be spoken only as a quotation of this rule. Requires a machine definition of adequate source control.",
    blocked_on: "machine_definition_of_adequate_source_control",
  }),
  approvedRule({
    rule_id: "APP-B4-WSES-R11.1",
    rule_type: "invasive_procedure",
    claim:
      "In adults after laparoscopic appendectomy for complicated appendicitis, avoiding routine prophylactic abdominal drainage is suggested. Conditional recommendation, low certainty. This concerns routine placement and does not forbid drainage for a specific established indication.",
    conditions: ["adult", "complicated", "after_appendectomy"],
    source_ids: ["WSES2025", "SAGES_APPENDICITIS"],
    risk_class: "high",
    constraint:
      "The presence of a drain is not a critical error without assessing the intraoperative situation and the indication.",
  }),
  approvedRule({
    rule_id: "APP-B5-WSES-R10.1",
    rule_type: "invasive_procedure",
    claim:
      "In complicated appendicitis, free contaminated fluid has to be evacuated. WSES suggests suction without routine lavage rather than lavage with suction; SAGES accepts both suction alone and suction with lavage, depending on the intraoperative situation and surgeon preference. Routine lavage is not mandatory.",
    conditions: ["adult", "complicated", "intraoperative"],
    source_ids: ["WSES2025", "SAGES_APPENDICITIS"],
    risk_class: "high",
    guideline_disagreement: true,
    constraint:
      "The guidelines disagree, so this is teaching material and not a binary right/wrong action. Performing lavage is never coded as an error, a safety stop or a penalty. What is assessed is adequacy of source control and removal of the accessible contaminated material.",
  }),
]);

/**
 * Dosing rules.
 *
 * Base rules v2 reverses the standing position that "the trainer does not state
 * a drug or a dose". Doses belong in the knowledge base - they are most of what
 * a resident needs a supervisor for - but they enter through this pipeline and
 * no other: an exact line copied from a named source, a licence note, a KNF RK
 * status, two reviewers, and only then the right for the mentor to say the
 * number out loud.
 *
 * Until a rule is approved the mentor's behaviour is unchanged: discuss the
 * decision, name no number, send the learner to the local formulary. That is
 * the safe transitional state, not a permanent policy.
 *
 * The registry below contains only the first three signed teaching-only rows.
 * Draft or needs-verification rows remain in DOSING_RULES_DRAFT_v0.1.md and do
 * not enter runtime. A row enters this file only after two reviewers sign and
 * the source line is confirmed; nothing here is written from memory.
 */
export const DOSING_RULE_STATUS = Object.freeze({
  NEEDS_CLINICAL_REVIEW: "NEEDS_CLINICAL_REVIEW",
  ...CLINICAL_RULE_STATUS,
});

/**
 * Signed 20.08.2026: independent clinical review Сарина Т.Т., local
 * applicability Каукенова Б.Н. Two signatures, because a dose is high-risk by
 * construction and `validateDosingRule` enforces the bar rather than trusting a
 * risk field somebody could forget to set.
 *
 * WHAT THE OWNER DECIDED TO LEAVE OUT, AND WHY IT IS NOT AN OVERSIGHT
 *
 * `adjustments` is empty on every row, and that is the decision, not a gap.
 * Anything written into dose/route/timing/adjustments becomes a number the
 * mentor is permitted to say out loud (see core/mentorAgent.js allowedNumbers),
 * so each field is a grant of speech, not documentation.
 *
 *   - Weight band "3 g if >=120 kg" is omitted: the pilot patient carries no
 *     weight, so the branch could never be evaluated, and including it would
 *     licence the mentor to say "3 g" and "120 kg" to a patient who has neither.
 *     The full source line survives in `source_line_verbatim`, which does NOT
 *     feed the permitted numbers - the audit trail keeps what runtime may not.
 *   - Intraoperative redosing is omitted because no trustworthy value exists:
 *     three separate readings of the source disagreed, and the last returned
 *     figures that track the half-life column rather than the redosing one.
 *     Absence here is the correct state, not a pending task.
 *
 * KNF divergence is RECORDED, never taught. `jurisdiction_decision` says the
 * reference rule drives runtime, and `knf_rule` preserves the Kazakhstan
 * regimen beside it. A resident who orders the KNF dose has followed their own
 * formulary and is not wrong; see MENTOR_JURISDICTION_RULE below, which is what
 * stops the mentor treating the divergence as an error to correct.
 */
const DOSING_REVIEWERS = Object.freeze(["Сарина Т.Т.", "Каукенова Б.Н., MD"]);
const DOSING_REVIEWED_AT = "2026-08-20";

function approvedDosingRule(fields) {
  return Object.freeze({
    rule_type: "dosing_rule",
    module: "acute_appendicitis",
    jurisdiction: "reference",
    adjustments: [],
    review_status: CLINICAL_RULE_STATUS.APPROVED,
    reviewed_by: DOSING_REVIEWERS,
    reviewed_at: DOSING_REVIEWED_AT,
    next_review_due: "2028-08-20",
    // Teaching and nothing else. Scoring is off for the pilot and a dose must
    // never become a patient effect, a safety verdict or a correction.
    allowed_runtime_effects: TEACHING_ONLY,
    score_weight: 0,
    license_note:
      "Цитирование короткой дозовой строки из опубликованного клинического руководства; полный текст не воспроизводится.",
    legacy_v1: false,
    ...fields,
  });
}

export const DOSING_RULE_REGISTRY = Object.freeze([
  approvedDosingRule({
    rule_id: "dosing.cefazolin.prophylaxis",
    agent: "цефазолин",
    indication: "периоперационная антибиотикопрофилактика, аппендэктомия",
    dose: "2 г",
    route: "в/в",
    timing: "в пределах 60 минут до разреза",
    source_ids: ["ASHP_SAP_2013"],
    source_line_verbatim:
      '"2 g, 3 g for pts weighing >=120 kg"; "The antimicrobial agent should be started within 60 minutes before surgical incision"',
    kp_rk_status: "КНФ±",
    knf_rule:
      "КНФ РК: 1 г за 30-60 минут до операции; при операции 2 часа и более дополнительно 0,5-1 г; далее 0,5-1 г каждые 6-8 часов до 24 часов после операции.",
    jurisdiction_decision: "use_reference_rule",
  }),
  approvedDosingRule({
    rule_id: "dosing.metronidazole.prophylaxis",
    agent: "метронидазол",
    indication: "комбинированная периоперационная профилактика, аппендэктомия",
    dose: "500 мг",
    route: "в/в",
    timing: "однократно, в пределах 60 минут до разреза",
    source_ids: ["ASHP_SAP_2013"],
    source_line_verbatim: '"500 mg" (Table 1)',
    kp_rk_status: "КНФ±",
    knf_rule:
      "КНФ РК подтверждает профилактику анаэробной инфекции при операциях на органах брюшной полости и содержит 500 мг каждые 8 часов для ряда в/в режимов; отдельная взрослая однократная предоперационная схема как самостоятельное правило не сформулирована.",
    jurisdiction_decision: "use_reference_rule",
  }),
  approvedDosingRule({
    rule_id: "dosing.appendectomy.prophylaxis",
    agent: "цефазолин + метронидазол",
    indication: "неосложнённый аппендицит, перед аппендэктомией",
    dose: "цефазолин 2 г + метронидазол 500 мг, однократно",
    route: "в/в",
    timing: "в пределах 60 минут до разреза",
    source_ids: ["ASHP_SAP_2013"],
    // Table 2 was read three times and disagreed with itself; the owner opened
    // the PDF on 20.08.2026 and confirmed this line by eye. The confirmation is
    // recorded on the source entry as `check_method`.
    source_line_verbatim:
      '"Cefoxitin, cefotetan, cefazolin + metronidazole" (Table 2, appendectomy for uncomplicated appendicitis)',
    kp_rk_status: "КНФ±",
    knf_rule:
      "КНФ РК не формулирует комбинированную однократную предоперационную схему для аппендэктомии как самостоятельное правило.",
    jurisdiction_decision: "use_reference_rule",
  }),
]);

/**
 * What the mentor may not do with a jurisdiction divergence.
 *
 * The cefazolin rule grants the mentor the number "2 g" while KNF RK and the
 * Kazakhstan protocol say 1 g. Eight residents trained on that protocol will
 * order 1 g, and they will be right by their own formulary. Under the current
 * architecture the mentor sees the approved rules and speaks in its own words,
 * so without this constraint the likeliest first-week outcome is a trainer
 * telling a cohort that their national formulary is a mistake.
 *
 * Carried into the mentor's system prompt. It restricts, and grants nothing.
 */
export const MENTOR_JURISDICTION_RULE = Object.freeze({
  rule_id: "mentor.jurisdiction.local_formulary_is_not_an_error",
  applies_to: ["dosing.cefazolin.prophylaxis", "dosing.metronidazole.prophylaxis", "dosing.appendectomy.prophylaxis"],
  instruction_ru:
    "Доза, названная резидентом по местному формуляру (КНФ РК, КП МЗ РК), не является ошибкой. " +
    "Не исправляй её, не подменяй числом из справочного правила и не называй ответ неверным. " +
    "Расхождение между локальным и справочным источником — материал разбора, а не живой реплики.",
  review_status: CLINICAL_RULE_STATUS.APPROVED,
  reviewed_by: DOSING_REVIEWERS,
  reviewed_at: DOSING_REVIEWED_AT,
});

const DOSING_RULE_REQUIRED_FIELDS = Object.freeze([
  "rule_id",
  "agent",
  "indication",
  "dose",
  "route",
  "source_line_verbatim",
  "license_note",
  "kp_rk_status",
]);

export function validateDosingRule(rule, sources = SOURCE_REGISTRY) {
  const errors = [];
  const sourceIds = new Set(sources.map((source) => source.source_id));
  for (const field of DOSING_RULE_REQUIRED_FIELDS) {
    if (!rule?.[field]) errors.push(`${rule?.rule_id || "unknown"}: ${field} is required`);
  }
  if (rule?.rule_type !== "dosing_rule") {
    errors.push(`${rule?.rule_id || "unknown"}: rule_type must be dosing_rule`);
  }
  const ruleSources = uniqueStrings(rule?.source_ids);
  if (!ruleSources.length) errors.push(`${rule?.rule_id || "unknown"}: source_ids are required`);
  for (const sourceId of ruleSources) {
    if (!sourceIds.has(sourceId)) errors.push(`${rule.rule_id}: unknown source ${sourceId}`);
  }
  if (rule?.legacy_v1 === true) {
    errors.push(`${rule.rule_id}: legacy V1 material cannot be a dosing source`);
  }
  const approved = rule?.review_status === CLINICAL_RULE_STATUS.APPROVED;
  const effects = uniqueStrings(rule?.allowed_runtime_effects);
  if (!approved && effects.length) {
    errors.push(`${rule.rule_id}: a dosing rule without approval cannot have runtime effects`);
  }
  for (const effect of effects) {
    if (effect !== CLINICAL_RUNTIME_EFFECT.MENTOR_TEACHING) {
      errors.push(`${rule.rule_id}: a dosing rule may only teach, not ${effect}`);
    }
  }
  // A dose is high-risk by construction, so the two-reviewer bar is not
  // conditional on a risk_class field somebody could forget to set.
  if (approved && uniqueStrings(rule?.reviewed_by).length < 2) {
    errors.push(`${rule.rule_id}: dosing approval requires at least two reviewers`);
  }
  return { ok: errors.length === 0, errors };
}

/**
 * The dosing rules the mentor may quote a number from. Anything short of
 * approved_for_training returns nothing, which is what keeps "сверь с
 * формуляром" the answer until a reviewer signs.
 */
export function approvedDosingRules(
  registry = DOSING_RULE_REGISTRY,
  sources = SOURCE_REGISTRY
) {
  return registry.filter(
    (rule) =>
      rule?.review_status === CLINICAL_RULE_STATUS.APPROVED &&
      validateDosingRule(rule, sources).ok &&
      uniqueStrings(rule.allowed_runtime_effects).includes(CLINICAL_RUNTIME_EFFECT.MENTOR_TEACHING)
  );
}

function uniqueStrings(value) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item) => typeof item === "string" && item.trim()))]
    : [];
}

export function validateSourceRegistry(sources = SOURCE_REGISTRY) {
  const errors = [];
  const ids = new Set();
  for (const source of sources) {
    if (!source?.source_id) errors.push("source_id is required");
    if (ids.has(source?.source_id)) errors.push(`duplicate source_id: ${source.source_id}`);
    ids.add(source?.source_id);
    for (const field of ["organization", "title", "year_version", "jurisdiction", "status"]) {
      if (!source?.[field]) errors.push(`${source?.source_id || "unknown"}: ${field} is required`);
    }
    if (source?.legacy_v1 === true) {
      errors.push(`${source.source_id}: legacy V1 material is forbidden in the source registry`);
    }
  }
  return { ok: errors.length === 0, errors, sourceIds: ids };
}

export function validateClinicalRule(rule, sources = SOURCE_REGISTRY) {
  const errors = [];
  const sourceIds = new Set(sources.map((source) => source.source_id));
  const statuses = new Set(Object.values(CLINICAL_RULE_STATUS));
  const effects = new Set(Object.values(CLINICAL_RUNTIME_EFFECT));

  if (!rule?.rule_id) errors.push("rule_id is required");
  if (!rule?.module) errors.push(`${rule?.rule_id || "unknown"}: module is required`);
  if (!rule?.rule_type) errors.push(`${rule?.rule_id || "unknown"}: rule_type is required`);
  if (!rule?.claim) errors.push(`${rule?.rule_id || "unknown"}: claim is required`);
  if (!statuses.has(rule?.review_status)) {
    errors.push(`${rule?.rule_id || "unknown"}: invalid review_status`);
  }
  if (rule?.legacy_v1 === true) {
    errors.push(`${rule.rule_id}: legacy V1 material cannot be clinical evidence`);
  }

  const ruleSources = uniqueStrings(rule?.source_ids);
  if (!ruleSources.length) errors.push(`${rule?.rule_id || "unknown"}: source_ids are required`);
  for (const sourceId of ruleSources) {
    if (!sourceIds.has(sourceId)) errors.push(`${rule.rule_id}: unknown source ${sourceId}`);
  }

  const allowedEffects = uniqueStrings(rule?.allowed_runtime_effects);
  for (const effect of allowedEffects) {
    if (!effects.has(effect)) errors.push(`${rule.rule_id}: unknown runtime effect ${effect}`);
  }
  if (rule?.review_status !== CLINICAL_RULE_STATUS.APPROVED && allowedEffects.length) {
    errors.push(`${rule.rule_id}: non-approved rule cannot have runtime effects`);
  }
  if (
    rule?.review_status === CLINICAL_RULE_STATUS.APPROVED &&
    (rule?.risk_class === "high" || HIGH_RISK_RULE_TYPES.includes(rule?.rule_type)) &&
    uniqueStrings(rule?.reviewed_by).length < 2
  ) {
    errors.push(`${rule.rule_id}: high-risk approval requires at least two reviewers`);
  }
  return { ok: errors.length === 0, errors };
}

export function ruleAllowsRuntimeEffect(rule, effect, sources = SOURCE_REGISTRY) {
  if (!rule || rule.review_status !== CLINICAL_RULE_STATUS.APPROVED) return false;
  if (!validateClinicalRule(rule, sources).ok) return false;
  return uniqueStrings(rule.allowed_runtime_effects).includes(effect);
}

export function approvedRulesForEffect(
  ruleIds,
  effect,
  registry = CLINICAL_RULE_REGISTRY,
  sources = SOURCE_REGISTRY
) {
  const requested = new Set(uniqueStrings(ruleIds));
  return registry.filter(
    (rule) => requested.has(rule.rule_id) && ruleAllowsRuntimeEffect(rule, effect, sources)
  );
}

export function clinicalGovernanceReadiness(
  registry = CLINICAL_RULE_REGISTRY,
  sources = SOURCE_REGISTRY
) {
  const sourceValidation = validateSourceRegistry(sources);
  const ruleErrors = registry.flatMap((rule) => validateClinicalRule(rule, sources).errors);
  const pendingRules = registry
    .filter((rule) => rule.review_status !== CLINICAL_RULE_STATUS.APPROVED)
    .map((rule) => rule.rule_id);
  return {
    version: CLINICAL_GOVERNANCE_VERSION,
    source_registry_version: SOURCE_REGISTRY_VERSION,
    clinical_rule_registry_version: CLINICAL_RULE_REGISTRY_VERSION,
    structurally_valid: sourceValidation.ok && ruleErrors.length === 0,
    errors: [...sourceValidation.errors, ...ruleErrors],
    pending_rule_ids: pendingRules,
    learner_release_ready: sourceValidation.ok && ruleErrors.length === 0 && pendingRules.length === 0,
  };
}

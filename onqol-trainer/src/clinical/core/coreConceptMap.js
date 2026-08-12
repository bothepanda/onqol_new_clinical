// Router vocabulary for the universal action library.
//
// Same contract as the disease router dictionaries: this is a vocabulary layer,
// not a clinical card. Concepts here map to core action ids only. When a disease
// dictionary already defines a concept, the disease mapping wins during
// composition, because it is the more specific one.

export const coreRouterConceptMap = {
  // consent and patient communication
  informed_consent: ["informed_consent"],
  consent_for_surgery: ["informed_consent"],
  risks_and_alternatives: ["informed_consent"],
  explain_to_patient: ["explain_to_patient"],
  family_communication: ["explain_to_patient"],
  breaking_news: ["explain_to_patient"],

  // team notification
  notify_anaesthesia: ["notify_anesthesia"],
  anaesthesia_assessment: ["notify_anesthesia"],
  anaesthesiologist_call: ["notify_anesthesia"],
  notify_theatre: ["notify_operating_team"],
  operating_room_preparation: ["notify_operating_team"],
  surgical_team_activation: ["notify_operating_team"],

  // perioperative safety
  time_out: ["who_time_out"],
  sign_in: ["who_sign_in"],
  sign_out: ["who_sign_out"],
  preoperative_risk_assessment: ["preop_risk_assessment"],
  comorbidity_assessment: ["preop_risk_assessment"],
  asa_classification: ["preop_risk_assessment"],
  allergy_history: ["preop_risk_assessment"],
  vte_prophylaxis: ["vte_risk_assessment"],
  thromboprophylaxis: ["vte_risk_assessment"],

  // systemic response
  sepsis: ["recognize_sepsis"],
  septic_shock: ["recognize_sepsis"],
  sirs: ["recognize_sepsis"],
  organ_dysfunction: ["recognize_sepsis"],

  // monitoring
  vital_signs_monitoring: ["vital_signs_reassessment"],
  haemodynamic_monitoring: ["vital_signs_reassessment"],
  repeat_observations: ["vital_signs_reassessment"],

  // escalation and limits of competence
  escalate_to_senior: ["call_senior_surgeon"],
  senior_surgeon_call: ["call_senior_surgeon"],
  consultant_review: ["call_senior_surgeon"],
  second_opinion: ["call_senior_surgeon"],
  escalate_to_intensive_care: ["call_intensive_care"],
  resuscitation_team_call: ["call_intensive_care"],
  icu_referral: ["call_intensive_care"],
  declare_uncertainty: ["declare_uncertainty"],
  insufficient_data_statement: ["declare_uncertainty"],
  limits_of_competence: ["declare_uncertainty", "call_senior_surgeon"],

  // hand-over and documentation
  structured_handover: ["structured_handover"],
  sbar_report: ["structured_handover"],
  shift_handover: ["structured_handover"],
  postoperative_reassessment: ["postoperative_reassessment"],
  postoperative_round: ["postoperative_reassessment"],
  discharge_plan: ["discharge_and_followup"],
  follow_up_plan: ["discharge_and_followup"],
  return_precautions: ["discharge_and_followup"],
  clinical_documentation: ["document_decision"],
  record_rationale: ["document_decision"],
};

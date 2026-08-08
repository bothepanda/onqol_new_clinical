// Evidence anchors for the universal (non-disease-specific) action library.
//
// Provenance tiers follow PRD corpus/02-metodika-urovni-resursa.md:
//   T1 - direct guideline recommendation
//   T2 - resource branch named by the guideline itself
//   B  - базовая подготовка: teaching-level knowledge (semiotics, generic
//        perioperative practice). May teach and guide, may NOT be the scored
//        correct answer. Same standing as T3.
//
// kz_protocol_status uses "КП?" where the mapping to КП МЗ РК has not been
// verified yet. "КП?" is deliberately distinct from "КП−" (checked, not
// covered): we do not assert coverage we have not looked up.
//
// verification_status marks entries whose exact bibliographic string still
// needs to be confirmed against the primary document before external release.

export const coreEvidence = {
  references: [
    {
      id: "who-ssc-sign-in",
      name: "WHO Surgical Safety Checklist",
      year: 2009,
      citation:
        "World Health Organization. WHO Guidelines for Safe Surgery 2009: Safe Surgery Saves Lives. Geneva: WHO; 2009.",
      section: "Checklist - Sign In (before induction of anaesthesia)",
      recommendation:
        "Before induction of anaesthesia the team confirms patient identity, site, procedure and consent, checks the anaesthesia machine and medication, confirms pulse oximetry, and reviews known allergy, difficult airway and aspiration risk, and expected blood loss.",
      strength: "strong",
      certainty: "not GRADE (WHO guideline)",
      provenance: "T1",
      kz_protocol_status: "КП?",
      license: "public WHO document",
      local_note:
        "Applies to every operative case regardless of nosology. Mapping to Kazakhstan operating-room documentation requirements is not yet verified.",
    },
    {
      id: "who-ssc-time-out",
      name: "WHO Surgical Safety Checklist",
      year: 2009,
      citation:
        "World Health Organization. WHO Guidelines for Safe Surgery 2009: Safe Surgery Saves Lives. Geneva: WHO; 2009.",
      section: "Checklist - Time Out (before skin incision)",
      recommendation:
        "Before skin incision the whole team pauses to confirm names and roles, patient, site and procedure, anticipated critical events, whether antibiotic prophylaxis was given within the last 60 minutes, and whether imaging is displayed.",
      strength: "strong",
      certainty: "not GRADE (WHO guideline)",
      provenance: "T1",
      kz_protocol_status: "КП?",
      license: "public WHO document",
      local_note:
        "The 60-minute antibiotic window is the checklist item that most often links to the disease-specific prophylaxis action.",
    },
    {
      id: "who-safe-surgery-consent",
      name: "WHO Guidelines for Safe Surgery",
      year: 2009,
      citation:
        "World Health Organization. WHO Guidelines for Safe Surgery 2009: Safe Surgery Saves Lives. Geneva: WHO; 2009.",
      section: "Ten essential objectives for safe surgery - objective 1",
      recommendation:
        "The team will operate on the correct patient at the correct site, having confirmed the patient's identity and the patient's own confirmation of the procedure and of consent.",
      strength: "strong",
      certainty: "not GRADE (WHO guideline)",
      provenance: "T1",
      kz_protocol_status: "КП?",
      license: "public WHO document",
      local_note:
        "Informed consent is treated here as a safety objective, not as a legal instrument. Kazakhstan consent-form requirements are a separate legal layer and are out of corpus scope.",
    },
    {
      id: "who-handover-sbar",
      name: "WHO Patient Safety Solutions - Communication During Patient Hand-Overs",
      year: 2007,
      citation:
        "World Health Organization, Joint Commission International. Patient Safety Solutions, volume 1, solution 3: Communication During Patient Hand-Overs. Geneva: WHO; 2007.",
      section: "Solution 3",
      recommendation:
        "Use a standardised approach to hand-over communication, such as SBAR (Situation, Background, Assessment, Recommendation), and allow the receiving clinician opportunity to ask and resolve questions.",
      strength: "recommended practice",
      certainty: "not GRADE",
      provenance: "T1",
      kz_protocol_status: "КП?",
      license: "public WHO document",
      verification_status:
        "NEEDS_SOURCE_VERIFICATION: confirm volume/solution numbering against the primary WHO document before external release.",
      local_note:
        "Anchors both escalation calls and transfer hand-over. Structured hand-over is what makes an escalation call scoreable rather than a vague request for help.",
    },
    {
      id: "eras-emergency-laparotomy-prehab",
      name: "ERAS Society guidelines - emergency laparotomy",
      year: 2023,
      citation:
        "Enhanced Recovery After Surgery (ERAS) Society guidelines for perioperative care in emergency laparotomy.",
      section: "Preoperative optimisation",
      recommendation:
        "Emergency abdominal surgery patients benefit from structured preoperative optimisation: risk assessment, fluid and electrolyte correction, timely antibiotics where indicated, and venous thromboembolism risk assessment.",
      strength: "conditional",
      certainty: "varies by item",
      provenance: "T2",
      kz_protocol_status: "КП?",
      verification_status:
        "NEEDS_SOURCE_VERIFICATION: exact citation, year and recommendation wording must be confirmed against the published ERAS emergency laparotomy guideline before any of these actions become scoreable.",
      local_note:
        "Used as the umbrella anchor for generic preoperative preparation. Individual items must be split into their own references before scoring is enabled.",
    },
    {
      id: "base-clinical-limits-of-competence",
      name: "Базовая клиническая подготовка",
      year: null,
      citation:
        "Общепринятая учебная база хирургической подготовки. Конкретный учебный источник подлежит внесению при сборке базового корпуса.",
      section: "Границы компетентности и эскалация",
      recommendation:
        "Распознавание границ собственной компетентности и своевременный вызов старшего коллеги или профильной службы является ожидаемым профессиональным поведением, а не признаком несостоятельности. Вызов помощи после выполнения доступного минимума оценки отличается от вызова вместо оценки.",
      strength: "teaching-level",
      certainty: "not GRADE",
      provenance: "B",
      kz_protocol_status: "КП?",
      verification_status:
        "NEEDS_SOURCE_VERIFICATION: to be replaced by a citable base-corpus source (StatPearls / CC-licensed textbook layer) when corpus/base is ingested.",
      local_note:
        "Tier B may teach and guide but must never be the scored correct answer, by the same rule that applies to T3.",
    },
    {
      id: "base-clinical-uncertainty-disclosure",
      name: "Базовая клиническая подготовка",
      year: null,
      citation:
        "Общепринятая учебная база хирургической подготовки. Конкретный учебный источник подлежит внесению при сборке базового корпуса.",
      section: "Работа в условиях неопределённости",
      recommendation:
        "Явное называние неопределённости и того, каких данных не хватает для решения, является рабочим клиническим навыком: оно делает рассуждение проверяемым и позволяет старшему коллеге вмешаться точечно.",
      strength: "teaching-level",
      certainty: "not GRADE",
      provenance: "B",
      kz_protocol_status: "КП?",
      verification_status:
        "NEEDS_SOURCE_VERIFICATION: to be replaced by a citable base-corpus source when corpus/base is ingested.",
      local_note:
        "Directly supports the кейс-пробел mode described in the PRD: reasoning correctly in the absence of a protocol.",
    },
  ],
};

export const coreEvidenceById = new Map(
  coreEvidence.references.map((reference) => [reference.id, reference])
);

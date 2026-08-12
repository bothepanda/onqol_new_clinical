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
      id: "who-ssc-sign-out",
      name: "WHO Surgical Safety Checklist",
      year: 2009,
      citation:
        "World Health Organization. WHO Guidelines for Safe Surgery 2009: Safe Surgery Saves Lives. Geneva: WHO; 2009.",
      section: "Checklist - Sign Out (before patient leaves operating room)",
      recommendation:
        "Before the patient leaves the operating room, the team confirms the procedure, specimen labelling, equipment problems and key concerns for recovery and management.",
      strength: "strong",
      certainty: "not GRADE (WHO guideline)",
      provenance: "T1",
      kz_protocol_status: "КП?",
      license: "public WHO document",
      local_note:
        "Kept separate from Sign In and Time Out so postoperative transfer cannot imply completion of a checkpoint that was never recorded.",
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
      id: "wses-iai-2021-sepsis",
      name: "WSES/GAIS/SIS-E/WSIS/AAST global clinical pathways for intra-abdominal infections",
      year: 2021,
      citation:
        "Sartelli M, et al. WSES/GAIS/SIS-E/WSIS/AAST global clinical pathways for patients with intra-abdominal infections. World J Emerg Surg. 2021. doi:10.1186/s13017-021-00387-8",
      section: "Sepsis recognition and early source control",
      recommendation:
        "Intra-abdominal infection with signs of organ dysfunction is a time-critical condition: early recognition of sepsis, prompt resuscitation and timely source control determine outcome.",
      strength: "strong",
      certainty: "varies by item",
      provenance: "T1",
      kz_protocol_status: "КП?",
      license: "CC BY 4.0",
      local_note:
        "Already registered in corpus/emergency/corpus_manifest.yaml as wses_global_iai_2021 with ingest_fulltext: true. Used here as the anchor for the universal sepsis-recognition action.",
    },

    // --- Базовый слой «Б». Источник: corpus/base/manifest.yaml -------------
    // Facts stated in our own words with attribution. StatPearls is CC BY-NC-ND:
    // the article is not ingested, reproduced or paraphrased wholesale.
    {
      id: "base-appendicitis-pain-migration",
      name: "StatPearls: Appendicitis",
      year: 2024,
      citation:
        "Jones MW, Lopez RA, Deppen JG, Kendall BJ. Appendicitis. StatPearls [Internet]. Treasure Island (FL): StatPearls Publishing. Bookshelf ID NBK493193, PMID 29630245. Last update 12 Feb 2024.",
      section: "History and Physical",
      recommendation:
        "Ранняя боль при аппендиците висцеральная и потому нелокализованная — околопупочная, по афферентам T8–T10. Смещение в правую подвздошную область отражает переход на париетальную брюшину. Миграция боли — это описание механизма, а не диагностический критерий.",
      strength: "teaching-level",
      certainty: "not GRADE",
      provenance: "B",
      kz_protocol_status: "КП?",
      license: "CC BY-NC-ND 4.0 (citation only, not ingested)",
      local_note:
        "Explains to the learner why the question about pain migration is asked at all. Must not be used as a scored diagnostic criterion.",
    },
    {
      id: "base-appendicitis-peritoneal-signs",
      name: "StatPearls: Appendicitis",
      year: 2024,
      citation:
        "Jones MW, Lopez RA, Deppen JG, Kendall BJ. Appendicitis. StatPearls [Internet]. Treasure Island (FL): StatPearls Publishing. Bookshelf ID NBK493193, PMID 29630245. Last update 12 Feb 2024.",
      section: "History and Physical",
      recommendation:
        "Точка Мак-Бернея — примерно 1,5–2 дюйма от передней верхней подвздошной ости по линии к пупку. Локальное напряжение и болезненность отдачи в правом нижнем квадранте встречаются часто, но не специфичны для аппендицита и бывают при других состояниях. В ранней стадии физикальные находки могут быть скудными.",
      strength: "teaching-level",
      certainty: "not GRADE",
      provenance: "B",
      kz_protocol_status: "КП?",
      license: "CC BY-NC-ND 4.0 (citation only, not ingested)",
      local_note:
        "The non-specificity clause matters pedagogically: it is what stops a learner from treating a positive sign as a diagnosis.",
    },
    {
      id: "base-appendicitis-special-signs",
      name: "StatPearls: Appendicitis",
      year: 2024,
      citation:
        "Jones MW, Lopez RA, Deppen JG, Kendall BJ. Appendicitis. StatPearls [Internet]. Treasure Island (FL): StatPearls Publishing. Bookshelf ID NBK493193, PMID 29630245. Last update 12 Feb 2024.",
      section: "History and Physical",
      recommendation:
        "Симптом Ровзинга — боль в правом нижнем квадранте при пальпации левого нижнего. Симптом Данфи — усиление боли при кашле и любом повышении внутрибрюшного давления. Псоас-симптом — боль при разгибании правого бедра или его сгибании против сопротивления, из-за раздражения поясничной мышцы. Ни один из них не является диагностическим.",
      strength: "teaching-level",
      certainty: "not GRADE",
      provenance: "B",
      kz_protocol_status: "КП?",
      license: "CC BY-NC-ND 4.0 (citation only, not ingested)",
      local_note:
        "Router dictionary already recognises these signs by name; this is the layer that lets the mentor say what they mean without inventing it.",
    },
    {
      id: "base-acute-abdomen-history",
      name: "StatPearls: Acute Abdomen",
      year: 2025,
      citation:
        "Patterson JW, Kashyap S, Dominique E. Acute Abdomen. StatPearls [Internet]. Treasure Island (FL): StatPearls Publishing. Bookshelf ID NBK459328, PMID 29083722. Last update 15 Feb 2025.",
      section: "History and Physical",
      recommendation:
        "Задача первичного анамнеза и осмотра при острой боли в животе — выделить тех, кому нужно срочное вмешательство. Опорные элементы: локализация и иррадиация, начало и длительность, интенсивность, характер, провоцирующие и облегчающие факторы, сопутствующие симптомы, гинекологический и половой анамнез с датой последней менструации, перенесённые операции, лекарственный анамнез. Распознать разворачивающуюся катастрофу на ранней неспецифической стадии труднее, чем состоявшийся острый живот.",
      strength: "teaching-level",
      certainty: "not GRADE",
      provenance: "B",
      kz_protocol_status: "КП?",
      license: "CC BY-NC-ND 4.0 (citation only, not ingested)",
      local_note:
        "This is the structure behind the focused_history action. It gives the mentor something to say about what a good history contains.",
    },

    {
      id: "base-clinical-limits-of-competence",
      name: "StatPearls: Closed Loop Communication Training in Medical Simulation",
      year: 2023,
      citation:
        "Tiel Groenestege-Kreb D, et al. Closed Loop Communication Training in Medical Simulation. StatPearls [Internet]. Treasure Island (FL): StatPearls Publishing. Bookshelf ID NBK549899, PMID 31751089. Last update 23 Jan 2023.",
      section: "Introduction; Issues of Concern",
      recommendation:
        "Иерархия в клинической команде и нежелание возражать вышестоящему — известный барьер коммуникации и признанная причина сбоев в передаче информации. Способность высказаться и привлечь помощь рассматривается как тренируемый навык, а не как черта характера; отработка в симуляции повышает её использование в реальной работе.",
      strength: "teaching-level",
      certainty: "not GRADE",
      provenance: "B",
      kz_protocol_status: "КП?",
      license: "CC BY-NC-ND 4.0 (citation only, not ingested)",
      coverage_note:
        "PARTIAL. Источник обосновывает, что иерархический барьер реален и что навык тренируем. Он НЕ утверждает напрямую, что вызов старшего после выполненного минимума — признак зрелости; эта формулировка в escalation_policy остаётся авторской и идёт рецензенту.",
      local_note:
        "Tier B may teach and guide but must never be the scored correct answer, by the same rule that applies to T3.",
    },
    {
      id: "base-clinical-uncertainty-disclosure",
      name: "StatPearls: Medical Error Reduction and Prevention",
      year: 2024,
      citation:
        "Rodziewicz TL, Houseman B, Vaqar S, Hipskind JE. Medical Error Reduction and Prevention. StatPearls [Internet]. Treasure Island (FL): StatPearls Publishing. Bookshelf ID NBK499956, PMID 29763131. Last update 12 Feb 2024.",
      section: "Clinical Significance; root causes of error",
      recommendation:
        "Сотрудников следует поощрять задавать вопросы при неуверенности. В типологии корневых причин ошибки отдельно стоят человеческий фактор с неполной оценкой, коммуникационные сбои с несообщением о проблеме, а также недостаточный надзор и укомплектованность.",
      strength: "teaching-level",
      certainty: "not GRADE",
      provenance: "B",
      kz_protocol_status: "КП?",
      license: "CC BY-NC-ND 4.0 (citation only, not ingested)",
      local_note:
        "Supports the кейс-пробел mode from the PRD: naming what you do not know is framed as error prevention, not as failure.",
    },
    {
      id: "base-closed-loop-communication",
      name: "StatPearls: Closed Loop Communication Training in Medical Simulation",
      year: 2023,
      citation:
        "Tiel Groenestege-Kreb D, et al. Closed Loop Communication Training in Medical Simulation. StatPearls [Internet]. Treasure Island (FL): StatPearls Publishing. Bookshelf ID NBK549899, PMID 31751089. Last update 23 Jan 2023.",
      section: "Introduction; Procedural Skills Assessment",
      recommendation:
        "Замкнутый контур коммуникации строится из call-out — первичного проговаривания значимого изменения или наблюдения — и подтверждения приёма принимающей стороной. Дефицит устной коммуникации усугубляется прерываниями, недопониманием и нехваткой стандартизированной терминологии.",
      strength: "teaching-level",
      certainty: "not GRADE",
      provenance: "B",
      kz_protocol_status: "КП?",
      license: "CC BY-NC-ND 4.0 (citation only, not ingested)",
      local_note:
        "More precise anchor for structured_handover than the WHO hand-over solution, whose exact numbering is still unverified. Both are kept: WHO for the SBAR structure, this for the call-out/check-back loop.",
    },
  ],
};

export const coreEvidenceById = new Map(
  coreEvidence.references.map((reference) => [reference.id, reference])
);

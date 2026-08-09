// V3.5 acute-abdomen alternatives held in faculty preview.
//
// WHAT IS AUTHORED AND WHAT IS NOT
//
// CLAUDE_CODE_ONQOL_V3_5_ADDENDUM.md section 5 authors four things per entry:
// the hidden truth, the discriminators, the safe endpoint, and the review
// status. It then requires nine more for a working entry: RU/KZ presentation,
// danger class, deterministic findings, trajectory, unsafe delays, acceptable
// endpoints, action map, transitions.
//
// Those nine do not exist yet. They are not filled in here, and they are not
// approximated from what an appendicitis case happens to contain. Writing
// plausible findings for ectopic pregnancy would be exactly the unreviewed
// clinical content this project refuses to ship - and it would look finished,
// which is worse than looking empty.
//
// So each entry declares `missing_for_authoring`, and the validator reports it.
// The master plan calls this status `disease_stub_inactive`
// (ONQOL_FULL_CLINICAL_LIBRARY_MASTER_PLAN.md 13.4): "Нынешние восемь mimics не
// считать authoring_complete, если у них нет полного disease-specific source
// package, action map, transitions и reviewed safe endpoint."
//
// The addendum's own status string is therefore NOT used. It says
// `authoring_complete_inactive`; nothing here is authoring-complete.
//
// PERFORATED ULCER IS NOT A MIMIC
//
// Master plan 13.2 is explicit: remove it from the mimic category, keep it a
// full DiseaseCard that attaches to several presentations. The addendum lists it
// as MIMIC-PERF-ULCER-001. The master plan wins, per the owner's instruction to
// use it for schemas and relationships.
//
// The count of eight is preserved, because the addendum's completeness test
// asks for eight alternatives - but each carries an explicit `entity_type`, so
// nothing pretends a principal surgical disease is a distractor.

/** What every entry still needs before it could ever be selectable. */
const MISSING_FOR_AUTHORING = Object.freeze([
  "ru_kz_presentation",
  "deterministic_findings",
  "trajectory",
  "unsafe_delays",
  "acceptable_endpoints",
  "action_map",
  "transitions",
  "danger_class",
  "disease_specific_source_package",
]);

const stub = (entry) =>
  Object.freeze({
    entity_type: "mimic",
    // Master plan 13.4. Deliberately not the addendum's
    // "authoring_complete_inactive": these are stubs, and the status must say so.
    runtime_status: "disease_stub_inactive",
    eligible_for_scoring: false,
    source_review_status: "pending_disease_package",
    clinical_review_status: "pending",
    local_review_status: "pending_when_applicable",
    language_review_status: "pending_for_new_ru_kk_text",
    missing_for_authoring: MISSING_FOR_AUTHORING,
    ...entry,
  });

/**
 * @typedef {Object} MimicStub
 * @property {string} mimic_id
 * @property {string} disease_card_id     the master plan DIS-* card this becomes
 * @property {string} entity_type         mimic | principal_disease
 * @property {string} hidden_truth_ru
 * @property {string} discriminators_ru   authored, section 5
 * @property {string} safe_endpoint_ru    authored, section 5
 */

/** @type {MimicStub[]} */
export const V35_MIMICS = Object.freeze([
  stub({
    mimic_id: "MIMIC-ECTOPIC-001",
    disease_card_id: "DIS-ECTOPIC-PREGNANCY",
    hidden_truth_ru: "Внематочная беременность",
    discriminators_ru:
      "Возможная беременность, pelvic/RLQ pain, beta-hCG branch, bleeding или syncope branch",
    safe_endpoint_ru: "Urgent gynecology pathway, stability first",
    presentation_cards: ["PRES-RLQ-PAIN", "PRES-PELVIC-PAIN"],
  }),
  stub({
    mimic_id: "MIMIC-TORSION-001",
    disease_card_id: "DIS-ADNEXAL-TORSION",
    hidden_truth_ru: "Перекрут придатков",
    discriminators_ru: "Внезапная односторонняя тазовая боль, тошнота/рвота, adnexal branch",
    safe_endpoint_ru: "Urgent gynecology surgical assessment",
    presentation_cards: ["PRES-RLQ-PAIN", "PRES-PELVIC-PAIN"],
  }),
  stub({
    mimic_id: "MIMIC-STONE-001",
    disease_card_id: "DIS-URETERIC-STONE",
    hidden_truth_ru: "Камень правого мочеточника",
    discriminators_ru: "Коликообразная flank-to-groin pain, hematuria branch",
    safe_endpoint_ru:
      "Analgesia/imaging/urology path; infected obstruction marked separately",
    presentation_cards: ["PRES-RLQ-PAIN"],
  }),
  stub({
    mimic_id: "MIMIC-PYELO-001",
    disease_card_id: "DIS-PYELONEPHRITIS",
    hidden_truth_ru: "Острый пиелонефрит или уросепсис",
    discriminators_ru: "Fever, flank pain, urinary symptoms, pyuria/systemic branch",
    safe_endpoint_ru: "Sepsis assessment, antimicrobial and obstruction check path",
    presentation_cards: ["PRES-RLQ-PAIN"],
  }),
  stub({
    mimic_id: "MIMIC-GASTRO-001",
    disease_card_id: "DIS-INFECTIOUS-GASTROENTERITIS",
    hidden_truth_ru: "Инфекционный гастроэнтерит",
    discriminators_ru: "Диарея/рвота, exposure branch, diffuse cramping, serial abdominal exam",
    safe_endpoint_ru: "Supportive/infectious pathway with return triggers",
    presentation_cards: ["PRES-RLQ-PAIN"],
  }),
  stub({
    mimic_id: "MIMIC-ADENITIS-001",
    disease_card_id: "DIS-MESENTERIC-ADENITIS",
    hidden_truth_ru: "Мезентериальный лимфаденит",
    discriminators_ru:
      "Younger modifier, recent infection branch, nodes with normal appendix on imaging",
    safe_endpoint_ru: "Observation or specialty follow-up according to authored severity",
    presentation_cards: ["PRES-RLQ-PAIN"],
  }),
  stub({
    mimic_id: "MIMIC-ILEITIS-001",
    disease_card_id: "DIS-TERMINAL-ILEITIS",
    hidden_truth_ru: "Терминальный илеит или болезнь Крона",
    discriminators_ru: "Recurrent symptoms, diarrhea/weight-loss branch, terminal ileum imaging",
    safe_endpoint_ru: "Gastroenterology/surgical safety endpoint, no invented therapy",
    presentation_cards: ["PRES-RLQ-PAIN"],
  }),
  stub({
    // Reclassified per master plan 13.2. Kept in the catalogue so the count of
    // eight holds, typed so nothing treats it as a distractor.
    mimic_id: "MIMIC-PERF-ULCER-001",
    disease_card_id: "DIS-PERFORATED-PUD",
    entity_type: "principal_disease",
    reclassified_from: "mimic",
    reclassification_reason:
      "Master plan 13.2: перфоративная язва — основная хирургическая нозология для внезапной эпигастральной боли, а не тип «мимик». Полноценная DiseaseCard, подключаемая к нескольким Presentation Cards.",
    hidden_truth_ru: "Перфоративная язва",
    discriminators_ru: "Sudden epigastric-to-generalized pain, peritonitis, free-air branch",
    safe_endpoint_ru: "Resuscitation and urgent source-control pathway",
    presentation_cards: ["PRES-EPIGASTRIC-PAIN", "PRES-DIFFUSE-PERITONITIS"],
  }),
]);

export const mimicsById = new Map(V35_MIMICS.map((mimic) => [mimic.mimic_id, mimic]));

/**
 * What faculty preview shows for an entry, and why it cannot be played.
 *
 * Addendum 5: "Faculty preview показывает hidden truth, все findings,
 * inactivity reason и открытые review gates."
 */
export function facultyPreview(mimic) {
  return {
    mimic_id: mimic.mimic_id,
    entity_type: mimic.entity_type,
    hidden_truth_ru: mimic.hidden_truth_ru,
    discriminators_ru: mimic.discriminators_ru,
    safe_endpoint_ru: mimic.safe_endpoint_ru,
    inactivity_reason_ru:
      "Карточка не авторская целиком: отсутствуют " +
      mimic.missing_for_authoring.join(", ") +
      ". До независимого клинического ревью недоступна резиденту и не участвует в оценке.",
    open_review_gates: {
      source: mimic.source_review_status,
      clinical: mimic.clinical_review_status,
      local: mimic.local_review_status,
      language: mimic.language_review_status,
    },
  };
}

// Alternative diseases for PRES-RLQ-PAIN, held as inactive stubs.
//
// `MIMIC` IS NOT AN ENTITY TYPE
//
// Master plan 2, verbatim: "Mimic не является отдельным типом карточки... Один и
// тот же диагноз может быть целевой нозологией в одной презентации и мимиком в
// другой." Ectopic pregnancy is the hidden truth of PRES-PELVIC-PAIN and an
// alternative under PRES-RLQ-PAIN. The same card, two relationships.
//
// So every entry here is an ALTERNATIVE DISEASE STUB: a reference to the
// DiseaseCard it will become, plus the link to the presentation it sits under.
// "Mimic" survives only as the name of that link, never as a kind of thing. An
// earlier version of this file typed one entry as `principal_disease` and the
// rest as `mimic`; that was the same category error one level down, and it is
// gone.
//
// NOTHING HERE IS AUTHORED
//
// Addendum 5 authors four fields per entry: hidden truth, discriminators, safe
// endpoint, review status. It then requires nine more before an entry could
// work: RU/KZ presentation, danger class, deterministic findings, trajectory,
// unsafe delays, acceptable endpoints, action map, transitions.
//
// Those nine are not filled in and are not approximated. Writing plausible
// findings for ectopic pregnancy would be unreviewed clinical content that
// LOOKS finished, which is worse than an obvious gap. Each entry lists what it
// is missing, and the validator refuses to activate it.
//
// Status is `disease_stub_inactive` (master plan 13.4), not the addendum's
// `authoring_complete_inactive`: nothing here is authoring-complete.

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
    runtime_status: "disease_stub_inactive",
    eligible_for_scoring: false,
    source_review_status: "pending_disease_package",
    clinical_review_status: "pending",
    local_review_status: "pending_when_applicable",
    language_review_status: "pending_for_new_ru_kk_text",
    missing_for_authoring: MISSING_FOR_AUTHORING,
    // The relationship, held on the entry because the PresentationCard does not
    // exist as an object yet. When it does, this moves there - master plan 2:
    // "связь «может имитировать» хранится в PresentationCard".
    presentation_relationships: Object.freeze([
      Object.freeze({ presentation_id: "PRES-RLQ-PAIN", relationship: "may_mimic" }),
    ]),
    ...entry,
  });

/**
 * @typedef {Object} AlternativeDiseaseStub
 * @property {string} alternative_id
 * @property {string} disease_card_id       the DiseaseCard this becomes
 * @property {string} hidden_truth_ru
 * @property {string} discriminators_ru     authored, addendum 5
 * @property {string} safe_endpoint_ru      authored, addendum 5
 * @property {object[]} presentation_relationships
 */
export const ALTERNATIVE_DISEASES = Object.freeze([
  stub({
    alternative_id: "ALT-ECTOPIC-001",
    legacy_id: "MIMIC-ECTOPIC-001",
    disease_card_id: "DIS-ECTOPIC-PREGNANCY",
    hidden_truth_ru: "Внематочная беременность",
    discriminators_ru:
      "Возможная беременность, pelvic/RLQ pain, beta-hCG branch, bleeding или syncope branch",
    safe_endpoint_ru: "Urgent gynecology pathway, stability first",
    presentation_relationships: [
      { presentation_id: "PRES-RLQ-PAIN", relationship: "may_mimic" },
      { presentation_id: "PRES-PELVIC-PAIN", relationship: "principal_hidden_truth" },
    ],
  }),
  stub({
    alternative_id: "ALT-TORSION-001",
    legacy_id: "MIMIC-TORSION-001",
    disease_card_id: "DIS-ADNEXAL-TORSION",
    hidden_truth_ru: "Перекрут придатков",
    discriminators_ru: "Внезапная односторонняя тазовая боль, тошнота/рвота, adnexal branch",
    safe_endpoint_ru: "Urgent gynecology surgical assessment",
    presentation_relationships: [
      { presentation_id: "PRES-RLQ-PAIN", relationship: "may_mimic" },
      { presentation_id: "PRES-PELVIC-PAIN", relationship: "principal_hidden_truth" },
    ],
  }),
  stub({
    alternative_id: "ALT-STONE-001",
    legacy_id: "MIMIC-STONE-001",
    disease_card_id: "DIS-URETERIC-STONE",
    hidden_truth_ru: "Камень правого мочеточника",
    discriminators_ru: "Коликообразная flank-to-groin pain, hematuria branch",
    safe_endpoint_ru: "Analgesia/imaging/urology path; infected obstruction marked separately",
  }),
  stub({
    alternative_id: "ALT-PYELO-001",
    legacy_id: "MIMIC-PYELO-001",
    disease_card_id: "DIS-PYELONEPHRITIS",
    hidden_truth_ru: "Острый пиелонефрит или уросепсис",
    discriminators_ru: "Fever, flank pain, urinary symptoms, pyuria/systemic branch",
    safe_endpoint_ru: "Sepsis assessment, antimicrobial and obstruction check path",
  }),
  stub({
    alternative_id: "ALT-GASTRO-001",
    legacy_id: "MIMIC-GASTRO-001",
    disease_card_id: "DIS-INFECTIOUS-GASTROENTERITIS",
    hidden_truth_ru: "Инфекционный гастроэнтерит",
    discriminators_ru: "Диарея/рвота, exposure branch, diffuse cramping, serial abdominal exam",
    safe_endpoint_ru: "Supportive/infectious pathway with return triggers",
  }),
  stub({
    alternative_id: "ALT-ADENITIS-001",
    legacy_id: "MIMIC-ADENITIS-001",
    disease_card_id: "DIS-MESENTERIC-ADENITIS",
    hidden_truth_ru: "Мезентериальный лимфаденит",
    discriminators_ru:
      "Younger modifier, recent infection branch, nodes with normal appendix on imaging",
    safe_endpoint_ru: "Observation or specialty follow-up according to authored severity",
  }),
  stub({
    alternative_id: "ALT-ILEITIS-001",
    legacy_id: "MIMIC-ILEITIS-001",
    disease_card_id: "DIS-TERMINAL-ILEITIS",
    hidden_truth_ru: "Терминальный илеит или болезнь Крона",
    discriminators_ru: "Recurrent symptoms, diarrhea/weight-loss branch, terminal ileum imaging",
    safe_endpoint_ru: "Gastroenterology/surgical safety endpoint, no invented therapy",
  }),
  stub({
    alternative_id: "ALT-PERF-ULCER-001",
    legacy_id: "MIMIC-PERF-ULCER-001",
    disease_card_id: "DIS-PERFORATED-PUD",
    hidden_truth_ru: "Перфоративная язва",
    discriminators_ru: "Sudden epigastric-to-generalized pain, peritonitis, free-air branch",
    safe_endpoint_ru: "Resuscitation and urgent source-control pathway",
    // Master plan 13.2 and 6.1: a principal emergency-surgery disease in its own
    // right. Under RLQ pain it is an alternative; under epigastric pain it is the
    // hidden truth. Same card, different relationship - which is precisely why
    // "mimic" cannot be a type.
    presentation_relationships: [
      { presentation_id: "PRES-RLQ-PAIN", relationship: "may_mimic" },
      { presentation_id: "PRES-EPIGASTRIC-PAIN", relationship: "principal_hidden_truth" },
      { presentation_id: "PRES-DIFFUSE-PERITONITIS", relationship: "principal_hidden_truth" },
    ],
  }),
]);

export const alternativesById = new Map(
  ALTERNATIVE_DISEASES.map((entry) => [entry.alternative_id, entry])
);

/** Entries that may mimic a given presentation. */
export function alternativesFor(presentationId) {
  return ALTERNATIVE_DISEASES.filter((entry) =>
    entry.presentation_relationships.some(
      (link) => link.presentation_id === presentationId && link.relationship === "may_mimic"
    )
  );
}

/**
 * What faculty preview shows, and why it cannot be played.
 * Addendum 5: hidden truth, inactivity reason and open review gates.
 */
export function facultyPreview(entry) {
  return {
    alternative_id: entry.alternative_id,
    disease_card_id: entry.disease_card_id,
    hidden_truth_ru: entry.hidden_truth_ru,
    discriminators_ru: entry.discriminators_ru,
    safe_endpoint_ru: entry.safe_endpoint_ru,
    presentation_relationships: entry.presentation_relationships,
    inactivity_reason_ru:
      "Заготовка нозологии, не карточка: отсутствуют " +
      entry.missing_for_authoring.join(", ") +
      ". До независимого клинического ревью недоступна резиденту и не участвует в оценке.",
    open_review_gates: {
      source: entry.source_review_status,
      clinical: entry.clinical_review_status,
      local: entry.local_review_status,
      language: entry.language_review_status,
    },
  };
}

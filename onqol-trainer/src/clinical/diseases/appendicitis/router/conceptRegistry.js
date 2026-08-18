// What a routed concept IS, not just what it maps to.
//
// WHY THIS REPLACES THE FLAT MAP
//
// The old map was `conceptId -> string[]`, and sixteen concepts had an empty
// array. One empty array meant six different things at once:
//
//   - a legitimate hypothesis the learner may hold (ovarian torsion);
//   - a real examination manoeuvre nobody had wired up (rectal examination);
//   - a sign that is part of an examination already modelled (Rovsing);
//   - a question about what the hospital has (resource availability);
//   - an order too vague to act on (\"антибиотики\" - which one, when?);
//   - something genuinely not modelled here (MRI).
//
// Because they were indistinguishable, every one of them produced the same
// non-answer. In the first live run "пальцевое ректальное исследование" was
// recognised by the router, mapped to `[]`, and vanished: no action, no reply,
// no record that the learner had asked. A trainer that silently swallows a
// clinically reasonable request teaches the learner not to ask.
//
// So each concept now declares its KIND, and the engine can respond to each kind
// honestly - including saying "this is not modelled here", which is a real
// answer and a different one from silence.
//
// WHAT THIS FILE IS NOT
//
// It is not a clinical content file. Declaring that `rectal_examination` is an
// action does not decide what a rectal examination FINDS - that is authored
// content and needs a surgeon's signature. Until it has one the action answers
// that it is not modelled, which is true, rather than inventing a normal
// prostate.

/**
 * The kinds a concept may have.
 *
 * The first six are the audit's. `needs_specification` is a seventh, added
 * because "антибиотики" is neither unsupported nor actionable: three different
 * antibiotic actions exist and only the learner knows which one they mean.
 */
export const CONCEPT_KINDS = Object.freeze([
  "action",
  "management_decision",
  "operative_approach",
  "finding_slot",
  "finding_bundle",
  "reasoning_only",
  "resource_query",
  "needs_specification",
  "unsupported",
]);

const action = (mapsTo, extra = {}) => ({ kind: "action", maps_to: mapsTo, ...extra });
const bundle = (mapsTo) => ({ kind: "finding_bundle", maps_to: mapsTo });
const slot = (bundleAction, slotId) => ({
  kind: "finding_slot",
  // A narrow question is answered from the bundle it belongs to, without
  // performing the whole bundle: asking whether Rovsing is positive is not the
  // same as examining the abdomen.
  maps_to: [],
  finding_bundle: bundleAction,
  slot_id: slotId,
});
const reasoning = (note) => ({ kind: "reasoning_only", maps_to: [], note_ru: note });
const managementDecision = (decisionId) => ({
  kind: "management_decision",
  maps_to: [],
  decision_id: decisionId,
});
const operativeApproach = (approach) => ({
  kind: "operative_approach",
  maps_to: [],
  decision_id: "operative_approach",
  approach,
});
const unsupported = (reason) => ({ kind: "unsupported", maps_to: [], reason_ru: reason });

export const APPENDICITIS_CONCEPTS = Object.freeze({
  // --- history -------------------------------------------------------------
  relevant_history: bundle(["focused_history"]),
  pain_history: bundle(["focused_history"]),
  associated_gi_symptoms: bundle(["focused_history"]),
  gynecologic_history: bundle(["focused_history"]),
  medication_allergy_history: bundle(["focused_history"]),
  // A narrow question about urinary symptoms should not hand over the whole
  // history. It reads the urinary part of it and nothing else.
  urinary_symptoms: slot("focused_history", "history.urinary"),

  // --- examination ---------------------------------------------------------
  physical_examination: bundle(["abdominal_exam"]),
  abdominal_examination: bundle(["abdominal_exam"]),
  abdominal_inspection: slot("abdominal_exam", "contour"),
  // "Пальпация живота" is the examination, not one of its findings: a learner
  // who says it is asking to palpate, and gets the whole examination.
  abdominal_palpation: bundle(["abdominal_exam"]),
  rlq_tenderness: slot("abdominal_exam", "tenderness"),
  guarding: slot("abdominal_exam", "guarding"),
  rebound_tenderness: slot("abdominal_exam", "rebound"),
  peritoneal_signs: slot("abdominal_exam", "rebound"),
  // Previously empty arrays. They are slots of an examination that already
  // exists - see v35/examSlots.js, which the owner signed on 10.08.2026.
  rovsing_sign: slot("abdominal_exam", "rovsing"),
  psoas_sign: slot("abdominal_exam", "psoas"),
  obturator_sign: slot("abdominal_exam", "obturator"),
  bowel_sounds: slot("abdominal_exam", "peristalsis"),
  percussion_tenderness: slot("abdominal_exam", "percussion"),
  pelvic_examination: bundle(["pelvic_gynecologic_screen"]),
  cervical_motion_tenderness: slot("pelvic_gynecologic_screen", "cervical_motion"),
  // In the owner's own sample chart, but not among the eleven signed abdominal
  // slots. Declared unsupported rather than quietly answered.
  cva_tenderness: unsupported("Симптом поколачивания не смоделирован в этом кейсе."),

  // --- rectal examination and prostate -------------------------------------
  //
  // The action exists and is recognised. Its findings are authored per
  // phenotype: signed for the pelvic case on 18.08.2026, absent everywhere
  // else. Where they are absent the case card carries the "not modelled"
  // reason on the action itself, so the learner still gets a straight answer
  // rather than an invented normal. See v35/examSlots.js and
  // RECTAL_EXAM_REVIEW.md.
  rectal_examination: action(["rectal_exam"]),
  prostate_examination: action([], {
    findings_status: "AWAITING_CLINICAL_SIGNATURE",
    // Part of the rectal bundle for a male patient, never a separate diagnosis.
    part_of: "rectal_examination",
    sex_restricted: "male",
    unavailable_reason_ru:
      "Оценка простаты пока не смоделирована в этом кейсе: результат не подписан клиницистом.",
  }),
  transrectal_ultrasound: action([], {
    findings_status: "NOT_MODELLED_RESOURCE",
    unavailable_reason_ru:
      "ТРУЗИ не смоделировано как доступный ресурс в этом сценарии.",
  }),

  // --- laboratory and imaging ----------------------------------------------
  cbc: action(["cbc"]),
  crp: action(["crp"]),
  urinalysis: action(["urinalysis"]),
  beta_hcg: action(["pregnancy_test"]),
  basic_biochemistry: action(["biochemistry"]),
  liver_tests: action(["biochemistry"]),
  abdominal_ultrasound: action(["abdominal_ultrasound"]),
  pelvic_ultrasound: action(["pelvic_ultrasound"]),
  ct_abdomen_pelvis: action(["ct_abdomen"]),
  mri_abdomen_pelvis: unsupported("МРТ не смоделирована в этом кейсе."),

  // --- hypotheses ----------------------------------------------------------
  acute_appendicitis: action(["diagnosis_acute_appendicitis"]),
  uncomplicated_appendicitis: action(["diagnosis_acute_appendicitis"]),
  complicated_appendicitis: action(["diagnosis_acute_appendicitis"]),
  ectopic_pregnancy: action(["differential_ectopic"]),
  // Named hypotheses that carry no action. They belong in the differential and
  // they reveal nothing: holding a hypothesis is not an investigation.
  ovarian_torsion: reasoning("Гипотеза резидента, действия не требует."),
  pelvic_inflammatory_disease: reasoning("Гипотеза резидента, действия не требует."),
  renal_colic: reasoning("Гипотеза резидента, действия не требует."),
  gastroenteritis: reasoning("Гипотеза резидента, действия не требует."),
  acute_prostatitis: reasoning("Гипотеза резидента, действия не требует."),
  prostatic_abscess: reasoning(
    "Опасное осложнение; сохраняется как гипотеза, только если резидент назвал его сам."
  ),

  // --- management ----------------------------------------------------------
  iv_access: action(["iv_access"]),
  analgesia: action(["analgesia"]),
  iv_fluids: action(["iv_fluids"]),
  npo: action(["npo"]),
  surgical_consult: action(["surgical_consult"]),
  gynecology_consult: action(["gynecology_consult"]),
  // Mentioning surgery, deciding on appendectomy and choosing an operative
  // access are three different meanings. Access selection is state, not source
  // control; only explicit procedure start/completion reaches a procedure action.
  operative_intent: reasoning("Оперативная возможность названа, но решение ещё не принято."),
  prepare_for_possible_surgery: reasoning(
    "Подготовка к возможной операции названа как условный план, не как решение."
  ),
  appendectomy: reasoning("Аппендэктомия упомянута без зафиксированного решения или доступа."),
  decision_for_appendectomy: managementDecision("appendectomy"),
  operative_approach_open: operativeApproach("open"),
  open_appendectomy: operativeApproach("open"),
  active_observation: action(["active_observation"]),
  serial_reexamination: action(["serial_reexamination"]),
  transfer: action(["transfer_before_source_control"]),
  operative_approach_laparoscopic: operativeApproach("laparoscopic"),
  laparoscopic_appendectomy: operativeApproach("laparoscopic"),
  procedure_start: action(["appendectomy_procedure_start"]),
  source_control_completed: action(["appendectomy_here"]),
  nonoperative_management: reasoning(
    "Стратегия, которую резидент может назвать; отдельного действия в кейсе нет."
  ),
  shared_decision_making: reasoning("Заявление о процессе решения, действия не создаёт."),
  // Three antibiotic actions exist and they are not interchangeable.
  antibiotics: {
    kind: "needs_specification",
    maps_to: [],
    candidates: [
      "preop_single_antibiotic_prophylaxis",
      "antibiotic_observation_course",
      "postop_antibiotics_uncomplicated",
    ],
    question_ru:
      "Уточни: профилактика перед операцией, курс на фоне наблюдения или послеоперационные антибиотики?",
  },

  // --- resources -----------------------------------------------------------
  resource_availability: {
    kind: "resource_query",
    maps_to: [],
    // Asking what the hospital has is not ordering it, and must not move the
    // clock. See the audit, §6 rule 7.
    orders_nothing: true,
  },
});

/** @returns {object|null} the typed entry, or null for an unknown concept. */
export function resolveConcept(conceptId) {
  return Object.hasOwn(APPENDICITIS_CONCEPTS, conceptId)
    ? APPENDICITIS_CONCEPTS[conceptId]
    : null;
}

/** Concept ids by kind, for prompts and tests. */
export function conceptsOfKind(kind) {
  return Object.entries(APPENDICITIS_CONCEPTS)
    .filter(([, entry]) => entry.kind === kind)
    .map(([conceptId]) => conceptId);
}

/**
 * The flat `conceptId -> actionIds` map, derived.
 *
 * Kept so existing callers keep working while the typed resolver is wired
 * through the engine. It is DERIVED, never edited by hand: two hand-maintained
 * maps is how the router schema drifted.
 */
export const appendicitisRouterConceptMap = Object.freeze(
  Object.fromEntries(
    Object.entries(APPENDICITIS_CONCEPTS).map(([conceptId, entry]) => [
      conceptId,
      entry.maps_to || [],
    ])
  )
);

export function mapRouterConceptToCaseActionIds(conceptId) {
  return appendicitisRouterConceptMap[conceptId];
}

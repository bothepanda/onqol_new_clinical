// What a disease brings to V3, in one table.
//
// Adding cholecystitis means writing a disease module and adding one entry here.
// It must not mean editing core mentor heuristics, the engine, or the UI. Every
// per-disease decision the composition needs lives in this record:
//
//   conceptMap             router vocabulary for the disease
//   mentorRules            disease-specific coaching (core stays nosology-free)
//   operativeActionIds     which actions acquire pre-incision prerequisites
//   minimumAssessment      the reviewed bar for judging escalation maturity
//   baseEvidence           tier-B teaching attached to case actions
//   extraPrerequisites     case-owned pre-incision requirements, with severity
//   browserContentKey      which disease card / retrieval package to load
//
// Every one of these is a clinical statement, so they are declared, not derived.

import { appendicitisRouterConceptMap } from "../diseases/appendicitis/router/conceptMap.js";
import { appendicitisMentorRules } from "../diseases/appendicitis/mentorRules.js";
import { createV25Case } from "../v25/caseFactory.js";

/** Case actions that acquire the standard operative prerequisites. */
export const V3_OPERATIVE_ACTION_IDS = ["appendectomy_here"];

/**
 * The bar for "did the learner do the available minimum before calling for
 * help". NEEDS_CLINICAL_REVIEW.
 *
 * Reading: you looked at the patient. History and examination, nothing more -
 * deliberately not the full work-up, because escalating before the labs are
 * back can be entirely correct.
 */
export const V3_MINIMUM_ASSESSMENT = ["focused_history", "abdominal_exam"];

/**
 * Tier-B teaching attached to case actions, so the mentor can say why a step is
 * taken. Teaches only; cannot change a weight.
 */
export const V3_BASE_EVIDENCE = {
  focused_history: ["base-acute-abdomen-history", "base-appendicitis-pain-migration"],
  abdominal_exam: ["base-appendicitis-peritoneal-signs", "base-appendicitis-special-signs"],
};

/**
 * Pre-incision requirements V3 enforces on top of the core ones.
 *
 * Antibiotic prophylaxis is given before the knife, not asked about afterwards.
 * Blocking, so the operation is stopped before it reaches the patient rather
 * than commented on once the appendix is out. V3-only on purpose: mentor-off
 * V2.5 keeps its behaviour so it stays regression-testable.
 * NEEDS_CLINICAL_REVIEW.
 */
export const V3_EXTRA_OPERATIVE_PREREQUISITES = [
  {
    action_id: "preop_single_antibiotic_prophylaxis",
    severity: "blocking",
    reason_id: "prophylaxis_not_given",
  },
];

const appendicitisModule = Object.freeze({
  disease_card_id: "acute_appendicitis",
  // Builds the playable variant of this disease (presentation, phrasings,
  // resource setting). Each disease owns its own; there is no generic builder,
  // because there is nothing generic about a presentation.
  buildCase: createV25Case,
  conceptMap: appendicitisRouterConceptMap,
  mentorRules: appendicitisMentorRules,
  operativeActionIds: V3_OPERATIVE_ACTION_IDS,
  minimumAssessment: V3_MINIMUM_ASSESSMENT,
  baseEvidence: V3_BASE_EVIDENCE,
  extraPrerequisites: V3_EXTRA_OPERATIVE_PREREQUISITES,
  browserContentKey: "app-acute-basic-001",
});

const diseaseModules = Object.freeze({
  acute_appendicitis: appendicitisModule,
});

/**
 * Look up the V3 module for a case.
 *
 * Fails loudly. Falling back to appendicitis for an unregistered disease would
 * hand a cholecystitis learner the wrong router vocabulary and the wrong disease
 * card, and nothing on screen would say so.
 */
export function getDiseaseModule(caseData) {
  const key = caseData.disease_card_id;
  const module = diseaseModules[key];
  if (!module) {
    throw new Error(
      `No V3 disease module registered for "${key}". Add one to v3/diseaseModules.js before selecting this case in V3.`
    );
  }
  return module;
}

export { diseaseModules };

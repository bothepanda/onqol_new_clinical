import { createV25Case } from "../v25/caseFactory.js";
import { composeCaseWithCore } from "../core/composeCase.js";
import { appendicitisRouterConceptMap } from "../diseases/appendicitis/router/conceptMap.js";

/**
 * V3 = V2.5 engine + universal action library + mentor channel.
 *
 * Everything declared here is a clinical statement, so it lives in one visible
 * place rather than being spread through the code or inferred at runtime.
 * All three declarations go to the reviewer together (see core/README.md).
 */

/** Case actions that acquire the standard operative prerequisites. */
export const V3_OPERATIVE_ACTION_IDS = ["open_appendectomy_here"];

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

export function createV3Case(locale = "ru") {
  const { caseData, conceptMap, report } = composeCaseWithCore(createV25Case(locale), {
    operativeActionIds: V3_OPERATIVE_ACTION_IDS,
    minimumAssessmentActionIds: V3_MINIMUM_ASSESSMENT,
    baseEvidenceAttachments: V3_BASE_EVIDENCE,
    conceptMap: appendicitisRouterConceptMap,
  });

  return {
    ...caseData,
    case_id: "app-acute-v3-001",
    // V2.5 ships "2.5.0-alpha.1", which the case schema rejects: it requires
    // strict semver. Sessions freeze case_version into every logged event, so
    // V3 starts from a version that actually validates.
    case_version: "3.0.0",
    product_version: "3.0",
    // The merged router dictionary travels with the case. Without it the LLM
    // router would still be given only the disease vocabulary, and
    // "предупрежу анестезиолога" would go back to being `unknown` - the exact
    // failure the core library exists to fix.
    v3_concept_map: conceptMap,
    v3_composition_report: report,
  };
}

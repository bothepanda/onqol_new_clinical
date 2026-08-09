// V3 case selection.
//
// The UI used to call `createV3Case()` directly, which hard-wired one disease
// into the start-up path, and then looked up browser content with a literal
// "app-acute-basic-001". Adding a second disease would have meant editing the
// React component, and a cholecystitis case would silently have been handed
// appendicitis's disease card.
//
// Selection goes through the existing registry, so seeded selection and
// repeat-avoidance are kept. With one reviewed disease today, selecting the same
// case every time is the honest outcome - not a reason to fake variety by
// mutating unreviewed patient facts.

import { selectCase } from "../caseRegistry.js";
import { composeCaseWithCore } from "../core/composeCase.js";
import { getDiseaseModule } from "./diseaseModules.js";

/**
 * Compose a playable disease case into a V3 case.
 *
 * @param {object} baseCase   the disease's playable variant
 * @param {object} [module]   its V3 module; looked up when omitted
 * @returns {{caseData: object, conceptMap: object, report: object, module: object}}
 */
export function composeV3Case(baseCase, module = getDiseaseModule(baseCase)) {
  const { caseData, conceptMap, report } = composeCaseWithCore(baseCase, {
    operativeActionIds: module.operativeActionIds,
    minimumAssessmentActionIds: module.minimumAssessment,
    baseEvidenceAttachments: module.baseEvidence,
    extraOperativePrerequisites: module.extraPrerequisites,
    conceptMap: module.conceptMap,
  });

  return {
    module,
    conceptMap,
    report,
    caseData: {
      ...caseData,
      // V2.5 ships "2.5.0-alpha.1", which the case schema rejects: it requires
      // strict semver. Sessions freeze case_version into every logged event, so
      // V3 starts from a version that actually validates.
      case_version: "3.0.0",
      product_version: "3.0",
      // The merged router dictionary travels with the case. Without it the LLM
      // router would be given only the disease vocabulary, and "предупрежу
      // анестезиолога" would go back to being `unknown` - the exact failure the
      // core library exists to fix.
      v3_concept_map: conceptMap,
      v3_composition_report: report,
      // Disease-specific coaching travels with the case; core never imports it.
      mentor_rules: module.mentorRules,
      // Which disease card and retrieval package this case uses. Read by the UI
      // instead of a hard-coded id.
      browser_content_key: module.browserContentKey,
    },
  };
}

/**
 * Select and compose a V3 case.
 *
 * @param {object} [options]  passed through to selectCase: locale, seed,
 *        filters, previousCaseId, requestedCaseId
 * @returns {{caseData: object, selection: object, conceptMap: object, report: object}}
 */
export function selectV3Case(options = {}) {
  const { locale = "ru" } = options;
  const { caseData: registryCase, selection } = selectCase({ ...options, locale });
  const module = getDiseaseModule(registryCase);
  const composed = composeV3Case(module.buildCase(locale), module);
  return { ...composed, selection };
}

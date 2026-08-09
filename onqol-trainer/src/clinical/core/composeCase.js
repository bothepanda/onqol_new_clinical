import { coreActions, coreDomains, operativePrerequisites } from "./coreActions.js";
import { coreEvidence } from "./coreEvidence.js";
import { coreRouterConceptMap } from "./coreConceptMap.js";

/**
 * Merge the universal action library into a disease case.
 *
 * Rules, in order of precedence:
 *   1. The case wins. A core action whose id already exists in the case is
 *      skipped entirely - the reviewed disease card keeps its own wording,
 *      weight and evidence.
 *   2. The disease router dictionary wins over the core dictionary for the
 *      same concept id, because it is the more specific mapping.
 *   3. Core actions never change the score on their own: they carry
 *      `eligible_for_scoring: false` until a reviewer signs them off.
 *
 * @param {object} caseData        validated disease case
 * @param {object} [options]
 * @param {string[]} [options.operativeActionIds]  case actions that should
 *        acquire the standard operative prerequisites (consent, anaesthesia...)
 * @param {object} [options.conceptMap]  disease router dictionary to merge with
 * @param {string[]} [options.include]   restrict composition to these core ids
 * @param {Object<string,string[]>} [options.baseEvidenceAttachments]  tier-B
 *        evidence ids to attach to existing case actions, keyed by action id
 * @param {string[]} [options.minimumAssessmentActionIds]  the reviewed bar for
 *        judging whether an escalation was mature or avoidant. Omit it and the
 *        mentor stops judging escalation at all, rather than guessing a bar.
 * @returns {{caseData: object, conceptMap: object, report: object}}
 */
export function composeCaseWithCore(caseData, options = {}) {
  const {
    operativeActionIds = [],
    conceptMap = {},
    include = null,
    minimumAssessmentActionIds = null,
    baseEvidenceAttachments = {},
    // Case-owned prerequisites a composition may declare on top of the core
    // ones, with their own severity. This is how V3 makes pre-incision
    // antibiotic prophylaxis blocking without touching the base case, so
    // mentor-off V2.5 keeps its behaviour exactly.
    extraOperativePrerequisites = [],
  } = options;

  const caseOwnedIds = new Set(
    [
      ...(caseData.expected_actions || []),
      ...(caseData.acceptable_alternatives || []),
      ...(caseData.unnecessary_actions || []),
      ...(caseData.unsafe_actions || []),
    ].map((action) => action.id)
  );

  const selected = coreActions.filter(
    (action) => (include === null || include.includes(action.id)) && !caseOwnedIds.has(action.id)
  );
  const skippedAsCaseOwned = coreActions
    .filter((action) => caseOwnedIds.has(action.id))
    .map((action) => action.id);

  const added = { alternative: [], unsafe: [] };
  for (const action of selected) {
    const { bucket, ...actionFields } = action;
    added[bucket === "unsafe" ? "unsafe" : "alternative"].push(actionFields);
  }

  const composedIds = new Set(selected.map((action) => action.id));

  // Attach standard operative prerequisites, but only for core actions that
  // actually made it into this case. Referencing an absent action id would
  // produce a warning the learner can never satisfy.
  const applicablePrerequisites = [...operativePrerequisites, ...extraOperativePrerequisites].filter(
    (prerequisite) => composedIds.has(prerequisite.action_id) || caseOwnedIds.has(prerequisite.action_id)
  );
  const prerequisiteIds = applicablePrerequisites.map((prerequisite) => prerequisite.action_id);
  const prerequisitesAttachedTo = [];

  // Base-layer (tier B) evidence attached to a case action. This is what lets
  // the mentor explain why a step is taken - "почему щупаем именно здесь" -
  // without inventing the explanation. Tier B teaches; it never scores, so
  // attaching it cannot change a weight.
  const baseAttachmentsMade = [];
  const withAttachments = (action) => {
    const attach = baseEvidenceAttachments[action.id];
    if (!attach || attach.length === 0) return action;
    const existing = action.evidence_reference_ids || [];
    const added = attach.filter((id) => !existing.includes(id));
    if (added.length === 0) return action;
    baseAttachmentsMade.push({ action_id: action.id, evidence_reference_ids: added });
    return {
      ...action,
      evidence_reference_ids: [...existing, ...added],
      base_evidence_reference_ids: added,
    };
  };

  const withPrerequisites = (actions) =>
    actions.map((rawAction) => {
      const action = withAttachments(rawAction);
      if (!operativeActionIds.includes(action.id)) return action;
      const existing = action.prerequisites || [];
      const merged = [...existing, ...prerequisiteIds.filter((id) => !existing.includes(id))];
      prerequisitesAttachedTo.push(action.id);
      return { ...action, prerequisites: merged, core_prerequisites: applicablePrerequisites };
    });

  // Register every domain the composed actions use. `scoreSession` indexes
  // domain accumulators by name, so an unregistered domain would produce NaN
  // the moment a learner performs the action.
  const existingDomains = caseData.scoring?.domains || [];
  const usedDomains = new Set([...added.alternative, ...added.unsafe].map((action) => action.domain));
  const domainsAdded = [...usedDomains].filter((domain) => !existingDomains.includes(domain));

  const referenceIds = new Set((caseData.references || []).map((reference) => reference.id));
  const referencesAdded = coreEvidence.references.filter(
    (reference) => !referenceIds.has(reference.id)
  );

  const mergedConceptMap = { ...coreRouterConceptMap };
  for (const [conceptId, mapsTo] of Object.entries(conceptMap)) {
    mergedConceptMap[conceptId] = mapsTo;
  }
  // A core concept pointing at an action that was skipped as case-owned must
  // not be dropped: remap it onto the case-owned id, which has the same id.
  for (const [conceptId, mapsTo] of Object.entries(mergedConceptMap)) {
    mergedConceptMap[conceptId] = mapsTo.filter(
      (id) => composedIds.has(id) || caseOwnedIds.has(id)
    );
  }

  const composed = {
    ...caseData,
    expected_actions: withPrerequisites(caseData.expected_actions || []),
    acceptable_alternatives: [
      ...withPrerequisites(caseData.acceptable_alternatives || []),
      ...added.alternative,
    ],
    unnecessary_actions: (caseData.unnecessary_actions || []).map(withAttachments),
    unsafe_actions: [...(caseData.unsafe_actions || []), ...added.unsafe],
    references: [...(caseData.references || []), ...referencesAdded],
    scoring: {
      ...caseData.scoring,
      domains: [...existingDomains, ...domainsAdded],
    },
    core_library: {
      version: "0.1.0",
      composed_action_ids: [...composedIds],
      skipped_as_case_owned: skippedAsCaseOwned,
      // The bar for "did the learner do the available minimum before calling
      // for help". A clinical judgement: declared per case, reviewed, never
      // inferred. Null means the mentor does not judge escalation here.
      minimum_assessment_action_ids: minimumAssessmentActionIds,
      // Domains present for key safety but carrying no scoreable weight yet.
      // The debrief must render these as "не оценивается", not as 100.
      unscored_domains: domainsAdded.filter((domain) =>
        [...added.alternative, ...added.unsafe]
          .filter((action) => action.domain === domain)
          .every((action) => action.eligible_for_scoring === false)
      ),
    },
  };

  return {
    caseData: composed,
    conceptMap: mergedConceptMap,
    report: {
      composedActionIds: [...composedIds],
      skippedAsCaseOwned,
      domainsAdded,
      referencesAdded: referencesAdded.map((reference) => reference.id),
      prerequisitesAttachedTo,
      applicablePrerequisites,
      baseAttachmentsMade,
      coreDomains,
    },
  };
}

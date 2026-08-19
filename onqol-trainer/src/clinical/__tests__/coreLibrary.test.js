import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import YAML from "yaml";
import { acuteAppendicitisCase } from "../cases/acuteAppendicitis.js";
import { appendicitisRouterConceptMap } from "../diseases/appendicitis/router/conceptMap.js";
import { composeCaseWithCore } from "../core/composeCase.js";
import { coreActions, coreActionsById, operativePrerequisites } from "../core/coreActions.js";
import { coreEvidence } from "../core/coreEvidence.js";
import { buildAllowedConcepts, validateRouterOutput } from "../semanticRouter.js";
import { validateCase } from "../schemas/caseSchema.js";
import { scoreSession } from "../scoring.js";

function compose() {
  return composeCaseWithCore(acuteAppendicitisCase, {
    operativeActionIds: ["open_appendectomy_here"],
    conceptMap: appendicitisRouterConceptMap,
  });
}

test("composed case still satisfies the case schema", () => {
  const { caseData } = compose();
  const result = validateCase(caseData);
  assert.deepEqual(result.errors, []);
  assert.ok(result.ok);
});

test("core evidence ids all resolve in the composed case", () => {
  const { caseData } = compose();
  const referenceIds = new Set(caseData.references.map((reference) => reference.id));
  for (const action of coreActions) {
    for (const referenceId of action.evidence_reference_ids) {
      assert.ok(referenceId, `${action.id} has an empty evidence id`);
      assert.ok(referenceIds.has(referenceId), `${action.id} -> unknown evidence ${referenceId}`);
    }
  }
});

test("the case wins: core never overwrites a case-owned action", () => {
  const { caseData, report } = compose();
  const originalById = new Map(
    [
      ...acuteAppendicitisCase.expected_actions,
      ...acuteAppendicitisCase.acceptable_alternatives,
      ...acuteAppendicitisCase.unnecessary_actions,
      ...acuteAppendicitisCase.unsafe_actions,
    ].map((action) => [action.id, action])
  );

  const composedById = new Map(
    [
      ...caseData.expected_actions,
      ...caseData.acceptable_alternatives,
      ...caseData.unnecessary_actions,
      ...caseData.unsafe_actions,
    ].map((action) => [action.id, action])
  );

  for (const [id, original] of originalById) {
    const composed = composedById.get(id);
    assert.ok(composed, `case action ${id} disappeared during composition`);
    assert.equal(composed.score_weight, original.score_weight);
    assert.equal(composed.domain, original.domain);
    assert.equal(composed.feedback_if_missed, original.feedback_if_missed);
  }

  for (const id of report.skippedAsCaseOwned) {
    assert.ok(originalById.has(id), `${id} was reported as case-owned but is not in the case`);
  }
});

test("no duplicate action ids after composition", () => {
  const { caseData } = compose();
  const ids = [
    ...caseData.expected_actions,
    ...caseData.acceptable_alternatives,
    ...caseData.unnecessary_actions,
    ...caseData.unsafe_actions,
  ].map((action) => action.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("router now recognises universal actions that no disease card defines", () => {
  const { caseData, conceptMap } = compose();
  const allowed = new Set(
    buildAllowedConcepts(caseData, conceptMap).map((concept) => concept.concept_id)
  );

  for (const conceptId of [
    "notify_anaesthesia",
    "informed_consent",
    "escalate_to_senior",
    "escalate_to_intensive_care",
    "declare_uncertainty",
    "sign_in",
    "time_out",
    "sign_out",
    "structured_handover",
  ]) {
    assert.ok(allowed.has(conceptId), `router cannot see concept ${conceptId}`);
  }
});

test("a universal action routes to a real action instead of being rejected", () => {
  const { caseData, conceptMap } = compose();
  const parsed = validateRouterOutput(
    {
      intents: [
        { type: "management", concept_id: "notify_anaesthesia", confidence: 0.94 },
        { type: "management", concept_id: "informed_consent", confidence: 0.9 },
        { type: "management", concept_id: "escalate_to_senior", confidence: 0.88 },
      ],
    },
    caseData,
    { conceptMap }
  );

  assert.deepEqual(parsed.invalidConcepts, []);
  assert.deepEqual(parsed.recognizedButUndefined, []);
  assert.deepEqual(
    parsed.actions.map((action) => action.id).sort(),
    ["call_senior_surgeon", "informed_consent", "notify_anesthesia"]
  );
});

test("the same input is rejected without the core library - this is the V2 failure", () => {
  const parsed = validateRouterOutput(
    { intents: [{ type: "management", concept_id: "notify_anaesthesia", confidence: 0.94 }] },
    acuteAppendicitisCase,
    { conceptMap: appendicitisRouterConceptMap }
  );

  assert.deepEqual(parsed.invalidConcepts, ["notify_anaesthesia"]);
  assert.deepEqual(parsed.actions, []);
});

test("core actions do not move the score before clinical review", () => {
  const { caseData } = compose();
  const baseline = scoreSession(caseData, {
    completedActions: [],
    unsafeActions: [],
    unnecessaryActions: [],
  });
  const withCore = scoreSession(caseData, {
    completedActions: [
      "informed_consent",
      "notify_anesthesia",
      "who_sign_in",
      "who_time_out",
      "who_sign_out",
      "call_senior_surgeon",
      "declare_uncertainty",
    ],
    unsafeActions: [],
    unnecessaryActions: [],
  });

  assert.equal(withCore.overallScore, baseline.overallScore);
  assert.deepEqual(withCore.domainScores, baseline.domainScores);
});

test("every core action ships unscoreable and flagged for review", () => {
  for (const action of coreActions) {
    assert.equal(action.eligible_for_scoring, false, `${action.id} is scoreable too early`);
    assert.equal(action.score_weight, 0, `${action.id} carries weight before review`);
    assert.ok(action.review_status, `${action.id} has no review marker`);
  }
});

test("a new scoring domain never produces NaN", () => {
  const { caseData } = compose();
  const scored = scoreSession(caseData, {
    completedActions: ["call_senior_surgeon", "declare_uncertainty", "structured_handover"],
    unsafeActions: [],
    unnecessaryActions: [],
  });

  assert.ok(Number.isFinite(scored.overallScore));
  for (const [domain, value] of Object.entries(scored.domainScores)) {
    // Since 10.08.2026 a domain with no scorable weight is `null`, not 100: a
    // perfect score for behaviour nobody measured is worse than no score. NaN is
    // still forbidden.
    assert.ok(value === null || Number.isFinite(value), `domain ${domain} scored ${value}`);
  }
  for (const domain of caseData.core_library.unscored_domains) {
    assert.equal(
      scored.domainScores[domain],
      null,
      `домен без оцениваемых элементов должен быть N/A, а не числом: ${domain}`
    );
  }
  assert.ok(caseData.scoring.domains.includes("Professionalism and escalation"));
  assert.ok(caseData.core_library.unscored_domains.includes("Professionalism and escalation"));
});

test("operative prerequisites are attached and every one of them exists", () => {
  const { caseData, report } = compose();
  const surgery = caseData.expected_actions.find((action) => action.id === "open_appendectomy_here");

  assert.ok(report.prerequisitesAttachedTo.includes("open_appendectomy_here"));
  assert.ok(surgery.prerequisites.includes("informed_consent"));
  assert.ok(surgery.prerequisites.includes("notify_anesthesia"));
  // CONTRACT CHANGED, CDR-18 (owner, 20.08.2026). The WHO checkpoints are run in
  // theatre, largely by the nursing team, and no longer gate the resident's
  // path. What they were protecting - consent and a warned anaesthetist - is
  // gated on its own terms, above and before induction.
  for (const checkpoint of ["who_sign_in", "who_time_out", "who_sign_out"]) {
    assert.ok(!surgery.prerequisites.includes(checkpoint), `${checkpoint} still gates surgery`);
  }
  // the case's own prerequisite must survive
  assert.ok(surgery.prerequisites.includes("diagnosis_acute_appendicitis"));

  const allIds = new Set(
    [
      ...caseData.expected_actions,
      ...caseData.acceptable_alternatives,
      ...caseData.unnecessary_actions,
      ...caseData.unsafe_actions,
    ].map((action) => action.id)
  );
  for (const prerequisite of surgery.prerequisites) {
    assert.ok(allIds.has(prerequisite), `unsatisfiable prerequisite ${prerequisite}`);
  }
  for (const prerequisite of operativePrerequisites) {
    assert.ok(prerequisite.severity, `${prerequisite.action_id} has no severity`);
    assert.ok(prerequisite.reason_id, `${prerequisite.action_id} has no reason id`);
  }
});

test("actions not declared operative keep their own prerequisites untouched", () => {
  const { caseData } = compose();
  const history = caseData.expected_actions.find((action) => action.id === "focused_history");
  assert.deepEqual(history.prerequisites, []);
});

test("escalation carries a context policy, not a flat reward", () => {
  const senior = coreActionsById.get("call_senior_surgeon");
  assert.equal(senior.escalation_policy.requires_minimum_assessment, true);
  assert.ok(senior.escalation_policy.appropriate_feedback);
  assert.ok(senior.escalation_policy.premature_feedback);
  assert.notEqual(
    senior.escalation_policy.appropriate_feedback,
    senior.escalation_policy.premature_feedback
  );

  const icu = coreActionsById.get("call_intensive_care");
  assert.equal(icu.escalation_policy.requires_minimum_assessment, false);
});

test("tier B evidence may teach but may never be a scored correct answer", () => {
  const tierB = coreEvidence.references.filter((reference) => reference.provenance === "B");
  assert.ok(tierB.length > 0);

  const tierBIds = new Set(tierB.map((reference) => reference.id));
  const backedByTierBOnly = coreActions.filter((action) =>
    action.evidence_reference_ids.every((id) => tierBIds.has(id))
  );
  assert.ok(backedByTierBOnly.length > 0, "expected at least one teaching-level action");
  for (const action of backedByTierBOnly) {
    assert.equal(action.eligible_for_scoring, false, `${action.id} scores from tier B evidence`);
  }
});

test("unverified citations are marked, not presented as confirmed", () => {
  for (const reference of coreEvidence.references) {
    assert.ok(reference.citation, `${reference.id} has no citation`);
    assert.ok(reference.provenance, `${reference.id} has no provenance tier`);
    // "КП?" means not yet mapped. Asserting "КП−" would claim we checked.
    assert.ok(
      ["КП=", "КП≠", "КП−", "КП!", "КП?"].includes(reference.kz_protocol_status),
      `${reference.id} has an unknown Kazakhstan protocol marker`
    );
  }
});

test("core router concepts never point at an action that does not exist", () => {
  const { caseData, conceptMap } = compose();
  const allIds = new Set(
    [
      ...caseData.expected_actions,
      ...caseData.acceptable_alternatives,
      ...caseData.unnecessary_actions,
      ...caseData.unsafe_actions,
    ].map((action) => action.id)
  );

  for (const [conceptId, mapsTo] of Object.entries(conceptMap)) {
    for (const actionId of mapsTo) {
      assert.ok(allIds.has(actionId), `concept ${conceptId} -> missing action ${actionId}`);
    }
  }
});

test("composition is restrictable for cases that should not carry the whole library", () => {
  const { caseData, report } = composeCaseWithCore(acuteAppendicitisCase, {
    include: ["informed_consent", "notify_anesthesia"],
    conceptMap: appendicitisRouterConceptMap,
  });

  assert.deepEqual(report.composedActionIds.sort(), ["informed_consent", "notify_anesthesia"]);
  const ids = caseData.acceptable_alternatives.map((action) => action.id);
  assert.ok(!ids.includes("call_senior_surgeon"));
});

// --- base layer (tier B) --------------------------------------------------

const BASE_ATTACHMENTS = {
  focused_history: ["base-acute-abdomen-history", "base-appendicitis-pain-migration"],
  abdominal_exam: ["base-appendicitis-peritoneal-signs", "base-appendicitis-special-signs"],
};

test("base-layer evidence attaches to case actions without touching their weight", () => {
  const before = compose();
  const after = composeCaseWithCore(acuteAppendicitisCase, {
    operativeActionIds: ["open_appendectomy_here"],
    conceptMap: appendicitisRouterConceptMap,
    baseEvidenceAttachments: BASE_ATTACHMENTS,
  });

  const exam = (bucket) => bucket.find((action) => action.id === "abdominal_exam");
  const original = exam(before.caseData.expected_actions);
  const attached = exam(after.caseData.expected_actions);

  assert.equal(attached.score_weight, original.score_weight);
  assert.equal(attached.domain, original.domain);
  assert.ok(attached.evidence_reference_ids.includes("base-appendicitis-special-signs"));
  // the guideline anchor the case already had must survive
  for (const referenceId of original.evidence_reference_ids) {
    assert.ok(attached.evidence_reference_ids.includes(referenceId));
  }
  assert.deepEqual(after.report.baseAttachmentsMade.map((entry) => entry.action_id).sort(), [
    "abdominal_exam",
    "focused_history",
  ]);
});

test("composed case with base attachments still validates", () => {
  const { caseData } = composeCaseWithCore(acuteAppendicitisCase, {
    operativeActionIds: ["open_appendectomy_here"],
    conceptMap: appendicitisRouterConceptMap,
    baseEvidenceAttachments: BASE_ATTACHMENTS,
  });
  assert.deepEqual(validateCase(caseData).errors, []);
});

test("every base-layer reference names a real, checkable source", () => {
  const base = coreEvidence.references.filter((reference) => reference.provenance === "B");
  const sourced = base.filter((reference) => !reference.verification_status);
  assert.ok(sourced.length >= 4, "expected the semiotics/history layer to be sourced");

  for (const reference of sourced) {
    // StatPearls entries must be traceable: Bookshelf ID and PMID, not a vague
    // "общепринятая учебная база".
    assert.match(reference.citation, /NBK\d+/, `${reference.id} has no Bookshelf ID`);
    assert.match(reference.citation, /PMID \d+/, `${reference.id} has no PMID`);
    assert.match(reference.license, /CC BY-NC-ND/, `${reference.id} has no license`);
    assert.match(reference.license, /not ingested/, `${reference.id} must stay citation-only`);
  }
});

test("unsourced base entries stay flagged rather than quietly citing nothing", () => {
  const unsourced = coreEvidence.references.filter(
    (reference) => reference.provenance === "B" && reference.verification_status
  );
  for (const reference of unsourced) {
    assert.match(reference.verification_status, /NEEDS_SOURCE_VERIFICATION/);
  }
});

test("sepsis recognition exists and is anchored to an open-licence guideline", () => {
  const sepsis = coreActionsById.get("recognize_sepsis");
  assert.ok(sepsis, "sepsis recognition missing from the core library");
  assert.deepEqual(sepsis.evidence_reference_ids, ["wses-iai-2021-sepsis"]);

  const reference = coreEvidence.references.find((item) => item.id === "wses-iai-2021-sepsis");
  assert.equal(reference.provenance, "T1");
  assert.match(reference.license, /CC BY 4\.0/);
});

test("a base-layer fact can never become the scored correct answer", () => {
  const { caseData } = composeCaseWithCore(acuteAppendicitisCase, {
    conceptMap: appendicitisRouterConceptMap,
    baseEvidenceAttachments: BASE_ATTACHMENTS,
  });
  const baseIds = new Set(
    coreEvidence.references.filter((item) => item.provenance === "B").map((item) => item.id)
  );

  for (const action of caseData.expected_actions) {
    const anchors = action.evidence_reference_ids || [];
    if (anchors.length === 0) continue;
    const onlyBase = anchors.every((id) => baseIds.has(id));
    assert.ok(
      !onlyBase || action.eligible_for_scoring === false,
      `${action.id} scores while resting on tier B alone`
    );
  }
});

// --- base corpus manifest -------------------------------------------------

const baseManifest = YAML.parse(
  readFileSync(new URL("../corpus/base/manifest.yaml", import.meta.url), "utf8")
);

test("base corpus manifest is parseable and entirely citation-only", () => {
  assert.ok(baseManifest.sources.length > 0);
  for (const source of baseManifest.sources) {
    assert.equal(source.ingest_fulltext, false, `${source.id} would be ingested`);
    assert.match(source.license, /CC BY-NC-ND/, `${source.id} has an unexpected licence`);
    assert.match(String(source.bookshelf_id), /^NBK\d+$/, `${source.id} has no Bookshelf ID`);
  }
  assert.equal(baseManifest.ingest_policy, "citation_only");
});

test("the NC clause is recorded as a monetisation blocker, not forgotten", () => {
  assert.equal(baseManifest.license_review.blocker_for_monetisation, true);
  assert.equal(baseManifest.license_review.status, "PILOT_ONLY");
});

test("every tier-B citation traces back to a source in the manifest", () => {
  const manifestIds = new Set(baseManifest.sources.map((source) => String(source.bookshelf_id)));
  const tierB = coreEvidence.references.filter((reference) => reference.provenance === "B");

  assert.ok(tierB.length >= 6);
  for (const reference of tierB) {
    const match = reference.citation.match(/NBK\d+/);
    assert.ok(match, `${reference.id} has no Bookshelf ID in its citation`);
    assert.ok(
      manifestIds.has(match[0]),
      `${reference.id} cites ${match[0]}, which is not in the base manifest`
    );
  }
});

test("no tier-B entry is left citing nothing", () => {
  const tierB = coreEvidence.references.filter((reference) => reference.provenance === "B");
  for (const reference of tierB) {
    assert.ok(
      !reference.verification_status,
      `${reference.id} still lacks a source: ${reference.verification_status}`
    );
    assert.doesNotMatch(reference.citation, /подлежит внесению/);
  }
});

test("partial coverage is declared rather than overclaimed", () => {
  const limits = coreEvidence.references.find(
    (reference) => reference.id === "base-clinical-limits-of-competence"
  );
  // The source supports "hierarchy is a barrier, speaking up is trainable".
  // It does not support "escalating after the minimum is maturity" - that
  // wording is ours and must say so.
  assert.match(limits.coverage_note, /^PARTIAL/);
  assert.match(limits.coverage_note, /авторск/);
});

test("rejected downloads keep their reason on record", () => {
  assert.ok(baseManifest.not_used.length > 0);
  for (const entry of baseManifest.not_used) {
    assert.ok(entry.reason && entry.reason.length > 20, `${entry.title} has no real reason`);
    assert.match(String(entry.bookshelf_id), /^NBK\d+$/);
  }
});

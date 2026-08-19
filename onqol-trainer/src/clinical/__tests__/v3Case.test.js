import test from "node:test";
import assert from "node:assert/strict";
import {
  V3_MINIMUM_ASSESSMENT,
  V3_OPERATIVE_ACTION_IDS,
  createV3Case,
} from "../v3/caseFactory.js";
import { advanceV25Session, createV25Session } from "../v25/engine.js";
import { buildAllowedConcepts, validateRouterOutput } from "../semanticRouter.js";
import { validateCase } from "../schemas/caseSchema.js";
import { minimumAssessmentIds } from "../core/mentorBrief.js";

test("V3 case is a valid case and declares its clinical choices in one place", () => {
  const caseData = createV3Case();
  assert.deepEqual(validateCase(caseData).errors, []);
  assert.equal(caseData.product_version, "3.0");
  assert.deepEqual(minimumAssessmentIds(caseData), V3_MINIMUM_ASSESSMENT);

  const surgery = caseData.expected_actions.find(
    (action) => action.id === V3_OPERATIVE_ACTION_IDS[0]
  );
  assert.ok(surgery.prerequisites.includes("informed_consent"));
});

test("the merged router dictionary travels with the case", () => {
  const caseData = createV3Case();
  assert.ok(caseData.v3_concept_map, "V3 case lost its concept map");

  // The LLM router is handed caseData.v3_concept_map by the UI. If that ever
  // stops carrying core concepts, "предупрежу анестезиолога" silently goes
  // back to `unknown`, which is the whole bug V3 exists to fix.
  const allowed = new Set(
    buildAllowedConcepts(caseData, caseData.v3_concept_map).map((c) => c.concept_id)
  );
  for (const conceptId of ["notify_anaesthesia", "informed_consent", "escalate_to_senior"]) {
    assert.ok(allowed.has(conceptId), `router cannot see ${conceptId}`);
  }

  const parsed = validateRouterOutput(
    { intents: [{ type: "management", concept_id: "notify_anaesthesia", confidence: 0.9 }] },
    caseData,
    { conceptMap: caseData.v3_concept_map }
  );
  assert.deepEqual(parsed.invalidConcepts, []);
  assert.deepEqual(parsed.actions.map((a) => a.id), ["notify_anesthesia"]);
});

test("base-layer teaching is attached to the actions that need it", () => {
  const caseData = createV3Case();
  const exam = caseData.expected_actions.find((action) => action.id === "abdominal_exam");
  assert.ok(exam.evidence_reference_ids.includes("base-appendicitis-special-signs"));
  assert.ok(exam.base_evidence_reference_ids.length > 0);
});

test("end to end: the mentor speaks and the operation is stopped before it happens", async () => {
  const caseData = createV3Case();
  let session = createV25Session({ caseData, mode: "reference", seed: "v3-e2e" });

  const assessed = await advanceV25Session({
    caseData,
    session,
    input: "Собираю анамнез и осматриваю живот",
    options: { mentor: true },
  });
  session = assessed.session;
  assert.ok(assessed.mentor, "mentor did not run");

  const diagnosed = await advanceV25Session({
    caseData,
    session,
    input: "Диагноз острый аппендицит, беру на операцию",
    options: { mentor: true },
  });
  session = diagnosed.session;

  const selected = await advanceV25Session({
    caseData,
    session,
    input: "Открытая аппендэктомия сейчас",
    options: { mentor: true },
  });
  assert.equal(selected.session.workingMemory.operativeApproach.approach, "open");
  assert.equal(selected.session.temporalState.sourceControl, false);

  const committed = await advanceV25Session({
    caseData,
    session: selected.session,
    input: "Начинаю операцию",
    options: { mentor: true },
  });

  // CDR-18: consent before induction, not the WHO checkpoint's name.
  assert.match(committed.reply, /До индукции не хватает.*согласие/is);
  assert.ok(!committed.session.revealedFindings.includes("operative_finding"));
  assert.equal(committed.session.temporalState.sourceControl, false);
});

test("without the mentor the V2.5 case is used and nothing changes", async () => {
  const caseData = createV3Case();
  const session = createV25Session({ caseData, mode: "reference", seed: "v3-off" });
  const result = await advanceV25Session({
    caseData,
    session,
    input: "Собираю анамнез",
    options: {},
  });
  assert.equal(result.mentor, null);
});

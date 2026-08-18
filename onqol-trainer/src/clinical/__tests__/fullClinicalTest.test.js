import assert from "node:assert/strict";
import test from "node:test";
import { enableFullClinicalTestCase } from "../testing/fullClinicalTest.js";
import { advanceV25Session, createV25Session } from "../v25/engine.js";
import { scoreV25Session } from "../v25/scoring.js";
import { buildV35Case } from "../v35/createCase.js";

test("APP-005 stays blocked for learners and is selectable only by the explicit internal test mode", () => {
  assert.throws(
    () => buildV35Case({ seed: "app-005-safe", requestedPresetId: "APP-005" }),
    /cannot be selected in learner mode/
  );

  const built = buildV35Case({
    seed: "app-005-test",
    requestedPresetId: "APP-005",
    mode: "internal_test",
  });
  assert.equal(built.selection.case_preset_id, "APP-005");
  assert.equal(built.patient.hidden.morphology, "diffuse_peritonitis");
});

test("full clinical test projection enables auditable unvalidated scoring without mutating source case", () => {
  const source = buildV35Case({ seed: "scoring-source" }).caseData;
  const testCase = enableFullClinicalTestCase(source);

  assert.equal(source.scoring.eligible_for_scoring, false);
  assert.equal(testCase.scoring.eligible_for_scoring, true);
  assert.equal(testCase.scoring.review_status, "internal_test_only_unvalidated");
  assert.equal(testCase.clinical_test.result_status, "not_valid_for_learner_assessment");
  assert.equal(
    testCase.acceptable_alternatives.every((action) => action.eligible_for_scoring === true),
    true
  );

  const session = createV25Session({
    caseData: testCase,
    mode: "reference",
    seed: "scoring-session",
  });
  const scoring = scoreV25Session(testCase, session);
  assert.equal(scoring.eligibleForScoring, undefined);
  assert.equal(scoring.overallScore, 0);
  assert.equal(session.eventLog[0].clinical_test.enabled, true);
});

test("full clinical test applies an unreviewed parameter but records the bypass", async () => {
  const testCase = enableFullClinicalTestCase(
    buildV35Case({ seed: "parameter-bypass" }).caseData
  );
  const session = createV25Session({
    caseData: testCase,
    mode: "reference",
    seed: "parameter-bypass",
  });

  const result = await advanceV25Session({
    caseData: testCase,
    session,
    input: "Ввожу внутривенно инфузию 200 мл/кг",
    options: { mentor: true, fullClinicalTest: true },
  });

  assert.equal(result.session.completedActions.includes("iv_fluids"), true);
  assert.equal(result.blockedOperations?.length || 0, 0);
  const fluidLog = result.session.actionLog.findLast((entry) => entry.action_id === "iv_fluids");
  assert.equal(fluidLog.applied_to_patient, true);
  assert.equal(
    fluidLog.clinical_test_bypass,
    "unvalidated_parameter_applied_in_internal_test"
  );
  assert.equal(fluidLog.parameter_safety.safety_verdict, "not_yet_reviewed");
});

test("full clinical test bypasses the operative prerequisite stop", async () => {
  const testCase = enableFullClinicalTestCase(
    buildV35Case({ seed: "operative-bypass" }).caseData
  );
  let session = createV25Session({
    caseData: testCase,
    mode: "reference",
    seed: "operative-bypass",
  });

  const selected = await advanceV25Session({
    caseData: testCase,
    session,
    input: "Выбираю открытую аппендэктомию",
    options: { mentor: true, fullClinicalTest: true },
  });
  session = selected.session;

  const started = await advanceV25Session({
    caseData: testCase,
    session,
    input: "Начинаю операцию",
    options: { mentor: true, fullClinicalTest: true },
  });

  assert.equal(started.session.completedActions.includes("appendectomy_procedure_start"), true);
  assert.equal(started.session.workingMemory.operativeState.procedure_started, true);
  assert.doesNotMatch(started.reply, /Перед индукцией.*Sign In/i);
});


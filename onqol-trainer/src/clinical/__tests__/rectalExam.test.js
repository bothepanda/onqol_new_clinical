// ПРИ: recognized everywhere, modelled nowhere.
//
// An earlier version of this suite locked in an authored pelvic finding for
// APP-003 - normal sphincter tone, right/anterior rectal-wall tenderness, no
// blood. The evidence does not support giving every pelvic patient the same
// positive sign: Takada 2015 found poor overall diagnostic performance, and in
// the limited pelvic subgroup sensitivity was about 0.38 with specificity not
// established.
//
// So the contract these tests hold is narrower and more honest: the request is
// understood, the answer says the patient-specific result is not modelled, and
// nothing about DRE is expected, critical or scored. The failure mode being
// guarded against is not silence - it is a plausible finding nobody signed.

import assert from "node:assert/strict";
import test from "node:test";
import { buildV35Case } from "../v35/createCase.js";
import {
  RECTAL_EXAM_SLOT_IDS,
  RECTAL_SLOT_REVIEW_STATUS,
  rectalStatesFor,
  renderRectalExamination,
} from "../v35/examSlots.js";
import { PHENOTYPES } from "../v35/phenotypes.js";
import { advanceV25Session, createV25Session } from "../v25/engine.js";
import { resolveConcept } from "../diseases/appendicitis/router/conceptRegistry.js";

const STABLE_PRESETS = ["APP-001", "APP-002", "APP-003", "APP-004"];
const REQUEST = "выполню пальцевое ректальное исследование";

const routerPayload = {
  intents: [
    { type: "request_examination", concept_id: "rectal_examination", confidence: 0.97 },
  ],
  unresolved_fragments: [],
};

function caseFor(presetId) {
  return buildV35Case({ seed: `rectal-${presetId}`, requestedPresetId: presetId, mode: "faculty" })
    .caseData;
}

async function askForRectalExam(presetId) {
  const caseData = caseFor(presetId);
  const session = createV25Session({ caseData, mode: "reference", seed: `rectal-${presetId}` });
  const result = await advanceV25Session({
    caseData,
    session,
    input: REQUEST,
    options: {
      actionExtractorLLM: async () => JSON.stringify(routerPayload),
      conceptMap: caseData.v3_concept_map,
      conceptRegistry: resolveConcept,
    },
  });
  return { caseData, result };
}

test("no stable preset carries an authored rectal finding", () => {
  for (const presetId of STABLE_PRESETS) {
    assert.equal(caseFor(presetId).available_findings.rectal_exam, undefined, presetId);
  }
});

test("the request is understood, and the answer is that it is not modelled", async () => {
  for (const presetId of STABLE_PRESETS) {
    const { result } = await askForRectalExam(presetId);
    assert.match(result.reply, /не смоделировано/i, presetId);
    assert.ok(!result.session.revealedFindings.includes("rectal_exam"), presetId);
  }
});

test("no invented finding leaks in: no tone, no tenderness, no blood, no prostate", async () => {
  for (const presetId of STABLE_PRESETS) {
    const { result } = await askForRectalExam(presetId);
    assert.doesNotMatch(result.reply, /сфинктер/i, presetId);
    assert.doesNotMatch(result.reply, /стенки прямой кишки/i, presetId);
    assert.doesNotMatch(result.reply, /нависани/i, presetId);
    assert.doesNotMatch(result.reply, /перчатк/i, presetId);
    assert.doesNotMatch(result.reply, /простат/i, presetId);
  }
});

test("ПРИ is orderable everywhere but expected, critical and scoreable nowhere", () => {
  for (const presetId of STABLE_PRESETS) {
    const caseData = caseFor(presetId);
    const action = (caseData.acceptable_alternatives || []).find(
      (entry) => entry.id === "rectal_exam"
    );
    assert.ok(action, presetId);
    assert.equal(action.eligible_for_scoring, false, presetId);
    assert.equal(action.score_weight, 0, presetId);
    assert.equal(action.critical, false, presetId);
    assert.equal(action.expected_for_this_patient, false, presetId);
    assert.ok(!(caseData.expected_actions || []).some((entry) => entry.id === "rectal_exam"), presetId);
    assert.ok(!(caseData.critical_omissions || []).includes("rectal_exam"), presetId);
  }
});

test("no phenotype assigns a rectal slot state at all", () => {
  for (const phenotype of Object.values(PHENOTYPES)) {
    assert.equal(
      phenotype.presentation?.rectal_exam_slots,
      undefined,
      phenotype.phenotype_id
    );
  }
});

// The slot vocabulary survives the withdrawal on purpose: it is words, not a
// claim, and a reviewed finding should plug into it rather than reopen the file.
test("the slot vocabulary stays available and declares that nothing is assigned", () => {
  assert.ok(RECTAL_EXAM_SLOT_IDS.length >= 3);
  for (const slotId of RECTAL_EXAM_SLOT_IDS) {
    assert.ok(rectalStatesFor(slotId).length > 0, slotId);
  }
  assert.equal(RECTAL_SLOT_REVIEW_STATUS.state_assignment, "none_authored");
  assert.equal(RECTAL_SLOT_REVIEW_STATUS.eligible_for_scoring, false);
});

test("rendering nothing produces nothing, not a plausible negative", () => {
  assert.equal(renderRectalExamination({}), "");
  assert.equal(renderRectalExamination(undefined), "");
});

test("the DRE source supports a negative claim only, and is attributed correctly", async () => {
  const { references } = await import("../evidence/appendicitisEvidence.js").then(
    (module) => module.appendicitisEvidence
  );
  const source = references.find((entry) => entry.id === "takada-2015-dre");
  assert.ok(source, "the Takada meta-analysis must be in the evidence layer");
  assert.match(source.citation, /Takada T/);
  assert.match(source.citation, /PLoS One/);
  assert.doesNotMatch(source.citation, /Sedighipour/);
  assert.match(source.recommendation, /cannot rule the diagnosis in or out/);
});

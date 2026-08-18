// ПРИ: authored for one phenotype, honestly absent in the others.
//
// The point of this suite is the asymmetry. A trainer that answers "не
// смоделировано" everywhere teaches nothing; a trainer that invents a normal
// rectal examination for every patient is exactly the failure the whole
// governance boundary exists to prevent. Signed content for APP-003, a straight
// non-answer elsewhere, and no scoring either way.

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

test("APP-003 hands over the signed rectal finding, and it is the owner's words", async () => {
  const { result } = await askForRectalExam("APP-003");
  assert.match(result.reply, /тонус сфинктера обычный/i);
  assert.match(result.reply, /болезненность стенки прямой кишки справа и спереди/i);
  assert.match(result.reply, /крови и патологического содержимого на перчатке нет/i);
  assert.ok(result.session.revealedFindings.includes("rectal_exam"));
});

test("the other three presets say it is not modelled instead of inventing a normal", async () => {
  for (const presetId of ["APP-001", "APP-002", "APP-004"]) {
    const { caseData, result } = await askForRectalExam(presetId);
    assert.equal(caseData.available_findings.rectal_exam, undefined, presetId);
    assert.match(result.reply, /не смоделировано/i, presetId);
    // The non-answer must not leak the finding authored for another phenotype.
    assert.doesNotMatch(result.reply, /сфинктер/i, presetId);
    assert.ok(!result.session.revealedFindings.includes("rectal_exam"), presetId);
  }
});

test("ПРИ is orderable everywhere but expected, critical and scoreable nowhere", () => {
  for (const presetId of ["APP-001", "APP-002", "APP-003", "APP-004"]) {
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

test("no phenotype claims a rectal state the slot layer does not define", () => {
  for (const phenotype of Object.values(PHENOTYPES)) {
    const slots = phenotype.presentation?.rectal_exam_slots;
    if (!slots) continue;
    for (const [slotId, state] of Object.entries(slots)) {
      assert.ok(RECTAL_EXAM_SLOT_IDS.includes(slotId), `${phenotype.phenotype_id}: ${slotId}`);
      assert.ok(
        rectalStatesFor(slotId).includes(state),
        `${phenotype.phenotype_id}: ${slotId} = ${state}`
      );
    }
  }
});

test("a phenotype that authored nothing renders nothing, not a plausible negative", () => {
  assert.equal(renderRectalExamination({}), "");
  assert.equal(renderRectalExamination(undefined), "");
});

test("the prostate stays unauthored: APP-003 may be drawn male or female", () => {
  const slots = PHENOTYPES.pelvic.presentation.rectal_exam_slots;
  assert.ok(!Object.keys(slots).some((slotId) => slotId.startsWith("prostate")));
  assert.equal(RECTAL_SLOT_REVIEW_STATUS.prostate, "not_authored_phenotype_may_be_female");
  assert.equal(RECTAL_SLOT_REVIEW_STATUS.eligible_for_scoring, false);
});

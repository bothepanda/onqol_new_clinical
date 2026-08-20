/**
 * What the trainer may say about a medication before a reviewer has signed it.
 *
 * These tests only ever assert a NEGATIVE. Nothing here approves a drug, a dose
 * or a safety verdict; each case fixes a limit that the pilot must not cross by
 * accident. That is why they can be written before the dosing registry is
 * filled: they say what stays impossible once it is.
 *
 * Owner decisions of 20.08.2026 that these lock in:
 *   - tramadol and morphine are excluded from the pilot: recognised, never
 *     dosed, and never repaired with a number from model memory;
 *   - metamizole is a formulary drug, not a historical practice;
 *   - «голод, холод и покой» is historical only as a WHOLE strategy.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  LEGACY_PRACTICE_REGISTRY,
  detectLegacyPractices,
  legacyPracticeById,
} from "../core/legacyPractices.js";
import { readOrderSlots } from "../core/operationalization.js";
import { reviewActionParameters } from "../core/parameterSafety.js";
import {
  DOSING_RULE_REGISTRY,
  approvedDosingRules,
} from "../governance/clinicalGovernance.js";

// --- excluded opioids -------------------------------------------------------

for (const drug of ["трамадол", "морфин"]) {
  test(`${drug} is recognised as a named agent but carries no approved dose`, () => {
    const slots = readOrderSlots({
      actionId: "analgesia",
      text: `обезболю, ${drug} 100 мг внутримышечно`,
    });

    // Recognised: the order is complete enough to be an order.
    assert.equal(slots.complete, true);
    assert.match(slots.filled.agent, new RegExp(drug, "i"));
    assert.equal(slots.eligible_for_scoring, false);

    // But nothing in the registry can turn that into an approved treatment.
    assert.equal(
      approvedDosingRules().some((rule) => new RegExp(drug, "i").test(rule.agent || "")),
      false
    );
  });

  test(`a ${drug} dose is transcribed, blocked and never labelled safe`, () => {
    const { reviews } = reviewActionParameters(
      [
        {
          concept_id: "analgesia",
          verbatim: `${drug} 100 мг в/м`,
          drug_name: drug,
          dose_value: 100,
          dose_unit: "мг",
          route: "в/м",
        },
      ],
      `обезболю, ${drug} 100 мг в/м`,
      ["analgesia"]
    );

    assert.equal(reviews.length, 1);
    const [review] = reviews;
    assert.equal(review.recognized_drug, drug);
    assert.equal(review.safety_verdict, "not_yet_reviewed");
    assert.equal(review.review_status, "not_yet_reviewed");
    assert.equal(review.blocks_application, true);
    assert.equal(review.applied_to_patient, false);
    // The one thing that would be an invented dose: a correction.
    assert.equal(review.authoritative_correction, null);
    // The learner's own words are kept exactly as written, never normalised
    // into some other number.
    assert.equal(review.verbatim, `${drug} 100 мг в/м`);
  });
}

test("the mentor has no number to offer for an excluded opioid", () => {
  // The registry is the mentor's only source of a dose. While it holds no
  // opioid rule, there is nothing for a replacement dose to come from.
  assert.equal(
    DOSING_RULE_REGISTRY.some((rule) => /трамадол|морфин|tramadol|morphine/i.test(rule.agent || "")),
    false
  );
  assert.equal(
    approvedDosingRules().some((rule) =>
      /трамадол|морфин|tramadol|morphine/i.test(rule.agent || "")
    ),
    false
  );
});

// --- metamizole -------------------------------------------------------------

test("metamizole is no longer classified as a historical practice", () => {
  assert.equal(legacyPracticeById.has("legacy.metamizole-solo"), false);
  assert.equal(
    LEGACY_PRACTICE_REGISTRY.some((practice) => practice.practice_id === "legacy.metamizole-solo"),
    false
  );
  assert.deepEqual(detectLegacyPractices("анальгин 1 г в/м"), []);
  assert.deepEqual(detectLegacyPractices("введу метамизол"), []);
});

test("metamizole is still recognised as a named agent, and still not approved", () => {
  const slots = readOrderSlots({
    actionId: "analgesia",
    text: "обезболю, метамизол 1 г внутримышечно",
  });
  assert.match(slots.filled.agent, /метамизол/i);
  assert.equal(
    approvedDosingRules().some((rule) => /метамизол/i.test(rule.agent || "")),
    false
  );
});

test("the lytic mixture is still recognised, and still teaches nothing", () => {
  const [practice] = detectLegacyPractices("назначу литическую смесь");
  assert.equal(practice.practice_id, "legacy.lytic-mixture");
  // Recognition without authored teaching: the combination is neither validated
  // nor called unsafe on the strength of its components.
  assert.equal(practice.what_it_is, null);
  assert.equal(practice.why_alternatives_exist, null);
  assert.equal(practice.what_instead, null);
  assert.equal(practice.teaching_rule_id, null);
  assert.equal(practice.executes_on_patient, false);
});

// --- the slogan -------------------------------------------------------------

test("«голод, холод и покой» is historical only as a whole strategy", () => {
  const [practice] = detectLegacyPractices("тактика: голод, холод и покой");
  assert.equal(practice.practice_id, "legacy.golod-holod-pokoy");
});

test("a single measure inside an ordinary plan does not trigger the slogan", () => {
  // Each of these was flagged before 20.08.2026. None of them is a tactic.
  assert.deepEqual(detectLegacyPractices("положу холод на живот"), []);
  assert.deepEqual(detectLegacyPractices("пузырь со льдом на живот"), []);
  assert.deepEqual(detectLegacyPractices("пока голод, готовлю к операции"), []);
  assert.deepEqual(detectLegacyPractices("ничего внутрь, ждём операционную"), []);
});

// --- the registry itself ----------------------------------------------------

test("no medication rule can score, whatever else it does", () => {
  for (const rule of DOSING_RULE_REGISTRY) {
    assert.equal(rule.score_weight ?? 0, 0, `${rule.rule_id} must not carry weight`);
    assert.deepEqual(
      (rule.allowed_runtime_effects || []).filter((effect) => effect !== "mentor_teaching"),
      [],
      `${rule.rule_id} may only teach`
    );
  }
});

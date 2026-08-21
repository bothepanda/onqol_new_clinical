/**
 * Cefazolin 1 g against 2 g: what the mentor may not do about it.
 *
 * THE SITUATION. `dosing.cefazolin.prophylaxis` grants the mentor the number
 * "2 г" from the international reference guideline. КНФ РК and the Kazakhstan
 * protocol say 1 г. Eight residents trained on that protocol will order 1 г in
 * the first week, and by their own formulary they are right.
 *
 * Under the current architecture the mentor reads the approved rules and speaks
 * in its own words, so nothing about the registry alone stops it "helpfully"
 * correcting a cohort's national formulary. These tests assert the constraints
 * that do: what the mentor is told, what it is not told, and that a number the
 * learner wrote is theirs to keep.
 *
 * Everything here is a prohibition. Nothing in this file approves a dose, and a
 * passing run is not evidence that 1 г or 2 г is the better order.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { buildV35Case } from "../v35/createCase.js";
import { createV25Session } from "../v25/engine.js";
import { buildMentorBrief } from "../core/mentorBrief.js";
import {
  allowedNumbers,
  buildMentorPrompt,
  mentorHardBounds,
  validateMentorPayload,
} from "../core/mentorAgent.js";
import {
  DOSING_RULE_REGISTRY,
  MENTOR_JURISDICTION_RULE,
} from "../governance/clinicalGovernance.js";

const LOCAL_ORDER = "цефазолин 1 г в/в за 30 минут до разреза";

function caseAndBrief(learnerText = LOCAL_ORDER) {
  const caseData = buildV35Case({ seed: "reference-knf", locale: "ru", mode: "learner" }).caseData;
  const session = createV25Session({
    caseData,
    mode: "reference",
    seed: "reference-knf",
    locale: "ru",
    learnerId: "anon:test",
    institutionId: "synthetic-pilot",
  });
  const brief = {
    ...buildMentorBrief({
      caseData,
      session,
      plan: { input: learnerText, parsed: {} },
      deterministicUpdate: {},
    }),
    candidateIssues: [{ issue_id: "current", safety_critical: false }],
    mentorPolicy: null,
    learnerTurns: [learnerText],
  };
  return { caseData, session, brief };
}

// --- what the mentor is told ------------------------------------------------

test("the jurisdiction constraint reaches the mentor's hard bounds", () => {
  const { brief } = caseAndBrief();
  const bounds = mentorHardBounds(brief);

  assert.match(bounds, /LOCAL FORMULARY DOSE IS NOT AN ERROR/i);
  assert.match(bounds, /do not correct it/i);
  assert.match(bounds, /debrief material, never a live correction/i);

  // And it survives into the assembled prompt, not just the helper.
  const prompt = buildMentorPrompt({ brief, learnerText: LOCAL_ORDER, locale: "ru" });
  assert.match(prompt.system, /LOCAL FORMULARY DOSE IS NOT AN ERROR/i);
});

test("the rule is registered with the same signatures as the doses it guards", () => {
  assert.equal(MENTOR_JURISDICTION_RULE.review_status, "approved_for_training");
  assert.ok(MENTOR_JURISDICTION_RULE.reviewed_by.length >= 2);
  // It restricts and grants nothing: no dose, no route, no number at all.
  assert.doesNotMatch(MENTOR_JURISDICTION_RULE.instruction_ru, /\d/);
  for (const ruleId of MENTOR_JURISDICTION_RULE.applies_to) {
    assert.ok(
      DOSING_RULE_REGISTRY.some((rule) => rule.rule_id === ruleId),
      `${ruleId} is guarded but not in the registry`
    );
  }
});

// --- what the mentor is not told --------------------------------------------

test("the mentor never receives both regimens at once", () => {
  const { brief } = caseAndBrief();
  const serialized = JSON.stringify(brief.approvedDosingRules);

  // The KNF figure is recorded on the registry row for the debrief. If it also
  // reached the mentor, "1 г" would become a number it is licensed to say -
  // and the likeliest way to say it is as a correction.
  assert.doesNotMatch(serialized, /knf|КНФ/i);
  assert.doesNotMatch(serialized, /1 г/);

  const registryRow = DOSING_RULE_REGISTRY.find(
    (rule) => rule.rule_id === "dosing.cefazolin.prophylaxis"
  );
  assert.match(registryRow.knf_rule, /1 г/, "the divergence is still recorded for the debrief");
});

// --- what the learner's own number does --------------------------------------

test("the learner's own dose is permitted back, and an unrelated reference dose stays out", () => {
  const { brief } = caseAndBrief();
  const permitted = allowedNumbers(brief);

  // Rule 2 lets the mentor repeat what the learner wrote. That is what makes
  // "принято, цефазолин 1 г" expressible without inventing anything.
  assert.ok(permitted.has("1"), "the learner's own figure is quotable back to them");
  // A signed reference rule is still not global authority for every turn. It
  // enters the prompt only when the deterministic candidate scopes that rule.
  assert.equal(permitted.has("2"), false);
});

test("a reply that corrects the learner to the reference dose is rejected on its numbers", () => {
  // A mentor with no dosing rules in context has no licence for "2 г" at all:
  // the correction fails the numeric check before anyone judges its tone.
  const { caseData, brief } = caseAndBrief();
  const withoutRules = { ...brief, approvedDosingRules: [], learnerTurns: [] };

  const correction = {
    mode: "CLARIFY",
    issue_id: "current",
    mentor_text: "Не 1 г, а 2 г внутривенно — исправь назначение.",
    factual_claims: [],
    question_domain: null,
  };
  assert.equal(
    validateMentorPayload(correction, withoutRules, caseData, []).reason,
    "uncited_numeric_fact"
  );
});

test("accepting the learner's order needs no number the base does not hold", () => {
  const { caseData, brief } = caseAndBrief();
  const accepted = {
    mode: "CLARIFY",
    issue_id: "current",
    mentor_text: "Принято. Что контролируешь после введения?",
    factual_claims: [],
    question_domain: null,
  };
  assert.equal(validateMentorPayload(accepted, brief, caseData, []).ok, true);
});

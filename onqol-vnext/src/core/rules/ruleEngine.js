import { RULE_CONDITION } from "./conditions.js";
import { partitionByAuthority, simulatorLimitation } from "./governance.js";
import { reviewStatusOf } from "./contentProvenance.js";

/**
 * Evaluating a reviewed clinical rule against learner-visible state only.
 *
 * FAIL CLOSED, THE WAY THE ORIGINAL v3.5 GOVERNANCE FILE DID IT, KEPT AS A
 * PATTERN NOT AS CODE. A condition this engine cannot evaluate is `unknown`,
 * and an `unknown` condition makes the whole rule ineligible - never `met` by
 * default. That single property is what stops content from ever citing
 * "complicated appendicitis" teaching to a resident who has seen nothing
 * suggesting perforation: before the operative finding is disclosed,
 * complicated-vs-uncomplicated is `unknown`, so every rule keyed to it stays
 * dark, visibly, rather than firing on a guess.
 *
 * Every condition evaluator here receives ONLY `{ state, learnerVisible }` -
 * never `state.truth`. That is the mentor hidden-truth boundary (Foundation
 * Spec §51-52) enforced at the one place a leak could actually happen.
 */

export const VERDICT = Object.freeze({ MET: "met", NOT_MET: "not_met", UNKNOWN: "unknown" });

/**
 * @param {object} rule   { id, conditions: [{ type, ...params }], level, ... }
 * @param {object} ctx    { state, learnerVisible }
 */
export function evaluateRule(rule, ctx) {
  const results = rule.conditions.map((condition) => evaluateCondition(condition, ctx));
  const verdict = results.includes(VERDICT.UNKNOWN)
    ? VERDICT.UNKNOWN
    : results.every((result) => result === VERDICT.MET)
      ? VERDICT.MET
      : VERDICT.NOT_MET;

  return {
    ruleId: rule.id,
    verdict,
    eligible: verdict === VERDICT.MET,
    unevaluated: rule.conditions.filter((_condition, index) => results[index] === VERDICT.UNKNOWN).map((c) => c.type),
  };
}

function evaluateCondition(condition, ctx) {
  const evaluator = RULE_CONDITION[condition.type];
  if (!evaluator) return VERDICT.UNKNOWN;
  const result = evaluator(condition, ctx);
  if (result === undefined || result === null) return VERDICT.UNKNOWN;
  return result ? VERDICT.MET : VERDICT.NOT_MET;
}

/**
 * Every rule whose conditions currently hold against learner-visible state
 * AND whose content has cleared the runtime governance gate
 * (`review_status === "approved_for_training"` - see `governance.js`).
 *
 * A clinically-eligible-but-not-approved rule never reaches this return
 * value: it cannot become a safety stop, cannot become mentor teaching, and
 * cannot influence patient truth. It is not silently dropped either - see
 * `governanceBlockedEligibleRules` below, which callers use to record the
 * simulator-limitation audit trail without granting authority.
 */
export function eligibleRules(rules, ctx) {
  const clinicallyEligible = rules
    .map((rule) => ({ rule, evaluation: evaluateRule(rule, ctx) }))
    .filter((entry) => entry.evaluation.eligible)
    .map((entry) => entry.rule);
  return partitionByAuthority(clinicallyEligible, reviewStatusOf).authoritative;
}

/**
 * Clinically-eligible rules that governance blocked from authority - for the
 * causal log / debrief's "simulator limitation, not a learner error" trail
 * (task §21, Governance Spec §24). Never used to drive a safety stop or
 * mentor teaching.
 */
export function governanceBlockedEligibleRules(rules, ctx) {
  const clinicallyEligible = rules
    .map((rule) => ({ rule, evaluation: evaluateRule(rule, ctx) }))
    .filter((entry) => entry.evaluation.eligible)
    .map((entry) => entry.rule);
  return partitionByAuthority(clinicallyEligible, reviewStatusOf).blocked.map((rule) =>
    simulatorLimitation({ kind: "rule", id: rule.id, reviewStatus: reviewStatusOf(rule) ?? null }),
  );
}

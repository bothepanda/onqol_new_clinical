/**
 * Condition evaluators for `ruleEngine.js`.
 *
 * Each evaluator reads `ctx.learnerVisible` (built by
 * `core/state/learnerView.js`) and/or the non-hidden parts of `ctx.state`
 * (hospital, clock, commands). None may read `ctx.state.truth`. A new
 * evaluator that needs a fact the learner has not been shown is a sign the
 * fact needs to become a disclosed finding first, not that this file should
 * reach past the boundary.
 */
export const RULE_CONDITION = Object.freeze({
  findingRevealed: (condition, ctx) => ctx.learnerVisible.revealedFindings.includes(condition.findingId),

  managementIntentIs: (condition, ctx) => ctx.state.managementPlan.intent === condition.intent,

  hospitalCapabilityMissing: (condition, ctx) => {
    const capability = ctx.state.hospital.capabilities[condition.capabilityKey];
    return capability ? capability.available === false : undefined;
  },

  commandParamEquals: (condition, ctx) => ctx.command?.params?.[condition.param] === condition.value,

  commandParamOutsideRange: (condition, ctx) => {
    const value = Number(ctx.command?.params?.[condition.param]);
    if (Number.isNaN(value)) return undefined;
    const { min, max } = condition;
    return value < min || value > max;
  },

  commandTypeIs: (condition, ctx) => ctx.command?.type === condition.commandType,

  preopReadyIs: (condition, ctx) => ctx.state.preop.ready === condition.value,

  ageInYearsGte: (condition, ctx) =>
    ctx.learnerVisible.demographics?.age != null ? ctx.learnerVisible.demographics.age >= condition.years : undefined,

  consentNotObtained: (condition, ctx) => ctx.state.preop.consent !== "obtained",

  minutesSincePlanCommittedGte: (condition, ctx) => {
    const committedAt = ctx.state.managementPlan.committedAt;
    if (committedAt == null) return undefined;
    return ctx.state.clock.elapsedMinutes - committedAt >= condition.minutes;
  },

  procedureNotStarted: (condition, ctx) => ctx.state.operative.started === false,
});

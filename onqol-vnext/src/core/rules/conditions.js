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

  /**
   * The positive form. Needed by RULE-LAPAROSCOPIC-PREFERRED-WHEN-AVAILABLE:
   * the claim "laparoscopy is preferred" is conditional on the stack actually
   * being there, and the simulator must never imply open surgery is impossible
   * in a hospital that has no laparoscopy (matrix O01/MR04).
   */
  hospitalCapabilityAvailable: (condition, ctx) => {
    const capability = ctx.state.hospital.capabilities[condition.capabilityKey];
    return capability ? capability.available === true : undefined;
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

  /** Source control has been achieved - i.e. this is now a postoperative patient. */
  sourceControlAchieved: (condition, ctx) => ctx.state.operative.sourceControl === true,

  /**
   * Does the drug/fluid named by a command parameter carry a content tag?
   *
   * Keeps class-level rules ("no routine postoperative ANTIBIOTICS") out of the
   * business of enumerating drug ids: the formulary declares
   * `tags: [antibiotic, ...]` and the rule matches on the tag. Returns
   * `undefined` - and therefore UNKNOWN, and therefore ineligible - when the
   * bundle is not in scope or the drug is unknown, so the rule fails closed.
   */
  commandParamHasTag: (condition, ctx) => {
    const value = ctx.command?.params?.[condition.param];
    if (value == null) return undefined;
    const entry = ctx.bundle?.shared?.medications?.medications?.[value];
    if (!entry) return undefined;
    return (entry.tags ?? []).includes(condition.tag);
  },

  /**
   * Has the learner already administered a bolus infusion tagged
   * `condition.tag` (e.g. "resuscitation_fluid")? Generic across diseases:
   * content declares the tag on the fluid, this reads `state.infusions`
   * (never `state.truth`) rather than enumerating fluid ids. Introduced for
   * fluids-01's C1 flag ("diuretic ordered before any resuscitation bolus
   * given"), phrased in the negative because that is the only direction the
   * rule needs - matches the existing `consentNotObtained` /
   * `procedureNotStarted` naming convention rather than adding a generic NOT
   * operator to the (deliberately AND-only) rule engine.
   */
  /**
   * Has a vital the LEARNER has actually seen (via `learnerVisible.physiologyKnownAt`,
   * refreshed on REASSESS/arrival - never `state.physiology` directly) crossed a
   * threshold? Generic across diseases and fields. Introduced for fluids-01's C2
   * flag ("repeat bolus after overload signs were shown"): the rule must fire on
   * what the learner was told, not on hidden state they never asked about.
   */
  learnerVisibleVitalGte: (condition, ctx) => {
    const value = ctx.learnerVisible.physiologyKnownAt?.values?.[condition.field];
    return typeof value === "number" ? value >= condition.value : undefined;
  },

  noResuscitationBolusGiven: (condition, ctx) => {
    const fluids = ctx.bundle?.shared?.medications?.fluids ?? {};
    const tag = condition.tag ?? "resuscitation_fluid";
    return !(ctx.state.infusions ?? []).some((infusion) => infusion.bolus === true && fluids[infusion.fluidId]?.tags?.includes(tag));
  },
});

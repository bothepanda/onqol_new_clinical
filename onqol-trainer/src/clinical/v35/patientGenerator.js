// Deterministic patient generation.
//
// WHAT THIS IS NOT: A SEVERITY FORMULA
//
// The obvious design is `severity -> vitals`, and it is wrong. It makes the
// phenotype a severity dial, so a retrocecal appendix becomes a sicker patient
// simply by being retrocecal - which is a claim about position, not about
// physiology, and the owner flagged it.
//
// What actually drives physiology here:
//
//   morphology          uncomplicated inflammation is not perforation
//   time from onset     where in the phenotype's own window this patient sits
//   trajectory          a deteriorating course enters differently from a stable one
//
// The PHENOTYPE supplies the ENVELOPE - the range of values a patient with this
// presentation may have - and nothing else. It never contributes to how sick the
// patient is inside that envelope. That separation is what the review flag on
// `retrocecal` is about, and a test asserts it.
//
// The MODIFIER changes what must be done, not what the pulse is. V3.5 authors no
// physiological delta for MOD-PREGNANCY-POSSIBLE and none is invented here.
//
// The RESOURCE PROFILE decides what help exists. It never touches hidden
// physiology; a test asserts that too.
//
// ONE LATENT POSITION, NOT SIX INDEPENDENT DRAWS
//
// Addendum 2, verbatim: "Возраст, симптомы, vitals, лаборатория, imaging и
// морфология генерируются связанным кластером, а не независимо."
//
// So a single `physiologic_load` in [0,1] is derived from the three inputs
// above, and every variable is placed at that position inside its own authored
// range. A small bounded jitter keeps two patients at the same load from being
// numerically identical, without letting any variable wander to the other end of
// its range: at load 0.9 nothing lands near the floor.
//
// PURITY
//
// Same inputs, same output, every time. No clock, no Math.random, no ambient
// state. Repeat avoidance lives in the session selector, not here - a generator
// that remembers the last case is no longer reproducible from a seed.

import {
  BASE_ADULT_AGE,
  PHENOTYPES,
  POPULATION_BLOOD,
  PREGNANCY_BRANCH_RULE,
  V35_MODIFIERS,
  resolvePreset,
} from "./phenotypes.js";

/**
 * How much each input contributes to physiological load.
 *
 * EXPERT_OPINION_UNREVIEWED. These weights are a composition rule, not a
 * clinical finding: they say "perforation makes a patient sicker than
 * uncomplicated inflammation, and later is worse than earlier", which is the
 * minimum needed to place a patient inside an already-authored envelope. They
 * are not thresholds and cannot be read as any.
 *
 * Deliberately absent: any term for the phenotype.
 */
export const LOAD_COMPOSITION = Object.freeze({
  // Morphology SELECTS A DISTRIBUTION; it does not add a fixed score.
  //
  // Surgeon's correction, 09.08.2026, option (г): the authored ranges are HARD
  // ENVELOPES, not a uniform distribution to be swept. The previous additive
  // form pinned uncomplicated inflammation at 0.25 and, with time worth at most
  // another 0.25, made the upper half of every envelope unreachable - CRP 140
  // in a retrocecal case could not occur at any seed.
  //
  // Now each morphology names where its patients sit inside the envelope and how
  // wide they spread. `centre` is the middle of the distribution, `spread` the
  // half-width of the triangular core. Extremes remain reachable through the
  // tails, and stay rare.
  morphology_distribution: Object.freeze({
    uncomplicated_inflammation: Object.freeze({ centre: 0.5, spread: 0.5 }),
    abscess: Object.freeze({ centre: 0.62, spread: 0.38 }),
    gangrene_necrosis: Object.freeze({ centre: 0.68, spread: 0.32 }),
    perforation: Object.freeze({ centre: 0.74, spread: 0.26 }),
    diffuse_peritonitis: Object.freeze({ centre: 0.8, spread: 0.2 }),
  }),
  // Inflammatory burden also moves with how far through the phenotype's own
  // onset window the patient is, and with the trajectory. Both SHIFT the centre;
  // neither replaces the morphology's distribution.
  time_in_window_shift: 0.15,
  trajectory_shift: Object.freeze({
    "TRJ-STABLE": 0,
    "TRJ-SERIAL-EVOLUTION": 0,
    "TRJ-RESPONDS-TO-TREATMENT": 0,
    "TRJ-NONRESPONSE": 0.05,
    "TRJ-PROGRESSIVE-DETERIORATION": 0.1,
    "TRJ-SEPTIC-SHOCK": 0.15,
    "TRJ-RECURRENCE-READMISSION": 0.05,
  }),
  // Residual variability only. Every variable is placed by the shared burden;
  // this is the small remainder that keeps two patients at the same burden from
  // being numerically identical. It is NOT an independent draw per variable.
  per_variable_jitter: 0.12,
  // Target for the shape: p5-p95 should occupy roughly the central 15-85% of the
  // envelope, so the edges are rare rather than routine. Asserted by a test.
  target_p5_p95: Object.freeze({ min: 0.15, max: 0.85 }),
  provenance: "SURGEON_REVIEWED_PROVISIONAL",
  clinical_review_status: "reviewed_provisional",
  eligible_for_scoring: false,
});

/**
 * Haemodynamic states, surgeon's correction section 3.
 *
 * Pressure is generated from a state rather than as three loose numbers: pulse
 * pressure comes from the state, and the diastolic and the mean follow from it.
 * That makes MAP a real computed value instead of the fiction it was when the
 * diastolic was `systolic * 0.62`.
 *
 * ORDER OF DERIVATION. The surgeon specified MAP and pulse pressure first, then
 * SBP and DBP. The constraint that the systolic must land inside the preset's
 * authored envelope is the binding one, so the systolic is placed first and the
 * mean is derived: MAP = SBP - 2*PP/3, DBP = MAP - PP/3. The same three
 * identities, solved from the end that has a hard constraint.
 *
 * PULSE PRESSURE RANGES ARE PROVISIONAL AND UNREVIEWED. The surgeon specified
 * the mechanism, not the numbers. These are conventional values placed so the
 * mechanism can run and are flagged in REVIEW_TABLES.md for replacement.
 */
export const HAEMODYNAMIC_STATES = Object.freeze({
  stable: Object.freeze({
    state_id: "stable",
    pulse_pressure: Object.freeze({ min: 35, max: 50 }),
    allowed_for_presets: ["APP-001", "APP-002", "APP-003", "APP-004"],
  }),
  pain_sympathetic: Object.freeze({
    state_id: "pain_sympathetic",
    pulse_pressure: Object.freeze({ min: 40, max: 60 }),
    allowed_for_presets: ["APP-001", "APP-002", "APP-003", "APP-004"],
  }),
  // APP-005 only, and not reachable by a learner.
  compensated: Object.freeze({
    state_id: "compensated",
    pulse_pressure: Object.freeze({ min: 30, max: 45 }),
    allowed_for_presets: ["APP-005"],
  }),
  hypovolaemic: Object.freeze({
    state_id: "hypovolaemic",
    // Narrow: the classic early sign, before the systolic falls.
    pulse_pressure: Object.freeze({ min: 20, max: 35 }),
    allowed_for_presets: ["APP-005"],
  }),
  vasodilatory: Object.freeze({
    state_id: "vasodilatory",
    // Wide: low diastolic in a vasodilated septic patient.
    pulse_pressure: Object.freeze({ min: 45, max: 70 }),
    allowed_for_presets: ["APP-005"],
  }),
  provenance: "MECHANISM_REVIEWED_RANGES_UNREVIEWED",
  clinical_review_status: "pending",
  eligible_for_scoring: false,
});

function hashSeed(seed) {
  let hash = 2166136261;
  for (const char of String(seed)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  return function random() {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (value) => Math.min(1, Math.max(0, value));

/**
 * How many decimals each variable is reported to.
 *
 * Declared once because it is needed twice: to round on the way out, and to
 * work out how much of a cluster's apparent drift is just rounding. A
 * respiratory rate spans 14-20 and is reported as a whole number, so half a
 * breath is already 8% of its range - larger than the jitter budget. Checking
 * cluster coherence without accounting for that fails on arithmetic rather than
 * on incoherence.
 */
export const REPORTED_DECIMALS = Object.freeze({
  heart_rate: 0,
  temperature_c: 1,
  systolic_bp: 0,
  respiratory_rate: 0,
  wbc: 1,
  crp: 0,
});

/**
 * Place a triangular draw so its 5th and 95th percentiles land on a target band
 * inside a wider hard envelope.
 *
 * The mean of two uniforms has its p5 and p95 at roughly +/-0.684 of its
 * half-width, which is what makes this solvable in closed form.
 */
function inTargetBand(triangular, envelope, target) {
  const span = envelope.max - envelope.min;
  if (span <= 0) return 0;
  const low = (target.min - envelope.min) / span;
  const high = (target.max - envelope.min) / span;
  const centre = (low + high) / 2;
  const halfWidth = (high - low) / 2 / 0.684;
  return clamp01(centre + (triangular - 0.5) * 2 * halfWidth);
}

/** Position error introduced purely by reporting `rangeSpec` to `decimals`. */
function quantisationSlack(rangeSpec, decimals) {
  const span = rangeSpec.max - rangeSpec.min;
  if (span <= 0) return 0;
  return 10 ** -decimals / 2 / span;
}

/**
 * The stored load is itself rounded, and the coherence check compares against
 * the stored value rather than the exact one. Without this term the check fails
 * roughly once in eight thousand patients on the rounding of the number it is
 * measuring against - which looks like incoherence and is arithmetic.
 */
const LOAD_REPORTED_DECIMALS = 3;
const LOAD_ROUNDING_SLACK = 10 ** -LOAD_REPORTED_DECIMALS / 2;

/**
 * Instability, owner decision 09.08.2026.
 *
 * Replaces `SBP < 100 or HR > 120`, which called a systolic of 95 shock and
 * lumped tachycardia in with hypotension. Three separate things now:
 *
 *   hard instability     SBP < 90, MAP < 65, or shock index >= 1.0
 *   physiologic mismatch HR > 120 in an uncomplicated case that nothing explains
 *   neither             SBP 90-99 on its own
 *
 * MAP needs a real diastolic and there is not one yet - the handoff derived it
 * from the systolic, which is a readability trick, not a measurement. Declared
 * here and NOT evaluated until diastolic is authored; see DIASTOLIC_STATUS.
 *
 * These are generation guards: they decide whether a synthetic patient is
 * coherent enough to ship. They are NOT diagnostic cutoffs and are never shown
 * to a learner. NEEDS_CLINICAL_REVIEW.
 */
export const INSTABILITY_RULES = Object.freeze({
  hard: Object.freeze({
    systolic_below: 90,
    mean_arterial_pressure_below: 65,
    shock_index_at_or_above: 1.0,
  }),
  physiologic_mismatch: Object.freeze({
    heart_rate_above: 120,
    // Only a mismatch when nothing in the case accounts for it.
    explained_by_trajectories: ["TRJ-SEPTIC-SHOCK", "TRJ-PROGRESSIVE-DETERIORATION", "TRJ-NONRESPONSE"],
    explained_by_morphologies: ["perforation", "diffuse_peritonitis", "abscess", "gangrene_necrosis"],
  }),
  not_shock_on_its_own: Object.freeze({ systolic_between: [90, 99] }),
  clinical_review_status: "pending",
  eligible_for_scoring: false,
});

/**
 * Diastolic pressure is not generated.
 *
 * The handoff used to print `systolic * 0.62`, which is a plausible ratio for a
 * normotensive patient and wrong in exactly the situations that matter: a
 * vasodilated septic patient has a wide pulse pressure and a low diastolic, a
 * hypovolaemic one narrows it, and a stiff-arteried older patient has isolated
 * systolic hypertension. A fabricated diastolic would also feed a fabricated
 * MAP straight into the instability rule above.
 *
 * So it is not printed and not used. Authoring it needs per-phenotype ranges
 * from the surgeon, like every other variable.
 */
export const DIASTOLIC_STATUS = Object.freeze({
  generated: true,
  status: "DERIVED_FROM_HAEMODYNAMIC_STATE",
  // Resolved on 09.08.2026. The fixed 0.62 ratio is gone: pulse pressure comes
  // from the haemodynamic state, and MAP and the diastolic follow by identity.
  // MAP < 65 is therefore a live coherence rule rather than a declared intent.
  note_ru:
    "Диастолическое выводится из состояния гемодинамики: пульсовое давление задаётся состоянием, MAP = САД - 2*ПД/3, ДАД = MAP - ПД/3. Диапазоны пульсового давления пока не отрецензированы.",
  open_review: "HAEMODYNAMIC_STATES.pulse_pressure ranges",
});

/** Place a position in [0,1] inside a range, rounded to `decimals`. */
function at(rangeSpec, position, decimals = 0) {
  const raw = rangeSpec.min + (rangeSpec.max - rangeSpec.min) * clamp01(position);
  const factor = 10 ** decimals;
  return Math.round(raw * factor) / factor;
}

/**
 * Physiological load: how sick this patient is, in [0,1].
 *
 * @param {object} params
 * @param {string} params.morphology
 * @param {number} params.timeInWindow  0..1, position in the phenotype's window
 * @param {string} params.trajectoryId
 */
export function physiologicLoad({ morphology, timeInWindow, trajectoryId, draw }) {
  const distribution = LOAD_COMPOSITION.morphology_distribution[morphology];
  if (!distribution) {
    throw new Error(`No burden distribution declared for morphology "${morphology}".`);
  }
  const trajectoryShift = LOAD_COMPOSITION.trajectory_shift[trajectoryId] ?? 0;

  // Mean of two uniforms: a triangular distribution whose 5th and 95th
  // percentiles sit at about 0.16 and 0.84 of its width. That is the shape the
  // surgeon asked for - the central 15-85% of the envelope carries the bulk,
  // and the edges are reachable but rare.
  const triangular = (draw() + draw()) / 2;

  // Time through the phenotype's own window and the trajectory move the centre.
  // Neither replaces the distribution, so morphology still decides the shape.
  const centre = clamp01(
    distribution.centre +
      (clamp01(timeInWindow) - 0.5) * 2 * LOAD_COMPOSITION.time_in_window_shift +
      trajectoryShift
  );

  return clamp01(centre + (triangular - 0.5) * 2 * distribution.spread);
}

/**
 * Blood pressure from a haemodynamic state.
 *
 * Systolic is placed inside the preset's authored envelope first, because that
 * constraint is hard. Pulse pressure comes from the state, and the mean and the
 * diastolic follow by identity. Nothing here is a fixed ratio.
 */
export function derivePressures({ systolic, pulsePressure }) {
  const meanArterial = systolic - (2 * pulsePressure) / 3;
  return {
    systolic_bp: Math.round(systolic),
    diastolic_bp: Math.round(meanArterial - pulsePressure / 3),
    mean_arterial_pressure: Math.round(meanArterial),
    pulse_pressure: Math.round(pulsePressure),
  };
}

/**
 * Which haemodynamic states a preset may present.
 *
 * APP-001..004 are stable or in pain, and nothing else: the surgeon's rule is
 * that a learner-facing uncomplicated case must never carry MAP < 65, SBP < 90
 * or a shock index at or above 1. The shocked clusters exist only for APP-005,
 * which no learner can reach.
 */
export function haemodynamicStateFor(casePresetId, draw) {
  const eligible = Object.values(HAEMODYNAMIC_STATES).filter(
    (state) => state?.allowed_for_presets?.includes(casePresetId)
  );
  if (eligible.length === 0) {
    throw new Error(`No haemodynamic state declared for preset "${casePresetId}".`);
  }
  return eligible[Math.min(eligible.length - 1, Math.floor(draw() * eligible.length))];
}

/**
 * Generate one patient.
 *
 * @param {string} casePresetId
 * @param {string} seed
 * @returns {object} a frozen patient: hidden truth plus the inputs that made it
 */
export function generatePatient(casePresetId, seed) {
  const { preset, phenotype, modifiers } = resolvePreset(casePresetId);
  const random = mulberry32(hashSeed(`${casePresetId}:${seed}`));

  // 1. Where in this phenotype's own onset window does the patient sit.
  const timeInWindow = random();
  const hoursFromOnset = at(phenotype.presentation.hours_from_onset, timeInWindow);

  // 2. One shared inflammatory burden for the whole cluster.
  const load = physiologicLoad({
    morphology: preset.morphology,
    timeInWindow,
    trajectoryId: preset.trajectory_id,
    draw: random,
  });

  // 3. Every variable at that burden inside its own authored envelope, plus a
  //    small residual. The residual is not an independent draw of the variable -
  //    it is the remainder after the shared state has placed it.
  const jitter = () => (random() - 0.5) * 2 * LOAD_COMPOSITION.per_variable_jitter;
  const positioned = (rangeSpec, decimals) => at(rangeSpec, load + jitter(), decimals);
  const ranges = phenotype.authoring_ranges;

  // Systolic falls as burden rises, so it reads its envelope from the other end.
  const systolic = at(
    ranges.systolic_bp,
    1 - clamp01(load + jitter()),
    REPORTED_DECIMALS.systolic_bp
  );
  const state = haemodynamicStateFor(preset.case_preset_id, random);
  const pressures = derivePressures({
    systolic,
    pulsePressure: at(state.pulse_pressure, random()),
  });

  const vitals = Object.freeze({
    heart_rate: positioned(ranges.heart_rate, REPORTED_DECIMALS.heart_rate),
    temperature_c: positioned(ranges.temperature_c, REPORTED_DECIMALS.temperature_c),
    ...pressures,
    haemodynamic_state: state.state_id,
    respiratory_rate: positioned(ranges.respiratory_rate, REPORTED_DECIMALS.respiratory_rate),
  });

  // 4. Demographics. One adult population, not one per sex. A preset that
  //    declares the modifier (APP-002) constrains them; otherwise the patient is
  //    drawn from the whole adult range and the case adapts to her, not the
  //    other way round. Drawn before the labs because haemoglobin is sexed.
  const declared = modifiers.find((modifier) => modifier.demographics)?.demographics;
  const sex = declared?.sex ?? (random() < 0.5 ? "male" : "female");
  const age = at(declared?.age ?? BASE_ADULT_AGE, random());

  // White count and neutrophil fraction come from the same burden, and the
  // absolute count is DERIVED from them - never drawn separately, which is how a
  // patient ends up with 16 x10^9/L and 60% neutrophils.
  const wbc = positioned(ranges.wbc, REPORTED_DECIMALS.wbc);
  const neutrophilPercent = positioned(ranges.neutrophil_percent, 0);
  const haemoglobinRange = POPULATION_BLOOD.haemoglobin[sex];

  const labs = Object.freeze({
    wbc,
    neutrophil_percent: neutrophilPercent,
    absolute_neutrophil_count: Math.round(wbc * (neutrophilPercent / 100) * 10) / 10,
    crp: positioned(ranges.crp, REPORTED_DECIMALS.crp),
    // Population values: they do not vary with where the appendix sits. Drawn
    // from the adult range with the same triangular shape, so the edges of the
    // envelope stay uncommon.
    haemoglobin: at(haemoglobinRange, (random() + random()) / 2, 0),
    // The surgeon gave platelets a hard envelope of 150-400 and a target p5-p95
    // of 170-350, which is not the same distribution: centring on the envelope
    // put the 95th percentile at 360. Placed to hit the target band instead,
    // with the envelope as the outer bound.
    platelets: at(
      POPULATION_BLOOD.platelets.envelope,
      inTargetBand(
        (random() + random()) / 2,
        POPULATION_BLOOD.platelets.envelope,
        POPULATION_BLOOD.platelets.target_p5_p95
      ),
      0
    ),
  });

  // The pregnancy branch follows the PATIENT. A woman in the reproductive band
  // gets it whether or not the preset anticipated her - which is what lets every
  // preset present a young woman without each one declaring the modifier.
  const appliedModifiers = [...modifiers];
  const branchRequired =
    sex === PREGNANCY_BRANCH_RULE.sex &&
    age >= PREGNANCY_BRANCH_RULE.age.min &&
    age <= PREGNANCY_BRANCH_RULE.age.max;
  if (branchRequired && !appliedModifiers.some((m) => m.modifier_id === PREGNANCY_BRANCH_RULE.modifier_id)) {
    appliedModifiers.push(V35_MODIFIERS[PREGNANCY_BRANCH_RULE.modifier_id]);
  }

  const enabledActionIds = [
    ...new Set(appliedModifiers.flatMap((modifier) => modifier.enables_action_ids || [])),
  ];
  const enabledAlternatives = [
    ...new Set(appliedModifiers.flatMap((modifier) => modifier.enables_dangerous_alternatives || [])),
  ];

  return Object.freeze({
    // What made this patient. Everything below is reproducible from these.
    composition: Object.freeze({
      case_preset_id: preset.case_preset_id,
      phenotype_id: preset.phenotype_id,
      morphology: preset.morphology,
      // What was actually applied, which may exceed what the preset declared:
      // the pregnancy branch attaches to the patient. Reproducing a case means
      // replaying these, not the preset's declaration.
      population_modifier_ids: appliedModifiers.map((modifier) => modifier.modifier_id),
      declared_modifier_ids: [...preset.population_modifier_ids],
      trajectory_id: preset.trajectory_id,
      resource_profile_id: preset.resource_profile_id,
      seed,
    }),
    // Hidden truth. Frozen before the session; requesting a test reveals a value
    // that already exists rather than creating one.
    hidden: Object.freeze({
      morphology: preset.morphology,
      operative_truth_ru: phenotype.imaging.operative_truth_ru,
      physiologic_load:
        Math.round(load * 10 ** LOAD_REPORTED_DECIMALS) / 10 ** LOAD_REPORTED_DECIMALS,
      pregnancy_present: enabledActionIds.includes("pregnancy_test") ? false : null,
    }),
    demographics: Object.freeze({ sex, age }),
    presentation: Object.freeze({
      hours_from_onset: hoursFromOnset,
      pain_score: at(phenotype.presentation.pain_score, load + jitter()),
      story_ru: phenotype.presentation.story_ru,
      examination_ru: phenotype.presentation.examination_ru,
    }),
    vitals,
    labs,
    imaging: phenotype.imaging,
    // What this patient's modifiers switch on. The case factory reads this to
    // decide which actions belong to the case at all.
    enabled_action_ids: Object.freeze(enabledActionIds),
    enabled_dangerous_alternatives: Object.freeze(enabledAlternatives),
    // Nothing generated here may move a score.
    eligible_for_scoring: false,
    clinical_review_status: "pending",
  });
}

/**
 * Coherence validation, addendum 4.2.
 *
 * Returns violations rather than throwing: the caller decides whether a
 * violation rejects the seed or is reported for review. Rejecting is what the
 * session selector does.
 */
export function coherenceViolations(patient) {
  const violations = [];
  const uncomplicated = patient.hidden.morphology === "uncomplicated_inflammation";

  // "Не генерировать shock vitals при uncomplicated morphology", with
  // instability defined per INSTABILITY_RULES rather than by a systolic cutoff.
  const shockIndex = patient.vitals.heart_rate / patient.vitals.systolic_bp;
  // MAP is a real computed value now that pressure comes from a haemodynamic
  // state, so the rule the surgeon specified finally does something. It was
  // declared and inert while the diastolic was a fixed ratio.
  const hardInstability =
    patient.vitals.systolic_bp < INSTABILITY_RULES.hard.systolic_below ||
    patient.vitals.mean_arterial_pressure < INSTABILITY_RULES.hard.mean_arterial_pressure_below ||
    shockIndex >= INSTABILITY_RULES.hard.shock_index_at_or_above;
  if (uncomplicated && hardInstability) {
    violations.push({
      rule: "no_shock_vitals_with_uncomplicated_morphology",
      detail: `САД ${patient.vitals.systolic_bp}, MAP ${patient.vitals.mean_arterial_pressure}, шоковый индекс ${shockIndex.toFixed(2)} при неосложнённом воспалении`,
    });
  }

  // Tachycardia is a separate finding, not shock. It is a mismatch only when
  // neither the morphology nor the trajectory accounts for it.
  const explained =
    INSTABILITY_RULES.physiologic_mismatch.explained_by_morphologies.includes(
      patient.hidden.morphology
    ) ||
    INSTABILITY_RULES.physiologic_mismatch.explained_by_trajectories.includes(
      patient.composition.trajectory_id
    );
  if (
    !explained &&
    patient.vitals.heart_rate > INSTABILITY_RULES.physiologic_mismatch.heart_rate_above
  ) {
    violations.push({
      rule: "physiologic_mismatch_unexplained_tachycardia",
      detail: `ЧСС ${patient.vitals.heart_rate} без объяснения морфологией или траекторией`,
    });
  }

  // "Не генерировать normal perfusion, low inflammatory burden и diffuse
  //  purulent peritonitis одновременно."
  if (
    patient.hidden.morphology === "diffuse_peritonitis" &&
    patient.vitals.systolic_bp >= 110 &&
    patient.labs.wbc < 14
  ) {
    violations.push({
      rule: "no_normal_perfusion_with_diffuse_purulent_peritonitis",
      detail: `САД ${patient.vitals.systolic_bp} и лейкоциты ${patient.labs.wbc} при разлитом перитоните`,
    });
  }

  // The cluster must hang together: every variable sits near the shared load.
  const ranges = PHENOTYPES[patient.composition.phenotype_id].authoring_ranges;
  const positionOf = (value, rangeSpec) =>
    rangeSpec.max === rangeSpec.min ? 0 : (value - rangeSpec.min) / (rangeSpec.max - rangeSpec.min);
  for (const key of ["heart_rate", "temperature_c", "respiratory_rate", "wbc", "crp"]) {
    const rangeSpec = ranges[key];
    const value = patient.vitals[key] ?? patient.labs[key];
    // Jitter is the deliberate spread; quantisation is the unavoidable rounding.
    // Only the first is a statement about the patient.
    const tolerance =
      LOAD_COMPOSITION.per_variable_jitter +
      quantisationSlack(rangeSpec, REPORTED_DECIMALS[key]) +
      LOAD_ROUNDING_SLACK;
    const drift = Math.abs(positionOf(value, rangeSpec) - patient.hidden.physiologic_load);
    if (drift > tolerance) {
      violations.push({
        rule: "cluster_variables_track_one_load",
        detail: `${key} отстоит от общей нагрузки на ${drift.toFixed(2)} (допуск ${tolerance.toFixed(2)})`,
      });
    }
  }

  // Every value stays inside the authored envelope, always.
  for (const [key, rangeSpec] of Object.entries(ranges)) {
    const value = patient.vitals[key] ?? patient.labs[key];
    if (value === undefined) continue;
    if (value < rangeSpec.min || value > rangeSpec.max) {
      violations.push({
        rule: "value_outside_authoring_range",
        detail: `${key}=${value} вне авторского диапазона ${rangeSpec.min}-${rangeSpec.max}`,
      });
    }
  }

  // Pregnancy actions only where a modifier switched them on.
  const pregnancyEnabled = patient.enabled_action_ids.includes("pregnancy_test");
  if (!pregnancyEnabled && patient.hidden.pregnancy_present !== null) {
    violations.push({
      rule: "pregnancy_status_without_modifier",
      detail: "статус беременности задан пациенту без модификатора возможной беременности",
    });
  }
  // And the converse, which matters more: a woman in the reproductive band must
  // never reach a case without the pregnancy branch. PREGNANCY_BRANCH_RULE
  // attaches it automatically, so this is a guard on that mechanism rather than
  // a filter on seeds.
  if (
    !pregnancyEnabled &&
    patient.demographics.sex === PREGNANCY_BRANCH_RULE.sex &&
    patient.demographics.age >= PREGNANCY_BRANCH_RULE.age.min &&
    patient.demographics.age <= PREGNANCY_BRANCH_RULE.age.max
  ) {
    violations.push({
      rule: "reproductive_age_woman_without_pregnancy_branch",
      detail: `женщина ${patient.demographics.age} лет в кейсе без ветви исключения беременности`,
    });
  }

  return violations;
}

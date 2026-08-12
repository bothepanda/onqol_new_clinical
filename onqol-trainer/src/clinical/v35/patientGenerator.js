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
  POPULATION_BLOOD,
  physiologyEnvelopeFor,
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
/**
 * Morphology is a CATEGORICAL TRUTH, not a point on a severity line.
 *
 * Surgeon's correction, 09.08.2026: "Абсцесс, перфорация и перитонит не являются
 * точками одной линейной шкалы." The previous form gave each morphology one
 * scalar centre (0.5 / 0.62 / 0.74 / 0.8), which asserted that an abscess is 62%
 * of the way to a peritonitis. It is not; it is a different thing.
 *
 * So each morphology names a profile, and the profile carries the latent
 * variables that actually drive physiology - kept separate because they do not
 * move together. A walled-off abscess can carry a high inflammatory burden with
 * no organ dysfunction at all; a diffuse peritonitis is defined by having both.
 */
export const MORPHOLOGY_PROFILES = Object.freeze({
  uncomplicated_inflammation: Object.freeze({
    morphology: "uncomplicated_inflammation",
    inflammatory_burden_prior: Object.freeze({ min: 0.05, max: 0.75 }),
    organ_dysfunction_prior: Object.freeze({ min: 0, max: 0.15 }),
    haemodynamic_states: ["stable", "pain_sympathetic"],
  }),
  abscess: Object.freeze({
    morphology: "abscess",
    // A walled-off collection is USUALLY physiologically stable. Usually is not
    // never: the surgeon struck out the previous "organ dysfunction impossible"
    // rule, so the prior starts at zero and reaches well above it.
    inflammatory_burden_prior: Object.freeze({ min: 0.45, max: 0.95 }),
    organ_dysfunction_prior: Object.freeze({ min: 0, max: 0.45 }),
    haemodynamic_states: ["stable", "pain_sympathetic", "compensated"],
  }),
  gangrene_necrosis: Object.freeze({
    morphology: "gangrene_necrosis",
    inflammatory_burden_prior: Object.freeze({ min: 0.5, max: 0.95 }),
    organ_dysfunction_prior: Object.freeze({ min: 0, max: 0.6 }),
    haemodynamic_states: ["pain_sympathetic", "compensated"],
  }),
  perforation: Object.freeze({
    morphology: "perforation",
    inflammatory_burden_prior: Object.freeze({ min: 0.55, max: 1 }),
    organ_dysfunction_prior: Object.freeze({ min: 0.05, max: 0.8 }),
    haemodynamic_states: ["compensated", "hypovolaemic"],
  }),
  diffuse_peritonitis: Object.freeze({
    morphology: "diffuse_peritonitis",
    // Not a fixed dysfunction either: a young patient with reserve can hold a
    // peritonitis physiologically for a while, and an old one cannot.
    inflammatory_burden_prior: Object.freeze({ min: 0.6, max: 1 }),
    organ_dysfunction_prior: Object.freeze({ min: 0.1, max: 0.95 }),
    haemodynamic_states: ["compensated", "hypovolaemic", "vasodilatory"],
  }),
  provenance: "MECHANISM_REVIEWED_PRIORS_PROVISIONAL",
  clinical_review_status: "pending",
  eligible_for_scoring: false,
});

/**
 * Physiologic reserve: how much a patient absorbs before the numbers move.
 *
 * Named in the surgeon's list of physiology drivers. Reserve falls with age,
 * which is why an older patient shows a smaller heart-rate response to the same
 * inflammatory burden. Drawn per patient and applied to the physiological
 * variables, not to the burden itself - the disease is the same, the response
 * to it is not.
 */
export const PHYSIOLOGIC_RESERVE = Object.freeze({
  // Age shifts the PRIOR; it does not determine the value. Surgeon's
  // instruction, 09.08.2026: the distributions must overlap. A fit
  // seventy-year-old outperforms a frail thirty-year-old, and a reserve computed
  // as a function of age alone cannot express that - it would make age a
  // physiological verdict rather than a risk factor.
  prior_young: Object.freeze({ min: 0.88, max: 1.0 }),
  prior_old: Object.freeze({ min: 0.78, max: 0.95 }),
  // The overlap is the point: 0.88-0.95 is reachable at any adult age.
  age_reference: Object.freeze({ prior_shifts_from: 40, prior_settles_at: 75 }),
  // Reserve modifies the physiological RESPONSE only. It never touches
  // morphology or inflammatory burden: the disease is what it is, and reserve
  // decides how loudly the patient shows it. Asserted by a test.
  modifies: ["heart_rate", "temperature_c", "respiratory_rate", "systolic_bp"],
  never_modifies: ["morphology", "inflammatory_burden", "organ_dysfunction"],
  clinical_review_status: "pending",
  eligible_for_scoring: false,
});

/**
 * How the latent state is composed.
 *
 * TIME IS ABSOLUTE, NOT RELATIVE TO THE PHENOTYPE.
 *
 * It used to be the position inside each phenotype's own onset window, which
 * erased the difference between a classic case at 13 hours and a retrocecal one
 * at 13 hours - and then the phenotype's envelope silently put that difference
 * back. The same fact counted twice, in two places, with no way to see it.
 *
 * Hours from onset now drive the burden on one scale shared by every phenotype.
 * A retrocecal patient who presents later is sicker BECAUSE they presented
 * later, which anyone can check, rather than because of where the appendix sits.
 */
export const LOAD_COMPOSITION = Object.freeze({
  // Horizon over which time raises the burden; beyond it the term saturates.
  time_reference_hours: 72,
  time_shift: 0.15,
  trajectory_shift: Object.freeze({
    "TRJ-STABLE": 0,
    "TRJ-SERIAL-EVOLUTION": 0,
    "TRJ-RESPONDS-TO-TREATMENT": 0,
    "TRJ-NONRESPONSE": 0.05,
    "TRJ-PROGRESSIVE-DETERIORATION": 0.1,
    "TRJ-SEPTIC-SHOCK": 0.15,
    "TRJ-RECURRENCE-READMISSION": 0.05,
  }),
  // Residual variability only. Every variable is placed by the shared latent
  // state; this is the remainder that stops two patients at the same burden from
  // being numerically identical. NOT an independent draw per variable.
  per_variable_jitter: 0.12,
  target_p5_p95: Object.freeze({ min: 0.15, max: 0.85 }),
  // The MECHANISM is reviewed: morphology supplies a prior, absolute time and
  // trajectory shift it, one latent places every variable. The NUMBERS are not -
  // `time_shift: 0.15` is exactly what produces the unvalidated CRP gradient in
  // early_subtle.review_flag. Two statuses, because they are two claims.
  mechanism_review_status: "reviewed_provisional",
  numeric_parameters_review_status: "pending",
  clinical_review_status: "pending",
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
    // A state that is defined as stable cannot emit a rate and a pressure that
    // together mean the opposite. The cap is a property of the STATE, not a trim
    // of the phenotype envelope: heart rate is placed within what the state and
    // the drawn pressure allow, instead of being drawn freely and then thrown
    // away by a validator.
    max_shock_index: 0.85,
    min_mean_arterial_pressure: 70,
    allowed_for_presets: ["APP-001", "APP-002", "APP-003", "APP-004"],
  }),
  pain_sympathetic: Object.freeze({
    state_id: "pain_sympathetic",
    pulse_pressure: Object.freeze({ min: 40, max: 60 }),
    max_shock_index: 0.95,
    min_mean_arterial_pressure: 68,
    allowed_for_presets: ["APP-001", "APP-002", "APP-003", "APP-004"],
  }),
  // APP-005 only, and not reachable by a learner.
  compensated: Object.freeze({
    state_id: "compensated",
    pulse_pressure: Object.freeze({ min: 30, max: 45 }),
    max_shock_index: 1.1,
    min_mean_arterial_pressure: 65,
    allowed_for_presets: ["APP-005"],
  }),
  hypovolaemic: Object.freeze({
    state_id: "hypovolaemic",
    // Narrow: the classic early sign, before the systolic falls.
    pulse_pressure: Object.freeze({ min: 20, max: 35 }),
    max_shock_index: 1.4,
    min_mean_arterial_pressure: 55,
    allowed_for_presets: ["APP-005"],
  }),
  vasodilatory: Object.freeze({
    state_id: "vasodilatory",
    // Wide: low diastolic in a vasodilated septic patient.
    pulse_pressure: Object.freeze({ min: 45, max: 70 }),
    max_shock_index: 1.4,
    min_mean_arterial_pressure: 55,
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
  // Hard instability is a pressure failure, and only that.
  hard: Object.freeze({
    systolic_below: 90,
    mean_arterial_pressure_below: 65,
  }),
  physiologic_mismatch: Object.freeze({
    // Moved out of `hard` on the surgeon's instruction, 09.08.2026. A shock
    // index at or above 1 is a signal of possible deterioration - it is not a
    // definition of shock, and treating it as one labels compensated patients
    // as shocked (Koch et al., 2019,
    // https://pmc.ncbi.nlm.nih.gov/articles/PMC6698590/).
    shock_index_at_or_above: 1.0,
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
export function latentClinicalState({ morphology, hoursFromOnset, trajectoryId, draw }) {
  const profile = MORPHOLOGY_PROFILES[morphology];
  if (!profile) throw new Error(`No morphology profile declared for "${morphology}".`);

  // Mean of two uniforms: triangular, p5/p95 at about 0.16/0.84 of the width.
  const triangular = () => (draw() + draw()) / 2;
  const fromPrior = (prior) => prior.min + (prior.max - prior.min) * triangular();

  const timeTerm =
    (clamp01(hoursFromOnset / LOAD_COMPOSITION.time_reference_hours) - 0.5) *
    2 *
    LOAD_COMPOSITION.time_shift;
  const trajectoryTerm = LOAD_COMPOSITION.trajectory_shift[trajectoryId] ?? 0;

  // The morphology supplies a PRIOR RANGE, not a centre. Time and trajectory
  // move the draw; they do not replace it.
  const inflammatoryBurden = clamp01(
    fromPrior(profile.inflammatory_burden_prior) + timeTerm + trajectoryTerm
  );
  const organDysfunction = clamp01(
    fromPrior(profile.organ_dysfunction_prior) + trajectoryTerm
  );

  return {
    morphology, // categorical truth, carried through untouched
    inflammatory_burden: Math.round(inflammatoryBurden * 1000) / 1000,
    organ_dysfunction: Math.round(organDysfunction * 1000) / 1000,
    trajectory_id: trajectoryId,
    hours_from_onset: hoursFromOnset,
  };
}

/**
 * How much this patient's reserve damps the physiological response.
 * Returns a multiplier in (0, 1]: 1 is a full response, lower is blunted.
 */
export function drawPhysiologicReserve(age, draw) {
  const { prior_shifts_from: from, prior_settles_at: to } = PHYSIOLOGIC_RESERVE.age_reference;
  const fraction = clamp01((age - from) / (to - from));
  // Interpolate the PRIOR between the young and old bands, then draw inside it.
  // Two patients of the same age get different reserves; patients of different
  // ages have overlapping ranges.
  const min =
    PHYSIOLOGIC_RESERVE.prior_young.min +
    (PHYSIOLOGIC_RESERVE.prior_old.min - PHYSIOLOGIC_RESERVE.prior_young.min) * fraction;
  const max =
    PHYSIOLOGIC_RESERVE.prior_young.max +
    (PHYSIOLOGIC_RESERVE.prior_old.max - PHYSIOLOGIC_RESERVE.prior_young.max) * fraction;
  const triangular = (draw() + draw()) / 2;
  return Math.round((min + (max - min) * triangular) * 1000) / 1000;
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
export function generatePatient(casePresetId, seed, options = {}) {
  const { preset, phenotype, modifiers } = resolvePreset(casePresetId);
  // TWO STREAMS, and the split is the point.
  //
  // The PHYSIOLOGY stream is keyed on the seed alone, so it does not know which
  // preset asked. Two presets given the same seed and the same disease time
  // therefore draw the same burden, the same reserve, the same residuals - and
  // produce the same patient physiologically. That is what makes the matched
  // counterfactual exact rather than approximately equal, and it is why a
  // phenotype cannot influence physiology even accidentally.
  //
  // The PRESENTATION stream is keyed on the preset as well, because the onset
  // window genuinely belongs to the phenotype: a retrocecal appendix is found
  // later, and that lateness then drives physiology through the shared time
  // term - once, visibly.
  const random = mulberry32(hashSeed(`physiology:${seed}`));
  const presentationRandom = mulberry32(hashSeed(`presentation:${casePresetId}:${seed}`));

  // 1. Absolute time from onset, drawn inside the phenotype's authored window.
  //    The WINDOW is phenotype-specific; the HOURS are then used on a scale
  //    shared by every phenotype, so time is counted once.
  // `hoursFromOnset` may be pinned. Two uses, both legitimate: faculty preview
  // of a specific point in the disease, and the matched counterfactual, where
  // holding time fixed is the whole experiment. The draw still happens either
  // way, so the random stream stays aligned and the rest of the patient is
  // unchanged - which is what makes the comparison exact rather than approximate.
  const drawnHours = at(phenotype.presentation.hours_from_onset, presentationRandom());
  const hoursFromOnset = Number.isFinite(options.hoursFromOnset)
    ? options.hoursFromOnset
    : drawnHours;

  // 2. The latent clinical state: inflammatory burden and organ dysfunction as
  //    separate variables, morphology carried through as a category.
  const latent = latentClinicalState({
    morphology: preset.morphology,
    hoursFromOnset,
    trajectoryId: preset.trajectory_id,
    draw: random,
  });
  const load = latent.inflammatory_burden;

  // 3. Every variable at that burden inside its own authored envelope, plus a
  //    small residual - the remainder after the shared state has placed it.
  const jitter = () => (random() - 0.5) * 2 * LOAD_COMPOSITION.per_variable_jitter;
  const positioned = (rangeSpec, decimals) => at(rangeSpec, load + jitter(), decimals);
  // Physiology envelope belongs to the morphology; the phenotype supplies only
  // the onset window and the presentation text.
  const ranges = physiologyEnvelopeFor(preset.morphology);

  // 4. Demographics first: physiologic reserve depends on age, and reserve damps
  //    the physiological response. Drawn before any vital sign is placed.
  // Both draws happen unconditionally, then a declaring modifier overrides them.
  // Drawing only when undeclared would make the stream consume a different
  // number of values depending on the preset's modifiers, which silently
  // desynchronises the physiology stream between presets - and the matched
  // counterfactual would then differ by a rounding step for no clinical reason.
  const drawnSex = random() < 0.5 ? "male" : "female";
  const drawnAgePosition = random();
  const declared = modifiers.find((modifier) => modifier.demographics)?.demographics;
  const sex = declared?.sex ?? drawnSex;
  const age = at(declared?.age ?? BASE_ADULT_AGE, drawnAgePosition);
  const reserve = drawPhysiologicReserve(age, random);
  // Reserve blunts the response to the same burden: an older patient shows less
  // tachycardia and less fever for the same disease.
  const responded = load * reserve;
  const respond = (rangeSpec, decimals) => at(rangeSpec, responded + jitter(), decimals);

  // 5. Pressure and rate from ONE haemodynamic state, generated together.
  //
  //    Systolic first, because landing inside the authored envelope is the hard
  //    constraint. Pulse pressure then comes from the state, narrowed where a
  //    wide one would drop the mean below what the state permits. Heart rate is
  //    finally placed within its envelope AND within the state's shock-index
  //    ceiling - so an incompatible pair is never built, rather than built and
  //    rejected.
  const state = haemodynamicStateFor(preset.case_preset_id, random);
  const systolic = at(ranges.systolic_bp, 1 - clamp01(responded + jitter()), REPORTED_DECIMALS.systolic_bp);
  // MAP = SBP - 2*PP/3 >= floor  =>  PP <= 1.5 * (SBP - floor)
  const maxPulseForMap = 1.5 * (systolic - state.min_mean_arterial_pressure);
  const pulsePressure = at(
    { min: state.pulse_pressure.min, max: Math.max(state.pulse_pressure.min, Math.min(state.pulse_pressure.max, maxPulseForMap)) },
    random()
  );
  const pressures = derivePressures({ systolic, pulsePressure });

  const heartRateCeiling = Math.min(
    ranges.heart_rate.max,
    Math.floor(pressures.systolic_bp * state.max_shock_index)
  );
  const heartRate = at(
    { min: ranges.heart_rate.min, max: Math.max(ranges.heart_rate.min, heartRateCeiling) },
    responded + jitter(),
    REPORTED_DECIMALS.heart_rate
  );

  const vitals = Object.freeze({
    heart_rate: heartRate,
    temperature_c: respond(ranges.temperature_c, REPORTED_DECIMALS.temperature_c),
    ...pressures,
    haemodynamic_state: state.state_id,
    respiratory_rate: respond(ranges.respiratory_rate, REPORTED_DECIMALS.respiratory_rate),
  });

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
    // Population values: they do not vary with where the appendix sits.
    haemoglobin: at(haemoglobinRange, (random() + random()) / 2, 0),
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
      // Declared by the preset. The case factory copies it into the effective
      // runtime snapshot; physiology generation remains independent of it.
      declared_resource_profile_id: preset.declared_resource_profile_id,
      seed,
    }),
    // Hidden truth. Frozen before the session; requesting a test reveals a value
    // that already exists rather than creating one.
    hidden: Object.freeze({
      morphology: preset.morphology,
      operative_truth_ru: phenotype.imaging.operative_truth_ru,
      // The latent state, stored separately rather than collapsed into one
      // "severity" number: morphology is categorical, burden and organ
      // dysfunction are their own variables.
      latent_state: latent,
      physiologic_reserve: Math.round(reserve * 1000) / 1000,
      // Burden after reserve has damped it. The vital signs were placed at THIS
      // position, so coherence must be judged against it: an older patient's
      // blunted response is the model working, not a cluster falling apart.
      physiologic_response: Math.round(responded * 1000) / 1000,
      physiologic_load: latent.inflammatory_burden,
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
    patient.vitals.mean_arterial_pressure < INSTABILITY_RULES.hard.mean_arterial_pressure_below;
  if (uncomplicated && hardInstability) {
    violations.push({
      rule: "no_shock_vitals_with_uncomplicated_morphology",
      detail: `САД ${patient.vitals.systolic_bp}, MAP ${patient.vitals.mean_arterial_pressure} при неосложнённом воспалении`,
    });
  }

  // A raised shock index is a mismatch signal, not shock. Reported separately so
  // it can never be read as a diagnosis.
  if (uncomplicated && shockIndex >= INSTABILITY_RULES.physiologic_mismatch.shock_index_at_or_above) {
    violations.push({
      rule: "physiologic_mismatch_shock_index",
      detail: `шоковый индекс ${shockIndex.toFixed(2)} при неосложнённом воспалении`,
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
  const ranges = physiologyEnvelopeFor(patient.hidden.morphology);
  const positionOf = (value, rangeSpec) =>
    rangeSpec.max === rangeSpec.min ? 0 : (value - rangeSpec.min) / (rangeSpec.max - rangeSpec.min);
  // Heart rate is placed inside the range the STATE allows, not the whole
  // phenotype envelope, so its coherence must be judged against the same range.
  // Measuring it against the full envelope reported a mismatch every time the
  // shock-index ceiling bit - which is the mechanism working, not failing.
  const state = HAEMODYNAMIC_STATES[patient.vitals.haemodynamic_state];
  const effectiveRange = (key) => {
    if (key !== "heart_rate" || !state) return ranges[key];
    const ceiling = Math.min(
      ranges.heart_rate.max,
      Math.floor(patient.vitals.systolic_bp * state.max_shock_index)
    );
    return { min: ranges.heart_rate.min, max: Math.max(ranges.heart_rate.min, ceiling) };
  };

  for (const key of ["heart_rate", "temperature_c", "respiratory_rate", "wbc", "crp"]) {
    const rangeSpec = effectiveRange(key);
    const value = patient.vitals[key] ?? patient.labs[key];
    // Jitter is the deliberate spread; quantisation is the unavoidable rounding.
    // Only the first is a statement about the patient.
    const tolerance =
      LOAD_COMPOSITION.per_variable_jitter +
      quantisationSlack(rangeSpec, REPORTED_DECIMALS[key]) +
      LOAD_ROUNDING_SLACK;
    // Vitals were placed after reserve damping; labs track the burden itself.
    const reference = ["heart_rate", "temperature_c", "respiratory_rate"].includes(key)
      ? patient.hidden.physiologic_response ?? patient.hidden.physiologic_load
      : patient.hidden.physiologic_load;
    const drift = Math.abs(positionOf(value, rangeSpec) - reference);
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

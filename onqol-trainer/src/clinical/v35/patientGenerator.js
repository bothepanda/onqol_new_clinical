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

import { PHENOTYPES, resolvePreset } from "./phenotypes.js";

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
  morphology: Object.freeze({
    uncomplicated_inflammation: 0.25,
    abscess: 0.6,
    gangrene_necrosis: 0.7,
    perforation: 0.8,
    diffuse_peritonitis: 0.9,
  }),
  // Weight of "how far through this phenotype's own onset window the patient is".
  // Relative to the phenotype, so ten hours is late for early_subtle and early
  // for retrocecal - which is the point.
  time_in_window_weight: 0.25,
  trajectory: Object.freeze({
    "TRJ-STABLE": 0,
    "TRJ-SERIAL-EVOLUTION": 0,
    "TRJ-RESPONDS-TO-TREATMENT": 0,
    "TRJ-NONRESPONSE": 0.05,
    "TRJ-PROGRESSIVE-DETERIORATION": 0.1,
    "TRJ-SEPTIC-SHOCK": 0.15,
    "TRJ-RECURRENCE-READMISSION": 0.05,
  }),
  // How far a single variable may sit from the shared load. Small on purpose:
  // above roughly 0.15 the cluster stops looking like one patient.
  per_variable_jitter: 0.12,
  provenance: "EXPERT_OPINION_UNREVIEWED",
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
 * Who a preset presents when no modifier constrains demographics.
 *
 * NEEDS_CLINICAL_REVIEW, and the open question is named in `review_flag`.
 */
export const DEFAULT_DEMOGRAPHICS = Object.freeze({
  male: Object.freeze({ min: 18, max: 70 }),
  // 46 is the floor because MOD-PREGNANCY-POSSIBLE declares reproductive age as
  // 18-45. Below it, the case would owe the learner a pregnancy branch it does
  // not have.
  female_without_pregnancy_branch: Object.freeze({ min: 46, max: 75 }),
  review_flag: Object.freeze({
    id: "presets_without_pregnancy_modifier_never_show_a_young_woman",
    question_ru:
      "APP-001, APP-003 и APP-004 не объявляют MOD-PREGNANCY-POSSIBLE, поэтому не могут выдать женщину 18-45 лет: иначе в кейсе не было бы ветви исключения беременности. Но аппендицит у молодых женщин част. Добавить модификатор в default_modifiers этих пресетов (тогда ветвь ХГЧ появится везде), или оставить как есть и признать, что три из четырёх пресетов тренируют другую популяцию?",
    status: "NEEDS_CLINICAL_REVIEW",
  }),
  clinical_review_status: "pending",
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
export function physiologicLoad({ morphology, timeInWindow, trajectoryId }) {
  const morphologyLoad = LOAD_COMPOSITION.morphology[morphology];
  if (morphologyLoad === undefined) {
    throw new Error(`No load weight declared for morphology "${morphology}".`);
  }
  const trajectoryLoad = LOAD_COMPOSITION.trajectory[trajectoryId] ?? 0;
  return clamp01(
    morphologyLoad + clamp01(timeInWindow) * LOAD_COMPOSITION.time_in_window_weight + trajectoryLoad
  );
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

  // 2. One shared load for the whole cluster.
  const load = physiologicLoad({
    morphology: preset.morphology,
    timeInWindow,
    trajectoryId: preset.trajectory_id,
  });

  // 3. Every variable at that load inside its own authored envelope.
  const jitter = () => (random() - 0.5) * 2 * LOAD_COMPOSITION.per_variable_jitter;
  const positioned = (rangeSpec, decimals) => at(rangeSpec, load + jitter(), decimals);
  const ranges = phenotype.authoring_ranges;

  const vitals = Object.freeze({
    heart_rate: positioned(ranges.heart_rate, REPORTED_DECIMALS.heart_rate),
    temperature_c: positioned(ranges.temperature_c, REPORTED_DECIMALS.temperature_c),
    // Blood pressure falls as load rises, so it reads the envelope from the
    // other end. Declared here rather than by reversing the authored range,
    // which would make the range itself say something backwards.
    systolic_bp: at(ranges.systolic_bp, 1 - clamp01(load + jitter()), REPORTED_DECIMALS.systolic_bp),
    respiratory_rate: positioned(ranges.respiratory_rate, REPORTED_DECIMALS.respiratory_rate),
  });

  const labs = Object.freeze({
    wbc: positioned(ranges.wbc, REPORTED_DECIMALS.wbc),
    crp: positioned(ranges.crp, REPORTED_DECIMALS.crp),
  });

  // 4. Demographics come from the modifiers, or from the adult default when no
  //    modifier constrains them. No modifier means no gynaecological layer -
  //    and the absence of the actions, not their presence at zero weight.
  const demographic = modifiers.find((modifier) => modifier.demographics)?.demographics;
  let sex;
  let age;
  if (demographic) {
    sex = demographic.sex;
    age = at(demographic.age, random());
  } else {
    // No reproductive-potential modifier means this case has no pregnancy safety
    // branch - so it must not produce a patient who would need one. A woman of
    // reproductive age with no beta-hCG in the case would teach the exact
    // omission the trainer exists to prevent.
    //
    // The consequence is a real content limitation, not a neutral default:
    // presets without the modifier never present a young woman, and appendicitis
    // in young women is common. Flagged in DEFAULT_DEMOGRAPHICS for a reviewer
    // rather than papered over.
    sex = random() < 0.5 ? "male" : "female";
    age =
      sex === "female"
        ? at(DEFAULT_DEMOGRAPHICS.female_without_pregnancy_branch, random())
        : at(DEFAULT_DEMOGRAPHICS.male, random());
  }

  const enabledActionIds = [
    ...new Set(modifiers.flatMap((modifier) => modifier.enables_action_ids || [])),
  ];
  const enabledAlternatives = [
    ...new Set(modifiers.flatMap((modifier) => modifier.enables_dangerous_alternatives || [])),
  ];

  return Object.freeze({
    // What made this patient. Everything below is reproducible from these.
    composition: Object.freeze({
      case_preset_id: preset.case_preset_id,
      phenotype_id: preset.phenotype_id,
      morphology: preset.morphology,
      population_modifier_ids: [...preset.population_modifier_ids],
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

  // "Не генерировать shock vitals при uncomplicated morphology."
  if (uncomplicated && (patient.vitals.systolic_bp < 100 || patient.vitals.heart_rate > 120)) {
    violations.push({
      rule: "no_shock_vitals_with_uncomplicated_morphology",
      detail: `САД ${patient.vitals.systolic_bp}, ЧСС ${patient.vitals.heart_rate} при неосложнённом воспалении`,
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
  // And the converse, which matters more: a case with no pregnancy branch must
  // not present a patient who needs one.
  if (
    !pregnancyEnabled &&
    patient.demographics.sex === "female" &&
    patient.demographics.age <= 45
  ) {
    violations.push({
      rule: "reproductive_age_woman_without_pregnancy_branch",
      detail: `женщина ${patient.demographics.age} лет в кейсе без ветви исключения беременности`,
    });
  }

  return violations;
}

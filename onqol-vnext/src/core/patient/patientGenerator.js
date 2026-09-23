/**
 * Generating one clinically coherent patient from reviewed content.
 *
 * Generation proceeds through layers (phenotype -> morphology -> physiology
 * envelope -> individual values), phenotype coherence outranks independent
 * randomization, and everything is drawn from a named RNG stream so a seed
 * reproduces the same patient.
 *
 * 2026-08-25 remediation (review matrix §3, §4; task §5, §6, §7):
 *
 *  - The age range moved OUT of this file. It used to be `int(18, 75)`,
 *    hardcoded, which is ungoverned patient-truth generation. It now comes
 *    from `phenotypes.yaml#demographics` (18-58, matrix P01) and is inventoried
 *    by `patientTruthGovernance.js`.
 *  - The "later onset drifts every value toward the top of the envelope" bias
 *    is GONE (matrix V04 REMOVE): duration may influence probability
 *    distributions, but it must not deterministically force WBC/CRP upward.
 *  - Symptom duration is bounded to the reviewed window; the extended window
 *    is authored but disabled because its share is unreviewed (matrix P04).
 *  - Nausea/vomiting is drawn as one COHERENT state, so repeated vomiting
 *    with no nausea is not expressible (matrix P06).
 *  - Sex-conditional history is applied by rule, so a male patient can never
 *    receive an LMP/pregnancy line (task §11).
 *  - Pain is generated into the PRE-SOURCE-CONTROL pain state, which is
 *    distinct from the post-source-control one (matrix PO01; see
 *    `state/painState.js`).
 *
 * This module knows nothing about any particular disease beyond what the
 * bundle tells it: a second disease's generator is this same file reading a
 * different bundle.
 */
import { createRng } from "../rng.js";
import { PAIN_STATE } from "../state/painState.js";

/**
 * @param {object} options
 * @param {string} options.seed
 * @param {object} options.bundle        compiled disease content
 * @param {string} options.casePresetId
 */
export function generatePatient({ seed, bundle, casePresetId }) {
  const rng = createRng(seed);
  const preset = (bundle.phenotypes.case_presets ?? []).find((p) => p.case_preset_id === casePresetId);
  if (!preset) throw new Error(`Unknown case preset "${casePresetId}".`);

  const phenotype = bundle.phenotypes.phenotypes[preset.phenotype_id];
  if (!phenotype) throw new Error(`Case preset "${casePresetId}" names unknown phenotype "${preset.phenotype_id}".`);

  // A "fixed" phenotype (Wave B / ТЗ §7-8: fluids-01 is one scripted teaching
  // patient with a deterministic branching table, not a generated instance of
  // a phenotype library) skips the whole draw pipeline below and returns its
  // authored state directly. Generic on the phenotype's own shape, not on
  // disease_id - any future single-scripted-patient case can use it the same
  // way appendicitis's generated phenotypes use the draw pipeline.
  if (phenotype.fixed_patient) return buildFixedPatient({ seed, casePresetId, phenotype });

  const morphology = preset.morphology;
  const envelope = bundle.disease.physiology_envelopes[morphology];
  if (!envelope) throw new Error(`No physiology envelope for morphology "${morphology}".`);

  const presentation = phenotype.presentation;
  // A preset may narrow the shared adult population when that demographic is
  // part of the authored case (APP-002 is specifically a woman of
  // reproductive age). The preset may narrow, but never silently widen, the
  // disease-level population.
  const demographicsContent = preset.demographics ?? bundle.phenotypes.demographics;
  const demographics = generateDemographics(rng.stream("demographics"), demographicsContent);
  const onsetHours = drawOnsetHours(rng.stream("onset"), presentation);
  const preSourceControlPainScore = drawRange(rng.stream("pain"), presentation.pain_score);
  const painSite = drawPainSite(rng.stream("pain_site"), presentation);
  const nauseaVomiting = drawNauseaVomiting(rng.stream("nausea_vomiting"), bundle.phenotypes.nausea_vomiting_states);
  const selfTreatmentRu = drawOptional(rng.stream("self_treatment"), presentation.self_treatment_variants_ru);
  const sexConditionalHistory = resolveSexConditionalHistory(bundle.phenotypes.sex_conditional_history, demographics, preset);
  const fastingHistory = drawFastingHistory(rng.stream("fasting"), bundle.findings?.fasting_history);

  const physiology = generatePhysiology(
    rng.stream("physiology"),
    envelope,
    bundle.disease?.inflammatory_profiles,
  );
  const examSlots = resolveExamSlots(rng.stream("exam"), presentation);
  const urinalysisRu = drawWeightedVariant(
    rng.stream("urinalysis"),
    presentation.urinalysis_variants_ru,
    presentation.urinalysis_variants_weights,
  );
  const imaging = resolveImaging(rng.stream("imaging"), phenotype.imaging);
  const postopRecovery = drawPostopRecoveryVariant(
    rng.stream("postop_recovery"),
    bundle.trajectories?.post_source_control_course,
  );

  return {
    caseId: `${casePresetId}::${seed}`,
    seed,
    presetId: casePresetId,
    phenotypeId: phenotype.phenotype_id,
    demographics,
    // ---- hidden truth: nothing here crosses the learner-view boundary ----
    truth: {
      diseaseId: bundle.disease.disease_id,
      phenotypeId: phenotype.phenotype_id,
      morphology,
      trajectoryId: preset.trajectory_id,
      onsetHours,
      stage: "untreated",
      sourceControlled: false,
      operativeTruthRu: phenotype.imaging.operative_truth_ru,
      complicationRolls: {},
      pregnancyExcluded: preset.excludes_pregnancy === true,
      // Seeded uncomplicated postoperative recovery variant (APP004 Numeric
      // Calibration Review, POSTOP). The window is an expectation, not a
      // discharge timer; the recovery model that consumes it ships dormant
      // (review_status: pending) so this is inert patient truth until the
      // model is clinically re-reviewed.
      postopRecoveryVariantId: postopRecovery?.variantId ?? null,
      postopRecoveryWindowHours: postopRecovery?.windowHours ?? null,
    },
    initialPhysiology: physiology,
    // Two named pain states, never one number that quietly changes meaning
    // once the source is controlled (matrix PO01).
    initialSymptoms: {
      painState: PAIN_STATE.PRE_SOURCE_CONTROL,
      preSourceControlPainScore,
      postSourceControlPainScore: null,
      postSourceControlPainModeled: false,
      painSiteRu: painSite,
      nausea: nauseaVomiting.nausea,
      vomitingEpisodes: nauseaVomiting.vomiting_episodes,
    },
    presentation: {
      painSiteRu: painSite,
      onsetHours,
      historyFixedRu: presentation.history_fixed_ru ?? [],
      historyVariantsRu: presentation.history_variants_ru ?? [],
      examinationExtraRu: presentation.examination_extra_ru ?? [],
      nauseaVomitingRu: nauseaVomiting.history_ru,
      selfTreatmentRu,
      sexConditionalHistoryRu: sexConditionalHistory,
      fastingHistory,
    },
    laboratory: { urinalysisRu },
    examSlots,
    imaging,
  };
}

/**
 * A fixed scripted patient (Wave B). `phenotype.fixed_patient` carries
 * exactly the fields the draw pipeline would otherwise have produced -
 * `demographics`, `truth`, `initial_physiology`, `initial_symptoms`,
 * `presentation`, `laboratory`, `exam_slots`, `imaging` - authored directly
 * instead of drawn, because the case is one frozen teaching scenario, not a
 * population to sample from. The returned shape matches `generatePatient`'s
 * generated-path return exactly, so `createInitialState` and everything
 * downstream reads either path identically.
 */
function buildFixedPatient({ seed, casePresetId, phenotype }) {
  const fp = phenotype.fixed_patient;
  if (!fp.demographics || !fp.truth || !fp.initial_physiology || !fp.initial_symptoms) {
    throw new Error(`Phenotype "${phenotype.phenotype_id}" declares fixed_patient but is missing demographics/truth/initial_physiology/initial_symptoms.`);
  }
  return {
    caseId: `${casePresetId}::${seed}`,
    seed,
    presetId: casePresetId,
    phenotypeId: phenotype.phenotype_id,
    demographics: { ...fp.demographics },
    truth: { ...fp.truth },
    initialPhysiology: { ...fp.initial_physiology },
    initialSymptoms: { ...fp.initial_symptoms },
    presentation: { ...(fp.presentation ?? {}) },
    laboratory: { ...(fp.laboratory ?? {}) },
    examSlots: { ...(fp.exam_slots ?? {}) },
    imaging: fp.imaging ?? null,
  };
}

/** Age and sex, from content (matrix P01/P02) - never from a literal here. */
function generateDemographics(stream, demographicsContent) {
  if (!demographicsContent?.age_years || !demographicsContent?.sexes) {
    throw new Error("phenotypes.yaml is missing the governed `demographics` block (age_years, sexes).");
  }
  const [minAge, maxAge] = demographicsContent.age_years;
  return { age: stream.int(minAge, maxAge), sex: stream.pick(demographicsContent.sexes) };
}

/**
 * Symptom duration (matrix P04, task §5.3).
 *
 * The single reviewed window is drawn uniform. The extended 30-36 h window and
 * its share were REMOVED for the pilot (APP004 Numeric Calibration Review,
 * RETROCECAL): a 3+ day presentation belongs to a different severity
 * trajectory and is not reachable in this phenotype.
 */
function drawOnsetHours(stream, presentation) {
  return drawRange(stream, presentation.hours_from_onset);
}

/**
 * Pain site (matrix P05). RLQ pain IS possible for a retrocecal appendix and
 * lives in the common list. The "less often" sites (RUQ / right flank) and
 * their share were REMOVED for the pilot (APP004 Numeric Calibration Review,
 * RETROCECAL); the phenotype draws uniformly from the reviewed common list.
 */
function drawPainSite(stream, presentation) {
  return stream.pick(presentation.pain_sites_ru);
}

/**
 * Pick one authored variant, honouring an optional parallel `weights` array
 * (APP004 Numeric Calibration Review: non-uniform variant mixes). When no
 * weights are supplied, or they do not line up with the variants, the draw is
 * uniform - the same "pick one approved sentence" behaviour as before.
 */
function drawWeightedVariant(stream, items, weights) {
  if (!Array.isArray(items) || items.length === 0) return null;
  if (!Array.isArray(weights) || weights.length !== items.length || weights.some((w) => !(w >= 0))) {
    return stream.pick(items);
  }
  return stream.weighted(items.map((value, index) => ({ value, weight: weights[index] })));
}

/**
 * Nausea and vomiting as one coherent state (matrix P06).
 *
 * The structure is the guarantee: because the content authors combined states
 * rather than two independent symptoms, "vomiting twice, no nausea" cannot be
 * generated at all. The relative frequency of the four states is a calibration
 * question recorded in the review table; the draw is uniform meanwhile and is
 * NOT presented as a reviewed distribution.
 */
function drawNauseaVomiting(stream, states) {
  if (!states?.length) return { nausea: false, vomiting_episodes: 0, history_ru: null };
  const state = stream.pick(states);
  if (state.vomiting_episodes > 0 && state.nausea !== true) {
    throw new Error(`Incoherent nausea/vomiting state "${state.id}": vomiting without nausea.`);
  }
  return state;
}

/** Draws from a list that may contain `null` ("this patient has none"). */
function drawOptional(stream, variants) {
  if (!variants?.length) return null;
  return stream.pick(variants) ?? null;
}

/**
 * Sex- and age-conditional history (matrix P03, task §11).
 *
 * Applied here, at generation, rather than by the renderer, so a male patient
 * never carries a reproductive-history line at all - there is nothing for a
 * later layer to leak.
 */
function resolveSexConditionalHistory(entries, demographics, preset) {
  if (preset?.excludes_pregnancy === true) return [];
  const lines = [];
  for (const entry of entries ?? []) {
    if (entry.applies_to_sex && entry.applies_to_sex !== demographics.sex) continue;
    if (entry.applies_to_age_years) {
      const [minAge, maxAge] = entry.applies_to_age_years;
      if (demographics.age < minAge || demographics.age > maxAge) continue;
    }
    lines.push(...(entry.lines_ru ?? []));
  }
  return lines;
}

/**
 * Last solid food / clear liquid times (matrix PR02, task §13.2).
 *
 * Seeded as part of the patient so the anesthesiologist can obtain them when
 * the learner did not ask. The CONSEQUENCE of a short interval is deliberately
 * not modeled here - that is anaesthesia content and is not reviewed.
 */
function drawFastingHistory(stream, content) {
  if (!content) return null;
  const lastSolidFoodHoursAgo = drawRange(stream, content.last_solid_food_hours_ago);
  let lastClearLiquidHoursAgo = drawRange(stream, content.last_clear_liquid_hours_ago);
  // Clinical Lead invariant (APP004 Numeric Calibration Review, FASTING): a
  // patient must never report the last clear liquid as longer ago than the last
  // solid food. The two ranges are drawn independently, so when the content
  // asks for the invariant we clamp the liquid interval to the solid one.
  if (
    content.enforce_clear_liquid_not_after_solid_food === true &&
    typeof lastSolidFoodHoursAgo === "number" &&
    typeof lastClearLiquidHoursAgo === "number" &&
    lastClearLiquidHoursAgo > lastSolidFoodHoursAgo
  ) {
    lastClearLiquidHoursAgo = lastSolidFoodHoursAgo;
  }
  return { lastSolidFoodHoursAgo, lastClearLiquidHoursAgo, obtained: false };
}

/**
 * Seeded uncomplicated postoperative recovery variant (APP004 Numeric
 * Calibration Review, POSTOP). Two windows, 50/50 simulation diversity - NOT
 * an epidemiological estimate. This only records which recovery expectation the
 * patient is on; the criteria-based recovery model in
 * `trajectories.yaml#post_source_control_course` is held at review_status
 * `pending` and stays dormant at runtime until clinically re-reviewed.
 */
function drawPostopRecoveryVariant(stream, course) {
  const variants = course?.recovery_variants;
  if (!Array.isArray(variants) || variants.length === 0) return null;
  const chosen = drawWeightedVariant(stream, variants, course.recovery_variant_weights);
  if (!chosen) return null;
  const windowRange = chosen.recovery_window_hours;
  const windowHours = Array.isArray(windowRange) ? stream.range(windowRange[0], windowRange[1], 1) : null;
  return { variantId: chosen.id, windowHours };
}

/**
 * Baseline physiology, drawn from the reviewed envelope WITHOUT the
 * onset-duration bias the previous version applied.
 *
 * Matrix V04 REMOVE: "later presentation = automatically higher every lab" is
 * too deterministic and clinically false as a universal rule. The bias used to
 * push every parameter toward the top of its range as `onsetHours` grew, which
 * is exactly that rule expressed as arithmetic. Removing it is not replaced
 * with a different coupling: matrix V03/V05 require linked minimal / moderate
 * / marked inflammatory profiles.
 *
 * APP004 Numeric Calibration Review 2026-08-31 (ENV) — Clinical Lead decision:
 * REVISE to the linked 3-profile calibration. The selection MECHANISM below is
 * in place: when `disease.yaml#inflammatory_profiles.selection.generation_enabled`
 * is true and the chosen profile carries real ranges, physiology is drawn from
 * that profile (systolic BP still comes from the union envelope unless a
 * profile supplies it). The profile ranges themselves are still `null` and
 * `generation_enabled` is `false`, so generation continues to use the
 * development-only union envelope until the Clinical Lead supplies the
 * minimal / moderate / marked numbers and re-review is recorded.
 */
function generatePhysiology(stream, envelope, inflammatoryProfiles) {
  const draw = (range, decimals = 1) => stream.centred(range[0], range[1], decimals);
  const profile = selectInflammatoryProfile(stream, inflammatoryProfiles);
  const rangeFor = (field) => (Array.isArray(profile?.[field]) ? profile[field] : envelope[field]);
  return {
    heartRate: Math.round(draw(rangeFor("heart_rate"), 0)),
    temperatureC: draw(rangeFor("temperature_c"), 1),
    systolicBp: Math.round(draw(rangeFor("systolic_bp"), 0)),
    respiratoryRate: Math.round(draw(rangeFor("respiratory_rate"), 0)),
    wbc: draw(rangeFor("wbc"), 1),
    neutrophilPercent: Math.round(draw(rangeFor("neutrophil_percent"), 0)),
    crp: Math.round(draw(rangeFor("crp"), 0)),
  };
}

/**
 * Choose one linked inflammatory profile (minimal / moderate / marked_but_stable)
 * for this patient, or `null` to fall back to the development-only union
 * envelope.
 *
 * Two regimes (APP004 Numeric Calibration Review, ENV):
 *
 *  - `selection.generation_enabled !== true`  -> return `null`. The three
 *    profiles are still `pending`, so generation uses the union envelope. This
 *    path is for internal development / faculty preview only; the session gate
 *    keeps it away from a learner pilot.
 *
 *  - `selection.generation_enabled === true`  -> a profile MUST be resolved.
 *    Every profile named in `selection.order` must be `approved_for_training`
 *    and carry all range fields; otherwise this THROWS rather than silently
 *    dropping back to the union envelope. One profile is chosen (weighted if
 *    `selection.weights` line up) and every physiology field is then drawn from
 *    that profile alone - never mixed across profiles.
 */
const PROFILE_RANGE_FIELDS = [
  "heart_rate",
  "temperature_c",
  "systolic_bp",
  "respiratory_rate",
  "wbc",
  "neutrophil_percent",
  "crp",
];

export function inflammatoryProfileCandidates(inflammatoryProfiles) {
  const selection = inflammatoryProfiles?.selection;
  const order = Array.isArray(selection?.order) ? selection.order : [];
  return order.map((id) => ({ id, profile: inflammatoryProfiles?.[id] }));
}

function profileRangesComplete(profile) {
  return Boolean(profile) && PROFILE_RANGE_FIELDS.every((field) => validGenRange(profile[field]));
}

function validGenRange(value) {
  return Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === "number") && value[0] <= value[1];
}

function selectInflammatoryProfile(stream, inflammatoryProfiles) {
  const selection = inflammatoryProfiles?.selection;
  if (!selection || selection.generation_enabled !== true) return null;

  const candidates = inflammatoryProfileCandidates(inflammatoryProfiles);
  if (candidates.length === 0) {
    throw new Error("inflammatory_profiles.selection is enabled but `order` is empty; refusing to fall back to the union envelope.");
  }
  for (const { id, profile } of candidates) {
    if (!profileRangesComplete(profile)) {
      throw new Error(`inflammatory profile "${id}" is enabled for generation but has missing/invalid ranges; refusing to fall back to the union envelope.`);
    }
    const status = profile.provenance?.review_status ?? profile.review_status;
    if (status !== "approved_for_training") {
      throw new Error(`inflammatory profile "${id}" is enabled for generation but review_status is "${status ?? "unset"}"; refusing to fall back to the union envelope.`);
    }
  }

  const available = candidates.map(({ profile }) => profile);
  const weights =
    Array.isArray(selection.weights) && selection.weights.length === available.length && selection.weights.every((w) => w >= 0)
      ? selection.weights
      : null;
  return weights
    ? stream.weighted(available.map((value, index) => ({ value, weight: weights[index] })))
    : stream.pick(available);
}

/**
 * Imaging, resolved once at generation so an investigation ordered later
 * reports what was true when the image was acquired.
 *
 * The CT free-fluid finding is seeded here (matrix I07: none vs a small
 * local/pelvic amount). No appendicolith and no incidental findings exist in
 * base APP-004 (matrix I08/I09), so there is nothing to draw for them.
 */
function resolveImaging(stream, imaging) {
  const ultrasoundVariants = imaging?.ultrasound_variants_ru ?? [];
  const ultrasoundRu = ultrasoundVariants.length
    ? stream.pick(ultrasoundVariants)
    : imaging?.ultrasound_ru ?? null;
  const variants = imaging?.ct_report_ru?.free_fluid_variants ?? [];
  const freeFluid = drawWeightedVariant(stream, variants, imaging?.ct_report_ru?.free_fluid_variants_weights);
  return { ...imaging, ultrasound_ru: ultrasoundRu, ctFreeFluid: freeFluid };
}

function resolveExamSlots(stream, presentation) {
  const fixed = { ...(presentation.examination_slots ?? {}) };
  const choices = presentation.examination_slot_choices ?? {};
  for (const [slotId, options] of Object.entries(choices)) {
    fixed[slotId] = drawWeightedVariant(stream, options, presentation.examination_slot_weights?.[slotId]);
  }
  return fixed;
}

function drawRange(stream, range) {
  if (!Array.isArray(range)) return null;
  const [min, max] = range;
  return stream.range(min, max, 1);
}

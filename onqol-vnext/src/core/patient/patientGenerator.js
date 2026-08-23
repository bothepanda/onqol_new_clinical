/**
 * Generating one clinically coherent patient from reviewed content.
 *
 * Foundation Spec §27-§42: generation proceeds through layers (phenotype ->
 * morphology -> physiology envelope -> individual values), phenotype
 * coherence outranks independent randomization, and everything is drawn from
 * a named RNG stream so a seed reproduces the same patient (§42).
 *
 * This module knows how to read a compiled disease bundle
 * (`content/generated/<disease>.json`, produced by
 * `scripts/buildContentIndex.mjs`) and a case preset id. It does not know
 * anything about appendicitis specifically beyond what the bundle tells it -
 * the acceptance test for the whole architecture (Core Foundation Spec §63,
 * §71) is that a second disease's generator is this same file reading a
 * different bundle, not a parallel copy of it.
 */
import { createRng } from "../rng.js";

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

  const morphology = preset.morphology;
  const envelope = bundle.disease.physiology_envelopes[morphology];
  if (!envelope) throw new Error(`No physiology envelope for morphology "${morphology}".`);

  const demographics = generateDemographics(rng.stream("demographics"));
  const onsetHours = drawRange(rng.stream("onset"), phenotype.presentation.hours_from_onset);
  const painScore = drawRange(rng.stream("pain"), phenotype.presentation.pain_score);
  const painSite = rng.stream("pain_site").pick(phenotype.presentation.pain_sites_ru);

  const physiology = generatePhysiology(rng.stream("physiology"), envelope, onsetHours);
  const examSlots = resolveExamSlots(rng.stream("exam"), phenotype.presentation);

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
      onsetHours,
      stage: "untreated",
      sourceControlled: false,
      operativeTruthRu: phenotype.imaging.operative_truth_ru,
      complicationRolls: {}, // filled lazily by the complications engine on first check
    },
    initialPhysiology: physiology,
    initialSymptoms: { painScore, painSiteRu: painSite },
    presentation: {
      painSiteRu: painSite,
      onsetHours,
      historyFixedRu: phenotype.presentation.history_fixed_ru ?? [],
      historyVariantsRu: phenotype.presentation.history_variants_ru ?? [],
    },
    examSlots,
    imaging: phenotype.imaging,
  };
}

function generateDemographics(stream) {
  const age = stream.int(18, 75);
  const sex = stream.pick(["male", "female"]);
  return { age, sex };
}

function generatePhysiology(stream, envelope, onsetHours) {
  // Later onset drifts values toward the top of the reviewed envelope rather
  // than sampling uniformly across the whole range at every timepoint - the
  // same coherence principle the legacy corpus's physiology-envelope rewrite
  // established (a CRP of 140 stays reachable, but as a rare high-burden
  // early patient, not as the typical one).
  const bias = clamp01(onsetHours / 30);
  const biasedRange = (min, max, decimals = 1) => {
    const centre = min + (max - min) * (0.35 + 0.3 * bias);
    const spread = (max - min) * 0.18;
    const value = clamp(stream.centred(centre - spread, centre + spread, decimals), min, max);
    return value;
  };

  return {
    heartRate: Math.round(biasedRange(...envelope.heart_rate, 0)),
    temperatureC: biasedRange(...envelope.temperature_c, 1),
    systolicBp: Math.round(biasedRange(...envelope.systolic_bp, 0)),
    respiratoryRate: Math.round(biasedRange(...envelope.respiratory_rate, 0)),
    wbc: biasedRange(...envelope.wbc, 1),
    neutrophilPercent: Math.round(biasedRange(...envelope.neutrophil_percent, 0)),
    crp: Math.round(biasedRange(...envelope.crp, 0)),
  };
}

function resolveExamSlots(stream, presentation) {
  const fixed = { ...(presentation.examination_slots ?? {}) };
  const choices = presentation.examination_slot_choices ?? {};
  for (const [slotId, options] of Object.entries(choices)) {
    fixed[slotId] = stream.pick(options);
  }
  return fixed;
}

function drawRange(stream, [min, max]) {
  return stream.range(min, max, 1);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
function clamp01(value) {
  return clamp(value, 0, 1);
}

// Which preset this session gets, and with which seed.
//
// WHY THIS IS NOT IN THE GENERATOR
//
// Repeat avoidance needs to know what the learner saw last time. A generator
// that knows that is no longer a function of its seed, and "same seed, same
// case" stops being true - which is the invariant the whole reproducibility
// argument rests on (addendum 2).
//
// So selection is separate and impure-by-input: it takes the previous preset and
// the requested seed, and returns a decision. The generator downstream stays a
// pure function of (preset, effective seed).
//
// THE EFFECTIVE SEED
//
// When repeat avoidance moves the learner off the preset the seed would have
// chosen, the seed alone no longer reproduces the session. Both are recorded:
// `requested_seed` is what came in, `effective_seed` is what the generator ran
// on, and `attempts` says why they differ. Reproducing a reported session means
// replaying the effective seed; auditing the selector means replaying the
// requested one.

import { CASE_PRESETS, learnerSelectablePresets, presetsById } from "./phenotypes.js";
import { coherenceViolations, generatePatient } from "./patientGenerator.js";

function hashSeed(seed) {
  let hash = 2166136261;
  for (const char of String(seed)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Max reseeds before giving up on avoiding a repeat or a coherence failure. */
const MAX_ATTEMPTS = 8;

/**
 * Reseed a fixed preset until it yields a coherent patient.
 *
 * An incoherent seed is discarded, never patched. Nudging a value to satisfy a
 * rule would mean the engine, not the author, decided what this patient looks
 * like.
 */
function reseedUntilCoherent(casePresetId, seed) {
  const attempts = [];
  let effectiveSeed = seed;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const patient = generatePatient(casePresetId, effectiveSeed);
    const violations = coherenceViolations(patient);
    if (violations.length === 0) return { patient, effectiveSeed, attempts };

    attempts.push({
      seed: effectiveSeed,
      case_preset_id: casePresetId,
      rejected_because: "coherence",
      violations,
    });
    effectiveSeed = `${effectiveSeed}#c${attempt + 1}`;
  }

  throw new Error(
    `Could not generate a coherent "${casePresetId}" in ${MAX_ATTEMPTS} attempts from seed "${seed}". ` +
      `Attempts: ${JSON.stringify(attempts)}`
  );
}

/**
 * Choose a case preset and a seed that produces a coherent patient.
 *
 * @param {object} options
 * @param {string} options.seed                    requested seed
 * @param {string|null} [options.previousPresetId] what the learner had last
 * @param {string|null} [options.requestedPresetId] faculty override
 * @param {"learner"|"faculty"|"internal_test"} [options.mode]
 * @returns {{preset, patient, selection}}
 */
export function selectV35Case({
  seed,
  previousPresetId = null,
  requestedPresetId = null,
  mode = "learner",
}) {
  if (!seed) throw new Error("A seed is required: sessions must be reproducible.");

  // Faculty override. The only route to a preview-only preset, and it is never
  // reachable from learner mode.
  if (requestedPresetId) {
    const preset = presetsById.get(requestedPresetId);
    if (!preset) throw new Error(`Unknown case preset "${requestedPresetId}".`);
    if (!["faculty", "internal_test"].includes(mode) && preset.runtime_status !== "learner_active") {
      throw new Error(
        `Preset "${requestedPresetId}" is ${preset.runtime_status} and cannot be selected in learner mode.`
      );
    }
    // Faculty asking for a specific seed gets exactly that seed, violations and
    // all - inspecting a rejected patient is the point of a preview.
    //
    // Anything learner-facing goes through the same coherence rejection as a
    // randomly selected case. Without this, naming a preset was a way round the
    // guarantee that a learner never meets an incoherent patient, which made the
    // invariant depend on how the case happened to be requested.
    if (mode === "faculty") {
      const patient = generatePatient(requestedPresetId, seed);
      return {
        preset,
        patient,
        selection: Object.freeze({
          case_preset_id: requestedPresetId,
          selection_method: "faculty_requested_preset",
          requested_seed: seed,
          effective_seed: seed,
          attempts: [],
          coherence_violations: coherenceViolations(patient),
        }),
      };
    }

    const pinned = reseedUntilCoherent(requestedPresetId, seed);
    return {
      preset,
      patient: pinned.patient,
      selection: Object.freeze({
        case_preset_id: requestedPresetId,
        selection_method: pinned.attempts.length ? "requested_preset_after_reseed" : "requested_preset",
        requested_seed: seed,
        effective_seed: pinned.effectiveSeed,
        attempts: Object.freeze(pinned.attempts),
        coherence_violations: [],
      }),
    };
  }

  const pool = mode === "internal_test" ? CASE_PRESETS : learnerSelectablePresets();
  if (pool.length === 0) throw new Error("No learner-selectable case presets.");

  const attempts = [];
  let effectiveSeed = seed;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const index = hashSeed(effectiveSeed) % pool.length;
    const candidate = pool[index];

    // Immediate repeat avoidance. Only when there is somewhere else to go: with
    // one eligible preset, repeating is the honest outcome, not a bug to hide.
    if (candidate.case_preset_id === previousPresetId && pool.length > 1) {
      attempts.push({
        seed: effectiveSeed,
        case_preset_id: candidate.case_preset_id,
        rejected_because: "immediate_repeat",
      });
      effectiveSeed = `${effectiveSeed}#r${attempt + 1}`;
      continue;
    }

    const patient = generatePatient(candidate.case_preset_id, effectiveSeed);
    const violations = coherenceViolations(patient);
    if (violations.length > 0) {
      // A seed that produces an incoherent patient is discarded, never patched.
      // Adjusting a value to satisfy a rule would mean the engine, not the
      // author, decided what this patient looks like.
      attempts.push({
        seed: effectiveSeed,
        case_preset_id: candidate.case_preset_id,
        rejected_because: "coherence",
        violations,
      });
      effectiveSeed = `${effectiveSeed}#c${attempt + 1}`;
      continue;
    }

    return {
      preset: candidate,
      patient,
      selection: Object.freeze({
        case_preset_id: candidate.case_preset_id,
        selection_method: attempts.length ? "seeded_after_reseed" : "seeded",
        requested_seed: seed,
        effective_seed: effectiveSeed,
        attempts: Object.freeze(attempts),
        coherence_violations: [],
      }),
    };
  }

  // Never silently hand over a patient the rules reject.
  throw new Error(
    `Could not select a coherent case in ${MAX_ATTEMPTS} attempts from seed "${seed}". ` +
      `Attempts: ${JSON.stringify(attempts)}`
  );
}

/**
 * The selection record for the event log, addendum 13.
 *
 * Carries both seeds and every rejected attempt, and no free text.
 */
export function selectionEvent(selection) {
  return {
    case_preset_id: selection.case_preset_id,
    selection_method: selection.selection_method,
    requested_seed: selection.requested_seed,
    effective_seed: selection.effective_seed,
    selection_attempts: selection.attempts.map((attempt) => ({
      case_preset_id: attempt.case_preset_id,
      rejected_because: attempt.rejected_because,
      violation_rules: (attempt.violations || []).map((violation) => violation.rule),
    })),
  };
}

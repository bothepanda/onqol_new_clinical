// The V3.5 content manifest and its validator.
//
// WHY A MANIFEST AT ALL
//
// Addendum 14 asks for exactly five phenotypes, eight alternatives, sixteen
// states and thirty-two contracts, and for aliases that resolve. Those are
// counting questions, and counting questions are answered by a machine or not at
// all. This file is what a test asserts against, and what a faculty preview
// reads to explain why something is inactive.
//
// WHAT `ready` MEANS HERE
//
// Not "the clinical content is good" - no file can say that. It means: the
// declared objects are present, internally consistent, and honest about their
// own gaps. A manifest can be valid and still describe mostly unauthored
// content; `readiness` reports both, separately, because conflating them is how
// a version gets called done when it is not.
//
// Addendum 16: "Если пункт не выполнен, не называй V3.5 готовой. Верни точный
// blocker."

import {
  CASE_PRESETS,
  COHERENCE_RULES,
  PHENOTYPES,
  PHENOTYPE_IDS,
  DECLARED_RESOURCE_PROFILE_IDS,
  TRAJECTORY_IDS,
  V35_MODIFIERS,
  learnerSelectablePresets,
  physiologyEnvelopeFor,
} from "./phenotypes.js";
import { ALTERNATIVE_DISEASES } from "./alternatives.js";
import { localeReadiness } from "./locale.js";
import { PATH_STATES, PATH_STATE_IDS, STABLE_PATH, pathStatesById } from "./pathStates.js";
import { ACTION_CONTRACTS, contractsById, resolvableActionIds } from "./actionContracts.js";
import { REASONING_FLAGS } from "../core/reasoningState.js";

// 3.5.4: owner's rewording of the whole learner-visible surface (WORDING_REVIEW.md).
// The version bumps because a seed replayed under 3.5.3 produces different text -
// and, where a variant list grew, a different patient.
// 3.5.5: the examination becomes declared slot states + one prose dictionary
// (examSlots.js), and the owner's answers to the nine open wording questions.
// 3.5.6: the owner's signed slot table - Rovsing to the classic phenotype only,
// the obturator sign to the pelvic one, percussion tenderness to classic and
// late, and the deliberate blanks left blank.
// 3.5.7: named signs print the finding only, not the manoeuvre (owner, 10.08.2026).
export const V35_CONTENT_VERSION = "3.5.7";

/** The counts addendum 14 requires. Named so a failure says which one. */
export const REQUIRED_COUNTS = Object.freeze({
  phenotypes: 5,
  case_presets: 5,
  alternative_diseases: 8,
  path_states: 16,
  action_contracts: 32,
});

export const v35Manifest = Object.freeze({
  content_version: V35_CONTENT_VERSION,
  vertical: "acute_appendicitis_adult",
  presentation_card: "PRES-RLQ-PAIN",
  phenotypes: PHENOTYPES,
  case_presets: CASE_PRESETS,
  modifiers: V35_MODIFIERS,
  trajectories: TRAJECTORY_IDS,
  declared_resource_profiles: DECLARED_RESOURCE_PROFILE_IDS,
  coherence_rules: COHERENCE_RULES,
  alternative_diseases: ALTERNATIVE_DISEASES,
  path_states: PATH_STATES,
  stable_path: STABLE_PATH,
  action_contracts: ACTION_CONTRACTS,
});

/**
 * Structural validation.
 *
 * @param {object} [caseData] resolve contract aliases against this case as well
 *        as the core library. Omit to check the core library only.
 * @returns {{ok: boolean, errors: string[], warnings: string[]}}
 */
export function validateV35Manifest(caseData = null) {
  const errors = [];
  const warnings = [];

  const count = (label, actual, expected) => {
    if (actual !== expected) errors.push(`${label}: expected exactly ${expected}, found ${actual}`);
  };
  count("phenotypes", PHENOTYPE_IDS.length, REQUIRED_COUNTS.phenotypes);
  count("case presets", CASE_PRESETS.length, REQUIRED_COUNTS.case_presets);
  count("alternative diseases", ALTERNATIVE_DISEASES.length, REQUIRED_COUNTS.alternative_diseases);
  count("path states", PATH_STATES.length, REQUIRED_COUNTS.path_states);
  count("action contracts", ACTION_CONTRACTS.length, REQUIRED_COUNTS.action_contracts);

  // --- ids are unique across the whole manifest ---------------------------
  const seen = new Map();
  const claim = (kind, id) => {
    if (seen.has(id)) errors.push(`duplicate id "${id}" (${seen.get(id)} and ${kind})`);
    else seen.set(id, kind);
  };
  for (const id of PHENOTYPE_IDS) claim("phenotype", id);
  for (const preset of CASE_PRESETS) claim("case preset", preset.case_preset_id);
  for (const entry of ALTERNATIVE_DISEASES) claim("alternative disease", entry.alternative_id);
  for (const state of PATH_STATES) claim("path state", state.state_id);
  for (const contract of ACTION_CONTRACTS) claim("action contract", contract.contract_id);

  // --- contracts are numbered 1..32 exactly -------------------------------
  const numbers = ACTION_CONTRACTS.map((contract) => contract.number).sort((a, b) => a - b);
  for (let index = 0; index < numbers.length; index += 1) {
    if (numbers[index] !== index + 1) {
      errors.push(`action contract numbering breaks at position ${index + 1} (found ${numbers[index]})`);
      break;
    }
  }

  // --- every transition resolves to a declared state ----------------------
  const stateIds = new Set(PATH_STATE_IDS);
  if (stateIds.size !== PATH_STATE_IDS.length) errors.push("path state ids are not unique");
  for (const state of PATH_STATES) {
    for (const target of state.allowed_transitions || []) {
      if (!stateIds.has(target)) {
        errors.push(`state "${state.state_id}" transitions to unknown state "${target}"`);
      }
    }
  }
  // The declared order and the declared objects must agree; otherwise the
  // canonical list and the graph drift apart silently.
  for (const id of PATH_STATE_IDS) {
    if (!pathStatesById.has(id)) errors.push(`state "${id}" is listed but not declared`);
  }

  // --- the stable path is walkable, and ends where the addendum says ------
  for (let index = 0; index < STABLE_PATH.length - 1; index += 1) {
    const from = pathStatesById.get(STABLE_PATH[index]);
    const to = STABLE_PATH[index + 1];
    if (!from) {
      errors.push(`stable path names unknown state "${STABLE_PATH[index]}"`);
      break;
    }
    if (!(from.allowed_transitions || []).includes(to)) {
      errors.push(`stable path cannot step from "${from.state_id}" to "${to}"`);
    }
  }
  if (STABLE_PATH.at(-1) !== "complete") {
    errors.push("the stable path must end at 'complete'");
  }
  if (!STABLE_PATH.includes("discharge")) {
    errors.push("the stable path must reach 'discharge'");
  }

  // --- every contract a state requires actually exists --------------------
  for (const state of PATH_STATES) {
    for (const contractId of [
      ...(state.required_action_contracts || []),
      ...(state.optional_action_contracts || []),
    ]) {
      if (!contractsById.has(contractId)) {
        errors.push(`state "${state.state_id}" names unknown contract "${contractId}"`);
      }
    }
  }

  // --- aliases resolve to real leaf actions -------------------------------
  const resolvable = resolvableActionIds(caseData);
  const intentionallyRemoved = new Set(caseData?.v35_removed_action_ids || []);
  for (const contract of ACTION_CONTRACTS) {
    for (const alias of contract.aliases) {
      // Generated patients remove population-gated actions from the runnable
      // case. That is not a dangling contract alias: the removed ids are frozen
      // on the case and the same alias must resolve on a compatible patient.
      if (!resolvable.has(alias) && !intentionallyRemoved.has(alias)) {
        errors.push(`contract "${contract.contract_id}" aliases unknown action "${alias}"`);
      }
    }
    for (const flag of contract.reasoning_flags) {
      if (!REASONING_FLAGS.includes(flag)) {
        errors.push(`contract "${contract.contract_id}" names unknown reasoning flag "${flag}"`);
      }
    }
    // A contract with neither a leaf nor a reasoning signal covers nothing. That
    // is allowed while a leaf is still to be authored, and only then.
    if (!contract.aliases.length && !contract.reasoning_flags.length && !contract.gap) {
      errors.push(
        `contract "${contract.contract_id}" resolves to nothing and does not declare a gap`
      );
    }
  }

  // --- nothing new may score ----------------------------------------------
  for (const contract of ACTION_CONTRACTS) {
    if (contract.eligible_for_scoring !== false) {
      errors.push(`contract "${contract.contract_id}" must not be eligible for scoring`);
    }
  }
  for (const entry of ALTERNATIVE_DISEASES) {
    if (entry.eligible_for_scoring !== false) {
      errors.push(`alternative "${entry.alternative_id}" must not be eligible for scoring`);
    }
    if (entry.runtime_status !== "disease_stub_inactive") {
      errors.push(
        `alternative "${entry.alternative_id}" must stay inactive until its disease package exists`
      );
    }
    // Every alternative must say which presentation it hangs off, or it is an
    // orphan diagnosis nothing can ever reach.
    if (!(entry.presentation_relationships || []).length) {
      errors.push(`alternative "${entry.alternative_id}" declares no presentation relationship`);
    }
  }

  // --- presets resolve to declared layers ---------------------------------
  for (const preset of CASE_PRESETS) {
    if (!PHENOTYPES[preset.phenotype_id]) {
      errors.push(`preset "${preset.case_preset_id}" names unknown phenotype "${preset.phenotype_id}"`);
    }
    for (const modifierId of [
      ...(preset.population_modifier_ids || []),
      ...(preset.compatible_modifier_ids || []),
    ]) {
      if (!V35_MODIFIERS[modifierId]) {
        errors.push(`preset "${preset.case_preset_id}" names undeclared modifier "${modifierId}"`);
      }
    }
    if (!TRAJECTORY_IDS.includes(preset.trajectory_id)) {
      errors.push(`preset "${preset.case_preset_id}" names unknown trajectory "${preset.trajectory_id}"`);
    }
    if (!DECLARED_RESOURCE_PROFILE_IDS.includes(preset.declared_resource_profile_id)) {
      errors.push(
        `preset "${preset.case_preset_id}" names unknown declared resource profile "${preset.declared_resource_profile_id}"`
      );
    }
    // The preset's morphology must be one the phenotype can actually carry.
    const phenotype = PHENOTYPES[preset.phenotype_id];
    if (phenotype && !phenotype.compatible_morphologies.includes(preset.morphology)) {
      errors.push(
        `preset "${preset.case_preset_id}" pairs morphology "${preset.morphology}" with a phenotype that does not carry it`
      );
    }
  }

  // --- every reachable morphology has a usable physiology envelope --------
  // Physiology belongs to the morphology now, so this checks the envelope the
  // generator will actually read rather than a per-phenotype table.
  const reachableMorphologies = new Set(
    CASE_PRESETS.filter((preset) => preset.runtime_status === "learner_active").map(
      (preset) => preset.morphology
    )
  );
  for (const morphology of reachableMorphologies) {
    let envelope;
    try {
      envelope = physiologyEnvelopeFor(morphology);
    } catch {
      errors.push(`morphology "${morphology}" has no physiology envelope`);
      continue;
    }
    for (const field of ["heart_rate", "temperature_c", "systolic_bp", "respiratory_rate", "wbc", "neutrophil_percent", "crp"]) {
      const declared = envelope[field];
      if (!declared || !(declared.min <= declared.max)) {
        errors.push(`physiology envelope for "${morphology}" has no usable range for ${field}`);
      }
    }
  }

  // A phenotype must not smuggle physiology back in.
  for (const [phenotypeId, phenotype] of Object.entries(PHENOTYPES)) {
    if (phenotype.authoring_ranges) {
      errors.push(`phenotype "${phenotypeId}" declares physiology, which belongs to the morphology`);
    }
  }

  // --- warnings: honest about what is not authored ------------------------
  const unauthored = ALTERNATIVE_DISEASES.filter((entry) => entry.missing_for_authoring?.length);
  if (unauthored.length) {
    warnings.push(
      `${unauthored.length}/${ALTERNATIVE_DISEASES.length} alternative diseases are stubs awaiting authoring`
    );
  }
  const flagged = Object.values(PHENOTYPES).filter((phenotype) => phenotype.review_flag);
  if (flagged.length) {
    warnings.push(
      `${flagged.length} phenotype(s) carry an open review flag: ${flagged
        .map((phenotype) => `${phenotype.phenotype_id} (${phenotype.review_flag.id})`)
        .join(", ")}`
    );
  }
  const gaps = ACTION_CONTRACTS.filter((contract) => contract.gap);
  if (gaps.length) {
    warnings.push(
      `${gaps.length} contracts have no leaf action yet: ${gaps
        .map((contract) => contract.contract_id)
        .join(", ")}`
    );
  }
  const previewStates = PATH_STATES.filter((state) => state.runtime_status === "faculty_preview");
  if (previewStates.length) {
    warnings.push(
      `${previewStates.length} path states are faculty preview only: ${previewStates
        .map((state) => state.state_id)
        .join(", ")}`
    );
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * What is actually playable, in one object.
 *
 * This is the answer to "is V3.5 done", and it is deliberately blunt: the
 * manifest can validate perfectly while almost nothing is wired to the engine.
 */
export function v35Readiness(caseData = null) {
  // Needs the case: most contract aliases are case-owned actions, and the core
  // library alone cannot resolve them. Passing nothing reports them as errors,
  // which is correct - it means "this manifest is not valid for no case".
  const { ok, errors, warnings } = validateV35Manifest(caseData);
  return {
    content_version: V35_CONTENT_VERSION,
    manifest_valid: ok,
    errors,
    warnings,
    learner_selectable_presets: learnerSelectablePresets().map((preset) => preset.case_preset_id),
    faculty_preview_presets: CASE_PRESETS.filter(
      (preset) => preset.runtime_status === "faculty_preview"
    ).map((preset) => preset.case_preset_id),
    inactive_alternatives: ALTERNATIVE_DISEASES.map((entry) => entry.alternative_id),
    locales: localeReadiness().map((row) => ({
      locale: row.locale,
      status: row.status,
      missing_keys: row.missing.length,
    })),
    generator_wired_to_case_factory: true,
    engine_wired: true,
    faculty_preview_complication_states_wired: false,
    blocking_for_release: [],
    blocking_for_done: [
      "KZ text absent across phenotypes, states and alternatives",
    ],
  };
}

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

import { APPENDICITIS_PHENOTYPES, COHERENCE_RULES, V35_MODIFIERS, learnerSelectablePhenotypes } from "./phenotypes.js";
import { V35_MIMICS } from "./mimics.js";
import { PATH_STATES, PATH_STATE_IDS, STABLE_PATH, pathStatesById } from "./pathStates.js";
import { ACTION_CONTRACTS, contractsById, resolvableActionIds } from "./actionContracts.js";
import { REASONING_FLAGS } from "../core/reasoningState.js";

export const V35_CONTENT_VERSION = "3.5.0";

/** The counts addendum 14 requires. Named so a failure says which one. */
export const REQUIRED_COUNTS = Object.freeze({
  phenotypes: 5,
  mimics: 8,
  path_states: 16,
  action_contracts: 32,
});

export const v35Manifest = Object.freeze({
  content_version: V35_CONTENT_VERSION,
  vertical: "acute_appendicitis_adult",
  presentation_card: "PRES-RLQ-PAIN",
  phenotypes: APPENDICITIS_PHENOTYPES,
  modifiers: V35_MODIFIERS,
  coherence_rules: COHERENCE_RULES,
  mimics: V35_MIMICS,
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
  count("phenotypes", APPENDICITIS_PHENOTYPES.length, REQUIRED_COUNTS.phenotypes);
  count("mimics", V35_MIMICS.length, REQUIRED_COUNTS.mimics);
  count("path states", PATH_STATES.length, REQUIRED_COUNTS.path_states);
  count("action contracts", ACTION_CONTRACTS.length, REQUIRED_COUNTS.action_contracts);

  // --- ids are unique across the whole manifest ---------------------------
  const seen = new Map();
  const claim = (kind, id) => {
    if (seen.has(id)) errors.push(`duplicate id "${id}" (${seen.get(id)} and ${kind})`);
    else seen.set(id, kind);
  };
  for (const phenotype of APPENDICITIS_PHENOTYPES) claim("phenotype", phenotype.preset_id);
  for (const mimic of V35_MIMICS) claim("mimic", mimic.mimic_id);
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
  for (const contract of ACTION_CONTRACTS) {
    for (const alias of contract.aliases) {
      if (!resolvable.has(alias)) {
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
  for (const mimic of V35_MIMICS) {
    if (mimic.eligible_for_scoring !== false) {
      errors.push(`mimic "${mimic.mimic_id}" must not be eligible for scoring`);
    }
    if (mimic.runtime_status !== "disease_stub_inactive") {
      errors.push(`mimic "${mimic.mimic_id}" must stay inactive until its disease package exists`);
    }
  }

  // --- modifiers referenced by a phenotype must be declared ---------------
  for (const phenotype of APPENDICITIS_PHENOTYPES) {
    for (const modifierId of [
      ...(phenotype.default_modifiers || []),
      ...(phenotype.compatible_modifiers || []),
    ]) {
      if (!V35_MODIFIERS[modifierId]) {
        errors.push(`phenotype "${phenotype.preset_id}" names undeclared modifier "${modifierId}"`);
      }
    }
    // Every learner-selectable preset needs the ranges a generator will read.
    if (phenotype.runtime_status === "learner_active") {
      for (const field of ["heart_rate", "temperature_c", "systolic_bp", "wbc", "crp"]) {
        const declared = phenotype.authoring_ranges?.[field];
        if (!declared || !(declared.min <= declared.max)) {
          errors.push(`phenotype "${phenotype.preset_id}" has no usable range for ${field}`);
        }
      }
    }
  }

  // --- warnings: honest about what is not authored ------------------------
  const unauthored = V35_MIMICS.filter((mimic) => mimic.missing_for_authoring?.length);
  if (unauthored.length) {
    warnings.push(
      `${unauthored.length}/${V35_MIMICS.length} alternatives are stubs awaiting authoring`
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
    learner_selectable_phenotypes: learnerSelectablePhenotypes().map((p) => p.preset_id),
    faculty_preview_phenotypes: APPENDICITIS_PHENOTYPES.filter(
      (p) => p.runtime_status === "faculty_preview"
    ).map((p) => p.preset_id),
    inactive_alternatives: V35_MIMICS.map((mimic) => mimic.mimic_id),
    // Set by the step that wires the manifest into the engine, not by declaring
    // the manifest. Until then the honest answer is no.
    engine_wired: false,
    blocking_for_done: [
      "path states are declared but do not drive the engine (temporalPatientModel still uses four phases)",
      "no patient generator: phenotype ranges are not yet instantiated into a case",
      "stable path does not reach discharge in the running engine",
      "reasoning snapshots are declared per state but not emitted",
      "KZ text absent across phenotypes, states and alternatives",
    ],
  };
}

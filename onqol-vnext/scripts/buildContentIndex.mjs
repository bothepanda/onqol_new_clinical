#!/usr/bin/env node
// Compiles authored clinical-content YAML into one versioned JSON bundle per
// disease, and fails the build if a required provenance field is missing.
//
// Why a build step and not a runtime YAML parse: the export schema (Core
// Core Runtime Spec §61, §30) needs a stable `content_versions` hash per
// session, and a release should be able to fail *before* a session starts if
// a rule lost its `source_ids` in an edit. Both of those want a discrete,
// checkable artifact - `src/content/generated/<disease>.json` - not a parse
// that happens once per browser session.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { validEnvelope } from "../src/core/calibration/treatmentCalibration.js";
import { RULE_CONDITION } from "../src/core/rules/conditions.js";
import { isKnownContentOperator } from "../src/core/rules/contentConditions.js";
import { validateCalibrationProposals } from "../src/content/review/validateCalibrationProposals.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DISEASES_DIR = path.join(ROOT, "src/content/diseases");
const OUT_DIR = path.join(ROOT, "src/content/generated");
const CHECK_ONLY = process.argv.includes("--check");

const REQUIRED_FILES = [
  "disease.yaml",
  "phenotypes.yaml",
  "trajectories.yaml",
  "findings.yaml",
  "rules.yaml",
  "operative.yaml",
  "complications.yaml",
];

function loadYaml(filePath) {
  // Medication and other reviewed content may reuse a complete provenance
  // record through standard YAML merge keys. Resolve those keys while
  // compiling so the generated JSON carries the actual review fields rather
  // than a literal `<<` property that the runtime cannot govern.
  return parseYaml(readFileSync(filePath, "utf8"), { merge: true });
}

/**
 * The provenance fields every clinical-content object must carry (remediation
 * task §21). Presence is required; VALUES may be null - an unreviewed item
 * honestly recording `reviewed_by: null` is the point, and inventing a reviewer
 * to satisfy a schema would be the worst possible failure of this check.
 */
const PROVENANCE_FIELDS = [
  "id",
  "authority_layer",
  "jurisdiction",
  "source",
  "source_version_or_date",
  "evidence_strength",
  "review_status",
  "reviewed_by",
  "reviewed_at",
  "second_review_required",
  "second_reviewed_by",
  "second_reviewed_at",
  "next_review_due",
  "notes",
];

function validateProvenance(item, label) {
  const errors = [];
  const provenance = item?.provenance;
  if (!provenance) return [`${label} is missing its provenance block (task §21)`];
  for (const field of PROVENANCE_FIELDS) {
    if (!(field in provenance)) errors.push(`${label} provenance is missing "${field}"`);
  }
  // A bare top-level review_status that disagrees with the provenance block is
  // the failure mode this check exists for: two statuses, one of them stale,
  // and no way to tell which the runtime read.
  if (item.review_status != null && provenance.review_status != null && item.review_status !== provenance.review_status) {
    errors.push(
      `${label} has conflicting review_status ("${item.review_status}" top-level vs "${provenance.review_status}" in provenance)`,
    );
  }
  if (provenance.review_status === "approved_for_training") {
    const hasReviewer = Boolean(provenance.reviewed_by) || Boolean(item.reviewers?.length);
    if (!hasReviewer) errors.push(`${label} claims approved_for_training without a recorded reviewer`);
    if (provenance.second_review_required === true && !provenance.second_reviewed_by) {
      errors.push(`${label} claims approved_for_training but its required second review is not recorded`);
    }
  }
  return errors;
}

function validateRule(rule, diseaseId) {
  const errors = [];
  if (!rule.id) errors.push(`rule missing id`);
  if (!rule.level) errors.push(`rule ${rule.id} missing level`);
  if (!rule.source_ids?.length) errors.push(`rule ${rule.id} missing source_ids (provenance)`);
  errors.push(...validateProvenance(rule, `rule ${rule.id}`));

  // A condition type with no evaluator fails closed to UNKNOWN at runtime, so a
  // typo makes the rule permanently and SILENTLY inert. Catching it here turns
  // that into a build failure instead of a rule nobody notices never fires.
  for (const condition of rule.conditions ?? []) {
    if (!RULE_CONDITION[condition.type]) {
      errors.push(`rule ${rule.id} uses unknown condition type "${condition.type}"`);
    }
  }
  return errors.map((message) => `[${diseaseId}] ${message}`);
}

/**
 * `rules.yaml#teaching_issues` (mentor behaviour, Wave B). An issue is timing
 * and wording, never a clinical claim, so it may only be `not_a_clinical_rule`
 * with authority_layer mentor_behavior, or approved with a recorded reviewer.
 * Anything else would let unreviewed content read as clinical authority.
 */
function validateTeachingIssues(rules, diseaseId) {
  const errors = [];
  const ruleIds = new Set((rules.rules ?? []).map((rule) => rule.id));
  const seen = new Set();
  for (const issue of rules.teaching_issues ?? []) {
    const label = `teaching_issue ${issue.id}`;
    if (!issue.id) errors.push("teaching_issue missing id");
    if (seen.has(issue.id)) errors.push(`${label} is a duplicate id`);
    seen.add(issue.id);
    if (!["rule", "command", "turn"].includes(issue.scope)) errors.push(`${label} has unknown scope "${issue.scope}"`);
    if (issue.scope === "rule" && !ruleIds.has(issue.rule_id)) errors.push(`${label} references unknown rule "${issue.rule_id}"`);
    if (issue.scope !== "rule") {
      if (!issue.trigger?.length) errors.push(`${label} needs a trigger`);
      for (const condition of issue.trigger ?? []) if (!RULE_CONDITION[condition.type]) errors.push(`${label} uses unknown condition type "${condition.type}"`);
    }
    if (!Number.isInteger(issue.priority) || issue.priority < 1 || issue.priority > 6) errors.push(`${label} priority must be 1-6`);
    if (typeof issue.prompt_ru !== "string" || !issue.prompt_ru.trim()) errors.push(`${label} missing prompt_ru`);
    for (const level of [1, 2, 3, 4]) if (typeof issue.scaffold_ru?.[level] !== "string") errors.push(`${label} missing scaffold_ru level ${level}`);
    if (issue.follow_through && (!issue.follow_through.trigger_event || !Array.isArray(issue.follow_through.expected_events))) errors.push(`${label} follow_through needs trigger_event and expected_events`);
    errors.push(...validateProvenance(issue, label));
    const status = issue.provenance?.review_status;
    if (status !== "approved_for_training" && !(status === "not_a_clinical_rule" && issue.provenance?.authority_layer === "mentor_behavior")) {
      errors.push(`${label} must be approved_for_training or not_a_clinical_rule/mentor_behavior (got "${status}")`);
    }
  }
  return errors.map((message) => `[${diseaseId}] ${message}`);
}

function buildDisease(diseaseId, shared) {
  const dir = path.join(DISEASES_DIR, diseaseId);
  const entries = readdirSync(dir);
  for (const file of REQUIRED_FILES) {
    if (!entries.includes(file)) throw new Error(`${diseaseId}: missing required content file "${file}".`);
  }

  const bundle = {};
  const rawParts = [];
  for (const file of REQUIRED_FILES) {
    const key = file.replace(".yaml", "");
    const filePath = path.join(dir, file);
    const raw = readFileSync(filePath, "utf8");
    rawParts.push(raw);
    bundle[key] = loadYaml(filePath);
  }

  const errors = [
    ...(bundle.rules.rules ?? []).flatMap((rule) => validateRule(rule, diseaseId)),
    ...validateTeachingIssues(bundle.rules, diseaseId),
    ...validateGeneratingContent(bundle, diseaseId),
    ...validateCrossReferences(bundle, shared, diseaseId),
  ];
  // Review-only calibration lives beside authored content, outside REQUIRED_FILES
  // and rawParts. Validate it during content:check/build without granting it a
  // content version, runtime bundle field, or treatment-effect selection path.
  if (diseaseId === "appendicitis") {
    const reviewPath = path.join(dir, "review", "calibration-proposals-v1.json");
    const review = JSON.parse(readFileSync(reviewPath, "utf8"));
    errors.push(...validateCalibrationProposals(review, (bundle.disease.sources ?? []).map((source) => source.id)));
  }
  if (errors.length) {
    throw new Error(`Content validation failed:\n${errors.join("\n")}`);
  }

  const contentVersion = createHash("sha256").update(rawParts.join("\n---\n")).digest("hex").slice(0, 16);
  return { diseaseId, contentVersion, bundle };
}

export function validateCrossReferences(bundle, shared, diseaseId = "disease") {
  const errors = [];
  const phenotypes = bundle.phenotypes?.phenotypes ?? {};
  const trajectories = bundle.trajectories?.trajectories ?? {};
  const examSlots = new Map((bundle.findings?.exam_slots ?? []).map((slot) => [slot.id, new Set(Object.keys(slot.states ?? {}))]));
  const decisions = bundle.operative?.decisions ?? {};
  const sourceIds = new Set((bundle.disease?.sources ?? []).map((source) => source.id));
  const medicationIds = new Set(Object.keys(shared?.medications?.medications ?? {}));

  for (const preset of bundle.phenotypes?.case_presets ?? []) {
    if (!phenotypes[preset.phenotype_id]) errors.push(`case preset ${preset.case_preset_id} references unknown phenotype_id "${preset.phenotype_id}"`);
    if (!trajectories[preset.trajectory_id]) errors.push(`case preset ${preset.case_preset_id} references unknown trajectory_id "${preset.trajectory_id}"`);
  }
  for (const [phenotypeId, phenotype] of Object.entries(phenotypes)) {
    for (const [slotId, stateId] of Object.entries(phenotype.presentation?.examination_slots ?? {})) {
      if (!examSlots.has(slotId)) errors.push(`phenotype ${phenotypeId} references unknown examination slot "${slotId}"`);
      else if (!examSlots.get(slotId).has(String(stateId))) errors.push(`phenotype ${phenotypeId} references unknown state "${stateId}" for examination slot "${slotId}"`);
    }
    for (const [slotId, choices] of Object.entries(phenotype.presentation?.examination_slot_choices ?? {})) {
      if (!examSlots.has(slotId)) errors.push(`phenotype ${phenotypeId} references unknown examination choice slot "${slotId}"`);
      else for (const choice of choices ?? []) if (!examSlots.get(slotId).has(String(choice))) errors.push(`phenotype ${phenotypeId} references unknown state "${choice}" for examination slot "${slotId}"`);
    }
  }
  for (const step of bundle.operative?.operative_sequence ?? []) {
    if (step.decision_id && !decisions[step.decision_id]) errors.push(`operative step ${step.step} references unknown decision_id "${step.decision_id}"`);
  }
  for (const [effectId, effect] of Object.entries(bundle.trajectories?.treatment_effects ?? {})) {
    for (const medicationId of effect.applies_to ?? []) if (!medicationIds.has(medicationId)) errors.push(`treatment effect ${effectId} references unknown medication "${medicationId}"`);
  }
  walk(bundle, (value, pathLabel) => {
    if (Array.isArray(value?.source_ids)) for (const sourceId of value.source_ids) if (!sourceIds.has(sourceId)) errors.push(`${pathLabel}.source_ids references unknown source "${sourceId}"`);
    if (Array.isArray(value?.conditions)) for (const condition of value.conditions) {
      if (condition.operator && !isKnownContentOperator(condition.operator)) errors.push(`${pathLabel} uses unknown content condition operator "${condition.operator}"`);
    }
  });
  const seen = new Map();
  const ids = [
    ...(bundle.rules?.rules ?? []).map((x) => [x.id, "rule"]),
    ...(bundle.findings?.exam_slots ?? []).map((x) => [x.id, "exam slot"]),
    ...Object.entries(phenotypes).map(([id]) => [id, "phenotype"]),
    ...Object.entries(trajectories).map(([id]) => [id, "trajectory"]),
    ...Object.entries(bundle.trajectories?.treatment_effects ?? {}).map(([id]) => [id, "treatment effect"]),
    ...Object.entries(decisions).map(([id]) => [id, "operative decision"]),
    ...(bundle.phenotypes?.case_presets ?? []).map((x) => [x.case_preset_id, "case preset"]),
  ];
  for (const [id, kind] of ids) {
    if (!id) continue;
    if (seen.has(id)) errors.push(`duplicate content id "${id}" (${seen.get(id)} and ${kind})`);
    else seen.set(id, kind);
  }
  return errors.map((message) => `[${diseaseId}] ${message}`);
}

function walk(value, visit, pathLabel = "content") {
  if (!value || typeof value !== "object") return;
  visit(value, pathLabel);
  if (Array.isArray(value)) value.forEach((item, index) => walk(item, visit, `${pathLabel}[${index}]`));
  else for (const [key, item] of Object.entries(value)) walk(item, visit, `${pathLabel}.${key}`);
}

/**
 * Patient-generation content is Patient Truth (review matrix §G1) and is
 * therefore held to the same provenance bar as a clinical rule. Before the
 * 2026-08-25 remediation only `rules.yaml` was checked, which is how a
 * phenotype could generate a patient with no recorded source at all.
 */
function validateGeneratingContent(bundle, diseaseId) {
  const errors = [];
  const checks = [
    [bundle.phenotypes?.demographics, "phenotypes.demographics"],
    [bundle.findings?.history_bundle_ru, "findings.history_bundle_ru"],
    [bundle.findings?.fasting_history, "findings.fasting_history"],
    [bundle.findings?.universal_normal_layer, "findings.universal_normal_layer"],
    [bundle.trajectories?.post_source_control_course, "trajectories.post_source_control_course"],
    [bundle.complications?.discharge_bundle, "complications.discharge_bundle"],
    [bundle.operative?.vte_assessment, "operative.vte_assessment"],
  ];
  for (const [item, label] of checks) {
    if (item) errors.push(...validateProvenance(item, label));
  }
  for (const [id, phenotype] of Object.entries(bundle.phenotypes?.phenotypes ?? {})) {
    errors.push(...validateProvenance(phenotype, `phenotype ${id}`));
  }
  for (const [id, envelope] of Object.entries(bundle.disease?.physiology_envelopes ?? {})) {
    errors.push(...validateProvenance(envelope, `physiology_envelope ${id}`));
  }
  for (const [id, trajectory] of Object.entries(bundle.trajectories?.trajectories ?? {})) {
    errors.push(...validateProvenance(trajectory, `trajectory ${id}`));
  }
  for (const [id, effect] of Object.entries(bundle.trajectories?.treatment_effects ?? {})) {
    errors.push(...validateProvenance(effect, `treatment_effect ${id}`));
    if (effect.response_envelope != null && (!Number.isFinite(effect.response_envelope.onset_minutes) || effect.response_envelope.onset_minutes < 0 || !validEnvelope(effect.response_envelope))) {
      errors.push(`treatment_effect ${id} has an invalid response_envelope`);
    }
    if (effect.provenance?.review_status === "approved_for_training" && !effect.response_envelope) errors.push(`treatment_effect ${id} has no approved response_envelope`);
  }
  for (const complication of bundle.complications?.postoperative_course?.complications ?? []) {
    errors.push(...validateProvenance(complication, `complication ${complication.id}`));
  }
  return errors.map((message) => `[${diseaseId}] ${message}`);
}

const SHARED_DIR = path.join(ROOT, "src/content/shared");

function buildShared() {
  const shared = {};
  for (const category of readdirSync(SHARED_DIR)) {
    const categoryDir = path.join(SHARED_DIR, category);
    const files = readdirSync(categoryDir).filter((name) => name.endsWith(".yaml"));
    shared[category] = {};
    for (const file of files) {
      Object.assign(shared[category], loadYaml(path.join(categoryDir, file)));
    }
  }
  return shared;
}

function main() {
  const diseaseIds = readdirSync(DISEASES_DIR).filter((name) => name !== "generated");
  const index = {};
  const compiled = {};

  const shared = buildShared();
  for (const diseaseId of diseaseIds) {
    const { contentVersion, bundle } = buildDisease(diseaseId, shared);
    index[diseaseId] = { contentVersion, files: REQUIRED_FILES };
    compiled[diseaseId] = bundle;
  }

  if (CHECK_ONLY) {
    console.log(`content:check OK — ${Object.keys(index).join(", ")} + shared/${Object.keys(shared).join(",")}`);
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path.join(OUT_DIR, "contentIndex.json"), JSON.stringify(index, null, 2));
  writeFileSync(path.join(OUT_DIR, "shared.json"), JSON.stringify(shared, null, 2));
  for (const [diseaseId, bundle] of Object.entries(compiled)) {
    // The content hash travels INSIDE the bundle, not only in the index.
    // `exportSession` reads `bundle.__contentVersion` to fill the export's
    // `content_versions`, and with the hash living only in contentIndex.json
    // every exported session recorded the literal string "unversioned" -
    // silently defeating the guarantee that two replays with equal
    // `content_versions` ran against byte-identical clinical content.
    writeFileSync(
      path.join(OUT_DIR, `${diseaseId}.json`),
      JSON.stringify({ ...bundle, __contentVersion: index[diseaseId].contentVersion }, null, 2),
    );
  }
  console.log(`content:build OK — wrote ${Object.keys(compiled).length} disease bundle(s) + shared/ to ${path.relative(ROOT, OUT_DIR)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

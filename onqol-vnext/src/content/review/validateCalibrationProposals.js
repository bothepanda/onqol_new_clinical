const CLASSES = new Set(["A", "B", "C", "D"]);
const DOMAINS = new Set(["preop", "analgesia", "fluid", "postop", "complication"]);
const DIRECTIONS = new Set(["increase", "decrease", "stable", "variable", "not_modeled"]);
const UNITS = new Set(["NRS_0_10", "beats_per_minute", "mmHg", "breaths_per_minute", "degrees_C", "percent", "mL", "mL_per_hour", "minutes", "hours", "mg_per_L", "cells_10e9_per_L"]);

/** Review-only schema. This data is deliberately never merged into a runtime bundle. */
export function validateCalibrationProposals(document, existingSourceIds = []) {
  const errors = [];
  if (document?.schema_version !== "app004-calibration-review-v1") errors.push("invalid schema_version");
  if (document?.case_preset_id !== "APP-004") errors.push("invalid case_preset_id");
  if (document?.runtime_authority !== "none") errors.push("runtime_authority must be none");
  if (!Array.isArray(document?.sources) || !Array.isArray(document?.proposals)) return [...errors, "sources and proposals must be arrays"];
  const sourceIds = new Set(existingSourceIds);
  for (const source of document.sources) {
    if (!source?.id || sourceIds.has(source.id)) errors.push(`duplicate or missing source id ${source?.id}`);
    sourceIds.add(source?.id);
    for (const field of ["title", "organization", "year", "version", "identifier", "url", "evidence_role", "population", "context", "applicability_limitations"]) {
      if (source?.[field] == null || String(source[field]).trim() === "") errors.push(`source ${source?.id} missing ${field}`);
    }
    if (source?.url && !/^https:\/\//.test(source.url)) errors.push(`source ${source?.id} invalid url`);
    if (source?.existing_registry_id != null && !existingSourceIds.includes(source.existing_registry_id)) errors.push(`source ${source?.id} unknown existing_registry_id`);
  }
  const ids = new Set();
  for (const p of document.proposals) {
    const label = p?.calibration_id ?? "unnamed proposal";
    if (!/^APP004-CAL-\d{3}$/.test(label) || ids.has(label)) errors.push(`${label} duplicate or malformed calibration_id`);
    ids.add(label);
    if (!DOMAINS.has(p?.clinical_domain)) errors.push(`${label} invalid clinical_domain`);
    if (!CLASSES.has(p?.evidence_class)) errors.push(`${label} invalid evidence_class`);
    if (!DIRECTIONS.has(p?.direction)) errors.push(`${label} invalid direction`);
    if (p?.proposed_status !== "draft" || p?.review_status !== "draft" || p?.runtime_authority !== "none") errors.push(`${label} must remain draft and inert`);
    if (p?.reviewer_decision !== null || p?.reviewer_notes !== null || p?.reviewed_by !== null || p?.reviewed_at !== null) errors.push(`${label} reviewer fields must be blank`);
    for (const field of ["variable", "baseline_condition", "clinical_question", "proposed_effect", "evidence_summary", "known", "unknown", "extrapolation", "uncertainty", "required_reviewer", "current_runtime_consequence"]) {
      if (typeof p?.[field] !== "string" || !p[field].trim()) errors.push(`${label} missing ${field}`);
    }
    if (!Array.isArray(p?.source_ids) || !p.source_ids.length || p.source_ids.some((id) => !sourceIds.has(id))) errors.push(`${label} missing or unknown source_ids`);
    if (p?.clinical_review_needed !== true) errors.push(`${label} clinical_review_needed must be true`);
    if (p?.numeric_range != null) {
      const range = p.numeric_range;
      if (!Array.isArray(range?.values) || range.values.length !== 2 || !range.values.every(Number.isFinite) || range.values[0] > range.values[1]) errors.push(`${label} malformed numeric_range`);
      if (!UNITS.has(range?.unit)) errors.push(`${label} invalid unit`);
      if (p.evidence_class !== "A") errors.push(`${label} numeric_range requires class A evidence`);
      if (typeof p?.numeric_evidence_locator !== "string" || !p.numeric_evidence_locator.trim()) errors.push(`${label} numeric_range missing evidence locator`);
    }
    if (p?.evidence_class !== "A" && (p?.onset != null || p?.duration != null || p?.constraints != null)) errors.push(`${label} unsupported quantitative timing or constraints require class A evidence`);
    if ((p?.onset != null || p?.duration != null || p?.constraints != null) && (typeof p?.numeric_evidence_locator !== "string" || !p.numeric_evidence_locator.trim())) errors.push(`${label} quantitative timing or constraints missing evidence locator`);
    if (p?.constraints != null) {
      const { min, max, unit } = p.constraints;
      if (!UNITS.has(unit)) errors.push(`${label} invalid constraint unit`);
      if (min != null && !Number.isFinite(min)) errors.push(`${label} invalid min`);
      if (max != null && !Number.isFinite(max)) errors.push(`${label} invalid max`);
      if (min != null && max != null && min > max) errors.push(`${label} impossible min/max`);
      if (p.numeric_range?.unit && p.numeric_range.unit !== unit) errors.push(`${label} range/constraint unit mismatch`);
    }
  }
  return errors;
}

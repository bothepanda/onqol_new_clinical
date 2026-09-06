/**
 * Governance visibility for PATIENT-GENERATION content (review matrix §G1,
 * remediation task §3).
 *
 * The vertical-slice build treated phenotype / physiology / history content as
 * exempt from the runtime gate, on the grounds that otherwise no patient could
 * be generated at all. The clinical review rejected that exemption: patient
 * generation IS Patient Truth, and "we need it to run" is not a review status.
 *
 * This module does not block generation - a development build still needs a
 * patient. What it does is make the exemption VISIBLE and AUDITABLE:
 *
 *   - it inventories every content object that generates a patient fact;
 *   - it reports each one's review status;
 *   - it produces a SIMULATOR_LIMITATION record for every object below
 *     `approved_for_training`;
 *   - it answers `isPatientTruthApproved()` for the one question that
 *     matters at release time - may this build be represented as pilot-ready?
 *
 * The inventory is derived from the bundle, not hardcoded per disease: adding
 * a second disease inventories its content through this same function.
 */
import { reviewStatusOf, provenanceRecord } from "../rules/contentProvenance.js";
import { isRuntimeAuthoritative, simulatorLimitation, RUNTIME_AUTHORITATIVE_STATUS } from "../rules/governance.js";
import { inflammatoryProfileCandidates } from "./patientGenerator.js";
import { SESSION_PURPOSE } from "../session/sessionPurpose.js";

const PILOT_ROUTE_PURPOSES = new Set([SESSION_PURPOSE.LEARNER_PILOT, SESSION_PURPOSE.PRODUCTION]);

const PROFILE_RANGE_FIELDS = [
  "heart_rate",
  "temperature_c",
  "systolic_bp",
  "respiratory_rate",
  "wbc",
  "neutrophil_percent",
  "crp",
];

/**
 * APP004 Numeric Calibration Review 2026-08-31 (ENV): once the linked
 * inflammatory profiles are the approved physiology path, a learner-pilot /
 * production APP-004 session must be generated FROM those profiles and must
 * FAIL rather than silently fall back to the union envelope when the
 * calibration is missing, unapproved or invalid.
 *
 * Pure and content-shaped so it can be proven without a full bundle. Returns
 * `{ ready: true }` when the disease has no profile calibration at all (nothing
 * to enforce) or when the calibration is complete and approved.
 */
export function evaluateInflammatoryCalibrationForPilot({ inflammatoryProfiles }) {
  const selection = inflammatoryProfiles?.selection;
  if (!selection) return { ready: true, code: "no_profile_calibration_defined" };

  if (selection.generation_enabled !== true) {
    return { ready: false, code: "inflammatory_calibration_not_enabled_for_pilot" };
  }
  const candidates = inflammatoryProfileCandidates(inflammatoryProfiles);
  if (candidates.length === 0) {
    return { ready: false, code: "inflammatory_calibration_order_empty" };
  }
  for (const { id, profile } of candidates) {
    const rangesOk =
      profile &&
      PROFILE_RANGE_FIELDS.every(
        (field) =>
          Array.isArray(profile[field]) &&
          profile[field].length === 2 &&
          profile[field].every((n) => typeof n === "number") &&
          profile[field][0] <= profile[field][1],
      );
    if (!rangesOk) return { ready: false, code: "inflammatory_calibration_incomplete_for_pilot", profileId: id };
    if (reviewStatusOf(profile) !== "approved_for_training") {
      return { ready: false, code: "inflammatory_profile_not_approved_for_pilot", profileId: id };
    }
  }
  const weights = selection.weights;
  const weightsOk =
    Array.isArray(weights) && weights.length === candidates.length && weights.every((w) => typeof w === "number" && w >= 0) && weights.some((w) => w > 0);
  if (!weightsOk) return { ready: false, code: "inflammatory_calibration_weights_invalid" };

  return { ready: true, code: "inflammatory_calibration_ready" };
}

/**
 * @param {object} options
 * @param {object} options.bundle        compiled disease bundle
 * @param {string} options.casePresetId
 * @param {string} [options.sessionPurpose] one of SESSION_PURPOSE. When it is
 *   `learner_pilot` or `production`, the physiology entry below reflects the
 *   ROUTE THAT ACTUALLY GENERATES THE PATIENT on that path (the linked
 *   inflammatory profiles, once active) rather than the legacy union
 *   envelope, which `patientGenerator.js` never reaches for that route. Any
 *   other purpose (including omitted, for existing internal-development /
 *   authoring callers) keeps inventorying the envelope itself, since that
 *   fallback path remains reachable there.
 * @returns {{ entries: object[], blocked: object[], approved: boolean }}
 */
export function inventoryPatientTruth({ bundle, casePresetId, sessionPurpose }) {
  const preset = (bundle.phenotypes?.case_presets ?? []).find((p) => p.case_preset_id === casePresetId);
  const phenotype = preset ? bundle.phenotypes.phenotypes?.[preset.phenotype_id] : null;
  const envelope = preset ? bundle.disease?.physiology_envelopes?.[preset.morphology] : null;
  const inflammatoryProfiles = bundle.disease?.inflammatory_profiles;
  const isPilotRoute = PILOT_ROUTE_PURPOSES.has(sessionPurpose);

  const candidates = [
    entry("demographics", "age, sex", preset?.demographics ?? bundle.phenotypes?.demographics),
    entry(
      "nausea_vomiting_states",
      "nausea, vomiting",
      // The coherence table's provenance is stored beside it rather than
      // inside it, because the table itself is a list.
      bundle.phenotypes?.provenance_nausea_vomiting ? { provenance: bundle.phenotypes.provenance_nausea_vomiting } : null,
    ),
    entry(
      "CAL-NAUSEA-VOMITING-SELECTION-APP004",
      "relative frequency of nausea/vomiting variants",
      bundle.phenotypes?.nausea_vomiting_selection_calibration,
    ),
    ...(preset?.excludes_pregnancy === true ? [] : (bundle.phenotypes?.sex_conditional_history ?? []).map((item) =>
      entry(item.id, "sex-conditional history", item),
    )),
    entry(
      preset?.phenotype_id ?? "phenotype",
      "symptom duration, pain site, pain score, examination findings, urinalysis, ultrasound, CT, operative findings",
      phenotype,
    ),
    entry(
      phenotype?.qualitative_truth?.provenance?.id ?? `${preset?.phenotype_id ?? "phenotype"}-qualitative`,
      "approved qualitative phenotype history, examination, imaging and operative truth",
      phenotype?.qualitative_truth,
    ),
    isPilotRoute
      ? pilotPhysiologyEntry(inflammatoryProfiles)
      : entry(preset?.morphology ?? "physiology_envelope", "baseline vitals, WBC, neutrophils, CRP", envelope),
    entry("history_bundle_ru", "history narrative", bundle.findings?.history_bundle_ru),
    entry("fasting_history", "last solid food / clear liquid times", bundle.findings?.fasting_history),
    entry("universal_normal_layer", "unrelated examination findings", bundle.findings?.universal_normal_layer),
    entry("post_source_control_course", "postoperative baseline state", bundle.trajectories?.post_source_control_course),
    entry(
      preset?.trajectory_id ?? "trajectory",
      "natural course over time",
      preset ? bundle.trajectories?.trajectories?.[preset.trajectory_id] : null,
    ),
    entry("chemistry_analytes", "biochemistry results", bundle.trajectories?.provenance_chemistry_analytes ? { provenance: bundle.trajectories.provenance_chemistry_analytes } : null),
  ].filter(Boolean);

  const blocked = candidates
    .filter((item) => !isRuntimeAuthoritative(item.reviewStatus))
    .map((item) =>
      simulatorLimitation({ kind: "patient_truth", id: item.contentId, reviewStatus: item.reviewStatus ?? null }),
    );

  return { entries: candidates, blocked, approved: blocked.length === 0 };
}

function entry(contentId, fieldsGenerated, item) {
  if (!item) return null;
  return {
    contentId,
    fieldsGenerated,
    reviewStatus: reviewStatusOf(item) ?? null,
    provenance: provenanceRecord(item, contentId),
  };
}

/**
 * The physiology-generation entry for a `learner_pilot` / `production`
 * inventory. `patientGenerator.js#selectInflammatoryProfile` never reaches
 * the legacy union envelope on this route once the profile calibration is
 * enabled - it fails closed instead (throws) if any linked profile is
 * missing, incomplete or unapproved. So the patient-truth question this
 * route actually needs answered is "is the active generation path fully
 * approved", which is exactly `evaluateInflammatoryCalibrationForPilot`, not
 * the envelope's own (irrelevant, and deliberately never-promoted)
 * `review_status`.
 */
function pilotPhysiologyEntry(inflammatoryProfiles) {
  const contentId = "inflammatory_profiles";
  const fieldsGenerated = "baseline vitals, WBC, neutrophils, CRP (active linked inflammatory profile; the legacy union envelope is not reachable on this route)";
  const calibration = evaluateInflammatoryCalibrationForPilot({ inflammatoryProfiles });
  const order = Array.isArray(inflammatoryProfiles?.selection?.order) ? inflammatoryProfiles.selection.order : [];
  // Representative provenance: every approved profile is reviewed by the same
  // Clinical Lead / second reviewer on the same dates (see disease.yaml), so
  // any one of them accurately represents the mechanism's own review record.
  // `review_status` is still driven by the AGGREGATE gate result below, not
  // blindly copied from this one profile, so a partially-approved set still
  // reports blocked.
  const representative = order.length ? inflammatoryProfiles[order[0]] : null;
  const reviewStatus = calibration.ready ? RUNTIME_AUTHORITATIVE_STATUS : calibration.code;
  return {
    contentId,
    fieldsGenerated,
    reviewStatus,
    provenance: {
      ...provenanceRecord(representative, contentId),
      review_status: reviewStatus,
      notes: `Aggregate gate over linked profiles [${order.join(", ") || "none"}]: evaluateInflammatoryCalibrationForPilot -> ${calibration.code}.`,
    },
  };
}

/**
 * The release-gate question. A build whose patient truth is not approved may
 * still run for internal development, but `createSession` stamps this onto
 * session state and the debrief/export repeat it, so nothing downstream can
 * quietly present such a build as pilot-ready (task §3).
 */
export function isPatientTruthApproved(inventory) {
  return inventory.approved === true;
}

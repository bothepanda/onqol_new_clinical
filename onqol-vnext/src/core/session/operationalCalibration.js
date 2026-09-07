/**
 * Operational simulation calibration — how long a learner action takes in the
 * simulated department.
 *
 * This is Hospital/World operational data (Governance Spec: resource ETAs,
 * staff-arrival times and investigation turnaround are operational facts about
 * a simulated hospital, not clinical claims, and are outside the
 * `approved_for_training` clinical-content gate). The values live in a
 * versioned content artifact — `src/content/shared/simulation/calibration.yaml`
 * — carrying an explicit Clinical-Lead approval and a scope, so they are
 * auditable and cannot silently apply to another disease or module. There are
 * no hard-coded duration constants in the runtime.
 *
 * When no scoped entry matches, every duration is 0 — the pre-2026-09-07
 * behaviour — so a disease without its own reviewed calibration is unchanged.
 */

/**
 * The calibration entry whose scope matches this session, or null.
 * @param {object} params
 * @param {object} params.bundle  merged content bundle (`bundle.shared.simulation`)
 * @param {object} params.session `state.session` (needs `casePresetId`, `purpose`)
 */
export function resolveOperationalCalibration({ bundle, session }) {
  const entries = bundle?.shared?.simulation?.simulation_calibration ?? [];
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const presetId = session?.casePresetId ?? null;
  const purpose = session?.purpose ?? null;
  for (const entry of entries) {
    const presets = entry?.scope?.case_preset_ids ?? [];
    const purposes = entry?.scope?.session_purposes ?? [];
    const presetOk = presets.length === 0 || (presetId != null && presets.includes(presetId));
    const purposeOk = purposes.length === 0 || (purpose != null && purposes.includes(purpose));
    if (presetOk && purposeOk) return entry;
  }
  return null;
}

/**
 * Minutes one executed command consumes, per the calibration.
 * Non-executed outcomes (CLARIFY / REJECTED / NO_PENDING_WORK) consume nothing.
 * An `EXAMINE` duration may be a per-region map with a `default`.
 */
export function actionDurationMinutes({ calibration, result }) {
  if (!calibration || !result?.command) return 0;
  if (!isTimeConsumingOutcome(result.outcome)) return 0;
  const table = calibration.action_durations_minutes ?? {};
  const spec = table[result.command.type];
  if (spec == null) return 0;
  if (typeof spec === "number") return Number.isFinite(spec) && spec > 0 ? spec : 0;
  if (typeof spec === "object") {
    const region = result.command.params?.region;
    const value = (region != null && spec[region] != null) ? spec[region] : spec.default;
    return Number.isFinite(value) && value > 0 ? value : 0;
  }
  return 0;
}

/**
 * One turn's clinical-time cost. Concurrent actions in a turn share one
 * interval (Core Runtime Spec §7.2), so the turn consumes the MAX of its
 * actions' calibrated durations — not the sum.
 */
export function turnConsumesMinutes({ calibration, results }) {
  if (!calibration || !Array.isArray(results) || results.length === 0) return 0;
  return Math.max(0, ...results.map((result) => actionDurationMinutes({ calibration, result })));
}

function isTimeConsumingOutcome(outcome) {
  return outcome === "EXECUTED";
}

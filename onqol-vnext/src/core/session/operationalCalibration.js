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
 *
 * Scoping is by CASE PRESET only. `session.purpose` is deliberately never
 * consulted (§8.2): patient-time physics is a property of the content, and
 * internal_development / faculty_preview / learner_pilot / production must all
 * pace an APP-004 case identically.
 *
 * @param {object} params
 * @param {object} params.bundle  merged content bundle (`bundle.shared.simulation`)
 * @param {object} params.session `state.session` (needs `casePresetId`)
 */
export function resolveOperationalCalibration({ bundle, session }) {
  const entries = bundle?.shared?.simulation?.simulation_calibration ?? [];
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const presetId = session?.casePresetId ?? null;
  for (const entry of entries) {
    const presets = entry?.scope?.case_preset_ids ?? [];
    const presetOk = presets.length === 0 || (presetId != null && presets.includes(presetId));
    if (presetOk) return entry;
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
 * One turn's learner-performed clinical-time cost (§8.3).
 *
 * Learner actions in a single turn are performed by ONE actor and are
 * therefore SEQUENTIAL/ADDITIVE - "опрос и осмотр живота" costs 10 + 5 = 15,
 * not max(10, 5). Actions that only initiate an independent hospital process
 * (ORDER_TEST, ORDER_MEDICATION, CALL_STAFF, ...) are 0 in the calibration, so
 * they add nothing here; their turnaround / ETA runs concurrently against the
 * clock through `advanceTime` once time later advances.
 *
 * Multiple commands in one turn do NOT imply they happened in parallel.
 */
export function turnConsumesMinutes({ calibration, results }) {
  if (!calibration || !Array.isArray(results) || results.length === 0) return 0;
  return results.reduce((total, result) => total + actionDurationMinutes({ calibration, result }), 0);
}

function isTimeConsumingOutcome(outcome) {
  return outcome === "EXECUTED";
}

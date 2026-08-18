const ACTION_MINUTES = {
  risk_stratification: 0,
  diagnosis_acute_appendicitis: 0,
  differential_ectopic: 0,
  focused_history: 8,
  abdominal_exam: 6,
  pelvic_gynecologic_screen: 10,
  cbc: 35,
  urinalysis: 20,
  pregnancy_test: 12,
  crp: 35,
  biochemistry: 35,
  abdominal_ultrasound: 30,
  pelvic_ultrasound: 30,
  ct_abdomen: 90,
  // Without a scenario there is no authored resource queue to wait for.
  wait_for_ultrasound: 0,
  active_observation: 120,
  serial_reexamination: 45,
  transfer_before_source_control: 150,
  appendectomy_procedure_start: 15,
  appendectomy_here: 75,
  preop_single_antibiotic_prophylaxis: 5,
  analgesia: 5,
  npo: 2,
  iv_access: 5,
  iv_fluids: 15,
  surgical_consult: 12,
  gynecology_consult: 25,
  antibiotic_observation_course: 20,
  postop_antibiotics_uncomplicated: 5,
  postoperative_reassessment: 0,
  discharge_and_followup: 0,
};

function unique(list) {
  return [...new Set(list)];
}

function hasAny(actions, ids) {
  return ids.some((id) => actions.includes(id));
}

/**
 * The emergency-department disposition checkpoint.
 *
 * A workflow marker only, and explicitly NOT a Kazakhstan standard.
 *
 * Owner decision, 09.08.2026: the threshold comes from the NHS England model,
 * which treats 0-4 hours as core emergency-department care with admit, transfer
 * or discharge as the target outcome. Kazakhstan allows 24 hours for processing;
 * the owner's point is that a patient nonetheless cannot spend 24 hours in the
 * emergency department, which is what the marker is for.
 *
 * So it is labelled as the NHS model wherever it is surfaced, never as a local
 * requirement, and it never moves a score.
 */
export const ED_DISPOSITION_CHECKPOINT_MINUTES = 240;

function temporalRuleMatches(rule, { actions, completed, clockMinutes }) {
  const when = rule.when || {};
  if (Number.isFinite(when.min_clock_minutes) && clockMinutes < when.min_clock_minutes) return false;
  if (when.actions && !when.actions.some((id) => actions.includes(id))) return false;
  if (when.completed && !when.completed.every((id) => completed.includes(id))) return false;
  return true;
}

export function createInitialTemporalState(caseData) {
  // A generated case carries its own opening vitals. Without this the sidebar
  // showed 37.8/96/118 while the handoff above it read something else, and the
  // learner had two different patients on one screen. The literals stay as the
  // fallback for the fixed V2.5/V3 card, which has no generated vitals.
  const opening = caseData.patient_state?.opening_vitals || {};
  return {
    clockMinutes: 0,
    flow: { checkpointMinute: ED_DISPOSITION_CHECKPOINT_MINUTES, edDispositionCheckpointReached: false },
    timeFromOnsetMinutes: Math.round((caseData.patient_state.time_from_onset_hours || 0) * 60),
    phase: "presentation",
    painScore: opening.pain_score ?? 7,
    temperatureC: opening.temperature_c ?? 37.8,
    heartRate: opening.heart_rate ?? 96,
    systolicBp: opening.systolic_bp ?? 118,
    peritonism: "local",
    sourceControl: false,
    antibioticProphylaxis: false,
    risk: "undifferentiated",
    status: "stable",
    flags: [],
    timeline: [
      {
        minute: 0,
        label: "Поступление",
        // Built from what is actually shown, not from a frozen sentence. The
        // literal used to read "Стабильная пациентка с болью в правой
        // подвздошной области поступила ночью" for every patient - wrong sex,
        // wrong site and an invented time of day for most of them.
        detail: admissionLine(caseData),
      },
    ],
  };
}

/** The opening timeline entry: sex and complaint as presented, nothing more. */
function admissionLine(caseData) {
  const sex = caseData.patient_state?.sex;
  const who = sex === "male" ? "Пациент" : sex === "female" ? "Пациентка" : "Пациент";
  // The complaint the learner was handed, without the diagnosis and without a
  // stability claim nobody has made yet.
  const complaint = caseData.title ? String(caseData.title).replace(/^Боль\s+/i, "боль ") : null;
  return complaint ? `${who} поступил${sex === "female" ? "а" : ""}: ${complaint}.` : `${who} поступил${sex === "female" ? "а" : ""} в приёмное отделение.`;
}

/**
 * Fallback cost, used only when nobody supplied a resolved ETA.
 *
 * The real cost of a turn is composed by v25/resourceTiming.js from a baseline
 * turnaround plus whatever queue THIS shift imposes. This table survives for
 * callers that have no scenario to resolve against - and it is why an ultrasound
 * used to cost six hours in a hospital that had one available round the clock.
 */
export function actionTimeCost(actionIds) {
  const costs = unique(actionIds).map((id) => ACTION_MINUTES[id] ?? 4);
  return costs.length ? Math.max(...costs) : 0;
}

/**
 * @param {object} [options]
 * @param {number} [options.elapsedMinutes] resolved ETA for this turn. Pass it
 *        whenever a scenario is available; without it the flat table is used.
 */
export function projectTemporalState(caseData, previousState, actionIds, options = {}) {
  const actions = unique(actionIds);
  const completed = unique([...(previousState.completedActionIds || []), ...actions]);
  const addedMinutes = Number.isFinite(options.elapsedMinutes)
    ? options.elapsedMinutes
    : actionTimeCost(actions);
  const clockMinutes = previousState.clockMinutes + addedMinutes;
  const timeFromOnsetMinutes = previousState.timeFromOnsetMinutes + addedMinutes;
  const sourceControl = previousState.sourceControl || actions.includes("appendectomy_here");
  const antibioticProphylaxis =
    previousState.antibioticProphylaxis || actions.includes("preop_single_antibiotic_prophylaxis");
  const flags = new Set(previousState.flags || []);
  let phase = previousState.phase;
  let status = previousState.status;
  let risk = previousState.risk;
  let painScore = previousState.painScore;
  let temperatureC = previousState.temperatureC;
  let heartRate = previousState.heartRate;
  let peritonism = previousState.peritonism;

  if (actions.includes("analgesia")) painScore = Math.max(3, painScore - 2);

  if (hasAny(completed, ["focused_history", "abdominal_exam", "cbc", "urinalysis", "pregnancy_test"])) {
    phase = "diagnostic_workup";
  }
  if (hasAny(completed, ["risk_stratification", "diagnosis_acute_appendicitis"])) {
    phase = "decision";
    risk = completed.includes("diagnosis_acute_appendicitis")
      ? "working_diagnosis_acute_appendicitis"
      : "stratified";
  }
  if (sourceControl) {
    phase = "post_source_control";
    status = antibioticProphylaxis ? "controlled" : "controlled_with_antibiotic_gap";
    painScore = 3;
    peritonism = "operative_finding_uncomplicated";
  }

  // Flow clock, not disease clock.
  //
  // Crossing four hours used to raise the temperature to 38.3, the heart rate to
  // 108, worsen the peritonism and set delay_risk - turning an emergency
  // department process target into a biological law that applies to every
  // patient with every disease. It is a workflow signal about disposition, and
  // nothing more. Physiology now changes only where a reviewed disease rule says
  // it does.
  const flow = {
    checkpointMinute: ED_DISPOSITION_CHECKPOINT_MINUTES,
    edDispositionCheckpointReached:
      previousState.flow?.edDispositionCheckpointReached ||
      clockMinutes >= ED_DISPOSITION_CHECKPOINT_MINUTES,
  };

  // Disease progression, case-configured. An unconfigured case simply does not
  // deteriorate with time, which is the honest default: inventing a threshold
  // here would be exactly the unreviewed clinical content this project refuses
  // to ship.
  if (!sourceControl) {
    for (const rule of caseData.temporal_progression_rules || []) {
      if (rule.runtime_status !== "reviewed_active") continue;
      if (!temporalRuleMatches(rule, { actions, completed, clockMinutes })) continue;
      const effects = rule.effects || {};
      if (effects.status) status = effects.status;
      if (Number.isFinite(effects.pain_delta)) {
        painScore = Math.min(10, Math.max(0, painScore + effects.pain_delta));
      }
      if (Number.isFinite(effects.min_temperature_c)) {
        temperatureC = Math.max(temperatureC, effects.min_temperature_c);
      }
      if (Number.isFinite(effects.min_heart_rate)) {
        heartRate = Math.max(heartRate, effects.min_heart_rate);
      }
      if (effects.peritonism) peritonism = effects.peritonism;
      for (const flag of effects.flags || []) flags.add(flag);
    }
  }
  if (actions.includes("transfer_before_source_control")) flags.add("transfer_before_source_control");
  if (actions.includes("antibiotic_observation_course")) flags.add("antibiotic_observation_course");
  if (actions.includes("postop_antibiotics_uncomplicated")) flags.add("postop_antibiotics_uncomplicated");

  return {
    ...previousState,
    completedActionIds: completed,
    clockMinutes,
    timeFromOnsetMinutes,
    phase,
    painScore,
    temperatureC,
    heartRate,
    systolicBp: previousState.systolicBp,
    peritonism,
    sourceControl,
    antibioticProphylaxis,
    risk,
    status,
    flow,
    flags: [...flags],
    lastDeltaMinutes: addedMinutes,
    timeline: actions.length
      ? [
          ...previousState.timeline,
          {
            minute: clockMinutes,
            label: actions.join(", "),
            detail: describeTemporalChange(clockMinutes, status, addedMinutes),
          },
        ]
      : previousState.timeline,
  };
}

export function describeTemporalChange(clockMinutes, status, addedMinutes) {
  const hours = Math.floor(clockMinutes / 60);
  const minutes = clockMinutes % 60;
  const clock = `${hours}ч ${minutes}м`;
  if (status === "controlled") return `${clock}: источник контролирован, профилактика дана.`;
  if (status === "controlled_with_antibiotic_gap") return `${clock}: операция выполнена, но профилактика не зафиксирована.`;
  if (status === "delayed_source_control") return `${clock}: задержка ${addedMinutes} мин усиливает локальную воспалительную картину.`;
  return `${clock}: клиническое время +${addedMinutes} мин.`;
}

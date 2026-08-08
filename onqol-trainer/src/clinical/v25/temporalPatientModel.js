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
  abdominal_ultrasound: 360,
  pelvic_ultrasound: 360,
  ct_abdomen: 90,
  wait_for_ultrasound: 360,
  active_observation: 120,
  serial_reexamination: 45,
  transfer_before_source_control: 150,
  open_appendectomy_here: 90,
  preop_single_antibiotic_prophylaxis: 5,
  analgesia: 5,
  npo: 2,
  iv_access: 5,
  iv_fluids: 15,
  surgical_consult: 12,
  gynecology_consult: 25,
  antibiotic_observation_course: 20,
  postop_antibiotics_uncomplicated: 5,
};

function unique(list) {
  return [...new Set(list)];
}

function hasAny(actions, ids) {
  return ids.some((id) => actions.includes(id));
}

export function createInitialTemporalState(caseData) {
  return {
    clockMinutes: 0,
    timeFromOnsetMinutes: Math.round((caseData.patient_state.time_from_onset_hours || 0) * 60),
    phase: "presentation",
    painScore: 7,
    temperatureC: 37.8,
    heartRate: 96,
    systolicBp: 118,
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
        detail: "Стабильная пациентка с болью в правой подвздошной области поступила ночью.",
      },
    ],
  };
}

export function actionTimeCost(actionIds) {
  const costs = unique(actionIds).map((id) => ACTION_MINUTES[id] ?? 4);
  return costs.length ? Math.max(...costs) : 0;
}

export function projectTemporalState(caseData, previousState, actionIds) {
  const actions = unique(actionIds);
  const completed = unique([...(previousState.completedActionIds || []), ...actions]);
  const addedMinutes = actionTimeCost(actions);
  const clockMinutes = previousState.clockMinutes + addedMinutes;
  const timeFromOnsetMinutes = previousState.timeFromOnsetMinutes + addedMinutes;
  const sourceControl = previousState.sourceControl || actions.includes("open_appendectomy_here");
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
  } else if (clockMinutes >= 240 || actions.includes("wait_for_ultrasound")) {
    status = "delayed_source_control";
    painScore = Math.min(9, painScore + 1);
    temperatureC = Math.max(temperatureC, 38.3);
    heartRate = Math.max(heartRate, 108);
    peritonism = "local_more_expressive";
    flags.add("delay_risk");
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

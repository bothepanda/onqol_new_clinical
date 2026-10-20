/**
 * Latest known vitals (task brief §23.5.B). Shows only what the learner is
 * currently entitled to know - it reads `learnerVisible.physiologyKnownAt`,
 * never `state.physiology` directly, so it cannot get ahead of what has
 * actually been observed in-session.
 */
export function VitalsStrip({ snapshot }) {
  if (!snapshot) return null;
  const { values } = snapshot;
  // BP shows systolic/diastolic when the patient model provides both, and
  // systolic only when it does not. The current reviewed physiology envelope
  // has no diastolic range, so rather than print a plausible invented number
  // this labels the value for what it actually is (Governance Spec §2).
  const bp = values.diastolicBp != null ? `${values.systolicBp}/${values.diastolicBp}` : `${values.systolicBp} сист.`;
  // Physiology names the field `spo2Percent`; `spo2` is kept for older snapshots.
  const spo2 = values.spo2Percent ?? values.spo2 ?? null;
  const entries = [
    ["HR", values.heartRate, "/мин"],
    ["BP", bp, ""],
    ["RR", values.respiratoryRate, "/мин"],
    ["SpO2", spo2 ?? "—", spo2 != null ? "%" : ""],
    ["T", values.temperatureC, "°C"],
    ["PAIN", values.painScore ?? "—", values.painScore != null ? "/10" : ""],
  ];
  return (
    <div className="onqol-vitals">
      {entries.map(([label, value, unit]) => (
        <span key={label}>
          {label}
          <b>
            {value}
            {unit}
          </b>
        </span>
      ))}
    </div>
  );
}

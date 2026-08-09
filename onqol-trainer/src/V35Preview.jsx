// Faculty review harness: read every word a learner could be shown, fast.
//
// WHY IT EXISTS
//
// Reviewing the corpus by playing sessions is the wrong tool for the job - a
// session shows one patient and only the findings that patient's learner asked
// for. Every text bug this cycle (a diagnosis in the title, a menu of pain sites,
// a developer's note printed as a CT report, an examination in a different place
// from the complaint) was found by reading many patients side by side.
//
// This is NOT a second trainer. It renders cases and shows their text; it has no
// engine, no mentor, no scoring, and it never mutates anything.
//
// Every card prints its seed and preset, so anything found here is reproducible:
// the same seed and preset rebuild the same patient byte for byte.

import { useMemo, useState } from "react";
import { buildV35Case } from "./clinical/v35/createCase.js";
import { CASE_PRESETS, learnerSelectablePresets } from "./clinical/v35/phenotypes.js";
import { V35_CONTENT_VERSION } from "./clinical/v35/manifest.js";

const MONO = "'IBM Plex Mono', 'Courier New', monospace";
const TEAL = "#16697A";
const INK = "#1f2a2e";

/** Findings in the order a shift actually uncovers them. */
const FINDING_ORDER = [
  "focused_history",
  "abdominal_exam",
  "pelvic_gynecologic_screen",
  "cbc",
  "crp",
  "urinalysis",
  "biochemistry",
  "pregnancy_test",
  "abdominal_ultrasound",
  "pelvic_ultrasound",
  "ct_abdomen",
];

const LEARNER_PRESETS = learnerSelectablePresets().map((preset) => preset.case_preset_id);
const FACULTY_PRESETS = CASE_PRESETS.filter(
  (preset) => !LEARNER_PRESETS.includes(preset.case_preset_id)
).map((preset) => preset.case_preset_id);

function buildBatch(presetId, count, run) {
  const cases = [];
  for (let index = 0; index < count; index += 1) {
    const seed = `review-${run}-${index}`;
    try {
      cases.push({
        seed,
        built: buildV35Case({
          seed,
          requestedPresetId: presetId === "все" ? undefined : presetId,
          // Faculty-only presets are reachable here and nowhere else.
          mode: FACULTY_PRESETS.includes(presetId) ? "faculty" : "learner",
        }),
      });
    } catch (error) {
      cases.push({ seed, error: error.message });
    }
  }
  return cases;
}

export default function V35Preview() {
  const [presetId, setPresetId] = useState("все");
  const [count, setCount] = useState(8);
  const [run, setRun] = useState(1);
  const [showHidden, setShowHidden] = useState(false);

  const cases = useMemo(() => buildBatch(presetId, count, run), [presetId, count, run]);

  return (
    <div style={{ fontFamily: MONO, color: INK, background: "#f5f7f7", minHeight: "100vh" }}>
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 5,
          background: "#fff",
          borderBottom: "1px solid rgba(22,105,122,0.2)",
          padding: "14px 24px",
          display: "flex",
          gap: 16,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <strong style={{ color: TEAL, letterSpacing: "0.08em" }}>ON QOL · ПРОСМОТР КОРПУСА</strong>
        <span style={{ fontSize: 12, opacity: 0.7 }}>контент {V35_CONTENT_VERSION}</span>

        <label style={{ fontSize: 12 }}>
          пресет{" "}
          <select value={presetId} onChange={(event) => setPresetId(event.target.value)}>
            <option value="все">все, как выпадет</option>
            {LEARNER_PRESETS.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
            {FACULTY_PRESETS.map((id) => (
              <option key={id} value={id}>
                {id} (только преподавателю)
              </option>
            ))}
          </select>
        </label>

        <label style={{ fontSize: 12 }}>
          пациентов{" "}
          <select value={count} onChange={(event) => setCount(Number(event.target.value))}>
            {[4, 8, 16, 32].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>

        <label style={{ fontSize: 12 }}>
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(event) => setShowHidden(event.target.checked)}
          />{" "}
          показать скрытое от резидента
        </label>

        <button
          onClick={() => setRun((value) => value + 1)}
          style={{
            marginLeft: "auto",
            border: `1px solid ${TEAL}`,
            background: TEAL,
            color: "#fff",
            borderRadius: 4,
            padding: "8px 14px",
            fontFamily: MONO,
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          Ещё пациенты
        </button>
      </header>

      <main style={{ padding: "20px 24px 60px", maxWidth: 980, margin: "0 auto" }}>
        <p style={{ fontSize: 12, opacity: 0.75, lineHeight: 1.6 }}>
          Это то, что резидент может увидеть, если запросит всё. Сид под каждым пациентом
          воспроизводит его байт в байт. Отсутствие признака в осмотре означает «фенотип его не
          задал», а не «отрицательный».
        </p>

        {cases.map(({ seed, built, error }) => (
          <CaseCard key={seed} seed={seed} built={built} error={error} showHidden={showHidden} />
        ))}
      </main>
    </div>
  );
}

function CaseCard({ seed, built, error, showHidden }) {
  if (error) {
    return (
      <section style={cardStyle}>
        <div style={{ color: "#b3261e" }}>
          {seed}: {error}
        </div>
      </section>
    );
  }

  const { caseData } = built;
  const findings = caseData.available_findings || {};
  const composition = caseData.v35_composition || {};

  return (
    <section style={cardStyle}>
      <h2 style={{ margin: "0 0 4px", fontSize: 17, color: TEAL }}>{caseData.title}</h2>
      <p style={{ margin: "0 0 12px", fontSize: 15, lineHeight: 1.65 }}>
        {caseData.initial_presentation?.text}
      </p>

      {FINDING_ORDER.filter((id) => findings[id]).map((id) => (
        <p key={id} style={{ margin: "0 0 8px", fontSize: 14, lineHeight: 1.6 }}>
          <span style={{ color: TEAL, fontSize: 11, letterSpacing: "0.06em" }}>
            {(findings[id].title || id).toUpperCase()}
          </span>
          <br />
          {findings[id].text}
        </p>
      ))}

      {showHidden && (
        <div
          style={{
            marginTop: 12,
            padding: "10px 12px",
            background: "rgba(22,105,122,0.06)",
            borderRadius: 4,
            fontSize: 13,
            lineHeight: 1.6,
          }}
        >
          <div style={{ color: TEAL, fontSize: 11, letterSpacing: "0.06em" }}>
            СКРЫТО ОТ РЕЗИДЕНТА
          </div>
          <div>{caseData.faculty_title_ru}</div>
          {Object.entries(caseData.hidden_findings || {}).map(([id, finding]) => (
            <div key={id}>{finding.text}</div>
          ))}
        </div>
      )}

      <footer style={{ marginTop: 12, fontSize: 11, opacity: 0.65 }}>
        сид <code>{composition.effective_seed || seed}</code> · пресет{" "}
        <code>{composition.case_preset_id}</code> · фенотип <code>{composition.phenotype_id}</code>{" "}
        · контент <code>{composition.content_version}</code>
      </footer>
    </section>
  );
}

const cardStyle = {
  background: "#fff",
  border: "1px solid rgba(22,105,122,0.18)",
  borderRadius: 6,
  padding: "16px 18px",
  marginBottom: 14,
};

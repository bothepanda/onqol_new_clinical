import { t } from "../i18n/strings.js";

/**
 * Start screen (task brief §23.2, Core Runtime Spec §14): two explicit,
 * equally weighted hospital modes. No diagnosis/phenotype selection is
 * exposed here - that is deliberately out of scope for the default
 * unknown-patient game (Core Runtime Spec §4).
 */
export function ModeSelection({ locale, onSelect, resumeCandidate, onResume, onDiscard }) {
  return (
    <div className="onqol-mode-screen">
      <h1>{t(locale, "mode.title")}</h1>
      <p className="onqol-mode-lead">{t(locale, "mode.lead")}</p>
      {resumeCandidate && (
        <div className="onqol-resume-card">
          <strong>{resumeCandidate.completed ? "Есть завершённый кейс" : "Есть незавершённый кейс"}</strong>
          <span>{resumeCandidate.completed ? "Можно открыть дебриф и экспорт." : "Время и журнал действий будут восстановлены."}</span>
          <div>
            <button type="button" onClick={onResume}>{resumeCandidate.completed ? "Открыть дебриф" : "Продолжить кейс"}</button>
            <button type="button" onClick={onDiscard}>Начать новый</button>
          </div>
        </div>
      )}
      <div className="onqol-mode-grid">
        <button type="button" className="onqol-mode-card" onClick={() => onSelect({ mode: "reference" })}>
          <strong>{t(locale, "mode.referenceTitle")}</strong>
          <span>{t(locale, "mode.referenceDesc")}</span>
        </button>
        <button
          type="button"
          className="onqol-mode-card"
          onClick={() => onSelect({ mode: "real", realProfileId: "KZ-R2-URBAN" })}
        >
          <strong>{t(locale, "mode.realTitle")}</strong>
          <span>{t(locale, "mode.realDesc")}</span>
        </button>
      </div>
    </div>
  );
}

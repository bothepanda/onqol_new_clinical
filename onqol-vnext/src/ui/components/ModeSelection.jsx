import { t } from "../i18n/strings.js";

/**
 * Start screen (task brief §23.2, Foundation Spec §14): two explicit,
 * equally weighted hospital modes. No diagnosis/phenotype selection is
 * exposed here - that is deliberately out of scope for the default
 * unknown-patient game (Foundation Spec §4).
 */
export function ModeSelection({ locale, onSelect }) {
  return (
    <div className="onqol-mode-screen">
      <h1>{t(locale, "mode.title")}</h1>
      <p className="onqol-mode-lead">{t(locale, "mode.lead")}</p>
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

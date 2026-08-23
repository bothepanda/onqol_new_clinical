import { t } from "../i18n/strings.js";
import { VitalsStrip } from "./VitalsStrip.jsx";
import { ConstraintList } from "./ConstraintList.jsx";
import { hospitalTimeLabel, elapsedLabel } from "../../core/time/clock.js";

/**
 * The strict learner-facing sidebar allowlist (task brief §23.5-23.6):
 * hospital clock, latest vitals, revealed shift constraints, and the JSON
 * export button. Nothing else. In particular this component never receives
 * `workflow.label`, `state.pending`, `state.mentor`, rule ids, or the seed -
 * those exist only in the dev-only diagnostics panel (§29), a different
 * component entirely, so there is no shared code path that could leak one
 * into the other by accident.
 */
export function SessionSidebar({ locale, clockRoot, elapsedMinutes, vitalsSnapshot, constraints, onDownload }) {
  return (
    <aside className="onqol-sidebar">
      <section className="onqol-side-section">
        <h3 className="onqol-mono-label onqol-side-heading">{t(locale, "sidebar.hospitalTime")}</h3>
        <div className="onqol-clock">
          <strong>{hospitalTimeLabel(clockRoot, elapsedMinutes)}</strong>
          <small>
            {t(locale, "sidebar.caseTime")}: {elapsedLabel(elapsedMinutes)}
          </small>
        </div>
      </section>

      <section className="onqol-side-section">
        <h3 className="onqol-mono-label onqol-side-heading">{t(locale, "sidebar.vitals")}</h3>
        <VitalsStrip snapshot={vitalsSnapshot} />
      </section>

      <section className="onqol-side-section">
        <h3 className="onqol-mono-label onqol-side-heading">{t(locale, "sidebar.constraints")}</h3>
        <ConstraintList locale={locale} constraints={constraints} />
      </section>

      <section className="onqol-side-section">
        <button type="button" className="onqol-download" onClick={onDownload}>
          <span>{t(locale, "sidebar.download")}</span>
          <span aria-hidden="true">↓</span>
        </button>
      </section>
    </aside>
  );
}

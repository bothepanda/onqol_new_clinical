import { LOCALES, t } from "../i18n/strings.js";

/**
 * Header chrome (task brief §23.1): brand, RU/KK/EN switch, disabled
 * "Личный кабинет" placeholder. No account backend in this build - the
 * button is honestly inert, not silently broken.
 */
export function AppHeader({ locale, onLocaleChange, onBrandClick }) {
  return (
    <header className="onqol-header">
      <button type="button" className="onqol-brand" onClick={onBrandClick}>
        {t(locale, "brand")}
      </button>
      <div className="onqol-header-controls">
        <div className="onqol-locale-switch" role="group" aria-label="language">
          {LOCALES.map((code) => (
            <button
              key={code}
              type="button"
              aria-pressed={locale === code}
              disabled={code !== "ru"}
              title={code === "ru" ? undefined : "Скоро"}
              onClick={() => onLocaleChange(code)}
            >
              {t(locale, `localeSwitch.${code}`)}{code === "ru" ? "" : " · скоро"}
            </button>
          ))}
        </div>
        <button type="button" className="onqol-account-button" disabled title={t(locale, "account.status")}>
          <strong>{t(locale, "account.label")}</strong>
          <small>{t(locale, "account.status")}</small>
        </button>
      </div>
    </header>
  );
}

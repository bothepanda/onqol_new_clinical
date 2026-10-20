import { useState } from "react";
import { AppHeader } from "../ui/components/AppHeader.jsx";
import { ModeSelection } from "../ui/components/ModeSelection.jsx";
import { ChatShell } from "../ui/components/ChatShell.jsx";
import { Composer } from "../ui/components/Composer.jsx";
import { SessionSidebar } from "../ui/components/SessionSidebar.jsx";
import { DebriefPanel } from "../ui/components/DebriefPanel.jsx";
import { t } from "../ui/i18n/strings.js";
import { useSession } from "./session/useSession.js";
import { FlexiblePatientApp } from "./FlexiblePatientApp.jsx";
import "../ui/styles/base.css";
import "../ui/styles/shell.css";

export default function App() {
  const [locale, setLocale] = useState("ru");
  const [flexible, setFlexible] = useState(false);
  const flexibleAvailable = import.meta.env.VITE_ONQOL_FLEXIBLE_PATIENT === "true" && import.meta.env.VITE_ONQOL_PILOT !== "true";
  const {
    session, messages, busy, debrief, resumeCandidate, startSession, resumeSession,
    discardPersistedSession, submitTurn, downloadExport, learnerVisible,
    mentorEnabled,
  } = useSession();

  const handleSelectMode = (choice) => startSession({ ...choice, locale });
  const handleBrandClick = () => {
    // Reset to the start screen without discarding the current export -
    // the learner can still download JSON for the session they are leaving.
    window.location.reload();
  };

  return (
    <div className="onqol-shell">
      <AppHeader locale={locale} onLocaleChange={setLocale} onBrandClick={handleBrandClick} />

      {flexible && flexibleAvailable ? <FlexiblePatientApp onExit={() => setFlexible(false)} /> : !session ? (
        <ModeSelection
          locale={locale}
          onSelect={handleSelectMode}
          resumeCandidate={resumeCandidate}
          onResume={resumeSession}
          onDiscard={discardPersistedSession}
          onFlexible={flexibleAvailable ? () => setFlexible(true) : null}
        />
      ) : (
        <div className="onqol-session-shell" data-turn={session.state.turn}>
          <div className="onqol-case-bar">
            <div>
              <span className="onqol-mono-label">{t(locale, "caseBar.presentation")}</span>
              <strong>{t(locale, `caseBar.mode.${session.state.session.mode}`)}</strong>
            </div>
          </div>

          <div className="onqol-workspace">
            <div className="onqol-chat-column">
              {debrief ? (
                <DebriefPanel
                  debrief={debrief}
                  onDownload={downloadExport}
                  onNewCase={() => { discardPersistedSession(); window.location.reload(); }}
                />
              ) : (
                <>
                  <ChatShell messages={messages} />
                  {busy && <div role="status" aria-live="polite" className="onqol-turn-status">{locale === "kk" ? "Өңделуде…" : "Обрабатывается…"}</div>}
                  <Composer locale={locale} disabled={busy} onSubmit={submitTurn} mentorEnabled={mentorEnabled} />
                </>
              )}
            </div>

            <SessionSidebar
              locale={locale}
              clockRoot={session.clockRoot}
              elapsedMinutes={session.state.clock.elapsedMinutes}
              vitalsSnapshot={learnerVisible?.physiologyKnownAt}
              constraints={learnerVisible?.revealedConstraints}
              onDownload={downloadExport}
            />
          </div>
        </div>
      )}
    </div>
  );
}

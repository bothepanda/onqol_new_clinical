import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { buildV35Case } from "./clinical/v35/createCase.js";
import { localDayStamp } from "./clinical/ids.js";
import { CASE_PRESETS } from "./clinical/v35/phenotypes.js";
import { enableFullClinicalTestCase } from "./clinical/testing/fullClinicalTest.js";
import { getBrowserContentForCase } from "./clinical/browserContentRegistry.js";
import {
  createSimulationRepository,
  getOrCreateAnonymousUserId,
} from "./clinical/simulationRepository.js";
import { createV25Case } from "./clinical/v25/caseFactory.js";
import { LEARNER_ADDRESS_FORM } from "./clinical/core/learnerAddress.js";
import {
  advanceV25Session,
  createV25Session,
} from "./clinical/v25/engine.js";
import {
  createKnowledgeBase,
} from "./clinical/v25/knowledgeBase.js";
import {
  createOpenAIBackendClient,
  getOpenAIBackendStatus,
} from "./clinical/v25/openAIBackendClient.js";
import {
  CLINICAL_REPORT_CATEGORIES,
  createClinicalReport,
  exportClinicalReports,
  listClinicalReports,
  saveClinicalReport,
} from "./clinical/governance/clinicalReport.js";
import { createScenarioSeed, resolveScenarioResource } from "./clinical/v25/scenarioEngine.js";
import { buildV25ReplayExport } from "./clinical/v25/replayExport.js";
import {
  PILOT_RU_REPORT_UI,
  PILOT_RU_UI,
  pilotRuActionStatus,
  pilotRuPhaseLabel,
} from "./pilot/ruRuntimeCopy.js";
import "./V25Trainer.css";

const ReactMarkdown = lazy(() => import("react-markdown"));

const MAIN_ACCESS_TOKEN_KEY = "onqol_main_access_token";
const PILOT_DATA_NOTICE_VERSION = "pilot-data-notice-2026-08-20";
const FULL_CLINICAL_TEST =
  import.meta.env.VITE_ONQOL_FULL_CLINICAL_TEST === "confirmed";
const LOCAL_FALLBACK_ALLOWED =
  import.meta.env.DEV &&
  import.meta.env.VITE_ONQOL_ALLOW_LOCAL_FALLBACK === "confirmed";

const INTERNAL_TEST_UI = Object.freeze({
  fullTestChip: "FULL CLINICAL TEST",
  fullTestTitle: "Локальный полный клинический тест",
  fullTestBody:
    "Открыты APP-005, невалидированная числовая оценка и действия, которые обычная версия блокирует до clinical review. Результаты нельзя использовать для оценки резидента.",
  preset: "Клинический пресет",
  randomPreset: "Случайный из всех, включая APP-005",
});

const UI = Object.freeze({ ...PILOT_RU_UI, ...INTERNAL_TEST_UI });

function actionLabel(actionId, caseData) {
  const action = [
    ...caseData.expected_actions,
    ...caseData.acceptable_alternatives,
    ...caseData.unnecessary_actions,
    ...caseData.unsafe_actions,
  ].find((item) => item.id === actionId);
  return action?.concept || actionId.replaceAll("_", " ");
}

function formatClock(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/**
 * The single header for every screen. Previously the title screen and the
 * session rendered two different brand lockups - a wordmark on one, a circular
 * badge plus sans-serif on the other - which read as two different products.
 */
function AppHeader({ actions = null }) {
  return (
    <header className="v25-classic-header">
      <button className="v25-classic-brand" onClick={() => window.location.reload()}>
        ON QOL
      </button>
      <span className="v25-classic-divider" />
      <span className="v25-classic-subtitle">{UI.subtitle}</span>
      <div className="v25-classic-controls">
        {actions}
        <div className="v25-classic-language" aria-label="Язык сессии">
          <span className="active">РУС</span>
        </div>
      </div>
    </header>
  );
}

function StartScreen({
  onStart,
  accessRequired,
  accessToken,
  onAccessTokenChange,
  fullClinicalTest,
  selectedPresetId,
  onPresetChange,
  backendStatus,
  canStart,
  consentAccepted,
  onConsentChange,
  addressForm,
  onAddressFormChange,
}) {
  const t = UI;
  return (
    <div className="v25-shell v25-classic-start-shell">
      <AppHeader />
      <main className="v25-classic-start">
        <h1>{t.landingTitle}</h1>
        <p className="v25-classic-lead">{t.landingBody}</p>

        {fullClinicalTest && (
          <section className="v25-full-test-panel" aria-label={t.fullTestTitle}>
            <strong>{t.fullTestTitle}</strong>
            <p>{t.fullTestBody}</p>
            <label>
              <span>{t.preset}</span>
              <select
                value={selectedPresetId}
                onChange={(event) => onPresetChange(event.target.value)}
              >
                <option value="">{t.randomPreset}</option>
                {CASE_PRESETS.map((preset) => (
                  <option key={preset.case_preset_id} value={preset.case_preset_id}>
                    {preset.case_preset_id} — {preset.title_ru}
                  </option>
                ))}
              </select>
            </label>
          </section>
        )}

        {accessRequired && (
          <label className="v25-access-code">
            <span>{t.accessCode}</span>
            <input
              type="password"
              autoComplete="off"
              value={accessToken}
              onChange={(event) => onAccessTokenChange(event.target.value)}
              placeholder={t.accessCodePlaceholder}
            />
            <small>{t.accessCodeHelp}</small>
          </label>
        )}

        <section className="v25-pilot-data-notice" aria-labelledby="v25-pilot-data-title">
          <strong id="v25-pilot-data-title">{t.pilotDataTitle}</strong>
          <p>{t.pilotDataBody}</p>
          <p>
            {t.pilotDataRetention}{" "}
            <a
              href="https://developers.openai.com/api/docs/guides/your-data"
              target="_blank"
              rel="noreferrer"
            >
              {t.providerPolicyLink}
            </a>
            .
          </p>
          <p>{t.pilotDataRestriction}</p>
          <label className="v25-pilot-consent">
            <input
              type="checkbox"
              checked={consentAccepted}
              onChange={(event) => onConsentChange(event.target.checked)}
            />
            <span>{t.pilotConsent}</span>
          </label>
        </section>

        <p className="v25-backend-status" role="status">
          {backendStatus.checking
            ? t.backendChecking
            : backendStatus.configured && backendStatus.accessGranted
              ? t.backendReady
              : backendStatus.accessRequired
                ? t.backendCodeRequired
                : t.backendUnavailable}
        </p>

        <fieldset className="v25-address-form" aria-label={t.addressFormRegionLabel}>
          <legend>{t.addressFormTitle}</legend>
          <p>{t.addressFormHelp}</p>
          <div className="v25-address-form-options">
            {[
              [LEARNER_ADDRESS_FORM.NEUTRAL, t.addressFormNeutral],
              [LEARNER_ADDRESS_FORM.FEMININE, t.addressFormFeminine],
              [LEARNER_ADDRESS_FORM.MASCULINE, t.addressFormMasculine],
            ].map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  name="v25-address-form"
                  value={value}
                  checked={addressForm === value}
                  onChange={() => onAddressFormChange(value)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <section className="v25-classic-mode-grid" aria-label={t.modeRegionLabel}>
          <button
            className="v25-classic-mode-card"
            onClick={onStart}
            disabled={!canStart}
            aria-disabled={!canStart}
          >
            <strong>{t.reference}</strong>
            <span>{t.referenceBody}</span>
          </button>
        </section>

      </main>
    </div>
  );
}

/**
 * The clinical error report dialog — governance §23.
 *
 * Deliberately small. Category, who is reporting, what is wrong, and optionally
 * the disputed sentence; everything else (session, versions, seed, last three
 * turns) is attached by the report module so the reporter does not have to
 * remember any of it.
 */
function ClinicalReportDialog({ onSubmit, onCancel }) {
  const t = PILOT_RU_REPORT_UI;
  const [categoryId, setCategoryId] = useState(CLINICAL_REPORT_CATEGORIES[0].id);
  const [role, setRole] = useState("unspecified");
  const [comment, setComment] = useState("");
  const [disputed, setDisputed] = useState("");
  const category = CLINICAL_REPORT_CATEGORIES.find((entry) => entry.id === categoryId);

  return (
    <div
      className="v25-report-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="v25-report-title"
    >
      <h3 id="v25-report-title">{t.title}</h3>
      <p className="v25-report-lead">{t.lead}</p>

      <label>
        <span>{t.category}</span>
        <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
          {CLINICAL_REPORT_CATEGORIES.map((entry) => (
            <option key={entry.id} value={entry.id}>{entry.label_ru}</option>
          ))}
        </select>
      </label>
      {category ? <small className="v25-report-hint">{category.hint_ru}</small> : null}

      <label>
        <span>{t.role}</span>
        <select value={role} onChange={(event) => setRole(event.target.value)}>
          {Object.entries(t.roles).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>

      <label>
        <span>{t.comment}</span>
        <textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder={t.commentPlaceholder}
          rows={3}
        />
      </label>

      <label>
        <span>{t.disputed}</span>
        <textarea
          value={disputed}
          onChange={(event) => setDisputed(event.target.value)}
          placeholder={t.disputedPlaceholder}
          rows={2}
        />
      </label>

      <div className="v25-report-actions">
        <button onClick={onCancel}>{t.cancel}</button>
        <button
          disabled={comment.trim().length < 3}
          onClick={() => onSubmit({ categoryId, reporterRole: role, comment, disputedContent: disputed })}
        >
          {t.submit}
        </button>
      </div>
    </div>
  );
}

function SessionSidebar({ session, caseData, onDownload, reportCount, onExportReports }) {
  const t = UI;
  const states = Object.values(session.workingMemory.actionStates).slice(-6);
  const revealed = session.workingMemory.revealedConstraints.map((resource) => {
    const resolution = resolveScenarioResource(
      session.scenario,
      resource,
      session.temporalState?.clockMinutes || 0
    );
    return resolution.revealText || `${resource}: доступен`;
  });
  return (
    <aside className="v25-sidebar">
      {/* The participant copies this into the feedback form, so it is the first
          thing in the sidebar and never behind a scroll. */}
      <section className="v25-side-section v25-session-code">
        <div className="v25-side-heading"><span>{t.sessionCode}</span></div>
        <code>{session.session_code}</code>
        <small>{t.sessionCodeHelp}</small>
      </section>

      <section className="v25-side-section v25-session-state">
        <div className="v25-side-heading"><span>{t.state}</span><b className="pulse-dot" /></div>
        <div className="v25-state-grid">
          <div><small>{t.clinicalTime}</small><strong>{formatClock(session.temporalState.clockMinutes)}</strong></div>
          <div><small>{t.phase}</small><strong>{pilotRuPhaseLabel(session.pathState || session.phase)}</strong></div>
        </div>
        <div className="v25-vitals">
          <span>ЧСС <b>{session.temporalState.heartRate}</b></span>
          {/* Decimal comma, same as the handoff and the labs. */}
          <span>T <b>{session.temporalState.temperatureC.toFixed(1).replace(".", ",")}</b></span>
          <span>Боль <b>{session.temporalState.painScore}/10</b></span>
        </div>
      </section>

      <section className="v25-side-section">
        <div className="v25-side-heading"><span>{t.actions}</span><small>{states.length}</small></div>
        {states.length ? (
          <div className="v25-memory-list">
            {states.map((state) => (
              <div key={state.action_id} className="v25-memory-item">
                <span>{actionLabel(state.action_id, caseData)}</span>
                <small className={`state-${state.status}`}>{pilotRuActionStatus(state.status)}</small>
              </div>
            ))}
          </div>
        ) : <p className="v25-empty">{t.noActions}</p>}
      </section>

      <section className="v25-side-section">
        <div className="v25-side-heading"><span>{t.known}</span><small>{revealed.length}</small></div>
        {revealed.length ? (
          <ul className="v25-constraint-list">{revealed.map((text, index) => <li key={index}>{text}</li>)}</ul>
        ) : <p className="v25-empty">{t.hidden}</p>}
      </section>

      <section className="v25-side-section v25-log-section">
        <div className="v25-side-heading"><span>{t.sessionData}</span><small>{session.eventLog.length} {t.records}</small></div>
        <button className="v25-download" onClick={onDownload}>{t.download} <span>↓</span></button>
        {reportCount > 0 && (
          <button className="v25-download" onClick={onExportReports}>
            {PILOT_RU_REPORT_UI.exportQueue} <small>{reportCount}</small>
          </button>
        )}
      </section>
    </aside>
  );
}

// One persistence path, behind an interface.
//
// This used to write straight to localStorage under its own key while
// simulationRepository.js kept a separate versioned store, so the app had two
// unrelated ways of remembering a run and no seam to put a server behind. The
// implementation is still local-only: nothing here makes the pilot's logging
// centralised or multi-user, and it should not be described that way.
const sessionRepository = createSimulationRepository();

function persistSession(session) {
  try {
    sessionRepository.saveSession(session);
  } catch {
    // Local persistence is best-effort in the vertical slice.
  }
}

/**
 * V3 is this component with the mentor on. Mentor-off behaviour remains
 * regression-testable through the component API, but no legacy mode or product
 * switch is exposed from the learner-facing entry point.
 */
export default function V25Trainer({ mentor = true }) {
  const [screen, setScreen] = useState("start");
  const locale = "ru";
  const [caseData, setCaseData] = useState(() => createV25Case());
  const [session, setSession] = useState(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirmInterrupt, setConfirmInterrupt] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportNotice, setReportNotice] = useState("");
  const [reportCount, setReportCount] = useState(() => listClinicalReports().length);
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [consentAccepted, setConsentAccepted] = useState(false);
  // Asked once, on the start screen, and nowhere else. Without it the mentor
  // resolves to NEUTRAL for most of a session and is pushed into the impersonal
  // register that made replay 91ba7206 read like a form. See core/learnerAddress.js.
  const [addressForm, setAddressForm] = useState(LEARNER_ADDRESS_FORM.NEUTRAL);
  const [openAIStatus, setOpenAIStatus] = useState({
    checking: true,
    configured: false,
    accessRequired: false,
    accessGranted: false,
    routerModel: "gpt-5.6-luna",
    simulatorModel: "gpt-5.6-terra",
  });
  const [accessToken, setAccessToken] = useState(
    () => sessionStorage.getItem(MAIN_ACCESS_TOKEN_KEY) || ""
  );
  const learnerId = useMemo(() => getOrCreateAnonymousUserId(), []);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  // Immediate repeat avoidance: which preset the last session used. Held in the
  // component rather than in the generator, which must stay a pure function of
  // its seed.
  const lastPresetIdRef = useRef(null);
  const t = UI;
  const modelBackendReady =
    openAIStatus.configured && openAIStatus.accessGranted === true;
  const canStart =
    consentAccepted &&
    !openAIStatus.checking &&
    (modelBackendReady || LOCAL_FALLBACK_ALLOWED);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session?.messages]);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => getOpenAIBackendStatus({ accessToken }).then((status) => {
      if (active) setOpenAIStatus({ ...status, checking: false });
    }), accessToken ? 180 : 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [accessToken]);

  function updateAccessToken(value) {
    setOpenAIStatus((status) => ({ ...status, checking: true, accessGranted: false }));
    setAccessToken(value);
    if (value) sessionStorage.setItem(MAIN_ACCESS_TOKEN_KEY, value);
    else sessionStorage.removeItem(MAIN_ACCESS_TOKEN_KEY);
  }

  function start() {
    if (!canStart) return;
    const params = new URLSearchParams(window.location.search);
    const seedOverride = params.get("seed")?.trim();
    const presetOverride = params.get("preset")?.trim();
    // The mentor needs the core library: consent, anaesthesia, escalation and
    // the prerequisite graph all live there, not in the disease card.
    //
    // V3 goes through the registry, so adding a second disease is a disease
    // module plus a registry entry - not an edit to this component. With one
    // reviewed case the selection returns the same case every time, which is the
    // honest outcome rather than faked variety.
    // One seed for the whole session: the same string reproduces the patient,
    // the facility and the shift. ONQOL_NORTH_STAR.md: "Каждый пациент
    // воспроизводим по seed."
    const sessionSeed = seedOverride || createScenarioSeed("reference");
    // V3.5 builds the patient from the case presets; V2.5 keeps its single fixed
    // patient so the mentor-off comparison stays a stable baseline.
    const built = mentor
      ? buildV35Case({
          seed: sessionSeed,
          locale,
          previousPresetId: lastPresetIdRef.current,
          requestedPresetId: FULL_CLINICAL_TEST
            ? presetOverride || selectedPresetId || null
            : null,
          mode: FULL_CLINICAL_TEST ? "internal_test" : "learner",
        })
      : null;
    if (built) lastPresetIdRef.current = built.selection.case_preset_id;
    const baseCase = built ? built.caseData : createV25Case(locale);
    const nextCase = FULL_CLINICAL_TEST
      ? enableFullClinicalTestCase(baseCase)
      : baseCase;
    const nextSession = createV25Session({
      caseData: nextCase,
      mode: "reference",
      seed: sessionSeed,
      locale,
      learnerId: `anon:${learnerId}`,
      institutionId: "synthetic-pilot",
      learnerAddressForm: addressForm,
      participantConsent: {
        accepted: true,
        policy_version: PILOT_DATA_NOTICE_VERSION,
        accepted_at: new Date().toISOString(),
        provider_processing_disclosed: true,
        provider_default_abuse_log_retention_days: 30,
        local_retention_days: 7,
      },
    });
    persistSession(nextSession);
    setCaseData(nextCase);
    setSession(nextSession);
    setInput("");
    setError("");
    setConfirmInterrupt(false);
    setScreen("session");
  }

  async function send(textOverride) {
    const text = (textOverride || input).trim();
    if (!text || !session || session.finished || loading) return;
    setLoading(true);
    setError("");
    try {
      const actionExtractorLLM = modelBackendReady
        ? createOpenAIBackendClient({ task: "router", accessToken, sessionId: session.session_id })
        : null;
      const simulatorLLM = modelBackendReady
        ? createOpenAIBackendClient({ task: "simulator", accessToken, sessionId: session.session_id })
        : null;
      // The mentor falls back to authored text when no key is configured, so
      // it stays useful offline - it just phrases things more stiffly.
      const mentorLLM = mentor && modelBackendReady
        ? createOpenAIBackendClient({ task: "mentor", accessToken, sessionId: session.session_id })
        : null;
      // From the active case, never a literal id. A second disease would
      // otherwise be handed appendicitis's disease card and retrieval package
      // with nothing on screen saying so.
      const browserContent = getBrowserContentForCase(
        caseData.browser_content_key || caseData.case_id
      );
      const result = await advanceV25Session({
        caseData,
        session,
        input: text,
        knowledgeBase: createKnowledgeBase(),
        options: {
          actionExtractorLLM,
          simulatorLLM,
          locale,
          conceptMap: caseData.v3_concept_map || browserContent.conceptMap,
          conceptRegistry: browserContent.conceptRegistry,
          diseaseCard: browserContent.diseaseCard,
          provider: simulatorLLM ? "openai" : "local",
          model: simulatorLLM ? openAIStatus.simulatorModel : null,
          routerModel: actionExtractorLLM ? openAIStatus.routerModel : null,
          mentorModel: mentorLLM ? openAIStatus.mentorModel : null,
          gatewayVersion: openAIStatus.gatewayVersion || null,
          schemaVersions: openAIStatus.schemas || null,
          mentor,
          mentorLLM,
          fullClinicalTest: FULL_CLINICAL_TEST,
        },
      });
      persistSession(result.session);
      setSession(result.session);
      setInput("");
    } catch {
      setError(t.requestError);
    } finally {
      setLoading(false);
    }
  }

  function restart() {
    setSession(null);
    setInput("");
    setError("");
    setConfirmInterrupt(false);
    setScreen("start");
  }

  function interruptSession() {
    setConfirmInterrupt(false);
    send("конец кейса");
  }

  // A report never touches the session: it is written next to it, so a failure
  // here cannot cost the learner their case.
  function submitClinicalReport({ categoryId, reporterRole, comment, disputedContent }) {
    const { ok, report } = createClinicalReport({
      caseData,
      session,
      categoryId,
      comment,
      reporterRole,
      disputedContent: disputedContent || null,
    });
    if (!ok) return;
    try {
      saveClinicalReport(report);
      setReportCount(listClinicalReports().length);
      setReportNotice(PILOT_RU_REPORT_UI.saved);
    } catch {
      // Local storage is best-effort, exactly like session persistence.
    }
    setReportOpen(false);
  }

  function downloadReports() {
    const payload = exportClinicalReports();
    downloadJson(payload, `onqol-clinical-reports-${localDayStamp()}.json`);
  }

  function downloadJson(payload, filename) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadLog() {
    if (!session) return;
    downloadJson(
      buildV25ReplayExport(session, new Date().toISOString(), {
        clinicalReports: listClinicalReports(),
      }),
      `onqol-replay-${session.session_id}.json`
    );
  }

  function onKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  if (screen === "start") {
    return (
      <StartScreen
        onStart={start}
        accessRequired={openAIStatus.accessRequired}
        accessToken={accessToken}
        onAccessTokenChange={updateAccessToken}
        fullClinicalTest={FULL_CLINICAL_TEST}
        selectedPresetId={selectedPresetId}
        onPresetChange={setSelectedPresetId}
        backendStatus={openAIStatus}
        canStart={canStart}
        consentAccepted={consentAccepted}
        onConsentChange={setConsentAccepted}
        addressForm={addressForm}
        onAddressFormChange={setAddressForm}
      />
    );
  }

  return (
    <div className="v25-shell v25-session-shell">
      <AppHeader
        actions={
          <span className="v25-version-chip">
            {FULL_CLINICAL_TEST ? t.fullTestChip : mentor ? t.alpha : "V2.5 · без наставника"}
          </span>
        }
      />
      <div className="v25-case-bar">
        <div>
          <span>{t.case}</span>
          <strong>{caseData.title}</strong>
        </div>
        <div className="v25-case-meta">
          <span className={`v25-mode-pill mode-${session.scenario.mode}`}>
            {t.referenceShort}
          </span>
          <small>{t.synthetic}</small>
        </div>
      </div>

      {FULL_CLINICAL_TEST && (
        <div className="v25-full-test-strip">
          {t.fullTestTitle}: clinical gates bypassed · результаты невалидированы
        </div>
      )}

      <main className="v25-workspace">
        <section className="v25-chat-column">
          {!modelBackendReady && <div className="v25-local-notice">{t.localNotice}</div>}
          <div className="v25-messages">
            {session.messages.map((message, index) => (
              <article key={index} className={`v25-message v25-message-${message.role}`}>
                {message.role === "assistant" ? (
                  <Suspense fallback={<span>{message.content}</span>}>
                    <ReactMarkdown>{message.content}</ReactMarkdown>
                  </Suspense>
                ) : message.content}
              </article>
            ))}
            {loading && <div className="v25-thinking"><i /><i /><i /><span>{t.loading}</span></div>}
            <div ref={bottomRef} />
          </div>

          {error && (
            <div className="v25-error" role="alert">
              <span>{error}</span>
              <button onClick={() => send()} disabled={loading}>{t.retry}</button>
            </div>
          )}
          <div className="v25-composer-area">
            {confirmInterrupt && (
              <div className="v25-interrupt-confirm" role="dialog" aria-modal="true" aria-labelledby="v25-interrupt-title">
                <p id="v25-interrupt-title">{t.finishConfirm}</p>
                <div>
                  <button onClick={() => setConfirmInterrupt(false)}>{t.cancel}</button>
                  <button onClick={interruptSession}>{t.finishConfirmAction}</button>
                </div>
              </div>
            )}
            {reportOpen && (
              <ClinicalReportDialog
                onSubmit={submitClinicalReport}
                onCancel={() => setReportOpen(false)}
              />
            )}
            {reportNotice && (
              <p className="v25-report-notice" role="status">{reportNotice}</p>
            )}
            <div className="v25-session-actions">
              <button onClick={() => setConfirmInterrupt(true)} disabled={loading || session.finished}>{t.finish}</button>
              <button onClick={restart}>{t.restart}</button>
              <button
                onClick={() => { setReportNotice(""); setReportOpen(true); }}
                disabled={reportOpen}
              >
                {PILOT_RU_REPORT_UI.open}
              </button>
            </div>
            <div className="v25-composer">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder={t.placeholder}
                disabled={loading || session.finished}
                rows={1}
              />
              <button onClick={() => send()} disabled={!input.trim() || loading || session.finished} aria-label={t.send}>↗</button>
            </div>
          </div>
        </section>

        <SessionSidebar
          session={session}
          caseData={caseData}
          onDownload={downloadLog}
          reportCount={reportCount}
          onExportReports={downloadReports}
        />
      </main>
    </div>
  );
}

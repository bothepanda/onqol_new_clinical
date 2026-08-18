import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { buildV35Case } from "./clinical/v35/createCase.js";
import { CASE_PRESETS } from "./clinical/v35/phenotypes.js";
import { enableFullClinicalTestCase } from "./clinical/testing/fullClinicalTest.js";
import { getBrowserContentForCase } from "./clinical/browserContentRegistry.js";
import {
  createSimulationRepository,
  getOrCreateAnonymousUserId,
} from "./clinical/simulationRepository.js";
import { createV25Case } from "./clinical/v25/caseFactory.js";
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
import { createScenarioSeed, resolveScenarioResource } from "./clinical/v25/scenarioEngine.js";
import { buildV25ReplayExport } from "./clinical/v25/replayExport.js";
import "./V25Trainer.css";

const ReactMarkdown = lazy(() => import("react-markdown"));

const MAIN_ACCESS_TOKEN_KEY = "onqol_main_access_token";
const FULL_CLINICAL_TEST =
  import.meta.env.VITE_ONQOL_FULL_CLINICAL_TEST === "confirmed";

const UI = {
  ru: {
    subtitle: "Клинический симулятор",
    alpha: "V3 · vertical slice",
    landingTitle: "Как вы сегодня работаете?",
    landingBody: "Экстренная абдоминальная хирургия. Выберите формат смены.",
    reference: "Эталонные условия",
    referenceBody: "Полный ресурс. Тактика ровно та, что в руководстве.",
    real: "Реальная смена",
    realBody: "Обстоятельства ночи выпадают вместе со случаем.",
    case: "Экстренная абдоминальная хирургия",
    referenceShort: "Эталон",
    realShort: "Реальная смена",
    synthetic: "Синтетический профиль; не представляет конкретную больницу",
    state: "Состояние сессии",
    clinicalTime: "Клиническое время",
    phase: "Фаза",
    memory: "Рабочая память",
    noActions: "Зафиксированных действий пока нет",
    known: "Что уже известно о смене",
    hidden: "Ограничения пока не раскрыты",
    log: "Событийный лог",
    events: "событий",
    download: "Скачать JSON",
    finish: "Прервать сессию",
    finishConfirm: "Прервать сессию? Она будет отмечена как незавершённая, без оценки.",
    finishConfirmAction: "Да, прервать",
    cancel: "Продолжить кейс",
    restart: "Новая смена",
    placeholder: "Что ты спрашиваешь или делаешь?",
    send: "Отправить",
    loading: "Выполняю запрос…",
    localNotice:
      "OpenAI backend не настроен: временно работает ограниченный локальный matcher.",
    accessCode: "Код доступа к серверному интерпретатору",
    accessCodePlaceholder: "Введите внутренний код",
    accessCodeHelp: "Код хранится только до закрытия этой вкладки.",
    fullTestChip: "FULL CLINICAL TEST",
    fullTestTitle: "Локальный полный клинический тест",
    fullTestBody:
      "Открыты APP-005, невалидированная числовая оценка и действия, которые обычная версия блокирует до clinical review. Результаты нельзя использовать для оценки резидента.",
    preset: "Клинический пресет",
    randomPreset: "Случайный из всех, включая APP-005",
  },
  kk: {
    subtitle: "Клиникалық симулятор",
    alpha: "V3 · сынақ нұсқасы",
    landingTitle: "Бүгін қалай жұмыс істейсіз?",
    landingBody: "Шұғыл абдоминалдық хирургия. Кезекшілік форматын таңдаңыз.",
    reference: "Эталондық жағдай",
    referenceBody: "Толық ресурс. Тактика нұсқаулыққа дәл сәйкес келеді.",
    real: "Нақты кезекшілік",
    realBody: "Түнгі кезекшіліктің жағдайлары кейспен бірге анықталады.",
    case: "Шұғыл абдоминалдық хирургия",
    referenceShort: "Эталон",
    realShort: "Нақты кезекшілік",
    synthetic: "Синтетикалық профиль; нақты аурухананы көрсетпейді",
    state: "Сессия жағдайы",
    clinicalTime: "Клиникалық уақыт",
    phase: "Кезең",
    memory: "Жұмыс жады",
    noActions: "Әзірге әрекет тіркелмеген",
    known: "Кезекшілік туралы белгілі деректер",
    hidden: "Шектеулер әлі ашылған жоқ",
    log: "Оқиғалар журналы",
    events: "оқиға",
    download: "JSON жүктеу",
    finish: "Сессияны тоқтату",
    finishConfirm: "Сессияны тоқтату керек пе? Ол бағалаусыз, аяқталмаған деп белгіленеді.",
    finishConfirmAction: "Иә, тоқтату",
    cancel: "Кейсті жалғастыру",
    restart: "Жаңа кезекшілік",
    placeholder: "Не сұрайсың немесе не істейсің?",
    send: "Жіберу",
    loading: "Сұрауды орындаймын…",
    localNotice:
      "OpenAI backend бапталмаған: уақытша шектеулі жергілікті matcher жұмыс істейді.",
    accessCode: "Серверлік интерпретаторға кіру коды",
    accessCodePlaceholder: "Ішкі кодты енгізіңіз",
    accessCodeHelp: "Код осы қойынды жабылғанға дейін ғана сақталады.",
    fullTestChip: "FULL CLINICAL TEST",
    fullTestTitle: "Жергілікті толық клиникалық тест",
    fullTestBody:
      "APP-005, тексерілмеген сандық бағалау және clinical review-ға дейін жабық әрекеттер ашық. Нәтижелер резидентті бағалауға жарамсыз.",
    preset: "Клиникалық пресет",
    randomPreset: "Барлығынан кездейсоқ, APP-005 қоса",
  },
};

function phaseLabel(phase, locale) {
  const labels = {
    ru: {
      ems_handoff: "Передача пациента",
      data_gathering: "Сбор данных",
      presentation: "Первичная оценка",
      diagnostic_workup: "Диагностика",
      decision: "Решение",
      post_source_control: "После контроля источника",
      operation: "Операция завершена",
      postop_destination: "Послеоперационный маршрут",
      ward_care: "Послеоперационное наблюдение",
      discharge: "Выписка и наблюдение",
    },
    kk: {
      ems_handoff: "Пациентті тапсыру",
      data_gathering: "Деректер жинау",
      presentation: "Бастапқы бағалау",
      diagnostic_workup: "Диагностика",
      decision: "Шешім",
      post_source_control: "Инфекция ошағын бақылаудан кейін",
      operation: "Операция аяқталды",
      postop_destination: "Операциядан кейінгі бағыт",
      ward_care: "Операциядан кейінгі бақылау",
      discharge: "Шығару және бақылау",
    },
  };
  return labels[locale][phase] || phase;
}

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
function AppHeader({ locale, setLocale, actions = null }) {
  return (
    <header className="v25-classic-header">
      <button className="v25-classic-brand" onClick={() => window.location.reload()}>
        ON QOL
      </button>
      <span className="v25-classic-divider" />
      <span className="v25-classic-subtitle">{UI[locale].subtitle}</span>
      <div className="v25-classic-controls">
        {actions}
        <div className="v25-classic-language" aria-label="Language">
          <button className={locale === "ru" ? "active" : ""} onClick={() => setLocale("ru")}>
            РУС
          </button>
          <button
            className={locale === "kk" ? "active" : ""}
            disabled
            title="Казахская клиническая редакция ожидает языковую проверку"
          >
            ҚАЗ · REVIEW
          </button>
        </div>
      </div>
    </header>
  );
}

function StartScreen({
  locale,
  setLocale,
  onStart,
  accessRequired,
  accessToken,
  onAccessTokenChange,
  fullClinicalTest,
  selectedPresetId,
  onPresetChange,
}) {
  const t = UI[locale];
  return (
    <div className="v25-shell v25-classic-start-shell">
      <AppHeader locale={locale} setLocale={setLocale} />
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

        <section className="v25-classic-mode-grid" aria-label="Simulation mode">
          <button
            className="v25-classic-mode-card"
            onClick={() => onStart("reference")}
          >
            <strong>{t.reference}</strong>
            <span>{t.referenceBody}</span>
          </button>
          <button
            className="v25-classic-mode-card"
            onClick={() => onStart("real")}
          >
            <strong>{t.real}</strong>
            <span>{t.realBody}</span>
          </button>
        </section>

      </main>
    </div>
  );
}

function SessionSidebar({ session, caseData, locale, onDownload }) {
  const t = UI[locale];
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
      <section className="v25-side-section v25-session-state">
        <div className="v25-side-heading"><span>{t.state}</span><b className="pulse-dot" /></div>
        <div className="v25-state-grid">
          <div><small>{t.clinicalTime}</small><strong>{formatClock(session.temporalState.clockMinutes)}</strong></div>
          <div><small>{t.phase}</small><strong>{phaseLabel(session.pathState || session.phase, locale)}</strong></div>
        </div>
        <div className="v25-vitals">
          <span>HR <b>{session.temporalState.heartRate}</b></span>
          {/* Decimal comma, same as the handoff and the labs. */}
          <span>T <b>{session.temporalState.temperatureC.toFixed(1).replace(".", ",")}</b></span>
          <span>PAIN <b>{session.temporalState.painScore}/10</b></span>
        </div>
      </section>

      <section className="v25-side-section">
        <div className="v25-side-heading"><span>{t.memory}</span><small>{states.length}</small></div>
        {states.length ? (
          <div className="v25-memory-list">
            {states.map((state) => (
              <div key={state.action_id} className="v25-memory-item">
                <span>{actionLabel(state.action_id, caseData)}</span>
                <small className={`state-${state.status}`}>{state.status}</small>
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
        <div className="v25-side-heading"><span>{t.log}</span><small>{session.eventLog.length} {t.events}</small></div>
        <button className="v25-download" onClick={onDownload}>{t.download} <span>↓</span></button>
        <code>seed: {session.scenario.seed}</code>
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
  const [locale, setLocale] = useState("ru");
  const [caseData, setCaseData] = useState(() => createV25Case());
  const [session, setSession] = useState(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirmInterrupt, setConfirmInterrupt] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [openAIStatus, setOpenAIStatus] = useState({
    checking: true,
    configured: false,
    accessRequired: false,
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
  const t = UI[locale];
  const modelBackendReady =
    openAIStatus.configured && (!openAIStatus.accessRequired || Boolean(accessToken));

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session?.messages]);

  useEffect(() => {
    let active = true;
    getOpenAIBackendStatus().then((status) => {
      if (active) setOpenAIStatus({ ...status, checking: false });
    });
    return () => { active = false; };
  }, []);

  function updateAccessToken(value) {
    setAccessToken(value);
    if (value) sessionStorage.setItem(MAIN_ACCESS_TOKEN_KEY, value);
    else sessionStorage.removeItem(MAIN_ACCESS_TOKEN_KEY);
  }

  function start(mode) {
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
    const sessionSeed = seedOverride || createScenarioSeed(mode === "real" ? "real" : "reference");
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
      mode,
      seed: sessionSeed,
      locale,
      learnerId: `anon:${learnerId}`,
      institutionId: "synthetic-pilot",
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
    } catch (caught) {
      setError(caught.message || "Simulation error");
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
    send(locale === "kk" ? "кейс соңы" : "конец кейса");
  }

  function downloadLog() {
    if (!session) return;
    const payload = buildV25ReplayExport(session);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `onqol-replay-${session.session_id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
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
        locale={locale}
        setLocale={setLocale}
        onStart={start}
        accessRequired={openAIStatus.accessRequired}
        accessToken={accessToken}
        onAccessTokenChange={updateAccessToken}
        fullClinicalTest={FULL_CLINICAL_TEST}
        selectedPresetId={selectedPresetId}
        onPresetChange={setSelectedPresetId}
      />
    );
  }

  return (
    <div className="v25-shell v25-session-shell">
      <AppHeader
        locale={locale}
        setLocale={setLocale}
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
            {session.scenario.mode === "reference" ? t.referenceShort : t.realShort}
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

          {error && <div className="v25-error">{error}</div>}
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
            <div className="v25-session-actions">
              <button onClick={() => setConfirmInterrupt(true)} disabled={loading || session.finished}>{t.finish}</button>
              <button onClick={restart}>{t.restart}</button>
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

        <SessionSidebar session={session} caseData={caseData} locale={locale} onDownload={downloadLog} />
      </main>
    </div>
  );
}

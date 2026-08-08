import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { getBrowserContentForCase } from "./clinical/browserContentRegistry.js";
import { selectCase } from "./clinical/caseRegistry.js";
import { advanceCaseWithSimulator, createInitialSession } from "./clinical/caseEngine.js";
import { createAnthropicBrowserClient } from "./clinical/semanticRouter.js";
import {
  buildSessionRecord,
  buildTurnEvents,
  createSimulationEvent,
  snapshotSimulatorState,
} from "./clinical/simulationEvents.js";
import {
  createSimulationRepository,
  getOrCreateAnonymousUserId,
} from "./clinical/simulationRepository.js";

const CLINICAL_MODEL = "claude-haiku-4-5-20251001";
const MODEL_INFO = Object.freeze({
  provider: "anthropic",
  model: CLINICAL_MODEL,
  version: "2025-10-01",
});

const C = {
  bg: "#f2f7f8",
  surface: "#ffffff",
  accent: "#16697A",
  accentLight: "#eaf4f6",
  text: "#0d2124",
  textMid: "#3a7a84",
  textSub: "#8ab8be",
  border: "rgba(22,105,122,0.15)",
  borderMid: "rgba(22,105,122,0.25)",
  userMsg: "#16697A",
  userText: "#ffffff",
};

function selectionRequestFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const locale = params.get("lang") === "kk" ? "kk" : "ru";
  return {
    locale,
    seed: params.get("seed") || undefined,
    requestedCaseId: params.get("case_id") || undefined,
    filters: {
      specialty: params.get("specialty") || undefined,
      difficulty: params.get("difficulty") || undefined,
      trainingLevel: params.get("training_level") || undefined,
      resourceSetting: params.get("resource_setting") || undefined,
      language: locale,
    },
  };
}

function isDeveloperMode() {
  const params = new URLSearchParams(window.location.search);
  return params.get("dev") === "1" || localStorage.getItem("onqol_dev_mode") === "1";
}

function persistEvents(repository, events) {
  for (const event of events) repository.appendEvent(event);
}

function abandonSession(repository, session) {
  if (!session || session.finished || session.completion_status !== "in_progress") return;
  const completedAt = new Date().toISOString();
  const abandonedState = {
    ...session,
    completed_at: completedAt,
    completion_status: "abandoned",
  };
  repository.appendEvent(
    createSimulationEvent("case_abandoned", session.session_id, {
      simulator_state_before: snapshotSimulatorState(session),
      simulator_state_after: snapshotSimulatorState(abandonedState),
    })
  );
  repository.completeSession(session.session_id, {
    completed_at: completedAt,
    completion_status: "abandoned",
  });
}

function phaseLabel(phase) {
  const labels = {
    presentation: "Презентация",
    diagnosis: "Диагноз",
    management: "Тактика",
    ready_to_finish: "Готов к разбору",
    report: "Отчёт",
  };
  return labels[phase] || phase;
}

function Progress({ session }) {
  const items = [
    ["presentation", "1"],
    ["diagnosis", "2"],
    ["management", "3"],
    ["ready_to_finish", "4"],
    ["report", "5"],
  ];
  const activeIndex = Math.max(0, items.findIndex(([phase]) => phase === session.phase));

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      {items.map(([phase, n], index) => (
        <span
          key={phase}
          style={{
            width: 24,
            height: 24,
            borderRadius: 4,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            fontWeight: 700,
            background: index <= activeIndex ? C.accent : C.accentLight,
            color: index <= activeIndex ? "#fff" : C.textMid,
          }}
          title={phaseLabel(phase)}
        >
          {n}
        </span>
      ))}
      <span style={{ fontSize: 12, color: C.textMid, letterSpacing: "0.05em" }}>
        {phaseLabel(session.phase)}
      </span>
    </div>
  );
}

function DeveloperMetadata({ session }) {
  return (
    <div
      style={{
        background: "#fbfdfe",
        borderBottom: `1px solid ${C.border}`,
        color: C.textMid,
        fontSize: 11,
        lineHeight: 1.6,
        padding: "8px 20px",
      }}
    >
      Case: {session.case_id} v{session.case_version} · Disease Card: {session.disease_card_id} v
      {session.disease_card_version} · Rubric: v{session.scoring_rubric_version} · Router: v
      {session.router_version}
    </div>
  );
}

function Header({ onOpenV1 }) {
  return (
    <>
      <style>{`
        @media (max-width: 600px) {
          .onqol-header { padding: 12px 14px !important; gap: 10px !important; }
          .onqol-header-divider, .onqol-header-subtitle { display: none !important; }
          .onqol-header-controls { gap: 8px !important; }
          .onqol-language button { padding-left: 11px !important; padding-right: 11px !important; }
          .onqol-case-header { grid-template-columns: minmax(0, 1fr) !important; align-items: start !important; }
        }
      `}</style>
      <div
      className="onqol-header"
      style={{
        borderBottom: `1px solid ${C.border}`,
        padding: "16px 24px",
        display: "flex",
        alignItems: "center",
        gap: 18,
        background: C.surface,
        boxShadow: "0 1px 3px rgba(22,105,122,0.06)",
      }}
    >
      <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: "0.18em", color: C.accent }}>
        ON QOL
      </span>
      <div className="onqol-header-divider" style={{ width: 1, height: 36, background: C.borderMid }} />
      <span className="onqol-header-subtitle" style={{ fontSize: 16, color: C.textMid, letterSpacing: "0.02em" }}>
        Тренажёр клинических кейсов
      </span>
      <div className="onqol-header-controls" style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "center" }}>
        <button
          onClick={onOpenV1}
          title="Открыть V1"
          style={{
            width: 46,
            height: 42,
            border: `1px solid ${C.borderMid}`,
            background: C.surface,
            color: C.textMid,
            borderRadius: 8,
            fontFamily: "inherit",
            fontSize: 18,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          ⇄
        </button>
        <div
          className="onqol-language"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            border: `1px solid ${C.borderMid}`,
            borderRadius: 8,
            overflow: "hidden",
            height: 42,
          }}
        >
          <button
            style={{
              border: "none",
              background: C.accent,
              color: "#fff",
              padding: "0 16px",
              fontFamily: "inherit",
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "0.12em",
            }}
          >
            РУС
          </button>
          <button
            title="Казахская локаль требует клинической языковой проверки"
            style={{
              border: "none",
              borderLeft: `1px solid ${C.borderMid}`,
              background: C.surface,
              color: C.textMid,
              padding: "0 16px",
              fontFamily: "inherit",
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "0.12em",
            }}
          >
            ҚАЗ
          </button>
        </div>
      </div>
      </div>
    </>
  );
}

function StartScreen({
  apiKey,
  apiKeyDraft,
  setApiKeyDraft,
  saveApiKey,
  onStart,
  onOpenV1,
  startError,
}) {
  return (
    <div
      style={{
        fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
        background: C.bg,
        minHeight: "100vh",
        color: C.text,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Header onOpenV1={onOpenV1} />
      <main
        style={{
          width: "min(100%, 900px)",
          margin: "0 auto",
          padding: "38px 28px 28px",
          boxSizing: "border-box",
        }}
      >
        <h1
          style={{
            margin: "0 0 18px",
            color: C.accent,
            fontSize: 40,
            lineHeight: 1.15,
            fontWeight: 700,
            letterSpacing: 0,
          }}
        >
          Как вы сегодня работаете?
        </h1>
        <p
          style={{
            margin: "0 0 34px",
            color: C.textMid,
            fontSize: 22,
            lineHeight: 1.45,
            letterSpacing: 0,
            maxWidth: 760,
          }}
        >
          Экстренная абдоминальная хирургия. Содержание сверено с WSES 2025 и КП МЗ РК 2018.
        </p>

        {!apiKey && (
          <div
            style={{
              background: C.surface,
              border: `1px solid ${C.borderMid}`,
              borderRadius: 8,
              padding: "18px 20px",
              marginBottom: 18,
              display: "grid",
              gap: 10,
            }}
          >
            <div style={{ color: C.accent, fontWeight: 700, fontSize: 15 }}>
              Ключ клинической модели
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="password"
                value={apiKeyDraft}
                onChange={(event) => setApiKeyDraft(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && saveApiKey()}
                placeholder="sk-ant-..."
                style={{
                  flex: 1,
                  border: `1px solid ${C.border}`,
                  background: C.bg,
                  borderRadius: 4,
                  padding: "10px 12px",
                  fontFamily: "inherit",
                  fontSize: 13,
                  color: C.text,
                }}
              />
              <button
                onClick={saveApiKey}
                style={{
                  border: "none",
                  background: C.accent,
                  color: "#fff",
                  borderRadius: 4,
                  padding: "0 14px",
                  fontFamily: "inherit",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Сохранить
              </button>
            </div>
            <div style={{ color: C.textSub, fontSize: 12, lineHeight: 1.5 }}>
              Ключ хранится только в этом браузере. Данные пациента и итоговая оценка берутся из версии активного кейса.
            </div>
          </div>
        )}

        <div style={{ display: "grid", gap: 18 }}>
          <button
            disabled
            title="Этот режим появится после enhanced/full-resource ветки кейса"
            style={{
              textAlign: "left",
              background: C.surface,
              border: `1px solid ${C.borderMid}`,
              borderRadius: 8,
              padding: "28px 30px",
              fontFamily: "inherit",
              color: C.text,
              opacity: 0.68,
              cursor: "not-allowed",
            }}
          >
            <div style={{ color: C.accent, fontSize: 26, fontWeight: 700, lineHeight: 1.2, marginBottom: 18 }}>
              Эталонные условия
            </div>
            <div style={{ color: C.textMid, fontSize: 20, lineHeight: 1.45 }}>
              Полный ресурс. Тактика ровно та, что в руководстве.
            </div>
          </button>

          <button
            onClick={onStart}
            disabled={!apiKey}
            style={{
              textAlign: "left",
              background: C.surface,
              border: `1px solid ${C.borderMid}`,
              borderRadius: 8,
              padding: "28px 30px",
              fontFamily: "inherit",
              color: C.text,
              cursor: apiKey ? "pointer" : "not-allowed",
              boxShadow: "0 1px 4px rgba(22,105,122,0.06)",
              opacity: apiKey ? 1 : 0.68,
            }}
          >
            <div style={{ color: C.accent, fontSize: 26, fontWeight: 700, lineHeight: 1.2, marginBottom: 18 }}>
              Реальная смена
            </div>
            <div style={{ color: C.textMid, fontSize: 20, lineHeight: 1.45 }}>
              Обстоятельства ночи выпадают вместе со случаем.
            </div>
          </button>
        </div>

        {startError && (
          <div style={{ color: "#c0392b", fontSize: 12, lineHeight: 1.5, marginTop: 14 }}>
            {startError}
          </div>
        )}
      </main>
    </div>
  );
}

export default function V2Trainer({ onOpenV1 }) {
  const [screen, setScreen] = useState("start");
  const [activeCase, setActiveCase] = useState(null);
  const [session, setSession] = useState(null);
  const [input, setInput] = useState("");
  const [lastParsed, setLastParsed] = useState(null);
  const [loading, setLoading] = useState(false);
  const [routerError, setRouterError] = useState("");
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("onqol_api_key") || "");
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [repository] = useState(() => createSimulationRepository());
  const [anonymousUserId] = useState(() => getOrCreateAnonymousUserId());
  const [developerMode] = useState(isDeveloperMode);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session?.messages]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + "px";
    }
  }, [input]);

  useEffect(() => {
    if (!session || session.finished || session.completion_status !== "in_progress") return undefined;
    const handlePageHide = () => abandonSession(repository, session);
    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, [repository, session]);

  function saveApiKey() {
    const key = apiKeyDraft.trim();
    if (!key) return;
    localStorage.setItem("onqol_api_key", key);
    setApiKey(key);
    setApiKeyDraft("");
    setRouterError("");
  }

  function startCase() {
    setRouterError("");
    try {
      const request = selectionRequestFromUrl();
      const lastCaseKey = `onqol_last_case_id:${anonymousUserId}`;
      const selected = selectCase({
        category: "emergency_surgery",
        ...request,
        previousCaseId: localStorage.getItem(lastCaseKey) || undefined,
      });
      const nextSession = createInitialSession(selected.caseData, {
        anonymousUserId,
        locale: request.locale,
        routerVersion: selected.caseData.router_version,
        selection: selected.selection,
      });

      repository.createSession(buildSessionRecord(nextSession));
      repository.appendEvent(
        createSimulationEvent("case_started", nextSession.session_id, {
          simulator_state_after: snapshotSimulatorState(nextSession),
          model_info: MODEL_INFO,
        })
      );
      localStorage.setItem(lastCaseKey, selected.caseData.case_id);
      setActiveCase(selected.caseData);
      setSession(nextSession);
      setLastParsed(null);
      setInput("");
      setScreen("session");
    } catch (error) {
      setRouterError(error.message);
    }
  }

  async function send(textOverride) {
    const text = (textOverride || input).trim();
    if (!text || !session || !activeCase || session.finished || loading) return;
    setLoading(true);
    setRouterError("");
    try {
      const clinicalContent = getBrowserContentForCase(activeCase.case_id);
      const llm = createAnthropicBrowserClient({ apiKey, model: CLINICAL_MODEL });
      const result = await advanceCaseWithSimulator(activeCase, session, text, {
        actionExtractorLLM: llm,
        simulatorLLM: llm,
        locale: session.locale,
        conceptMap: clinicalContent.conceptMap,
        diseaseCard: clinicalContent.diseaseCard,
        retrievalCorpus: clinicalContent.retrievalCorpus,
        modelInfo: MODEL_INFO,
      });
      persistEvents(repository, buildTurnEvents(session, result, text, MODEL_INFO));
      if (result.session.finished) {
        repository.completeSession(result.session.session_id, {
          completed_at: result.session.completed_at,
          completion_status: "completed",
          overall_score: result.session.scoring.overallScore,
          domain_scores: result.session.scoring.domainScores,
          critical_errors_count: result.session.scoring.criticalErrors.length,
        });
      }
      setSession(result.session);
      setLastParsed(result.parsed);
      setInput("");
    } catch (error) {
      const eventType = /router|extract|json|model api/i.test(error.message)
        ? "parser_failure"
        : "system_error";
      repository.appendEvent(
        createSimulationEvent(eventType, session.session_id, {
          raw_user_text: text,
          simulator_state_before: snapshotSimulatorState(session),
          simulator_state_after: snapshotSimulatorState(session),
          model_info: MODEL_INFO,
          error_code: error.name || "simulation_error",
        })
      );
      setRouterError(error.message);
    } finally {
      setLoading(false);
    }
  }

  function restart() {
    abandonSession(repository, session);
    setSession(null);
    setActiveCase(null);
    setLastParsed(null);
    setInput("");
    setRouterError("");
    setScreen("start");
  }

  function openV1() {
    abandonSession(repository, session);
    onOpenV1();
  }

  function handleKey(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const parsedLabels = (lastParsed?.actions || [])
    .filter((action) => action.id !== "end_case")
    .map((action) => action.id);

  if (screen === "start") {
    return (
      <StartScreen
        apiKey={apiKey}
        apiKeyDraft={apiKeyDraft}
        setApiKeyDraft={setApiKeyDraft}
        saveApiKey={saveApiKey}
        onStart={startCase}
        onOpenV1={openV1}
        startError={routerError}
      />
    );
  }

  if (!session || !activeCase) return null;

  return (
    <div
      style={{
        fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
        background: C.bg,
        minHeight: "100vh",
        color: C.text,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;700&display=swap');
        textarea::placeholder { color: #a8cfd5; }
        .clinical-report h1 { font-size: 16px; color: ${C.accent}; margin: 0 0 12px; }
        .clinical-report p { margin: 0 0 10px; }
        .clinical-report ul { margin: 8px 0 14px; padding-left: 20px; }
        .clinical-report li { margin: 0 0 6px; }
      `}</style>

      <Header onOpenV1={openV1} />

      <div
        className="onqol-case-header"
        style={{
          padding: "14px 20px",
          background: C.surface,
          borderBottom: `1px solid ${C.border}`,
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          gap: 16,
          alignItems: "center",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ color: C.accent, fontWeight: 700, fontSize: 13, letterSpacing: "0.08em" }}>
            {activeCase.title}
          </div>
          <div style={{ color: C.textSub, fontSize: 12, marginTop: 4 }}>
            {activeCase.resource_context.level} · {activeCase.specialty}
          </div>
        </div>
        <Progress session={session} />
      </div>

      {developerMode && <DeveloperMetadata session={session} />}

      <div style={{ flex: 1, overflowY: "auto", padding: "24px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
        {session.messages.map((msg, i) => (
          <div
            key={i}
            className={msg.role === "assistant" ? "clinical-report" : undefined}
            style={{
              alignSelf: msg.role === "assistant" ? "flex-start" : "flex-end",
              maxWidth: msg.role === "assistant" ? "82%" : "72%",
              background: msg.role === "assistant" ? C.surface : C.userMsg,
              border: msg.role === "assistant" ? `1px solid ${C.border}` : "none",
              borderRadius: msg.role === "assistant" ? "2px 12px 12px 12px" : "12px 2px 12px 12px",
              padding: msg.role === "assistant" ? "14px 18px" : "10px 16px",
              fontSize: 15,
              lineHeight: 1.75,
              color: msg.role === "assistant" ? C.text : C.userText,
              boxShadow: msg.role === "assistant" ? "0 1px 4px rgba(22,105,122,0.06)" : "none",
              whiteSpace: msg.role === "assistant" ? "normal" : "pre-wrap",
            }}
          >
            {msg.role === "assistant" ? (
              <ReactMarkdown>{msg.content}</ReactMarkdown>
            ) : (
              msg.content
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div style={{ background: C.surface, borderTop: `1px solid ${C.border}`, padding: "8px 16px" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
          {developerMode ? (
            <div style={{ fontSize: 12, color: C.textSub }}>
              {parsedLabels.length
                ? `Extracted: ${parsedLabels.join(", ")}`
                : "No scoring-relevant actions extracted"}
            </div>
          ) : (
            <span />
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => send("конец кейса")}
              disabled={session.finished || loading}
              style={{
                border: `1px solid ${C.borderMid}`,
                background: C.surface,
                color: C.accent,
                borderRadius: 4,
                padding: "8px 10px",
                fontFamily: "inherit",
                fontSize: 12,
                cursor: session.finished ? "default" : "pointer",
              }}
            >
              Завершить кейс
            </button>
            <button
              onClick={restart}
              style={{
                border: "none",
                background: C.accent,
                color: "#fff",
                borderRadius: 4,
                padding: "8px 10px",
                fontFamily: "inherit",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              Сначала
            </button>
          </div>
        </div>
      </div>

      {routerError && (
        <div style={{ background: "#fdf0ef", color: "#c0392b", padding: "8px 16px", fontSize: 12 }}>
          Симулятор: {routerError}
        </div>
      )}

      <div style={{ borderTop: `1px solid ${C.border}`, padding: "12px 16px", display: "flex", gap: 10, alignItems: "flex-end", background: C.surface }}>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          rows={1}
          disabled={session.finished || loading}
          placeholder="Ваш ответ..."
          style={{
            flex: 1,
            background: C.bg,
            border: `1px solid ${C.border}`,
            borderRadius: 4,
            color: C.text,
            fontFamily: "inherit",
            fontSize: 13,
            padding: "10px 12px",
            resize: "none",
            outline: "none",
            lineHeight: 1.5,
            minHeight: 42,
            maxHeight: 160,
          }}
        />
        <button
          onClick={() => send()}
          disabled={!input.trim() || session.finished || loading}
          style={{
            background: input.trim() && !session.finished && !loading ? C.accent : C.accentLight,
            border: "none",
            borderRadius: 4,
            color: input.trim() && !session.finished && !loading ? "#ffffff" : C.textSub,
            cursor: input.trim() && !session.finished && !loading ? "pointer" : "default",
            fontFamily: "inherit",
            fontSize: 13,
            fontWeight: 700,
            padding: "10px 16px",
            height: 42,
          }}
        >
          {loading ? "..." : "→"}
        </button>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { ChatShell } from "../ui/components/ChatShell.jsx";
import { VitalsStrip } from "../ui/components/VitalsStrip.jsx";
import { Composer } from "../ui/components/Composer.jsx";
import { useSession } from "./session/useSession.js";
import { FLEXIBLE_STORAGE_KEY, hasLegacyFlexibleSession } from "./session/flexibleSessionStorage.js";

export function FlexiblePatientApp({ onExit }) {
  const runtime = useSession({ patientDialogue: true, storageKey: FLEXIBLE_STORAGE_KEY });
  const initialized = useRef(false);
  const [stopped, setStopped] = useState(false);
  const { session, messages, busy, startSession, resumeSession, resumeCandidate, submitTurn, downloadExport } = runtime;
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    if (resumeCandidate) resumeSession(); else startSession({ mode: "reference" });
  }, [resumeCandidate, resumeSession, startSession]);
  if (!session) return <p role="status">Подготовка пациента…</p>;
  const complete = session.state.session.status === "complete";
  return <>
    <div className="onqol-case-bar"><div><span className="onqol-mono-label">Гибкий клинический диалог · прототип</span><strong>Время в кейсе: {session.state.clock.elapsedMinutes} мин</strong></div><button type="button" className="onqol-download" onClick={onExit} disabled={busy}>К выбору режима</button></div>
    <div className="onqol-workspace"><div className="onqol-chat-column">
      <ChatShell messages={messages} />
      {runtime.persistenceError && <p role="alert">Автосохранение недоступно. Скачайте сессию перед закрытием.</p>}
      {busy && <div role="status" className="onqol-turn-status">Пациент отвечает…</div>}
      {stopped ? <p>Сессия остановлена. Кейс не завершён; продолжение доступно после возвращения.</p> : complete ? <p>Кейс завершён.</p> : <Composer locale="ru" disabled={busy} onSubmit={submitTurn} mentorEnabled={runtime.mentorEnabled} />}
    </div><aside className="onqol-sidebar">
      <section className="onqol-side-section"><h3>Последние измеренные показатели</h3>
        {runtime.learnerVisible?.physiologyKnownAt ? <><p>В кейсе: {runtime.learnerVisible.physiologyKnownAt.atMinutes} мин</p>
          <VitalsStrip snapshot={{ ...runtime.learnerVisible.physiologyKnownAt,
            values: { ...runtime.learnerVisible.physiologyKnownAt.values, painScore: runtime.learnerVisible.painScore } }} /></>
          : <p>Измерений пока нет.</p>}
      </section>
      <section className="onqol-side-section"><h3>Гибкое ведение пациента</h3><p>Уточняйте анамнез, обследуйте, назначайте лечение и возвращайтесь к переоценке.</p><p>Если данных для ответа нет, пациент или персонал сообщит об ограничении симуляции.</p></section>
      {hasLegacyFlexibleSession(globalThis.localStorage) && <section className="onqol-side-section"><p>Старая экспериментальная сессия сохранена отдельно. Продолжить её в новой версии нельзя.</p></section>}
      <section className="onqol-side-section"><button type="button" className="onqol-download" onClick={downloadExport}>Скачать сессию ↓</button></section>
      {!stopped && !complete && <section className="onqol-side-section"><button type="button" className="onqol-download" onClick={() => setStopped(true)} disabled={busy}>Остановить сессию</button></section>}
      <section className="onqol-side-section"><button type="button" className="onqol-download" disabled={busy} onClick={() => { setStopped(false); startSession({ mode: "reference" }); }}>Новый пациент</button></section>
    </aside></div>
  </>;
}

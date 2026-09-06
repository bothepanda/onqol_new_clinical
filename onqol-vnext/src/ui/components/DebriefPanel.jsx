function list(items, render) {
  if (!items?.length) return <p className="onqol-empty">Нет зафиксированных пунктов.</p>;
  return <ul>{items.map((item, index) => <li key={`${index}-${JSON.stringify(item).slice(0, 32)}`}>{render(item)}</li>)}</ul>;
}

export function DebriefPanel({ debrief, onDownload, onNewCase }) {
  if (!debrief) return null;
  const governanceWarning = debrief.contentGovernance?.pilotReady === false ||
    debrief.contentGovernance?.patientTruthApproved === false;
  return (
    <main className="onqol-debrief" data-testid="debrief">
      <header>
        <p className="onqol-mono-label">ДЕБРИФ</p>
        <h1>Разбор завершённого кейса</h1>
        <p>Время кейса: {debrief.caseSummary.totalCaseMinutes} мин. Итог: {debrief.caseSummary.endpointType}.</p>
      </header>
      {governanceWarning && (
        <aside className="onqol-debrief-warning" role="note">
          Внутренняя сборка: клинический контент ещё не одобрен для обучения. Этот разбор не является клиническим эталоном.
        </aside>
      )}
      <section><h2>Что было сделано</h2>{list(debrief.observedBehavior, (item) => `${item.atMinutes} мин — ${item.type}`)}</section>
      <section><h2>Что получилось</h2>{list(debrief.whatWentWell, (item) => item.pointRu)}</section>
      <section><h2>Важные пропуски</h2>{list(debrief.importantMisses, (item) => item.pointRu)}</section>
      <section><h2>Последствия решений</h2>{list(debrief.consequences, (item) => `${item.atMinutes} мин — ${item.type} (${item.attribution})`)}</section>
      <section><h2>Ограничения ресурсов</h2>{list(debrief.resourceLimitations, (item) => item.pointRu ?? item.reasonKey ?? item.kind)}</section>
      <section><h2>Ограничения симулятора</h2>{list(debrief.simulatorLimitations, (item) => item.pointRu ?? item.reasonKey ?? item.kind)}</section>
      {debrief.referenceComparison?.available && (
        <section><h2>Сопоставление с одобренным маршрутом</h2>{list(debrief.referenceComparison.items, (item) => item.pointRu ?? item.ruleId)}</section>
      )}
      <section><h2>Цели для следующей попытки</h2>{list(debrief.learningObjectives, (item) => item.pointRu ?? String(item))}</section>
      <div className="onqol-debrief-actions">
        <button type="button" onClick={onDownload}>Скачать журнал кейса</button>
        <button type="button" onClick={onNewCase}>Начать новый кейс</button>
      </div>
    </main>
  );
}

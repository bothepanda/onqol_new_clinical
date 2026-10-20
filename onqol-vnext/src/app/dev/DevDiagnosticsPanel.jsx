import { useMemo } from "react";
import { buildDiagnostics } from "./devDiagnostics.js";

/** Development-only. Shows hidden truth; never mounted in a learner build (see App.jsx). */
export function DevDiagnosticsPanel({ session }) {
  const diagnostics = useMemo(() => buildDiagnostics(session), [session]);
  if (!diagnostics) return null;
  const sections = [
    ["Сессия", diagnostics.session],
    ["Скрытая правда", diagnostics.truth],
    ["Физиология", diagnostics.physiology],
    ["Симптомы", diagnostics.symptoms],
    ["Очередь", diagnostics.pending],
    ["Ограничения больницы", diagnostics.dynamicConstraints],
    ["Ограничения симулятора", diagnostics.simulatorLimitations],
    ["Наставник", diagnostics.mentor],
    ["События (последние)", diagnostics.events],
  ];
  return (
    <aside className="onqol-dev-panel" data-testid="dev-diagnostics" aria-label="Диагностика (dev)">
      <strong>DEV · диагностика</strong>
      {sections.map(([title, value]) => (
        <details key={title}>
          <summary>{title}</summary>
          <pre>{JSON.stringify(value, null, 2)}</pre>
        </details>
      ))}
    </aside>
  );
}

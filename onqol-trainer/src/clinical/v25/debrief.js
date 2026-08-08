import { formatEvidenceCitation, retrieveEvidence } from "./knowledgeBase.js";

function listOrDash(items) {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- Не выявлено.";
}

function actionMap(actions) {
  return new Map(actions.map((action) => [action.id, action]));
}

function evidenceForAction(knowledgeBase, action) {
  const query = [
    action.concept,
    action.router_description,
    action.feedback_if_done,
    action.feedback_if_missed,
    action.feedback,
    ...(action.evidence_reference_ids || []),
  ]
    .filter(Boolean)
    .join(" ");
  return retrieveEvidence(knowledgeBase, query, { limit: 3 });
}

function formatEvidenceRows(rows) {
  if (!rows.length) return "- Нет совпавшего источника; требуется загрузить/разметить руководство или учебник.";
  return rows.map((row) => `- ${formatEvidenceCitation(row)}: ${row.text.slice(0, 220)}${row.text.length > 220 ? "..." : ""}`).join("\n");
}

export function buildEvidenceGroundedDebrief({ caseData, session, scoring, knowledgeBase }) {
  const expected = actionMap(caseData.expected_actions);
  const unnecessary = actionMap(caseData.unnecessary_actions);
  const unsafe = actionMap(caseData.unsafe_actions);
  const completedExpected = caseData.expected_actions.filter((action) => scoring.completed.includes(action.id));
  const missedExpected = scoring.missedExpected.map((id) => expected.get(id)).filter(Boolean);
  const unnecessaryDone = scoring.unnecessaryActions.map((id) => unnecessary.get(id)).filter(Boolean);
  const unsafeDone = scoring.unsafeActions.map((id) => unsafe.get(id)).filter(Boolean);
  const focusActions = [...completedExpected, ...missedExpected, ...unnecessaryDone, ...unsafeDone].filter(
    (action, index, all) => all.findIndex((item) => item.id === action.id) === index
  );
  const evidenceRows = focusActions.flatMap((action) => evidenceForAction(knowledgeBase, action));
  const uniqueEvidence = evidenceRows.filter(
    (row, index, all) => all.findIndex((item) => item.id === row.id) === index
  );

  const timeline = session.temporalState.timeline
    .slice(-6)
    .map((event) => `- T+${event.minute} мин: ${event.detail}`)
    .join("\n");

  const revealedConstraintRows = (session.workingMemory?.revealedConstraints || []).map((resource) => {
    const constraint = session.scenario.constraints.find((item) => item.resource === resource);
    if (constraint) return constraint.debriefText;
    const capability = session.scenario.facility.capabilities[resource];
    if (capability?.installed === false) return `${resource}: ресурс отсутствовал в профиле стационара.`;
    if (resource === "ultrasound" && capability?.coverage === "business_hours") {
      return "УЗИ было доступно только в рабочие часы.";
    }
    return `${resource}: доступность была уточнена во время кейса.`;
  });
  const actionLifecycle = (session.actionLog || [])
    .slice(-10)
    .map(
      (entry) =>
        `- T${entry.turn}: ${entry.action_id} — ${entry.lifecycle_before || "new"} → ${entry.lifecycle_after}${
          entry.technique ? ` (${entry.technique})` : ""
        }`
    )
    .join("\n");
  const scenarioMode = session.scenario.mode === "reference" ? "Эталонные условия" : "Реальная смена";

  const markdown = `# Разбор V${caseData.product_version || "2.5"}

**Кейс:** ${caseData.title}

**Режим:** ${scenarioMode}

**Итоговая оценка:** ${scoring.overallScore}%

**Оценка по доменам**
${Object.entries(scoring.domainScores)
  .map(([domain, score]) => `- ${domain}: ${score}%`)
  .join("\n")}

**Клиническая временная линия**
${timeline}

**Жизненный цикл решений**
${actionLifecycle || "- Действия не зафиксированы."}

**Что сделано**
${listOrDash(completedExpected.map((action) => action.feedback_if_done))}

**Что пропущено или сделано поздно**
${listOrDash(missedExpected.map((action) => action.feedback_if_missed))}

**Небезопасные или малоценные действия**
${listOrDash([...unnecessaryDone, ...unsafeDone].map((action) => action.feedback))}

**Ресурсный разбор**
- При полном ресурсе применялся бы тот же disease-specific стандарт и доступный путь к контролю источника.
${listOrDash(revealedConstraintRows)}
- Не раскрытые во время диалога ограничения не влияли на баллы.

**Использованные источники**
${formatEvidenceRows(uniqueEvidence)}

**Статус grounding**
- Разбор собран из авторизованных действий кейса, детерминированного scoring, временной модели и версионированной базы источников.
- Загруженные материалы могут поддерживать цитаты, но не создают факты пациента и не меняют rubric.`;

  return {
    markdown,
    evidence: uniqueEvidence,
  };
}

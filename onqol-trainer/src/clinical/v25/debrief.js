import { formatEvidenceCitation, retrieveEvidence } from "./knowledgeBase.js";

function listOrDash(items) {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- Не выявлено.";
}

function actionMap(actions) {
  return new Map(actions.map((action) => [action.id, action]));
}

const DEFERRED_ISSUE_LABELS = Object.freeze({
  checkpoint_problem_representation: "Представление проблемы явно не сформулировано.",
  checkpoint_hypotheses: "Гипотезы и опасная альтернатива явно не ранжированы.",
  checkpoint_what_changes_the_plan: "Условие изменения плана осталось неявным.",
  investigation_without_purpose: "Цель исследования не была вербализована.",
  no_contingency_plan: "План на случай изменения ситуации не был сформулирован.",
  observation_without_endpoint: "Критерии завершения наблюдения остались неполными.",
  consultation_replacing_reasoning: "Собственная оценка перед консультацией осталась неявной.",
});

function deferredMentorRows(caseData, session) {
  const investigations = session.workingMemory?.reasoningState?.investigations?.items || [];
  const actionById = actionMap([
    ...(caseData.expected_actions || []),
    ...(caseData.acceptable_alternatives || []),
    ...(caseData.unnecessary_actions || []),
    ...(caseData.unsafe_actions || []),
  ]);
  const unpurposedInvestigations = investigations.filter(
    (item) => !item.purpose_stated && !item.justification
  );
  const hasArticulatedPurpose = investigations.some(
    (item) => item.purpose_stated || item.justification
  );

  return (session.workingMemory?.deferredMentorIssues || [])
    .flatMap((issue) => {
      if (issue.issue_id !== "investigation_without_purpose") {
        return [DEFERRED_ISSUE_LABELS[issue.issue_id]];
      }
      if (!unpurposedInvestigations.length) return [];
      if (!hasArticulatedPurpose) return [DEFERRED_ISSUE_LABELS[issue.issue_id]];
      return unpurposedInvestigations.map((item) => {
        const canonicalActionId = actionById.has(item.action_id)
          ? item.action_id
          : (caseData.v3_concept_map?.[item.action_id] || []).find((id) => actionById.has(id));
        const action = actionById.get(canonicalActionId);
        const findingId = action?.effects_on_case?.reveal || action?.maps_to || null;
        const finding = findingId
          ? caseData.available_findings?.[findingId] || caseData.hidden_findings?.[findingId]
          : null;
        return `Для «${finding?.title || action?.concept || item.action_id}» не было явно сказано, какой результат изменит тактику.`;
      });
    })
    .filter(Boolean)
    .filter((label, index, all) => all.indexOf(label) === index);
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

function buildFormativeDebrief({ caseData, session, scoring }) {
  const stableEndpointReached = session.pathState === "discharge";
  const domainRows = (scoring.formativeDomains || [])
    .map((domain) => {
      const observed = domain.signals
        .filter((signal) => signal.observed)
        .map((signal) => signal.label_ru);
      return `| ${domain.title_ru} | ${
        observed.length ? observed.join("; ") : "высказывание не зафиксировано"
      } |`;
    })
    .join("\n");
  const timeline = (session.temporalState?.timeline || [])
    .slice(-6)
    .map((entry) => `- T+${entry.minute} мин: ${entry.detail}`)
    .join("\n");
  const deferredRows = deferredMentorRows(caseData, session);

  const markdown = `# Формирующий разбор V${caseData.product_version || "3.5"}

**Статус:** итоговый числовой балл отключён. Рубрика не валидирована для оценивания резидента.

**Путь:** ${
    stableEndpointReached
      ? "стабильный путь доведён до discharge/follow-up endpoint."
      : `сессия завершена до безопасного endpoint (текущее состояние: \`${session.pathState || "unknown"}\`).`
  }

Таблица ниже фиксирует только наличие явно сформулированных элементов рассуждения. Она не подтверждает их клиническую правильность и не является оценкой эффективности.

| Область | Что было явно сформулировано |
| --- | --- |
${domainRows}

**Клиническая временная линия**
${timeline || "- Временные события не зафиксированы."}

**Отложено для разбора**
${listOrDash(deferredRows)}

Эти пункты не прерывали ведение пациента. Они фиксируют только то, что соответствующее рассуждение не было явно высказано; клиническую правильность они не устанавливают.

**Статус данных**
- Формирующий режим: \`${scoring.reviewStatus}\`.
- Legacy \`expected_actions\`, веса и штрафы не использовались.
- Числовые overall score и domain scores не создавались.`;

  return {
    markdown,
    evidence: [],
    formativeDomains: scoring.formativeDomains || [],
    pathwayStatus: stableEndpointReached ? "completed" : "incomplete",
  };
}

export function buildEvidenceGroundedDebrief({ caseData, session, scoring, knowledgeBase }) {
  if (scoring.eligibleForScoring === false) {
    return buildFormativeDebrief({ caseData, session, scoring });
  }
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
  .map(([domain, score]) =>
    // `null` means the domain had nothing to score in this case. Printing it as
    // a percentage - any percentage - claims a measurement that was not made.
    score === null
      ? `- ${domain}: не оценивался (в этом кейсе нет оцениваемых элементов)`
      : `- ${domain}: ${score}%`
  )
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

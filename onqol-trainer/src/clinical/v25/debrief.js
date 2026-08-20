import { mentorHeuristics } from "../core/mentorHeuristics.js";
import { formatEvidenceCitation, retrieveEvidence } from "./knowledgeBase.js";

function listOrDash(items) {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- Не выявлено.";
}

function actionMap(actions) {
  return new Map(actions.map((action) => [action.id, action]));
}

/**
 * The debrief line for a deferred issue comes from the rule that raised it -
 * core heuristics plus whatever the case carries in `mentor_rules` - never from
 * a table kept here.
 *
 * There used to be such a table, with seven of the nineteen rules in it. The
 * other twelve resolved to `undefined` and were then removed by a `.filter`,
 * so a resident who closed on a diagnosis without excluding the dangerous
 * alternative was told only that a contingency plan was missing. The gap was in
 * the export and nowhere on the screen. A second table can always fall behind
 * the rules; a field on the rule cannot.
 */
function debriefLabels(caseData) {
  return new Map(
    [...mentorHeuristics, ...(caseData.mentor_rules || [])]
      .filter((rule) => rule.id && rule.debrief_line_ru)
      .map((rule) => [rule.id, rule.debrief_line_ru])
  );
}

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

  const labels = debriefLabels(caseData);

  return (session.workingMemory?.deferredMentorIssues || [])
    .flatMap((issue) => {
      if (issue.issue_id !== "investigation_without_purpose") {
        // An issue with no line of its own is still reported. Losing it quietly
        // is the failure this function was rewritten for; the resident sees that
        // something was deferred, and the id stays in the export for whoever
        // owns the rule.
        return [
          labels.get(issue.issue_id) ||
            "Ещё один пункт разбора зафиксирован в выгрузке сессии без формулировки.",
        ];
      }
      if (!unpurposedInvestigations.length) return [];
      if (!hasArticulatedPurpose) return [labels.get(issue.issue_id)];
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
    .map((entry) => `- Через ${entry.minute} мин: ${entry.detail}`)
    .join("\n");
  const deferredRows = deferredMentorRows(caseData, session);

  const markdown = `# Формирующий разбор

**Статус:** итоговый числовой балл отключён. Рубрика не валидирована для оценивания резидента.

**Путь:** ${
    stableEndpointReached
      ? "стабильный путь завершён: выписка и дальнейшее наблюдение зафиксированы."
      : "сессия завершена до выписки и плана дальнейшего наблюдения."
  }

Таблица ниже фиксирует только наличие явно сформулированных элементов рассуждения. Она не подтверждает их клиническую правильность и не является оценкой эффективности.

| Область | Что было явно сформулировано |
| --- | --- |
${domainRows}

**Клиническая временная линия**
${timeline || "- Временные события не зафиксированы."}

**Отложено для разбора**
${listOrDash(deferredRows)}

Эти пункты не прерывали ведение пациента. Они фиксируют только то, что соответствующее рассуждение не было явно высказано; клиническую правильность они не устанавливают.`;

  // Build telemetry, not feedback. It was the last thing a surgeon read after
  // finishing a case: which legacy fields went unused and which numbers were not
  // created. It belongs in the export and in the faculty view, where someone is
  // asking exactly that question - not on the learner's screen. The scoring line
  // in the header stays: that one is addressed to the resident.
  const dataStatusMarkdown = `**Статус данных**
- Формирующий режим: \`${scoring.reviewStatus}\`.
- Legacy \`expected_actions\`, веса и штрафы не использовались.
- Числовые overall score и domain scores не создавались.`;

  return {
    markdown,
    dataStatusMarkdown,
    facultyMarkdown: `${markdown}\n\n${dataStatusMarkdown}`,
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
    .map((event) => `- Через ${event.minute} мин: ${event.detail}`)
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

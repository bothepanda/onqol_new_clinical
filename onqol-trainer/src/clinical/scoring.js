function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function byId(actions) {
  return new Map(actions.map((action) => [action.id, action]));
}

export function scoreSession(caseData, session) {
  const completed = new Set(session.completedActions || []);
  const unsafeCompleted = new Set(session.unsafeActions || []);
  const unnecessaryCompleted = new Set(session.unnecessaryActions || []);
  const expectedById = byId(caseData.expected_actions);
  const alternativeById = byId(caseData.acceptable_alternatives);
  const unnecessaryById = byId(caseData.unnecessary_actions);
  const unsafeById = byId(caseData.unsafe_actions);

  const domainTotals = {};
  const domainEarned = {};
  const domainPenalties = {};

  for (const domain of caseData.scoring.domains) {
    domainTotals[domain] = 0;
    domainEarned[domain] = 0;
    domainPenalties[domain] = 0;
  }

  for (const action of caseData.expected_actions) {
    domainTotals[action.domain] += action.score_weight || 0;
    if (completed.has(action.id)) {
      domainEarned[action.domain] += action.score_weight || 0;
    }
  }

  for (const action of caseData.acceptable_alternatives) {
    if (completed.has(action.id) && action.eligible_for_scoring !== false) {
      domainEarned[action.domain] += action.score_weight || 0;
    }
  }

  for (const id of unnecessaryCompleted) {
    const action = unnecessaryById.get(id);
    if (action && action.eligible_for_scoring !== false) {
      domainPenalties[action.domain] += action.penalty || 0;
    }
  }

  for (const id of unsafeCompleted) {
    const action = unsafeById.get(id);
    if (action && action.eligible_for_scoring !== false) {
      domainPenalties[action.domain] += action.penalty || 0;
    }
  }

  const missedExpected = caseData.expected_actions.filter((action) => !completed.has(action.id));
  const missedCritical = missedExpected.filter((action) => action.critical);
  const criticalOmissions = caseData.critical_omissions.filter((id) => !completed.has(id));
  const criticalErrors = [
    ...[...unsafeCompleted].filter((id) => {
      const action = unsafeById.get(id);
      return action?.critical && action.eligible_for_scoring !== false;
    }),
    ...criticalOmissions,
  ];

  const domainScores = {};
  for (const domain of caseData.scoring.domains) {
    const total = domainTotals[domain] || 0;
    const raw = total === 0 ? 100 : ((domainEarned[domain] - domainPenalties[domain]) / total) * 100;
    domainScores[domain] = Math.round(clamp(raw, 0, 100));
  }

  const maxExpected = Object.values(domainTotals).reduce((sum, value) => sum + value, 0);
  const earned = Object.values(domainEarned).reduce((sum, value) => sum + value, 0);
  const penalties = Object.values(domainPenalties).reduce((sum, value) => sum + value, 0);
  const overallScore = Math.round(clamp(((earned - penalties) / maxExpected) * 100, 0, 100));

  return {
    completed: [...completed],
    overallScore,
    domainScores,
    earned,
    penalties,
    maxExpected,
    criticalErrorFlag: criticalErrors.length > 0,
    criticalErrors,
    missedExpected: missedExpected.map((action) => action.id),
    missedCritical: missedCritical.map((action) => action.id),
    unsafeActions: [...unsafeCompleted],
    unnecessaryActions: [...unnecessaryCompleted],
    expectedById,
    alternativeById,
    unnecessaryById,
    unsafeById,
  };
}

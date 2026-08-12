function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function byId(actions) {
  return new Map(actions.map((action) => [action.id, action]));
}

export function scoreSession(caseData, session) {
  if (caseData.scoring?.eligible_for_scoring === false) {
    throw new Error(
      "Numeric scoring is disabled for this case. Use the formative assessment path."
    );
  }
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

  // Two different failures, reported separately.
  //
  // The first live run put `open_appendectomy_here` and
  // `preop_single_antibiotic_prophylaxis` under the heading "CRITICAL / UNSAFE
  // ACTIONS" for a learner who had performed neither. Telling someone they did
  // a dangerous thing they did not do is not a scoring nuance; it is a false
  // accusation in a training record.
  const unsafeActionsPerformed = [...unsafeCompleted].filter((id) => {
    const action = unsafeById.get(id);
    return action?.critical && action.eligible_for_scoring !== false;
  });

  // Dependent omissions are not independent failures.
  //
  // Prophylaxis before an operation is only owed once an operation is decided
  // on. Counting it against a learner who never got as far as deciding turns one
  // gap into two.
  const dependentOmissions = caseData.dependent_omissions || {};
  const criticalOmissionsIndependent = criticalOmissions.filter((id) => {
    const requires = dependentOmissions[id];
    if (!requires) return true;
    return requires.some((prerequisiteId) => completed.has(prerequisiteId));
  });
  const criticalOmissionsSuppressed = criticalOmissions.filter(
    (id) => !criticalOmissionsIndependent.includes(id)
  );

  const domainScores = {};
  for (const domain of caseData.scoring.domains) {
    const total = domainTotals[domain] || 0;
    // A domain with nothing to score is `null`, not 100.
    //
    // Reporting a perfect score for behaviour that was never observed is the
    // most flattering possible lie: the first live run showed Patient safety and
    // Professionalism at 100 without a single scorable item in either.
    if (total === 0) {
      domainScores[domain] = null;
      continue;
    }
    const raw = ((domainEarned[domain] - domainPenalties[domain]) / total) * 100;
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
    criticalErrorFlag: unsafeActionsPerformed.length > 0 || criticalOmissionsIndependent.length > 0,
    // Kept for consumers that read one combined list, but no longer the primary
    // report: `unsafe_actions_performed` and `critical_omissions` are.
    criticalErrors: [...unsafeActionsPerformed, ...criticalOmissionsIndependent],
    unsafeActionsPerformed,
    criticalOmissions: criticalOmissionsIndependent,
    criticalOmissionsSuppressed,
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

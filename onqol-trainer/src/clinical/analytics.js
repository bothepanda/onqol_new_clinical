export function stratifySessionsForAnalytics(sessions) {
  const strata = new Map();

  for (const session of sessions) {
    const key = [
      session.case_id,
      session.case_version,
      session.scoring_rubric_version,
      session.disease_card_version,
      session.router_version,
    ].join("::");
    if (!strata.has(key)) {
      strata.set(key, {
        case_id: session.case_id,
        case_version: session.case_version,
        scoring_rubric_version: session.scoring_rubric_version,
        disease_card_version: session.disease_card_version,
        router_version: session.router_version,
        sessions: [],
      });
    }
    strata.get(key).sessions.push(session);
  }

  return [...strata.values()];
}

export function assertComparableRubricVersions(sessions) {
  const versions = new Set(sessions.map((session) => session.scoring_rubric_version));
  if (versions.size > 1) {
    throw new Error(
      "Sessions use materially different scoring_rubric_version values. Stratify or explicitly normalize before aggregation."
    );
  }
}


function listOrDash(items) {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- Не выявлено.";
}

function referencesFor(caseData, referenceIds) {
  const refs = new Map(caseData.references.map((reference) => [reference.id, reference]));
  return [...new Set(referenceIds)]
    .map((id) => refs.get(id))
    .filter(Boolean);
}

function formatReference(reference) {
  const status = reference.kz_protocol_status ? ` · ${reference.kz_protocol_status}` : "";
  return `- ${reference.name} ${reference.year}, ${reference.section}${status}: ${reference.recommendation}`;
}

export function buildClinicalReasoningReport(caseData, scoring) {
  const expected = new Map(caseData.expected_actions.map((action) => [action.id, action]));
  const unsafe = new Map(caseData.unsafe_actions.map((action) => [action.id, action]));
  const unnecessary = new Map(caseData.unnecessary_actions.map((action) => [action.id, action]));

  const doneWell = caseData.expected_actions
    .filter((action) => scoring.completed.includes(action.id))
    .map((action) => action.feedback_if_done);

  const missed = scoring.missedExpected
    .map((id) => expected.get(id))
    .filter(Boolean)
    .map((action) => action.feedback_if_missed);

  const unnecessaryItems = scoring.unnecessaryActions
    .map((id) => unnecessary.get(id))
    .filter(Boolean)
    .map((action) => action.feedback);

  const unsafeItems = scoring.unsafeActions
    .map((id) => unsafe.get(id))
    .filter(Boolean)
    .map((action) => action.feedback);

  const criticalOmissions = scoring.missedCritical
    .map((id) => expected.get(id))
    .filter(Boolean)
    .map((action) => action.feedback_if_missed);

  const learningPoints = caseData.feedback.key_learning_points.map((point) => {
    const review = point.review_status ? ` (${point.review_status})` : "";
    return `${point.text}${review}`;
  });

  const referenceIds = [
    ...caseData.expected_actions.flatMap((action) =>
      scoring.completed.includes(action.id) || scoring.missedExpected.includes(action.id)
        ? action.evidence_reference_ids || []
        : []
    ),
    ...caseData.unnecessary_actions.flatMap((action) =>
      scoring.unnecessaryActions.includes(action.id) ? action.evidence_reference_ids || [] : []
    ),
    ...caseData.unsafe_actions.flatMap((action) =>
      scoring.unsafeActions.includes(action.id) ? action.evidence_reference_ids || [] : []
    ),
    ...caseData.feedback.key_learning_points.flatMap((point) => point.evidence_reference_ids || []),
  ];

  const references = referencesFor(caseData, referenceIds);
  const domainRows = Object.entries(scoring.domainScores)
    .map(([domain, score]) => `- ${domain}: ${score}%`)
    .join("\n");

  const markdown = `# Clinical Reasoning Report

**Кейс:** ${caseData.title}

**Overall score:** ${scoring.overallScore}%

**Domain scores**
${domainRows}

**WHAT YOU DID WELL**
${listOrDash(doneWell)}

**WHAT YOU MISSED**
${listOrDash(missed)}

**UNNECESSARY ACTIONS**
${listOrDash(unnecessaryItems)}

**CRITICAL / UNSAFE ACTIONS**
${listOrDash([...criticalOmissions, ...unsafeItems])}

**KEY LEARNING POINTS**
${listOrDash(learningPoints)}

**EVIDENCE / REFERENCES**
${references.map(formatReference).join("\n")}`;

  return {
    markdown,
    doneWell,
    missed,
    unnecessary: unnecessaryItems,
    unsafe: unsafeItems,
    learningPoints,
    references,
  };
}

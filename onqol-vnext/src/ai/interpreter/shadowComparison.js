const SET_LIKE_ARRAY_KEYS = new Set(["analytes", "targets", "domains"]);
const IDENTITY_KEYS = ["testId", "drugId", "fluidId", "procedureId", "topic", "region", "role", "destination", "to", "intent", "approach", "choice"];

export function compareInterpretations({ deterministic, modelResult }) {
  const deterministicCommands = deterministic.commands.map(canonicalizeCommand);
  const modelCommands = (modelResult.acceptedCommands ?? modelResult.boundCommands ?? []).map(canonicalizeCommand);
  const overlap = multisetIntersection(deterministicCommands, modelCommands);
  return {
    deterministicCommands,
    modelCommands,
    exactCommandAgreement: overlap === deterministicCommands.length && overlap === modelCommands.length,
    onlyDeterministic: multisetDifference(deterministicCommands, modelCommands),
    onlyModel: multisetDifference(modelCommands, deterministicCommands),
    deterministicUnresolvedFragments: deterministic.unmatchedFragments ?? [],
    modelUnresolvedFragments: modelResult.output?.unresolvedFragments ?? [],
    modelAmbiguities: modelResult.output?.ambiguities ?? [],
    modelReasoningDomains: reasoningDomains(modelResult.output?.reasoningDelta ?? {}),
  };
}

export function evaluateInterpretationAgainstGold({
  commands = [], reasoningDelta = {}, patientQuestions = [], ambiguities = [],
  unresolvedFragments = [], mentorAnswerDelta = {}, proposedCommands = [], actionValidation = [], expected,
}) {
  const goldCommands = (expected.commands ?? []).map(canonicalizeCommand);
  const actualCommands = commands.map(canonicalizeCommand);
  const matchedCommands = multisetIntersectionBy(goldCommands, actualCommands, sameCommandIdentity);
  const exactCommandMatches = multisetIntersection(goldCommands, actualCommands);
  const goldReasoning = canonicalSet(expected.reasoningDomains ?? []);
  const actualReasoning = canonicalSet(reasoningDomains(reasoningDelta));
  const goldQuestions = canonicalSet(expected.patientQuestionTopics ?? []);
  const actualQuestions = canonicalSet(patientQuestions.map((item) => item.topic));
  const goldMentor = canonicalSet(expected.mentorAnswerDomains ?? []);
  const actualMentor = canonicalSet(Array.isArray(mentorAnswerDelta.domains) ? mentorAnswerDelta.domains : []);
  const parameterizedGold = goldCommands.filter((item) => Object.keys(item.params).length > 0);
  const proposed = proposedCommands.map(canonicalizeCommand);
  const reasoningOnly = goldCommands.length === 0 && goldReasoning.size > 0;
  const mentorOnly = goldCommands.length === 0 && goldMentor.size > 0;
  const expectsUnsupportedConcept = (expected.unresolvedFragments ?? []).some((issue) => issueReason(issue) === "unsupported_concept");
  const expectsTentative = (expected.ambiguities ?? []).some((issue) => issueReason(issue) === "tentative_not_committed");
  const tentativeProposals = proposedCommands.filter((command) => isCommittedManagementCommand(command.type)).length;
  return {
    goldCommands,
    actualCommands,
    matchedCommands,
    exactTurn: exactCommandMatches === goldCommands.length && exactCommandMatches === actualCommands.length,
    parameterizedGoldCommands: parameterizedGold.length,
    parameterMatches: parameterizedGold.filter((gold) => actualCommands.some((actual) => sameIdentityAndParams(gold, actual))).length,
    reasoning: setCounts(goldReasoning, actualReasoning),
    patientQuestions: setCounts(goldQuestions, actualQuestions),
    mentorAnswer: setCounts(goldMentor, actualMentor),
    ambiguities: setCounts(canonicalIssueSet(expected.ambiguities ?? []), canonicalIssueSet(ambiguities)),
    unresolved: setCounts(canonicalIssueSet(expected.unresolvedFragments ?? []), canonicalIssueSet(unresolvedFragments)),
    unsupportedFalsePositive: goldCommands.length === 0 && actualCommands.length > 0,
    proposedCommands: proposed,
    groundedProposedCommands: actionValidation.filter((item) => !(item.errors ?? []).some(isGroundingError)).length,
    missingEvidenceRejections: actionValidation.filter((item) => (item.errors ?? []).includes("evidence_not_verbatim")).length,
    reasoningOnly,
    reasoningAsAction: reasoningOnly && proposed.length > 0,
    mentorOnly,
    mentorAnswerAsAction: mentorOnly && proposed.length > 0,
    unsupportedConceptTurn: expectsUnsupportedConcept,
    unsupportedConceptAsGenericCommand: expectsUnsupportedConcept && proposed.length > 0,
    tentativeTurn: expectsTentative,
    tentativeCommittedProposals: expectsTentative ? tentativeProposals : 0,
    tentativeCommittedAccepted: expectsTentative ? actualCommands.filter((command) => isCommittedManagementCommand(command.type)).length : 0,
  };
}

export function aggregateGoldMetrics(rows) {
  const totals = emptyTotals();
  for (const row of rows) addRow(totals, row);
  return finalize(totals);
}

export function aggregateGoldMetricsByCategory(rows) {
  return Object.fromEntries([...new Set(rows.map((row) => row.category))].sort().map((category) => [
    category, aggregateGoldMetrics(rows.filter((row) => row.category === category)),
  ]));
}

export function canonicalizeCommand(command) {
  return { type: normalizeString(command.type), params: canonicalizeValue(command.params ?? {}) };
}

function canonicalizeValue(value, key = null) {
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalizeValue(item));
    return SET_LIKE_ARRAY_KEYS.has(key) ? items.sort((a, b) => stableStringify(a).localeCompare(stableStringify(b))) : items;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((childKey) => [childKey, canonicalizeValue(value[childKey], childKey)]));
  }
  if (typeof value === "number") return Number(value);
  if (typeof value !== "string") return value;
  if (key === "dose") return canonicalDose(value);
  if (key === "route") return canonicalRoute(value);
  return normalizeString(value);
}

function canonicalDose(value) {
  const normalized = normalizeString(value).replace(/\s+/g, "");
  const match = /^(\d+(?:[.,]\d+)?)(мг|mg|г|g)$/.exec(normalized);
  if (!match) return normalized;
  const amount = Number(match[1].replace(",", "."));
  return `${/^(г|g)$/.test(match[2]) ? amount * 1000 : amount}mg`;
}

function canonicalRoute(value) {
  const normalized = normalizeString(value).replace(/\s+/g, "");
  if (["iv", "в/в", "вв", "внутривенно"].includes(normalized)) return "iv";
  if (["im", "в/м", "вм", "внутримышечно"].includes(normalized)) return "im";
  if (["po", "oral", "внутрь", "перорально"].includes(normalized)) return "oral";
  return normalized;
}

function emptyTotals() {
  return {
    runs: 0, goldCommands: 0, actualCommands: 0, matchedCommands: 0, exactTurns: 0,
    parameterizedGoldCommands: 0, parameterMatches: 0, unsupportedTurns: 0, unsupportedFalsePositives: 0,
    reasoningGold: 0, reasoningActual: 0, reasoningMatched: 0,
    patientQuestionGold: 0, patientQuestionActual: 0, patientQuestionMatched: 0,
    mentorAnswerGold: 0, mentorAnswerActual: 0, mentorAnswerMatched: 0,
    ambiguityGold: 0, ambiguityMatched: 0, unresolvedGold: 0, unresolvedMatched: 0,
    proposedCommands: 0, groundedProposedCommands: 0, missingEvidenceRejections: 0,
    reasoningOnlyTurns: 0, reasoningAsActionTurns: 0, mentorOnlyTurns: 0, mentorAnswerAsActionTurns: 0,
    crossChannelTurns: 0, crossChannelContaminatedTurns: 0,
    unsupportedConceptTurns: 0, unsupportedConceptAsGenericCommandTurns: 0,
    tentativeTurns: 0, tentativeCommittedProposals: 0, tentativeCommittedAccepted: 0,
    tentativePromotions: 0, inventedNumericBeforeBinder: 0, inventedNumericAfterBinder: 0,
    inventedRouteOrUnit: 0, highRiskBeforeBinder: 0, highRiskAfterBinder: 0, acceptedHighRiskAfterBinder: 0,
    schemaFailures: 0, providerFailures: 0, providerTimeouts: 0, providerTransportErrors: 0,
    providerInvalidResponses: 0, normalizationFailures: 0, binderFailures: 0, comparisonFailures: 0,
    providerReturnedRuns: 0, providerEvidenceCapturedRuns: 0, latenciesMs: [],
  };
}

function addRow(totals, row) {
  const item = row.evaluation;
  totals.runs += 1;
  totals.goldCommands += item.goldCommands.length;
  totals.actualCommands += item.actualCommands.length;
  totals.matchedCommands += item.matchedCommands;
  totals.exactTurns += item.exactTurn ? 1 : 0;
  totals.parameterizedGoldCommands += item.parameterizedGoldCommands;
  totals.parameterMatches += item.parameterMatches;
  if (item.goldCommands.length === 0) totals.unsupportedTurns += 1;
  totals.unsupportedFalsePositives += item.unsupportedFalsePositive ? 1 : 0;
  addSetTotals(totals, "reasoning", item.reasoning);
  addSetTotals(totals, "patientQuestion", item.patientQuestions);
  addSetTotals(totals, "mentorAnswer", item.mentorAnswer);
  totals.ambiguityGold += item.ambiguities.gold;
  totals.ambiguityMatched += item.ambiguities.matched;
  totals.unresolvedGold += item.unresolved.gold;
  totals.unresolvedMatched += item.unresolved.matched;
  totals.proposedCommands += item.proposedCommands.length;
  totals.groundedProposedCommands += item.groundedProposedCommands;
  totals.missingEvidenceRejections += item.missingEvidenceRejections;
  totals.reasoningOnlyTurns += item.reasoningOnly ? 1 : 0;
  totals.reasoningAsActionTurns += item.reasoningAsAction ? 1 : 0;
  totals.mentorOnlyTurns += item.mentorOnly ? 1 : 0;
  totals.mentorAnswerAsActionTurns += item.mentorAnswerAsAction ? 1 : 0;
  if (item.reasoningOnly || item.mentorOnly) totals.crossChannelTurns += 1;
  if (item.reasoningAsAction || item.mentorAnswerAsAction) totals.crossChannelContaminatedTurns += 1;
  totals.unsupportedConceptTurns += item.unsupportedConceptTurn ? 1 : 0;
  totals.unsupportedConceptAsGenericCommandTurns += item.unsupportedConceptAsGenericCommand ? 1 : 0;
  totals.tentativeTurns += item.tentativeTurn ? 1 : 0;
  totals.tentativeCommittedProposals += item.tentativeCommittedProposals;
  totals.tentativeCommittedAccepted += item.tentativeCommittedAccepted;
  const before = row.telemetry?.inventions?.beforeBinder ?? row.telemetry?.inventions ?? { highRisk: [], inventedNumericParameterCount: 0 };
  const after = row.telemetry?.inventions?.afterBinder ?? { highRisk: [], inventedNumericParameterCount: 0 };
  totals.inventedNumericBeforeBinder += before.inventedNumericParameterCount ?? 0;
  totals.inventedNumericAfterBinder += after.inventedNumericParameterCount ?? 0;
  totals.highRiskBeforeBinder += before.highRisk?.length ?? 0;
  totals.highRiskAfterBinder += after.highRisk?.length ?? 0;
  if (row.telemetry?.status === "valid") totals.acceptedHighRiskAfterBinder += after.highRisk?.length ?? 0;
  totals.tentativePromotions += (before.highRisk ?? []).filter((issue) => issue.kind === "tentative_not_committed").length;
  totals.inventedRouteOrUnit += (before.highRisk ?? []).filter((issue) => ["invented_route", "invented_dose_unit"].includes(issue.kind)).length;
  const status = row.telemetry?.status;
  totals.schemaFailures += status === "schema_validation_failure" ? 1 : 0;
  totals.providerTimeouts += status === "provider_timeout" ? 1 : 0;
  totals.providerTransportErrors += status === "provider_transport_error" ? 1 : 0;
  totals.providerInvalidResponses += status === "provider_invalid_response" ? 1 : 0;
  totals.providerFailures += ["provider_timeout", "provider_transport_error", "provider_invalid_response"].includes(status) ? 1 : 0;
  totals.normalizationFailures += status === "normalization_failure" ? 1 : 0;
  totals.binderFailures += status === "binder_failure" ? 1 : 0;
  totals.comparisonFailures += status === "comparison_failure" ? 1 : 0;
  const providerReturned = !["provider_timeout", "provider_transport_error"].includes(status);
  totals.providerReturnedRuns += providerReturned ? 1 : 0;
  totals.providerEvidenceCapturedRuns += providerReturned && row.telemetry?.providerEvidenceCaptured === true ? 1 : 0;
  if (Number.isFinite(row.telemetry?.elapsedMs)) totals.latenciesMs.push(row.telemetry.elapsedMs);
}

function finalize(totals) {
  return {
    runs: totals.runs,
    commandPrecision: ratio(totals.matchedCommands, totals.actualCommands),
    commandRecall: ratio(totals.matchedCommands, totals.goldCommands),
    canonicalExactTurnAgreement: ratio(totals.exactTurns, totals.runs),
    parameterFidelity: ratio(totals.parameterMatches, totals.parameterizedGoldCommands),
    unsupportedActionFalsePositiveRate: ratio(totals.unsupportedFalsePositives, totals.unsupportedTurns),
    ambiguityDetectionRecall: ratio(totals.ambiguityMatched, totals.ambiguityGold),
    unresolvedFragmentRecall: ratio(totals.unresolvedMatched, totals.unresolvedGold),
    reasoningDomainPrecision: ratio(totals.reasoningMatched, totals.reasoningActual),
    reasoningDomainRecall: ratio(totals.reasoningMatched, totals.reasoningGold),
    patientQuestionPrecision: ratio(totals.patientQuestionMatched, totals.patientQuestionActual),
    patientQuestionRecall: ratio(totals.patientQuestionMatched, totals.patientQuestionGold),
    contextualMentorAnswerRecall: ratio(totals.mentorAnswerMatched, totals.mentorAnswerGold),
    groundedCommandRate: ratio(totals.groundedProposedCommands, totals.proposedCommands),
    commandRejectionDueToMissingVerbatimEvidence: totals.missingEvidenceRejections,
    crossChannelContaminationRate: ratio(totals.crossChannelContaminatedTurns, totals.crossChannelTurns),
    reasoningAsActionRate: ratio(totals.reasoningAsActionTurns, totals.reasoningOnlyTurns),
    mentorAnswerAsActionRate: ratio(totals.mentorAnswerAsActionTurns, totals.mentorOnlyTurns),
    unsupportedConceptAsGenericCommandRate: ratio(totals.unsupportedConceptAsGenericCommandTurns, totals.unsupportedConceptTurns),
    tentativeToCommittedProposalRateBeforeValidator: ratio(totals.tentativeCommittedProposals, totals.tentativeTurns),
    tentativeToCommittedAcceptedRateAfterValidator: ratio(totals.tentativeCommittedAccepted, totals.tentativeTurns),
    tentativeToCommittedPromotionCount: totals.tentativePromotions,
    inventedNumericParameterCountBeforeBinder: totals.inventedNumericBeforeBinder,
    inventedNumericParameterCountAfterBinder: totals.inventedNumericAfterBinder,
    inventedRouteOrUnitCount: totals.inventedRouteOrUnit,
    highRiskInventionCountBeforeBinder: totals.highRiskBeforeBinder,
    highRiskInventionCountAfterBinder: totals.highRiskAfterBinder,
    acceptedHighRiskInventionCountAfterBinder: totals.acceptedHighRiskAfterBinder,
    schemaFailureRate: ratio(totals.schemaFailures, totals.runs),
    providerFailureRate: ratio(totals.providerFailures, totals.runs),
    localNormalizationFailureRate: ratio(totals.normalizationFailures, totals.runs),
    rawProviderEvidenceCaptureRate: ratio(totals.providerEvidenceCapturedRuns, totals.providerReturnedRuns),
    latencyP50Ms: percentile(totals.latenciesMs, 0.5),
    latencyP95Ms: percentile(totals.latenciesMs, 0.95),
    counts: { ...totals, latenciesMs: undefined },
  };
}

function addSetTotals(totals, prefix, counts) { totals[`${prefix}Gold`] += counts.gold; totals[`${prefix}Actual`] += counts.actual; totals[`${prefix}Matched`] += counts.matched; }
function setCounts(gold, actual) { return { gold: gold.size, actual: actual.size, matched: [...actual].filter((item) => gold.has(item)).length }; }
function canonicalSet(items) { return new Set(items.map(normalizeString)); }
function canonicalIssueSet(items) { return new Set(items.map(canonicalIssue)); }
function canonicalIssue(issue) {
  if (typeof issue === "string") return normalizeString(issue);
  return `${normalizeString(issue?.reason)}|${normalizeString(issue?.evidenceSpan)}`;
}
function issueReason(issue) { return typeof issue === "string" ? normalizeString(issue) : normalizeString(issue?.reason); }
function isCommittedManagementCommand(type) { return ["order_procedure", "start_procedure", "operative_decision", "commit_management_plan", "disposition", "transfer", "move_patient", "discharge"].includes(normalizeString(type)); }
function isGroundingError(error) { return ["evidence_not_verbatim", "lexical_anchor_missing", "params.analytes_not_grounded", "params.targets_not_grounded"].includes(error); }
function reasoningDomains(delta) {
  const domains = [];
  if (meaningfulObject(delta.stability, ["stated", "learnerAssessment"])) domains.push("stability");
  if (meaningfulObject(delta.problemRepresentation, ["stated", "verbatim"])) domains.push("problemRepresentation");
  if (meaningfulObject(delta.workingDiagnosis, ["stated", "conceptId", "uncertaintyExpressed"])) domains.push("workingDiagnosis");
  if (
    (Array.isArray(delta.differential) && delta.differential.length) ||
    meaningfulObject(delta.differential, ["stated"]) ||
    (Array.isArray(delta.differential?.items) && delta.differential.items.length)
  ) domains.push("differential");
  if (Array.isArray(delta.investigations?.items) && delta.investigations.items.length) domains.push("investigations");
  if (meaningfulObject(delta.management, ["planStated", "urgencyStated", "rationaleStated"])) domains.push("management");
  if (
    delta.observation?.active === true || delta.observation?.active === false ||
    meaningfulObject(delta.observation, ["goalStated", "reassessmentIntervalStated", "escalationCriteriaStated"])
  ) domains.push("observation");
  if (meaningfulObject(delta.reassessment, ["stated"])) domains.push("reassessment");
  if (
    meaningfulObject(delta.contingency, ["stated", "specificity"]) ||
    (Array.isArray(delta.contingency?.triggerConceptIds) && delta.contingency.triggerConceptIds.length)
  ) domains.push("contingency");
  if (meaningfulObject(delta.disposition, ["stated", "destination"])) domains.push("disposition");
  if (meaningfulObject(delta.consultation, ["ownAssessmentStated", "consultationQuestionStated"])) domains.push("consultation");
  if (typeof delta.statement === "string" && delta.statement.trim()) domains.push("statement");
  return domains;
}
function meaningfulObject(value, keys) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && keys.some((key) => {
    const item = value[key];
    return item === true || (typeof item === "string" && item.trim());
  });
}
function sameIdentityAndParams(gold, actual) { if (gold.type !== actual.type) return false; for (const key of IDENTITY_KEYS) if (gold.params[key] != null && gold.params[key] !== actual.params[key]) return false; return stableStringify(gold.params) === stableStringify(actual.params); }
function sameCommandIdentity(gold, actual) { if (gold.type !== actual.type) return false; for (const key of IDENTITY_KEYS) if (gold.params[key] != null && gold.params[key] !== actual.params[key]) return false; return true; }
function multisetIntersection(left, right) { const pool = right.map(stableStringify); let count = 0; for (const item of left.map(stableStringify)) { const index = pool.indexOf(item); if (index >= 0) { count += 1; pool.splice(index, 1); } } return count; }
function multisetIntersectionBy(left, right, predicate) { const pool = [...right]; let count = 0; for (const item of left) { const index = pool.findIndex((candidate) => predicate(item, candidate)); if (index >= 0) { count += 1; pool.splice(index, 1); } } return count; }
function multisetDifference(left, right) { const pool = right.map(stableStringify); return left.filter((item) => { const index = pool.indexOf(stableStringify(item)); if (index < 0) return true; pool.splice(index, 1); return false; }); }
function stableStringify(value) { return JSON.stringify(value); }
function normalizeString(value) { return String(value ?? "").trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " "); }
function ratio(numerator, denominator) { return denominator === 0 ? null : Number((numerator / denominator).toFixed(4)); }
function percentile(values, fraction) { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.ceil(fraction * sorted.length) - 1]; }

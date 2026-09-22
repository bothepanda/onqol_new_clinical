import { matchesGold as stage2Matches, stage2Metrics } from "./stage2Metrics.mjs";
import { validateCommand } from "../src/core/commands/commandTypes.js";
import { bindModelCommand, HIGH_RISK_PARAMETER_KEYS } from "../src/ai/interpreter/deterministicParameterBinder.js";
import { createPromotionPolicy } from "../src/ai/interpreter/promotionPolicy.js";
import { effectiveGold } from "./v3Corpus.mjs";

/**
 * Interpreter v3 metrics. Deterministic-only and v3 are ALWAYS reported
 * separately, from the same rows, so neither can borrow the other's number.
 *
 * Definitions are fixed here and are part of the freeze: changing one after a
 * holdout has been seen invalidates that holdout (see docs/INTERPRETER_V3_ARCHITECTURE.md).
 *
 *  committed command   a final action command that is complete (validateCommand
 *                      SUFFICIENT). An incomplete command asks a question and
 *                      commits nothing, so it is a clarification, not a command.
 *  exact set           committed commands == gold commands (as a multiset, gold
 *                      params as a subset, `absent` keys must be missing) and the
 *                      disposition holds: commands -> nothing unresolved and no
 *                      clarification; clarify -> a clarification or unresolved
 *                      fragment surfaces and nothing outside gold is committed;
 *                      unresolved -> a fragment stays unresolved; no_action -> no
 *                      action command at all.
 *  false execution     an EXECUTED command that matches no gold command.
 *  inappropriate clar. a CLARIFY outcome on a row whose gold is commands / no_action.
 */
const BOOKKEEPING = new Set(["STATE_REASONING", "ANSWER_MENTOR"]);
const policy = createPromotionPolicy();
const actions = (commands = []) => commands.filter((c) => !BOOKKEEPING.has(c.type));
const complete = (command) => validateCommand(command).outcome === "SUFFICIENT";
const isComplete = complete;

export function matchesGold(command, gold) {
  if (!stage2Matches(command, { type: gold.type, params: gold.params ?? {} })) return false;
  return (gold.absent ?? []).every((key) => command.params?.[key] === undefined);
}

function view(row, kind) {
  const reading = kind === "v3" ? row.hybrid : row.deterministic;
  const executed = kind === "v3" ? row.executedCommands : row.deterministicExecuted;
  const clarified = kind === "v3" ? row.hybrid?.clarified === true : row.deterministic?.clarified === true;
  return {
    reading,
    final: actions(reading?.commands),
    executed: actions(executed),
    clarified,
    unresolved: (reading?.unmatchedFragments?.length ?? 0) > 0,
  };
}

/** Does this one row satisfy its gold under the definitions above? */
export function rowExact(row, kind, gold) {
  const { final, clarified, unresolved } = view(row, kind);
  const committed = final.filter(isComplete);
  const remaining = [...gold.commands];
  const matchedGold = (command) => {
    const index = remaining.findIndex((g) => matchesGold(command, g));
    if (index < 0) return false;
    remaining.splice(index, 1);
    return true;
  };
  if (gold.disposition === "clarify" && gold.commands.some((g) => g.absent?.length)) {
    // Gold names the incomplete command itself: it must be present, incomplete, and non-gold params absent.
    const incomplete = final.filter((c) => !isComplete(c));
    const goldMatched = gold.commands.every((g) => final.some((c) => matchesGold(c, g)));
    return goldMatched && incomplete.length > 0 && committed.every((c) => gold.commands.some((g) => matchesGold(c, g))) && (clarified || unresolved);
  }
  if (!committed.every(matchedGold)) return false;
  if (gold.disposition === "clarify") {
    const goldStillOpen = remaining.every((g) => final.some((c) => matchesGold(c, g)));
    return goldStillOpen && (clarified || unresolved || final.some((c) => !isComplete(c)));
  }
  if (remaining.length) return false;
  if (gold.disposition === "unresolved") return unresolved;
  if (gold.disposition === "no_action") return final.length === 0 && !clarified;
  return !unresolved && !clarified;
}

function blockFor(rows, kind, adjudication, { sessionTurns }) {
  const scored = rows.map((row) => ({ row, ...effectiveGold(row, adjudication) })).filter((item) => item.gold);
  const verdicts = scored.map(({ row, gold }) => ({ row, gold, exact: rowExact(row, kind, gold), v: view(row, kind) }));

  const executed = verdicts.flatMap(({ gold, v }) => v.executed.map((command) => ({ command, correct: gold.commands.some((g) => matchesGold(command, g)) })));
  const committed = verdicts.flatMap(({ gold, v }) => v.final.filter(isComplete).map((command) => ({ command, correct: gold.commands.some((g) => matchesGold(command, g)) })));
  const goldTotal = verdicts.reduce((n, { gold }) => n + gold.commands.length, 0);
  const goldHit = verdicts.reduce((n, { gold, v }) => n + gold.commands.filter((g) => v.final.some((c) => matchesGold(c, g))).length, 0);
  const falseExecuted = executed.filter((item) => !item.correct);

  const strictRows = verdicts.filter(({ gold }) => ["commands", "no_action"].includes(gold.disposition));
  const questionRows = verdicts.filter(({ gold }) => gold.commands.some((g) => ["ASK_PATIENT", "ASK_FASTING_HISTORY"].includes(g.type)));

  const groups = new Map();
  for (const item of verdicts) groups.set(item.row.group, [...(groups.get(item.row.group) ?? []), item.exact]);
  const byCategory = {};
  for (const item of verdicts) {
    const bucket = (byCategory[item.row.category] ??= { rows: 0, exact: 0 });
    bucket.rows += 1;
    bucket.exact += item.exact ? 1 : 0;
  }

  const conflictRows = kind === "v3" ? verdicts.filter(({ row }) => (row.hybrid?.semanticTelemetry?.conflicts?.length ?? 0) > 0) : [];
  const consulted = verdicts.filter(({ row }) => row.hybrid?.semanticTelemetry?.called === true);
  const latencies = verdicts.map(({ row }) => (kind === "v3" ? row.elapsedMs : row.deterministicMs)).filter(Number.isFinite).sort((a, b) => a - b);
  const costs = kind === "v3" ? verdicts.map(({ row }) => row.costUsd) : verdicts.map(() => 0);
  const costKnown = costs.every(Number.isFinite);
  const totalCost = costKnown ? costs.reduce((n, c) => n + c, 0) : null;
  const resolutionCounts = {};
  if (kind === "v3") {
    for (const { row } of verdicts) for (const r of row.hybrid?.semanticTelemetry?.finalCommands ?? []) resolutionCounts[r.resolution] = (resolutionCounts[r.resolution] ?? 0) + 1;
  }
  const pct = (n, d) => (d ? n / d : null);
  const quantile = (q) => (latencies.length ? latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * q) - 1)] : null);

  return {
    rows: verdicts.length,
    groups: groups.size,
    exactFinalCommandSetAccuracy: pct(verdicts.filter((x) => x.exact).length, verdicts.length),
    exactSetAccuracyByGroup: pct([...groups.values()].filter((list) => list.every(Boolean)).length, groups.size),
    commandPrecision: pct(committed.filter((x) => x.correct).length, committed.length),
    committedCommandCount: committed.length,
    commandRecall: pct(goldHit, goldTotal),
    executedCommandCount: executed.length,
    executedCommandPrecision: pct(executed.filter((x) => x.correct).length, executed.length),
    falseExecutionRate: pct(falseExecuted.length, executed.length),
    falseExecutionCount: falseExecuted.length,
    inappropriateClarificationRate: pct(strictRows.filter(({ v }) => v.clarified).length, strictRows.length),
    inappropriateClarificationCount: strictRows.filter(({ v }) => v.clarified).length,
    semanticConflictResolutionAccuracy: kind === "v3" ? pct(conflictRows.filter((x) => x.exact).length, conflictRows.length) : null,
    semanticConflictRows: conflictRows.length,
    parameterInventionCount: kind === "v3" ? verdicts.reduce((n, { row }) => n + inventedParameters(row), 0) : 0,
    highRiskFalseExecutionCount: falseExecuted.filter(({ command }) => policy.isProtected(command.type) && !["WAIT", "REPEAT_LAST", "END_CASE"].includes(command.type)).length,
    patientQuestionAccuracy: pct(questionRows.filter((x) => x.exact).length, questionRows.length),
    patientQuestionRows: questionRows.length,
    providerFallbackRate: kind === "v3" ? pct(consulted.filter(({ row }) => row.hybrid?.mode === "hybrid_fallback_deterministic").length, consulted.length) : null,
    consultationRate: kind === "v3" ? pct(consulted.length, verdicts.length) : 0,
    latencyMs: { p50: quantile(0.5), p95: quantile(0.95) },
    costUsd: { total: totalCost, perTurn: totalCost == null ? null : totalCost / Math.max(1, verdicts.length), perConsultedTurn: totalCost == null || !consulted.length ? null : totalCost / consulted.length,
      projectedPerSession: totalCost == null ? null : (totalCost / Math.max(1, verdicts.length)) * sessionTurns, sessionTurnsAssumed: sessionTurns },
    resolutionCounts,
    byCategory,
    goldSources: verdicts.reduce((acc, { row }) => { const { source } = effectiveGold(row, adjudication); acc[source] = (acc[source] ?? 0) + 1; return acc; }, {}),
  };
}

/** Model-supplied high-risk parameters that the learner's literal text does not support. */
function inventedParameters(row) {
  let count = 0;
  for (const command of row.hybrid?.semanticTelemetry?.addedCommands ?? []) {
    const bound = bindModelCommand({ candidate: { type: command.type, params: {}, evidenceSpans: [command.sourceText] }, rawText: row.text, openClarification: row.turnContext?.openClarification }).command.params;
    for (const key of HIGH_RISK_PARAMETER_KEYS) {
      if (command.params?.[key] != null && String(command.params[key]).replace(/\s+/g, "") !== String(bound[key] ?? "").replace(/\s+/g, "")) count += 1;
    }
  }
  return count;
}

export function v3Metrics(rows, { adjudication = null, sessionTurns = 30 } = {}) {
  return {
    definitions: "scripts/v3Metrics.mjs header; frozen with the candidate",
    deterministicOnly: blockFor(rows, "deterministic", adjudication, { sessionTurns }),
    v3: blockFor(rows, "v3", adjudication, { sessionTurns }),
    // The Stage 2 definitions, on the same rows, so v3 is comparable with the 2026-09-19 evidence.
    stage2Compat: stage2Metrics(rows.filter((row) => row.corpusVersion === "stage2")),
  };
}

/**
 * Freeze eligibility is independent of any metric value: development numbers
 * cannot make a candidate eligible, and eligibility cannot lift NO-GO by itself.
 */
export function v3FreezeEligibility({ adjudication, realPilotTurns, realPilotRequired = 60, independentGoldReview = false, frozen = false }) {
  const rows = Object.values(adjudication?.rows ?? {});
  const adjudicated = rows.filter((entry) => entry.decision).length;
  const blockers = [];
  if (adjudicated < rows.length) blockers.push(`gold_adjudication_incomplete:${adjudicated}/${rows.length}`);
  if (!independentGoldReview) blockers.push("independent_gold_review_missing");
  if (realPilotTurns < realPilotRequired) blockers.push(`real_resident_turns:${realPilotTurns}/${realPilotRequired}`);
  if (!frozen) blockers.push("code_prompt_schema_registry_metrics_not_frozen");
  return { eligible: blockers.length === 0, blockers, holdoutVerdict: "NO-GO", holdoutMayRun: blockers.length === 0 };
}

import { validateCommand } from "../../src/core/commands/commandTypes.js";
import { HIGH_RISK_PARAMETER_KEYS, bindModelCommand } from "../../src/ai/interpreter/deterministicParameterBinder.js";
import { createPromotionPolicy } from "../../src/ai/interpreter/promotionPolicy.js";

/**
 * Metrics for legacy_real_language_development. Definitions are fixed here and are part of the
 * freeze of the corpus artifact: they are NOT changed to make a number pass.
 *
 *  committed command   a final action command that is complete (validateCommand SUFFICIENT)
 *  incomplete command  a final action command with a missing required parameter: the character will ask
 *  executed command    a command the real turn pipeline reported EXECUTED
 *  gold `execute`      one committed command must match (type or altType; gold params a subset; `absent` keys unfilled)
 *  gold `clarify`      the INCOMPLETE command must appear with the stated params, the `absent` keys unfilled
 *  gold `either`       a committed command or the clarification, either is right
 *  gold `optional`     never a miss; a matching command is never a false execution
 *
 *  exact (row)         every required gold is satisfied AND nothing else is committed/executed AND no
 *                      spurious clarification AND no absent parameter was filled in
 *  false execution     an EXECUTED command that matches no gold command of the row (any mode)
 *  high-risk           a false execution whose type is a protected class of the promotion policy
 *  invented parameter  (a) a parameter the gold marks `absent` was filled, or (b) a model-added command carries a
 *                      numeric/route parameter its own evidence does not literally support (the v3 definition)
 *  precision           correct committed / committed (correct = matches some gold command)
 *  recall              required gold satisfied / required gold (execute + clarify + either)
 */
const BOOKKEEPING = new Set(["STATE_REASONING", "ANSWER_MENTOR"]);
const policy = createPromotionPolicy();
const actionsOf = (commands = []) => commands.filter((c) => !BOOKKEEPING.has(c.type));
export const isComplete = (command) => validateCommand(command).outcome === "SUFFICIENT";

const norm = (value) => (typeof value === "string" ? value.replace(/\s+/g, "").toLowerCase() : value);
const filled = (value) => value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && value.length === 0);
const same = (actual, wanted) => (Array.isArray(wanted)
  ? Array.isArray(actual) && actual.length === wanted.length && [...actual].map(norm).sort().join("|") === [...wanted].map(norm).sort().join("|")
  : JSON.stringify(norm(actual)) === JSON.stringify(norm(wanted)));
export const paramsMatch = (actual = {}, wanted = {}) => Object.entries(wanted).every(([key, value]) => same(actual[key], value));

/** Does `command` read the same words as gold `g`? An altType is a different type for the same words: params are not compared. */
export function matchesGold(command, g) {
  if (command.type !== g.type) return (g.altTypes ?? []).includes(command.type);
  return [g.params ?? {}, ...(g.anyOf ?? [])].some((params) => paramsMatch(command.params, params));
}
/** An incomplete command that does not contradict gold `g`: same type (or altType), every parameter it DOES carry agrees with gold. */
export function compatibleIncomplete(command, g) {
  if (command.type !== g.type) return (g.altTypes ?? []).includes(command.type);
  return Object.entries(command.params ?? {}).every(([key, value]) => !filled(value) || !(key in (g.params ?? {})) || same(value, g.params[key]));
}
export const absentViolations = (command, g) => (g.absent ?? []).filter((key) => filled(command.params?.[key]));
const modeOf = (g) => g.expect ?? "execute";
const REQUIRED = new Set(["execute", "clarify", "either"]);

export function viewOf(row, kind) {
  const reading = kind === "v3" ? row.hybrid : row.deterministic;
  const executed = kind === "v3" ? row.executedCommands : row.deterministicExecuted;
  const final = actionsOf(reading?.commands);
  return {
    reading, final, executed: actionsOf(executed),
    complete: final.filter(isComplete), incomplete: final.filter((c) => !isComplete(c)),
    withheld: reading?.withheldCommands ?? [], unmatched: reading?.unmatchedFragments ?? [],
  };
}

/** Score one row against its gold. Pure: no I/O. */
export function scoreRow(row, kind, gold) {
  const view = viewOf(row, kind);
  const used = new Set();
  const take = (candidates, g) => {
    const found = candidates.find((c) => !used.has(c) && matchesGold(c, g));
    if (found) used.add(found);
    return found ?? null;
  };
  const satisfied = [];
  const missed = [];
  const invented = [];
  const completedInsteadOfClarify = [];
  const optionalHit = [];
  const order = ["execute", "clarify", "either", "optional"];
  const golds = [...gold.commands].sort((a, b) => order.indexOf(modeOf(a)) - order.indexOf(modeOf(b)));

  for (const g of golds) {
    const mode = modeOf(g);
    let hit = null;
    let via = null;
    if (mode === "execute") { hit = take(view.complete, g); via = "complete"; }
    else if (mode === "clarify") {
      hit = take(view.incomplete, g); via = "incomplete";
      if (!hit) { const done = take(view.complete, g); if (done) { (absentViolations(done, g).length ? completedInsteadOfClarify : satisfied).push({ gold: g, command: done, via: "complete" }); continue; } }
    } else if (mode === "either") {
      hit = take(view.complete, g);
      if (!hit) { hit = view.incomplete.find((c) => !used.has(c) && compatibleIncomplete(c, g)) ?? null; if (hit) used.add(hit); }
      via = hit && isComplete(hit) ? "complete" : "incomplete";
    } else { hit = take(view.complete, g) ?? take(view.incomplete, g); via = hit && isComplete(hit) ? "complete" : "incomplete"; }
    if (hit) {
      const bad = absentViolations(hit, g);
      if (bad.length) invented.push({ command: hit, keys: bad, gold: g });
      (mode === "optional" ? optionalHit : satisfied).push({ gold: g, command: hit, via });
    } else if (REQUIRED.has(mode)) missed.push({ gold: g, mode });
  }

  const matchesAnyGold = (command) => gold.commands.some((g) => matchesGold(command, g));
  const falseCommits = view.complete.filter((c) => !used.has(c) && !matchesAnyGold(c));
  const spuriousClarifications = view.incomplete.filter((c) => !used.has(c) && !matchesAnyGold(c));
  const falseExecutions = view.executed.filter((c) => !matchesAnyGold(c));
  const requiredTotal = gold.commands.filter((g) => REQUIRED.has(modeOf(g))).length;
  const exact = missed.length === 0 && falseCommits.length === 0 && falseExecutions.length === 0 && spuriousClarifications.length === 0
    && invented.length === 0 && completedInsteadOfClarify.length === 0;
  const committedCorrect = view.complete.filter(matchesAnyGold).length;
  return {
    exact, satisfied, missed, invented, completedInsteadOfClarify, optionalHit, falseCommits, spuriousClarifications, falseExecutions,
    requiredTotal, requiredHit: satisfied.length, committedTotal: view.complete.length, committedCorrect,
    view,
  };
}

/** The v3 definition: model-added protected parameters that the learner's literal text does not support. */
export function modelInventedParameters(row) {
  let count = 0;
  for (const command of row.hybrid?.semanticTelemetry?.addedCommands ?? []) {
    const bound = bindModelCommand({ candidate: { type: command.type, params: {}, evidenceSpans: [command.sourceText] }, rawText: row.text, openClarification: row.turnContext?.openClarification }).command.params;
    for (const key of HIGH_RISK_PARAMETER_KEYS) {
      if (command.params?.[key] != null && String(command.params[key]).replace(/\s+/g, "") !== String(bound[key] ?? "").replace(/\s+/g, "")) count += 1;
    }
  }
  return count;
}

const pct = (n, d) => (d ? n / d : null);

/** Aggregate block over already-scored rows. `scored` = [{ row, gold, score }]. */
export function aggregate(scored, kind) {
  const rows = scored.length;
  const actionRows = scored.filter(({ gold }) => gold.commands.some((g) => REQUIRED.has(modeOf(g))));
  const restraintRows = scored.filter(({ gold }) => !gold.commands.some((g) => REQUIRED.has(modeOf(g))));
  const falseExec = scored.flatMap(({ row, score }) => score.falseExecutions.map((command) => ({ turnId: row.id, command })));
  const highRisk = falseExec.filter(({ command }) => policy.isProtected(command.type) && !["WAIT", "REPEAT_LAST", "END_CASE"].includes(command.type));
  const inventedGold = scored.flatMap(({ row, score }) => [...score.invented, ...score.completedInsteadOfClarify.map((x) => ({ ...x, keys: absentViolations(x.command, x.gold) }))].map((x) => ({ turnId: row.id, ...x })));
  const inventedModel = kind === "v3" ? scored.map(({ row }) => ({ turnId: row.id, count: modelInventedParameters(row) })).filter((x) => x.count) : [];
  const committedTotal = scored.reduce((n, { score }) => n + score.committedTotal, 0);
  const committedCorrect = scored.reduce((n, { score }) => n + score.committedCorrect, 0);
  const requiredTotal = scored.reduce((n, { score }) => n + score.requiredTotal, 0);
  const requiredHit = scored.reduce((n, { score }) => n + score.requiredHit, 0);
  const consulted = kind === "v3" ? scored.filter(({ row }) => row.hybrid?.semanticTelemetry?.called === true) : [];
  const costs = kind === "v3" ? scored.map(({ row }) => row.costUsd).filter(Number.isFinite) : [];
  const byChannel = {};
  for (const { row, score } of scored) { const b = (byChannel[row.channel] ??= { rows: 0, exact: 0 }); b.rows += 1; b.exact += score.exact ? 1 : 0; }
  return {
    rows,
    exactAccuracy: pct(scored.filter(({ score }) => score.exact).length, rows),
    exactRows: scored.filter(({ score }) => score.exact).length,
    exactOnActionRows: pct(actionRows.filter(({ score }) => score.exact).length, actionRows.length), actionRows: actionRows.length,
    exactOnRestraintRows: pct(restraintRows.filter(({ score }) => score.exact).length, restraintRows.length), restraintRows: restraintRows.length,
    commandPrecision: pct(committedCorrect, committedTotal), committedCommandCount: committedTotal,
    commandRecall: pct(requiredHit, requiredTotal), requiredGoldCount: requiredTotal,
    falseExecutionCount: falseExec.length, falseExecutionRows: [...new Set(falseExec.map((x) => x.turnId))],
    highRiskFalseExecutionCount: highRisk.length, highRiskFalseExecutionRows: [...new Set(highRisk.map((x) => x.turnId))],
    inventedParameterCount: inventedGold.length + inventedModel.reduce((n, x) => n + x.count, 0),
    inventedFromGoldAbsent: inventedGold.length, inventedByModel: inventedModel.reduce((n, x) => n + x.count, 0),
    inventedParameterRows: [...new Set([...inventedGold.map((x) => x.turnId), ...inventedModel.map((x) => x.turnId)])],
    spuriousClarificationCount: scored.reduce((n, { score }) => n + score.spuriousClarifications.length, 0),
    providerFallbackRate: kind === "v3" ? pct(consulted.filter(({ row }) => row.hybrid?.mode === "hybrid_fallback_deterministic").length, consulted.length) : null,
    consultationRate: kind === "v3" ? pct(consulted.length, rows) : 0, consultedRows: consulted.length,
    costUsd: kind === "v3" && costs.length === rows ? costs.reduce((a, b) => a + b, 0) : null,
    byChannel,
  };
}

export const TARGETS = Object.freeze({
  falseExecutions: 0, highRiskFalseExecutions: 0, inventedParameters: 0, precision: 0.95, recall: 0.9, exact: 0.9,
});

export function targetReport(block) {
  const gate = (name, value, pass) => ({ name, value, pass });
  return [
    gate("false executions = 0", block.falseExecutionCount, block.falseExecutionCount === 0),
    gate("high-risk false executions = 0", block.highRiskFalseExecutionCount, block.highRiskFalseExecutionCount === 0),
    gate("invented parameters = 0", block.inventedParameterCount, block.inventedParameterCount === 0),
    gate("precision >= 0.95", block.commandPrecision, block.commandPrecision !== null && block.commandPrecision >= TARGETS.precision),
    gate("recall >= 0.90", block.commandRecall, block.commandRecall !== null && block.commandRecall >= TARGETS.recall),
    gate("exact interpretation >= 0.90", block.exactAccuracy, block.exactAccuracy !== null && block.exactAccuracy >= TARGETS.exact),
  ];
}

import { interpretHybrid } from "../src/ai/interpreter/hybridInterpreter.js";
import { interpretDeterministically } from "../src/ai/interpreter/deterministicInterpreter.js";
import { validateCommand } from "../src/core/commands/commandTypes.js";
import { createSession } from "../src/core/session/createSession.js";
import { submitLearnerTurn } from "../src/core/session/submitLearnerTurn.js";

/**
 * Runs every row through BOTH readings, each executed through the real turn
 * pipeline on a fresh session:
 *   deterministic  interpretDeterministically only (the pre-v3 fast path)
 *   hybrid         interpretHybrid (consultation policy + arbitration)
 * The two never share a result, so the reports can be kept separate.
 */
export async function evaluateV3Rows({ rows, bundle, providerForRow, hybridTimeoutMs, beforeRow = async () => {}, afterRow = async () => {} }) {
  const evaluated = [];
  for (const row of rows) {
    await beforeRow(row);
    const newSession = () => createSession({ sessionId: row.id, seed: row.id, mode: "reference", casePresetId: "APP-004", sessionPurpose: "internal_development", bundle, locale: "ru", startIso: "2026-09-19T08:00:00+05:00" });

    const dStarted = performance.now();
    const deterministic = interpretDeterministically({ text: row.text, bundle, turnContext: row.turnContext });
    const deterministicMs = performance.now() - dStarted;
    const dTurn = submitLearnerTurn({ session: newSession(), text: row.text, interpreted: deterministic });
    deterministic.clarified = dTurn.outcomes.some((outcome) => outcome.outcome === "CLARIFY") || deterministic.commands.some((c) => validateCommand(c).outcome === "CLARIFY");

    const started = Date.now();
    const hybrid = await interpretHybrid({ text: row.text, bundle, turnContext: row.turnContext, provider: providerForRow(row), ...(hybridTimeoutMs ? { timeoutBudgetMs: hybridTimeoutMs } : {}) });
    const hTurn = submitLearnerTurn({ session: newSession(), text: row.text, interpreted: hybrid });
    hybrid.clarified = hTurn.outcomes.some((outcome) => outcome.outcome === "CLARIFY");

    const result = {
      ...row, deterministic, hybrid, deterministicMs, elapsedMs: Date.now() - started,
      costUsd: hybrid.semanticTelemetry?.costUsd ?? (hybrid.mode === "deterministic" ? 0 : null),
      deterministicExecuted: dTurn.outcomes.filter((outcome) => outcome.outcome === "EXECUTED").map((outcome) => outcome.command),
      executedCommands: hTurn.outcomes.filter((outcome) => outcome.outcome === "EXECUTED").map((outcome) => outcome.command),
      evaluationStatus: "EVALUATED",
    };
    await afterRow(result);
    evaluated.push(result);
  }
  return evaluated;
}

import { interpretHybrid } from "../src/ai/interpreter/hybridInterpreter.js";
import { interpretDeterministically } from "../src/ai/interpreter/deterministicInterpreter.js";
import { validateCommand } from "../src/core/commands/commandTypes.js";
import { createSession } from "../src/core/session/createSession.js";
import { submitLearnerTurn } from "../src/core/session/submitLearnerTurn.js";

export async function evaluateStage2Rows({ rows, bundle, providerForRow, beforeRow = async () => {}, afterRow = async () => {} }) {
  const evaluated = [];
  for (const row of rows) {
    await beforeRow(row);
    const started = Date.now();
    const deterministic = interpretDeterministically({ text: row.text, bundle, turnContext: row.turnContext });
    deterministic.clarified = deterministic.commands.some((command) => validateCommand(command).outcome === "CLARIFY");
    const hybrid = await interpretHybrid({ text: row.text, bundle, turnContext: row.turnContext, provider: providerForRow(row) });
    const session = createSession({ sessionId: row.id, seed: row.id, mode: "reference", casePresetId: "APP-004", sessionPurpose: "internal_development", bundle, locale: "ru", startIso: "2026-09-08T08:00:00+05:00" });
    const turn = submitLearnerTurn({ session, text: row.text, interpreted: hybrid });
    hybrid.clarified = turn.outcomes.some((outcome) => outcome.outcome === "CLARIFY");
    const result = { ...row, deterministic, hybrid, elapsedMs: Date.now() - started,
      costUsd: hybrid.semanticTelemetry?.costUsd ?? (hybrid.mode === "deterministic" ? 0 : null),
      executedCommands: turn.outcomes.filter((outcome) => outcome.outcome === "EXECUTED").map((outcome) => outcome.command), evaluationStatus: "EVALUATED" };
    await afterRow(result);
    evaluated.push(result);
  }
  return evaluated;
}

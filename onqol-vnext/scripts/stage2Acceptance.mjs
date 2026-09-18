import process from "node:process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { root, date, evidence, loadStage2Env, liveGateway } from "./stage2Runtime.mjs";
import { interpretHybrid } from "../src/ai/interpreter/hybridInterpreter.js";
import { interpretDeterministically } from "../src/ai/interpreter/deterministicInterpreter.js";
import { createSession } from "../src/core/session/createSession.js";
import { submitLearnerTurn, buildTurnContext } from "../src/core/session/submitLearnerTurn.js";
import { exportSession } from "../src/core/replay/exportSession.js";
import { withShared } from "../src/core/content/loadBundle.js";
import disease from "../src/content/generated/appendicitis.json" with { type: "json" };
import shared from "../src/content/generated/shared.json" with { type: "json" };

loadStage2Env();
const bundle = withShared(disease, shared);
if (process.argv.includes("--broken-key")) {
  const gateway = await liveGateway({ apiKey: "stage2-intentionally-invalid" });
  try {
    const text = "оак и ультразвук живота";
    const result = await interpretHybrid({ text, bundle, provider: gateway.provider("stage2-broken-key") });
    const baseline = interpretDeterministically({ text, bundle });
    const pass = result.semanticTelemetry?.errorCode === "provider_auth" && JSON.stringify(result.commands) === JSON.stringify(baseline.commands);
    evidence("BROKEN_KEY", { status: pass ? "PASS" : "FAIL", result, rawProviderResponses: gateway.raw });
    console.log(`stage2:broken-key ${pass ? "PASS" : "FAIL"}`);
    if (!pass) process.exitCode = 1;
  } finally { await gateway.close(); }
} else {
  const smoke = JSON.parse(readFileSync(path.join(root, `docs/evidence/STAGE2_HYBRID_LIVE_SMOKE_${date}.json`), "utf8"));
  if (!smoke.validSchema) {
    evidence("ACCEPTANCE_SESSION", { status: "BLOCKED_BEFORE_CALLS", reason: "Live strict-schema smoke has no valid response", providerAnswered: false, export: null });
    console.log("stage2:acceptance BLOCKED_BEFORE_CALLS");
    process.exitCode = 1;
  } else {
    const gateway = await liveGateway();
    try {
      let session = createSession({ sessionId: `stage2-acceptance-${Date.now()}`, seed: "stage2-acceptance", mode: "reference", casePresetId: "APP-004",
        sessionPurpose: "learner_pilot", bundle, locale: "ru", startIso: "2026-09-08T08:00:00+05:00" });
      for (const text of ["опрос и осмотр живота", "оак и ультразвук живота", "кт обп", "кетопрофен", "100 мг в/в", "обезбол",
        "парацетамол 1 г внутрь", "переоценю боль и живот через 2 часа", "узи обп", "что с пациентом сейчас?"]) {
        const interpreted = await interpretHybrid({ text, bundle, idPrefix: `t${session.state.turn}`, turnContext: buildTurnContext(session), provider: gateway.provider(session.sessionId) });
        session = submitLearnerTurn({ session, text, interpreted }).session;
      }
      const exported = exportSession({ session, generatedAtIso: new Date().toISOString() });
      const providerAnswered = exported.interpreter.telemetryByTurn.some((row) => row.status === "valid");
      evidence("ACCEPTANCE_SESSION", { status: providerAnswered ? "RECORDED_REQUIRES_REVIEW" : "PROVIDER_UNAVAILABLE", providerAnswered, export: exported, rawProviderResponses: gateway.raw });
    } finally { await gateway.close(); }
  }
}

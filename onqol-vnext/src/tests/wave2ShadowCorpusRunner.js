import diseaseBundle from "../content/generated/appendicitis.json" with { type: "json" };
import sharedBundle from "../content/generated/shared.json" with { type: "json" };
import { withShared } from "../core/content/loadBundle.js";
import { createSession } from "../core/session/createSession.js";
import { buildLearnerVisibleState } from "../core/state/learnerView.js";
import { AI_INTERACTION_V2 } from "../ai/interaction/featureFlags.js";
import { interpretTurn } from "../ai/interpreter/interpretTurn.js";
import { runInterpreterShadow } from "../ai/interpreter/shadowInterpreter.js";
import { aggregateGoldMetrics, aggregateGoldMetricsByCategory, evaluateInterpretationAgainstGold } from "../ai/interpreter/shadowComparison.js";
import { WAVE2_SHADOW_CORPUS } from "./fixtures/wave2ShadowCorpus.js";

const bundle = withShared(diseaseBundle, sharedBundle);

export async function runWave2ShadowCorpus() {
  const learnerVisible = buildLearnerVisibleState(baseSession().state);
  const semanticFixtures = WAVE2_SHADOW_CORPUS.filter((fixture) => fixture.suite === "semantic");
  const deterministicRows = semanticFixtures.map(deterministicRow);
  const safetyProbeRows = [];
  for (const fixture of WAVE2_SHADOW_CORPUS.filter((item) => item.suite === "safety_probe")) {
    safetyProbeRows.push(await injectedRow({ fixture, learnerVisible }));
  }
  const resilienceRows = [];
  for (const fixture of WAVE2_SHADOW_CORPUS.filter((item) => item.suite === "resilience")) {
    resilienceRows.push(await injectedRow({ fixture, learnerVisible }));
  }

  return {
    corpusVersion: "wave21-evaluation-corpus-2026-08-28.1",
    methodology: {
      deterministicBaseline: "deterministic interpreter vs independent gold labels",
      liveModel: "not measured by this offline runner",
      modelVsDeterministic: "debug only",
      excludedFromSemanticDenominators: ["M04", "V04", "A03", "A04"],
      invalidatedHistoricalClaims: ["60.71% exact agreement", "96.08% command precision/recall"],
    },
    composition: {
      totalFixtures: WAVE2_SHADOW_CORPUS.length,
      semanticFixtures: semanticFixtures.length,
      safetyProbeFixtures: safetyProbeRows.length,
      resilienceFixtures: resilienceRows.length,
    },
    deterministicBaselineVsGold: {
      metrics: aggregateGoldMetrics(deterministicRows),
      metricsByCategory: aggregateGoldMetricsByCategory(deterministicRows),
      rows: deterministicRows,
    },
    injectedGuardrailValidation: {
      note: "Deliberately injected outputs; validator/binder tests, not observed model performance.",
      rows: safetyProbeRows,
    },
    injectedResilienceValidation: {
      note: "Injected timeout/schema failures; excluded from semantic accuracy.",
      rows: resilienceRows,
    },
  };
}

function deterministicRow(fixture) {
  const deterministic = interpretTurn({ text: fixture.text, turnContext: {}, idPrefix: fixture.id });
  const evaluation = evaluateInterpretationAgainstGold({
    commands: deterministic.commands,
    unresolvedFragments: deterministic.unmatchedFragments ?? [],
    expected: fixture.expected,
  });
  return {
    id: fixture.id,
    category: fixture.category,
    locale: fixture.locale,
    text: fixture.text,
    expected: fixture.expected,
    rawDeterministicOutput: deterministic,
    evaluation,
    telemetry: { status: "deterministic", elapsedMs: null, inventions: { beforeBinder: { highRisk: [], inventedNumericParameterCount: 0 }, afterBinder: { highRisk: [], inventedNumericParameterCount: 0 } } },
  };
}

async function injectedRow({ fixture, learnerVisible }) {
  const deterministic = interpretTurn({ text: fixture.text, turnContext: {}, idPrefix: fixture.id });
  const provider = fixture.providerFailure
    ? { async complete() { const error = new Error(fixture.providerFailure); error.name = fixture.providerFailure === "timeout" ? "AbortError" : "Error"; throw error; } }
    : { async complete() { return { output: fixture.modelOutput, meta: { model: "deliberately-injected-test-output" } }; } };
  const telemetry = await runInterpreterShadow({ provider, text: fixture.text, locale: fixture.locale, learnerVisible, turnContext: {}, bundle, deterministic });
  const output = telemetry.modelOutput ?? {};
  const evaluation = evaluateInterpretationAgainstGold({
    commands: telemetry.acceptedCommands ?? [],
    proposedCommands: telemetry.proposedCommands ?? [],
    actionValidation: telemetry.actionValidation ?? [],
    reasoningDelta: telemetry.normalizedReasoning,
    patientQuestions: output.patientQuestions,
    ambiguities: output.ambiguities,
    unresolvedFragments: output.unresolvedFragments,
    mentorAnswerDelta: output.mentorAnswerDelta,
    expected: fixture.expected,
  });
  return {
    id: fixture.id,
    category: fixture.category,
    locale: fixture.locale,
    text: fixture.text,
    expected: fixture.expected,
    rawInjectedOutput: fixture.modelOutput,
    telemetry: compactTelemetry(telemetry),
    evaluation,
  };
}

function compactTelemetry(telemetry) {
  return {
    status: telemetry.status,
    elapsedMs: telemetry.elapsedMs,
    schemaErrors: telemetry.schemaErrors,
    conceptErrors: telemetry.conceptErrors,
    commandValidation: telemetry.commandValidation,
    bindingDiagnostics: telemetry.bindingDiagnostics,
    actionValidation: telemetry.actionValidation,
    proposedCommands: telemetry.proposedCommands,
    boundCommands: telemetry.boundCommands,
    acceptedCommands: telemetry.acceptedCommands,
    inventions: telemetry.inventions,
    providerEvidenceCaptured: telemetry.providerEvidenceCaptured,
    normalizedReasoning: telemetry.normalizedReasoning,
  };
}

function baseSession() {
  return createSession({
    sessionId: "wave21-corpus", seed: "wave21-corpus", mode: "reference", casePresetId: "APP-004",
    sessionPurpose: "internal_development", interactionFlags: { [AI_INTERACTION_V2]: true }, bundle,
    locale: "ru", startIso: "2026-08-28T12:00:00+05:00",
  });
}

export { bundle, baseSession };

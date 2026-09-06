import { buildLearnerVisibleState } from "../core/state/learnerView.js";
import { interpretTurn } from "../ai/interpreter/interpretTurn.js";
import { runInterpreterShadow } from "../ai/interpreter/shadowInterpreter.js";
import {
  aggregateGoldMetrics,
  aggregateGoldMetricsByCategory,
  canonicalizeCommand,
  evaluateInterpretationAgainstGold,
} from "../ai/interpreter/shadowComparison.js";
import { WAVE2_SHADOW_CORPUS } from "./fixtures/wave2ShadowCorpus.js";
import { WAVE22_HOLDOUT_CORPUS, WAVE22_HOLDOUT_METADATA } from "./fixtures/wave22HoldoutCorpus.js";
import { baseSession, bundle } from "./wave2ShadowCorpusRunner.js";

export const WAVE22_DEVELOPMENT_FIXTURES = Object.freeze(
  WAVE2_SHADOW_CORPUS.filter((fixture) => fixture.suite === "semantic"),
);
export const WAVE22_SAFETY_FIXTURES = Object.freeze(
  WAVE2_SHADOW_CORPUS.filter((fixture) => fixture.suite === "safety_probe"),
);

export function wave22Schedule() {
  return {
    development: schedule(WAVE22_DEVELOPMENT_FIXTURES, 3),
    holdout: schedule(WAVE22_HOLDOUT_CORPUS, 3),
    safety: schedule(WAVE22_SAFETY_FIXTURES, 10),
  };
}

export async function runWave22EvaluationSuite({ provider, suite, model }) {
  const definitions = {
    development: { fixtures: WAVE22_DEVELOPMENT_FIXTURES, repetitions: 3, corpusId: "wave22-development-from-wave21-ordinary-2026-08-29.1" },
    holdout: { fixtures: WAVE22_HOLDOUT_CORPUS, repetitions: 3, corpusId: WAVE22_HOLDOUT_METADATA.corpusId },
    safety: { fixtures: WAVE22_SAFETY_FIXTURES, repetitions: 10, corpusId: "wave22-m04-v04-safety-2026-08-29.1" },
  };
  const definition = definitions[suite];
  if (!definition) throw new Error(`unknown_wave22_suite:${suite}`);
  const learnerVisible = buildLearnerVisibleState(baseSession().state);
  const startedAt = new Date().toISOString();
  const rows = [];

  for (const fixture of definition.fixtures) {
    for (let repetition = 1; repetition <= definition.repetitions; repetition += 1) {
      const turnContext = fixture.turnContext ?? {};
      const deterministic = interpretTurn({ text: fixture.text, turnContext, idPrefix: `${fixture.id}-${repetition}` });
      const telemetry = await runInterpreterShadow({
        provider,
        text: fixture.text,
        locale: fixture.locale,
        learnerVisible,
        turnContext,
        bundle,
        deterministic,
      });
      const output = telemetry.modelOutput ?? {};
      rows.push({
        fixtureId: fixture.id,
        category: fixture.category,
        repetition,
        locale: fixture.locale,
        text: fixture.text,
        source: fixture.source,
        turnContext,
        expected: fixture.expected,
        rawProviderPayload: telemetry.rawProviderPayload,
        rawProviderOutput: telemetry.rawProviderOutput,
        parsedProviderOutput: telemetry.parsedProviderOutput,
        validator: {
          status: telemetry.status,
          errorCode: telemetry.errorCode,
          schemaErrors: telemetry.schemaErrors,
          conceptErrors: telemetry.conceptErrors,
          actionValidation: telemetry.actionValidation,
          commandValidation: telemetry.commandValidation,
          bindingDiagnostics: telemetry.bindingDiagnostics,
          proposedCommands: telemetry.proposedCommands,
          acceptedCommands: telemetry.acceptedCommands,
          inventions: telemetry.inventions,
        },
        telemetry: {
          status: telemetry.status,
          errorCode: telemetry.errorCode,
          elapsedMs: telemetry.elapsedMs,
          providerMeta: telemetry.providerMeta,
          providerEvidenceCaptured: telemetry.providerEvidenceCaptured,
          inventions: telemetry.inventions,
        },
        evaluation: evaluateInterpretationAgainstGold({
          commands: telemetry.acceptedCommands,
          proposedCommands: telemetry.proposedCommands,
          actionValidation: telemetry.actionValidation,
          reasoningDelta: telemetry.normalizedReasoning,
          patientQuestions: output.patientQuestions,
          ambiguities: output.ambiguities,
          unresolvedFragments: output.unresolvedFragments,
          mentorAnswerDelta: output.mentorAnswerDelta,
          expected: fixture.expected,
        }),
        semanticSignature: semanticSignature(telemetry),
        modelVsDeterministicDebug: telemetry.comparison,
      });
    }
  }

  return {
    evaluationVersion: `wave22-${suite}-2026-08-29.1`,
    suite,
    corpusId: definition.corpusId,
    holdoutFrozenBeforeInterpreterRevision: suite === "holdout" ? WAVE22_HOLDOUT_METADATA.frozenBeforeInterpreterRevision : null,
    status: "completed",
    provider: "openai_chat_completions",
    model,
    startedAt,
    completedAt: new Date().toISOString(),
    fixtureCount: definition.fixtures.length,
    repetitionsPerFixture: definition.repetitions,
    scheduledCalls: definition.fixtures.length * definition.repetitions,
    completedCalls: rows.length,
    metrics: aggregateGoldMetrics(rows),
    metricsByCategory: aggregateGoldMetricsByCategory(rows),
    stability: aggregateStability(rows),
    failureCounts: countStatuses(rows),
    authority: "none",
    rows,
  };
}

export function notConfiguredEvidence({ suite, model, reason }) {
  const scheduledCalls = wave22Schedule()[suite].length;
  return {
    evaluationVersion: `wave22-${suite}-2026-08-29.1`,
    suite,
    status: "not_configured",
    reason,
    provider: "openai_chat_completions",
    model,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    scheduledCalls,
    completedCalls: 0,
    metrics: null,
    metricsByCategory: null,
    stability: null,
    failureCounts: {},
    authority: "none",
    rows: [],
  };
}

function schedule(fixtures, repetitions) {
  return fixtures.flatMap((fixture) => Array.from({ length: repetitions }, (_, index) => ({ fixtureId: fixture.id, repetition: index + 1 })));
}

function semanticSignature(telemetry) {
  const output = telemetry.modelOutput ?? {};
  return JSON.stringify({
    status: telemetry.status,
    acceptedCommands: (telemetry.acceptedCommands ?? []).map(canonicalizeCommand),
    normalizedReasoning: telemetry.normalizedReasoning ?? {},
    patientQuestionTopics: (output.patientQuestions ?? []).map((item) => item.topic).sort(),
    mentorAnswerDomains: (Array.isArray(output.mentorAnswerDelta?.domains) ? output.mentorAnswerDelta.domains : []).sort(),
    ambiguities: canonicalIssues(output.ambiguities),
    unresolvedFragments: canonicalIssues(output.unresolvedFragments),
    errorCode: telemetry.errorCode ?? null,
  });
}

function aggregateStability(rows) {
  const byFixture = new Map();
  for (const row of rows) {
    const signatures = byFixture.get(row.fixtureId) ?? [];
    signatures.push(row.semanticSignature);
    byFixture.set(row.fixtureId, signatures);
  }
  const fixtures = [...byFixture.entries()].map(([fixtureId, signatures]) => ({
    fixtureId,
    repetitions: signatures.length,
    uniqueSemanticOutcomes: new Set(signatures).size,
    stable: new Set(signatures).size === 1,
  }));
  return {
    stableFixtureRate: fixtures.length ? Number((fixtures.filter((item) => item.stable).length / fixtures.length).toFixed(4)) : null,
    stableFixtures: fixtures.filter((item) => item.stable).length,
    totalFixtures: fixtures.length,
    fixtures,
  };
}

function countStatuses(rows) {
  const counts = {};
  for (const row of rows) counts[row.telemetry.status] = (counts[row.telemetry.status] ?? 0) + 1;
  return counts;
}

function canonicalIssues(items = []) {
  return items.map((item) => ({ reason: item.reason, evidenceSpan: normalize(item.evidenceSpan) }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}
function normalize(value) { return String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/\s+/g, " "); }

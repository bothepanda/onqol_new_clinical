import { test } from "node:test";
import assert from "node:assert/strict";

import diseaseBundle from "../../content/generated/appendicitis.json" with { type: "json" };
import sharedBundle from "../../content/generated/shared.json" with { type: "json" };
import { withShared } from "../../core/content/loadBundle.js";
import { AI_INTERACTION_V2 } from "../interaction/featureFlags.js";
import { createSession } from "../../core/session/createSession.js";
import { submitLearnerTurn } from "../../core/session/submitLearnerTurn.js";
import { buildLearnerVisibleState } from "../../core/state/learnerView.js";
import { buildModelAllowlist, validateModelConcepts } from "./modelConceptValidation.js";
import { buildModelInterpreterRequest, SAFE_INTERACTION_CONTEXT_KEYS } from "./modelInterpreter.js";
import { MODEL_INTERPRETATION_SCHEMA_VERSION, validateModelOutput } from "./modelOutputSchema.js";
import { SEMANTIC_TASK, WAVE23_SCHEMA_VERSION } from "./semanticTaskSchemas.js";
import { bindModelCommand } from "./deterministicParameterBinder.js";
import { canonicalizeCommand } from "./shadowComparison.js";
import { runInterpreterShadow } from "./shadowInterpreter.js";
import { runSplitSemanticShadow } from "./splitSemanticInterpreter.js";

const bundle = withShared(diseaseBundle, sharedBundle);

function output(overrides = {}) {
  return {
    clinicalActions: [],
    reasoningDelta: {},
    mentorAnswerDelta: {},
    patientQuestions: [],
    ambiguities: [],
    unresolvedFragments: [],
    meta: { schemaVersion: MODEL_INTERPRETATION_SCHEMA_VERSION, confidence: 0.9 },
    ...overrides,
  };
}

function providerReturning(value) {
  return {
    async complete(request) {
      const rawText = JSON.parse(request.messages.find((message) => message.role === "user").content).rawLearnerText
        ?? JSON.parse(request.messages.find((message) => message.role === "user").content).learnerText;
      if (request.task === SEMANTIC_TASK.ACTION) {
        return { output: {
          clinicalActions: value.clinicalActions ?? [],
          patientQuestions: value.patientQuestions ?? [],
          ambiguities: value.ambiguities ?? [],
          unresolvedFragments: value.unresolvedFragments ?? [],
          meta: { schemaVersion: WAVE23_SCHEMA_VERSION, confidence: value.meta?.confidence ?? 0.9 },
        }, meta: { model: "fixture" } };
      }
      if (request.task === SEMANTIC_TASK.MENTOR_ANSWER) {
        const mentor = value.mentorAnswerDelta ?? {};
        return { output: {
          answered: Boolean(mentor.domains?.length),
          mentorAnswerDelta: {
            domains: mentor.domains ?? [],
            evidenceSpans: mentor.evidenceSpans ?? (mentor.domains?.length ? [rawText] : []),
            completeness: mentor.domains?.length ? "sufficient" : "none",
            stuck: mentor.stuck === true,
          },
          reasoningDelta: {},
          ambiguities: value.ambiguities ?? [],
          meta: { schemaVersion: WAVE23_SCHEMA_VERSION, confidence: value.meta?.confidence ?? 0.9 },
        }, meta: { model: "fixture" } };
      }
      return { output: {
        reasoningDelta: projectReasoning(value.reasoningDelta ?? {}, rawText),
        ambiguities: value.ambiguities ?? [],
        meta: { schemaVersion: WAVE23_SCHEMA_VERSION, confidence: value.meta?.confidence ?? 0.9 },
      }, meta: { model: "fixture" } };
    },
  };
}

function legacyProviderReturning(value) {
  return { async complete() { return { output: value, meta: { model: "fixture" } }; } };
}

function projectReasoning(value, evidenceSpan) {
  const result = {};
  if (value.workingDiagnosis) result.workingDiagnosis = { conceptId: value.workingDiagnosis.conceptId ?? "acute_appendicitis", evidenceSpan, uncertaintyExpressed: value.workingDiagnosis.uncertaintyExpressed === true };
  if (value.stability) result.stabilityAssessment = { assessment: value.stability.learnerAssessment ?? "uncertain", evidenceSpan };
  return result;
}

function session() {
  return createSession({
    sessionId: "wave2-shadow",
    seed: "wave2-shadow",
    mode: "reference",
    casePresetId: "APP-004",
    sessionPurpose: "internal_development",
    interactionFlags: { [AI_INTERACTION_V2]: true },
    bundle,
    locale: "ru",
    startIso: "2026-08-28T12:00:00+05:00",
  });
}

test("semantic-channel schema supports simultaneous actions, reasoning, mentor answer and patient questions", () => {
  const candidate = output({
    clinicalActions: [
      { type: "TAKE_HISTORY", params: {}, evidenceSpans: ["опрос"], statedParameters: [] },
      { type: "EXAMINE", params: { region: "abdomen" }, evidenceSpans: ["живот"], statedParameters: [] },
    ],
    reasoningDelta: { workingDiagnosis: { stated: true, conceptId: "acute_appendicitis" } },
    mentorAnswerDelta: { domains: ["contingency"], evidenceSpans: ["ухудшение"] },
    patientQuestions: [{ topic: "pain", evidenceSpans: ["где болит"] }],
  });
  assert.equal(validateModelOutput(candidate).ok, true);
});

test("model request contains only a narrow learner-visible context", () => {
  const current = session();
  const learnerVisible = buildLearnerVisibleState(current.state);
  const turnContext = {
    openMentorQuestion: current.state.mentor.openQuestion,
    openClarification: current.state.clarification,
    managementIntent: current.state.managementPlan.intent,
    preopReady: current.state.preop.ready,
  };
  const request = buildModelInterpreterRequest({
    text: "осмотрю живот",
    locale: "ru",
    learnerVisible,
    turnContext,
    allowlist: buildModelAllowlist({ bundle, turnContext }),
  });
  const serialized = JSON.stringify(request.messages);
  assert.deepEqual(Object.keys(request.safeContext), SAFE_INTERACTION_CONTEXT_KEYS);
  assert.equal(Object.hasOwn(request.safeContext, "preopReady"), false);
  assert.equal(Object.hasOwn(request.safeContext, "clock"), false);
  assert.equal(Object.hasOwn(request.safeContext, "revealedFindings"), false);
  const userPayload = JSON.parse(request.messages.find((message) => message.role === "user").content);
  assert.deepEqual(userPayload.allowlist.parameterSchemas.ORDER_MEDICATION, ["drugId"]);
  assert.equal(userPayload.allowlist.statedParameterCategories.includes("dose_unit"), true);
  assert.equal(userPayload.allowlist.clinicalActionTypes.includes("STATE_REASONING"), false);
  assert.equal(userPayload.allowlist.clinicalActionTypes.includes("ANSWER_MENTOR"), false);
  for (const secret of [current.state.truth.phenotypeId, current.state.truth.morphology, current.state.truth.trajectoryId, "operativeTruthRu", "expectedAnswer", "scoring"]) {
    assert.equal(serialized.includes(secret), false, `hidden context leaked: ${secret}`);
  }
});

test("canonical evaluation normalizes safe formatting but preserves semantic differences", () => {
  assert.deepEqual(
    canonicalizeCommand({ type: "ORDER_MEDICATION", params: { drugId: "PARACETAMOL", dose: "1 г", route: "в/в" } }),
    canonicalizeCommand({ type: "order_medication", params: { route: "iv", dose: "1000мг", drugId: "paracetamol" } }),
  );
  assert.deepEqual(
    canonicalizeCommand({ type: "ORDER_TEST", params: { testId: "chemistry", analytes: ["electrolytes", "creatinine"] } }),
    canonicalizeCommand({ type: "ORDER_TEST", params: { testId: "chemistry", analytes: ["creatinine", "electrolytes"] } }),
  );
  assert.notDeepEqual(
    canonicalizeCommand({ type: "ORDER_MEDICATION", params: { dose: "500 мг" } }),
    canonicalizeCommand({ type: "ORDER_MEDICATION", params: { dose: "1000 мг" } }),
  );
});

test("deterministic binder owns medication, infusion and timing parameters", () => {
  const incomplete = bindModelCommand({
    candidate: { type: "GIVE_ANTIBIOTIC_PROPHYLAXIS", params: { drugId: "cefazolin", dose: "2 г", doseMg: 2000, route: "iv" }, evidence: "цефазолин 2" },
    rawText: "цефазолин 2",
  });
  assert.deepEqual(incomplete.command.params, { drugId: "cefazolin" });

  const medication = bindModelCommand({
    candidate: { type: "ORDER_MEDICATION", params: { drugId: "paracetamol" }, evidence: "парацетамол 1 г в/в" },
    rawText: "парацетамол 1 г в/в",
  });
  assert.deepEqual(medication.command.params, { drugId: "paracetamol", dose: "1 г", doseMg: 1000, route: "iv" });

  const infusion = bindModelCommand({
    candidate: { type: "ORDER_INFUSION", params: { fluidId: "crystalloid" }, evidence: "физраствор 500 мл за час" },
    rawText: "физраствор 500 мл за час",
  });
  assert.deepEqual(infusion.command.params, { fluidId: "crystalloid", volumeMl: 500, durationMinutes: 60 });

  const weightBased = bindModelCommand({
    candidate: { type: "ORDER_INFUSION", params: { fluidId: "crystalloid", volumeMl: 14000 }, evidence: "физраствор 200 мл/кг" },
    rawText: "физраствор 200 мл/кг",
  });
  assert.deepEqual(weightBased.command.params, { fluidId: "crystalloid" });
  assert.deepEqual(weightBased.unboundExpressions, [{ kind: "weight_based_volume", expression: "200 мл/кг" }]);
});

test("missing medication unit and route are high-risk inventions", () => {
  const candidate = output({
    clinicalActions: [{
      type: "GIVE_ANTIBIOTIC_PROPHYLAXIS",
      params: { drugId: "cefazolin", dose: "2 г", doseMg: 2000, route: "iv" },
      evidenceSpans: ["цефазолин 2"],
      statedParameters: ["dose", "dose_unit", "route"],
    }],
  });
  const validation = validateModelConcepts({
    output: candidate,
    allowlist: buildModelAllowlist({ bundle }),
    rawText: "цефазолин 2",
    openClarification: null,
  });
  assert.equal(validation.ok, false);
  assert.ok(validation.inventions.highRisk.some((item) => item.kind === "invented_dose_unit"));
  assert.ok(validation.inventions.highRisk.some((item) => item.kind === "invented_route"));
});

test("tentative preparation cannot become a committed operative plan", () => {
  const candidate = output({
    clinicalActions: [{
      type: "COMMIT_MANAGEMENT_PLAN",
      params: { intent: "operative" },
      evidenceSpans: ["можно подготовить к потенциальной операции"],
      statedParameters: [],
    }],
  });
  const validation = validateModelConcepts({
    output: candidate,
    allowlist: buildModelAllowlist({ bundle }),
    rawText: "можно подготовить к потенциальной операции",
    openClarification: null,
  });
  assert.equal(validation.ok, false);
  assert.ok(validation.inventions.highRisk.some((item) => item.kind === "tentative_not_committed"));
});

test("valid shadow output has zero authority over commands, reasoning, time and event replay", async () => {
  const initial = session();
  const shadow = output({
    clinicalActions: [{ type: "ORDER_TEST", params: { testId: "cbc" }, evidenceSpans: ["не знаю"], statedParameters: [] }],
    reasoningDelta: { workingDiagnosis: { stated: true, conceptId: "acute_appendicitis" } },
  });
  const turn = submitLearnerTurn({ session: initial, text: "не знаю", shadowProvider: providerReturning(shadow) });
  const stateImmediately = structuredClone(turn.session.state);
  const eventsImmediately = structuredClone(turn.session.events);
  const telemetry = await turn.shadowTelemetryPromise;
  assert.deepEqual(turn.session.state, stateImmediately);
  assert.deepEqual(turn.session.events, eventsImmediately);
  assert.equal(turn.session.state.clock.elapsedMinutes, 0);
  assert.equal(turn.session.state.reasoning.workingDiagnosis.conceptId, null);
  assert.equal(turn.session.events.some((event) => event.type === "TEST_ORDERED" || event.type === "REASONING_STATED"), false);
  assert.equal(telemetry.clinicalAuthority, "none");
  assert.equal(telemetry.executedSource, "deterministic");
});

test("timeout, malformed JSON and invalid concepts leave deterministic experience unchanged", async () => {
  const providers = [
    { async complete() { const error = new Error("timeout"); error.name = "AbortError"; throw error; } },
    { async complete() { return { text: "not-json" }; } },
    providerReturning(output({ clinicalActions: [{ type: "ORDER_TEST", params: { testId: "invented_scan" }, evidenceSpans: ["ОАК"], statedParameters: [] }] })),
  ];
  for (const provider of providers) {
    const initial = session();
    const turn = submitLearnerTurn({ session: initial, text: "ОАК", shadowProvider: provider });
    const telemetry = await turn.shadowTelemetryPromise;
    assert.equal(turn.interpreted.commands.length, 1);
    assert.equal(turn.session.state.clock.elapsedMinutes, 0);
    assert.equal(turn.session.events.some((event) => event.type === "TEST_ORDERED"), true);
    assert.equal(turn.session.state.investigations.cbc.status, "ordered");
    assert.equal(telemetry.status, "partial_or_failed");
    assert.equal(telemetry.acceptedCommands.length, 0);
    assert.ok(["provider_timeout", "provider_invalid_response", "concept_validation_failure"].includes(
      telemetry.taskResults[SEMANTIC_TASK.ACTION].status,
    ));
  }
});

test("legacy Wave 2.2 malformed investigation shapes remain inert and preserve provider evidence", async () => {
  const initial = session();
  const malformedOptionalReasoning = output({
    reasoningDelta: { investigations: { items: { unexpected: "object-not-array" } } },
  });
  const telemetry = await runInterpreterShadow({
    provider: legacyProviderReturning(malformedOptionalReasoning),
    text: "объясняю выбор анализа",
    locale: "ru",
    learnerVisible: buildLearnerVisibleState(initial.state),
    turnContext: {},
    bundle,
    deterministic: { commands: [], unmatchedFragments: [] },
  });
  assert.equal(telemetry.status, "valid");
  assert.equal(telemetry.providerEvidenceCaptured, true);
  assert.deepEqual(telemetry.rawProviderOutput, malformedOptionalReasoning);
  assert.deepEqual(telemetry.providerMeta, { model: "fixture" });
  assert.deepEqual(telemetry.modelOutput.reasoningDelta.investigations.items, { unexpected: "object-not-array" });
});

test("typed downstream failures retain a returned provider payload", async () => {
  const invalidConcept = output({
    clinicalActions: [{ type: "ORDER_TEST", params: { testId: "invented_scan" }, evidenceSpans: ["ОАК"], statedParameters: [] }],
  });
  const initial = session();
  const turn = submitLearnerTurn({ session: initial, text: "ОАК", shadowProvider: providerReturning(invalidConcept) });
  const telemetry = await turn.shadowTelemetryPromise;
  const actionResult = telemetry.taskResults[SEMANTIC_TASK.ACTION];
  assert.equal(actionResult.status, "concept_validation_failure");
  assert.equal(actionResult.providerEvidence.captured, true);
  assert.deepEqual(actionResult.providerMeta, { model: "fixture" });
});

test("unsupported concepts cannot degrade into grounded generic commands", async () => {
  const proposed = output({
    clinicalActions: [{ type: "ORDER_TEST", params: {}, evidenceSpans: ["МРТ живота"], statedParameters: [] }],
    unresolvedFragments: [{ evidenceSpan: "МРТ живота", reason: "unsupported_concept" }],
  });
  const initial = session();
  const turn = submitLearnerTurn({ session: initial, text: "МРТ живота", shadowProvider: providerReturning(proposed) });
  const telemetry = await turn.shadowTelemetryPromise;
  const actionResult = telemetry.taskResults[SEMANTIC_TASK.ACTION];
  assert.equal(actionResult.status, "concept_validation_failure");
  assert.equal(telemetry.proposedCommands.length, 1);
  assert.equal(telemetry.acceptedCommands.length, 0);
  assert.ok(actionResult.conceptErrors.some((error) => error.includes("missing_required_parameter")));
  assert.deepEqual(telemetry.modelOutput.unresolvedFragments, [{ evidenceSpan: "МРТ живота", reason: "unsupported_concept" }]);
});

test("reasoning and mentor bookkeeping commands are never model-eligible actions", async () => {
  for (const type of ["STATE_REASONING", "ANSWER_MENTOR"]) {
    const proposed = output({
      clinicalActions: [{ type, params: {}, evidenceSpans: ["думаю, это аппендицит"], statedParameters: [] }],
      reasoningDelta: type === "STATE_REASONING" ? { workingDiagnosis: { stated: true, conceptId: "acute_appendicitis" } } : {},
      mentorAnswerDelta: type === "ANSWER_MENTOR" ? { domains: ["contingency"], evidenceSpans: ["думаю, это аппендицит"] } : {},
    });
    const initial = session();
    const turn = submitLearnerTurn({ session: initial, text: "думаю, это аппендицит", shadowProvider: providerReturning(proposed) });
    const telemetry = await turn.shadowTelemetryPromise;
    const actionResult = telemetry.taskResults[SEMANTIC_TASK.ACTION];
    assert.equal(actionResult.status, "concept_validation_failure");
    assert.equal(telemetry.acceptedCommands.length, 0);
    assert.ok(actionResult.conceptErrors.some((error) => error.includes("type_not_allowlisted")));
  }
});

test("contextual mentor answer remains in its own channel without measurement actions", async () => {
  const proposed = output({
    mentorAnswerDelta: {
      domains: ["observation_targets"],
      evidenceSpans: ["боль, давление, температуру и ЧСС"],
      observationTargets: ["pain", "blood_pressure", "temperature", "heart_rate"],
    },
    reasoningDelta: { observation: { goalStated: true } },
  });
  const telemetry = await runSplitSemanticShadow({
    provider: providerReturning(proposed),
    text: "боль, давление, температуру и ЧСС",
    locale: "ru",
    turnContext: { openMentorQuestion: { id: "observe", text: "Что отслеживаешь?", expectedDomains: ["observation_targets"] } },
    bundle,
  });
  assert.equal(telemetry.status, "valid");
  assert.equal(telemetry.proposedCommands.length, 0);
  assert.equal(telemetry.acceptedCommands.length, 0);
  assert.deepEqual(telemetry.modelOutput.mentorAnswerDelta.domains, ["observation_targets"]);
});

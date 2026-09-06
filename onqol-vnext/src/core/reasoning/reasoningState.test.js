import { test } from "node:test";
import assert from "node:assert/strict";

import { AI_INTERACTION_V2 } from "../../ai/interaction/featureFlags.js";
import diseaseBundle from "../../content/generated/appendicitis.json" with { type: "json" };
import { createCommand } from "../commands/commandTypes.js";
import { exportSession } from "../replay/exportSession.js";
import { applyCommand } from "../session/applyTurn.js";
import { createSession } from "../session/createSession.js";
import {
  createEmptyReasoningState,
  mergeReasoningState,
  REASONING_SCHEMA_VERSION,
} from "./reasoningState.js";

test("Wave 1 reasoning schema initializes every semantic domain", () => {
  const state = createEmptyReasoningState();
  assert.equal(state.schemaVersion, REASONING_SCHEMA_VERSION);
  assert.deepEqual(Object.keys(state), [
    "schemaVersion",
    "stability",
    "problemRepresentation",
    "workingDiagnosis",
    "differential",
    "investigations",
    "management",
    "observation",
    "reassessment",
    "contingency",
    "disposition",
    "consultation",
    "statements",
  ]);
  assert.equal(state.stability.stated, false);
  assert.deepEqual(state.differential.conceptIds, []);
});

test("reasoning merges across turns", () => {
  const first = mergeReasoningState(createEmptyReasoningState(), {
    stability: { stated: true, learnerAssessment: "stable" },
    workingDiagnosis: { stated: true, conceptId: "acute_appendicitis" },
  }, 1);
  const second = mergeReasoningState(first, {
    differential: {
      stated: true,
      items: [{ conceptId: "ectopic_pregnancy", dangerous: true }],
    },
    investigations: {
      items: [{ actionId: "betahcg", purposeStated: true }],
    },
  }, 2);
  assert.equal(second.stability.learnerAssessment, "stable");
  assert.equal(second.workingDiagnosis.conceptId, "acute_appendicitis");
  assert.deepEqual(second.differential.conceptIds, ["ectopic_pregnancy"]);
  assert.equal(second.investigations.items[0].purposeStated, true);
});

test("a later partial update never erases fields articulated earlier", () => {
  const first = mergeReasoningState(createEmptyReasoningState(), {
    observation: {
      active: true,
      goalStated: true,
      reassessmentIntervalStated: true,
      escalationCriteriaStated: true,
    },
    contingency: {
      stated: true,
      specificity: "specific",
      triggerConceptIds: ["cbc"],
    },
  }, 3);
  const second = mergeReasoningState(first, {
    observation: { active: true },
    contingency: { stated: true, triggerConceptIds: ["crp"] },
  }, 4);
  assert.equal(second.observation.goalStated, true);
  assert.equal(second.observation.reassessmentIntervalStated, true);
  assert.equal(second.contingency.specificity, "specific");
  assert.deepEqual(second.contingency.triggerConceptIds, ["cbc", "crp"]);
});

test("observation intent can be explicitly abandoned while earlier reasoning remains in events", () => {
  let session = createSession({
    sessionId: "reasoning-observation-revision",
    seed: "reasoning-observation-revision",
    mode: "reference",
    casePresetId: "APP-004",
    sessionPurpose: "internal_development",
    interactionFlags: { [AI_INTERACTION_V2]: true },
    bundle: diseaseBundle,
    locale: "ru",
    startIso: "2026-08-28T10:00:00+05:00",
  });
  for (const [id, params, sourceText] of [
    ["observation-start", { observation: { active: true, goalStated: true } }, "Наблюдаю пациента."],
    ["observation-stop", { observation: { active: false } }, "Отказываюсь от наблюдения."],
  ]) {
    session = applyCommand({
      session,
      command: createCommand({ id, type: "STATE_REASONING", params, sourceText }),
    }).session;
  }
  assert.equal(session.state.reasoning.observation.active, false);
  assert.equal(session.state.reasoning.observation.goalStated, true);
  const events = session.events.filter((event) => event.type === "REASONING_STATED");
  assert.equal(events.length, 2);
  assert.equal(events[0].payload.delta.observation.active, true);
  assert.equal(events[1].payload.delta.observation.active, false);
});

test("differential tracks current status separately from ever-mentioned hypotheses", () => {
  const considered = mergeReasoningState(createEmptyReasoningState(), {
    differential: { items: [{ conceptId: "ectopic_pregnancy", status: "active" }] },
  }, 1);
  const deprioritized = mergeReasoningState(considered, {
    differential: { items: [{ conceptId: "ectopic_pregnancy", status: "deprioritized" }] },
  }, 2);
  const ruledOut = mergeReasoningState(deprioritized, {
    differential: { items: [{ conceptId: "ectopic_pregnancy", status: "ruled_out" }] },
  }, 3);
  assert.deepEqual(ruledOut.differential.activeConceptIds, []);
  assert.deepEqual(ruledOut.differential.everMentionedConceptIds, ["ectopic_pregnancy"]);
  assert.equal(ruledOut.differential.items[0].status, "ruled_out");
  assert.equal(ruledOut.differential.items[0].updatedTurn, 3);
});

test("working-diagnosis uncertainty is an explicitly cumulative educational marker", () => {
  const first = mergeReasoningState(createEmptyReasoningState(), {
    workingDiagnosis: { stated: true, conceptId: "acute_appendicitis", uncertaintyStated: true },
  }, 1);
  const later = mergeReasoningState(first, {
    workingDiagnosis: { stated: true, conceptId: "acute_appendicitis" },
  }, 2);
  assert.equal(later.workingDiagnosis.uncertaintyExpressed, true);
  assert.equal("uncertaintyStated" in later.workingDiagnosis, false);
});

test("a learner claim changes reasoning only and remains distinct from patient truth", () => {
  const session = createSession({
    sessionId: "reasoning-boundary",
    seed: "reasoning-boundary",
    mode: "reference",
    casePresetId: "APP-004",
    sessionPurpose: "internal_development",
    interactionFlags: { [AI_INTERACTION_V2]: true },
    bundle: diseaseBundle,
    locale: "ru",
    startIso: "2026-08-28T10:00:00+05:00",
  });
  const truthBefore = structuredClone(session.state.truth);
  const physiologyBefore = structuredClone(session.state.physiology);
  const applied = applyCommand({
    session,
    command: createCommand({
      id: "reasoning-1",
      type: "STATE_REASONING",
      params: {
        stability: { stated: true, learnerAssessment: "unstable" },
        workingDiagnosis: { stated: true, conceptId: "acute_appendicitis" },
      },
      sourceText: "Считаю пациентку нестабильной, рабочий диагноз — острый аппендицит.",
    }),
  }).session;
  assert.equal(applied.state.reasoning.stability.learnerAssessment, "unstable");
  assert.deepEqual(applied.state.truth, truthBefore);
  assert.deepEqual(applied.state.physiology, physiologyBefore);
});

test("replay/export carries the normalized reasoning state and event delta", () => {
  let session = createSession({
    sessionId: "reasoning-export",
    seed: "reasoning-export",
    mode: "reference",
    casePresetId: "APP-004",
    sessionPurpose: "internal_development",
    interactionFlags: { [AI_INTERACTION_V2]: true },
    bundle: diseaseBundle,
    locale: "ru",
    startIso: "2026-08-28T10:00:00+05:00",
  });
  session = applyCommand({
    session,
    command: createCommand({
      id: "reasoning-export-1",
      type: "STATE_REASONING",
      params: { workingDiagnosis: "acute_appendicitis", differential: ["ectopic_pregnancy"] },
      sourceText: "Рабочий диагноз — аппендицит; исключаю внематочную беременность.",
    }),
  }).session;
  const exported = exportSession({ session, generatedAtIso: "2026-08-28T10:05:00Z" });
  assert.equal(exported.current_state.reasoning.schemaVersion, REASONING_SCHEMA_VERSION);
  assert.equal(exported.current_state.reasoning.workingDiagnosis.conceptId, "acute_appendicitis");
  const event = exported.events.find((candidate) => candidate.type === "REASONING_STATED");
  assert.equal(event.payload.schemaVersion, REASONING_SCHEMA_VERSION);
  assert.equal(event.payload.delta.workingDiagnosis.conceptId, "acute_appendicitis");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import disease from "../../content/generated/appendicitis.json" with { type: "json" };
import shared from "../../content/generated/shared.json" with { type: "json" };
import { withShared } from "../../core/content/loadBundle.js";
import { createSession } from "../../core/session/createSession.js";
import { submitLearnerTurn } from "../../core/session/submitLearnerTurn.js";
import { resolveInterpreterMode } from "../interaction/featureFlags.js";
import { interpretSemanticFirst, SEMANTIC_FIRST_VERSION } from "./semanticFirstInterpreter.js";
import { WAVE23_SCHEMA_VERSION } from "./semanticTaskSchemas.js";
import { reduceEvents } from "../../core/state/worldState.js";
import { createPersistedSession, loadPersistedSession, savePersistedSession } from "../../app/session/sessionPersistence.js";
import { buildChatTurnContext } from "../../app/session/interpreterContext.js";

const bundle = withShared(disease, shared);
const action = (type, params, evidence) => ({ type, params, evidenceSpans: [evidence], statedParameters: [] });
const output = (clinicalActions = [], extra = {}) => ({ clinicalActions, patientQuestions: [], ambiguities: [], unresolvedFragments: [], meta: { schemaVersion: WAVE23_SCHEMA_VERSION, confidence: 0.9 }, ...extra });
const fixture = (value) => ({ isConfigured: true, calls: [], async complete(request) { this.calls.push(request); return { output: value, meta: { model: "fixture" } }; } });
const run = (text, value, extra = {}) => interpretSemanticFirst({ text, bundle, provider: fixture(value), ...extra });
const actions = (result) => result.commands.filter((command) => !["STATE_REASONING", "ANSWER_MENTOR"].includes(command.type));
const session = () => createSession({ bundle, seed: "semantic-first", mode: "reference", locale: "ru", casePresetId: "APP-004", sessionPurpose: "internal_development", sessionId: "semantic-first-test", startIso: "2026-09-21T08:00:00Z" });

test("internal default is semantic-first; pilot and explicit rollback are not promoted", () => {
  assert.equal(resolveInterpreterMode(undefined), "semantic_first");
  assert.equal(resolveInterpreterMode("deterministic"), "deterministic");
  assert.equal(resolveInterpreterMode("hybrid"), "hybrid");
  assert.equal(resolveInterpreterMode(undefined, { purpose: "learner_pilot" }), "deterministic");
  assert.equal(resolveInterpreterMode("semantic_first", { purpose: "learner_pilot" }), "deterministic");
  assert.equal(resolveInterpreterMode("typo"), "deterministic");
});

test("only exact shorthand lists bypass the provider", async () => {
  const provider = fixture(output());
  const exact = await run("ОАК и КТ ОБП", output(), { provider });
  assert.equal(provider.calls.length, 0);
  assert.deepEqual(actions(exact).map((c) => c.params.testId), ["cbc", "ct_abdomen"]);
  await run("назначаю ОАК", output(), { provider });
  assert.equal(provider.calls.length, 1, "even a known free sentence goes through semantics");
});

test("the exported compound shorthand order survives a semantic provider timeout", async () => {
  const provider = { isConfigured: true, complete() { return new Promise(() => {}); } };
  const result = await run("узи обп и омт, оак, оам, бхак", output(), { provider, timeoutBudgetMs: 15 });
  assert.equal(result.mode, "semantic_first_fast_path");
  assert.deepEqual(actions(result).map((c) => c.params.testId), [
    "ultrasound_abdomen", "pelvic_ultrasound", "cbc", "urinalysis", "chemistry",
  ]);
});

test("a free phrase with no authored verb anchor can select an existing concept", async () => {
  const text = "Пусть лаборант определит число белых клеток в крови";
  const result = await run(text, output([action("ORDER_TEST", { testId: "cbc" }, text)]));
  assert.deepEqual(actions(result).map((c) => c.params.testId), ["cbc"]);
  assert.equal(result.semanticTelemetry.candidateDecisions[0].grounding, "semantic_only");
  assert.equal(result.semanticTelemetry.policyVersion, SEMANTIC_FIRST_VERSION);
});

test("a one-character typo in the action word can ground history-taking without choosing clinical parameters", async () => {
  const text = "физикальный осмотр и анамнещз";
  const result = await run(text, output([
    action("EXAMINE", { region: "general" }, "физикальный осмотр"),
    action("TAKE_HISTORY", {}, "анамнещз"),
  ]));
  assert.deepEqual(actions(result).map((c) => c.type), ["EXAMINE", "TAKE_HISTORY"]);
  assert.deepEqual(result.unmatchedFragments, []);
});

test("a valid empty semantic result cannot revive a dictionary order", async () => {
  const result = await run("назначаю ОАК", output());
  assert.equal(actions(result).length, 0);
  assert.ok(result.unmatchedFragments.length);
  assert.ok(result.semanticTelemetry.deterministicCandidates.some((c) => c.type === "ORDER_TEST"));
});

test("full text including qualifiers is sent, without hidden patient truth", async () => {
  const text = "ОАК, КТ только если станет хуже";
  const provider = fixture(output());
  await run(text, output(), { provider });
  const request = provider.calls[0];
  const payload = JSON.parse(request.messages[1].content);
  assert.equal(payload.rawLearnerText, text);
  assert.ok(payload.allowlist.concepts.tests.length);
  for (const key of ["patient", "vitals", "findings", "diagnosis", "results", "rubric"]) assert.equal(payload[key], undefined);
});

test("negation, hypothetical, deferred and questions cannot execute even if proposed", async () => {
  for (const text of ["КТ если понадобится", "не назначаю КТ", "КТ позже", "может КТ?"]) {
    const result = await run(text, output([action("ORDER_TEST", { testId: "ct_abdomen" }, text)]));
    assert.equal(actions(result).length, 0, text);
    const before = session();
    const after = submitLearnerTurn({ session: before, text, interpreted: result });
    assert.equal(after.session.state.clock.elapsedMinutes, before.state.clock.elapsedMinutes, text);
    assert.ok(!after.session.events.some((event) => event.type === "TEST_ORDERED"), text);
  }
});

test("compound turn executes the committed study only", async () => {
  const text = "Назначаю ОАК, КТ только если понадобится";
  const result = await run(text, output([
    action("ORDER_TEST", { testId: "cbc" }, "Назначаю ОАК"),
    action("ORDER_TEST", { testId: "ct_abdomen" }, "КТ"),
  ]));
  assert.deepEqual(actions(result).map((c) => c.params.testId), ["cbc"]);
});

test("lexical contradictions, unsupported IDs and fabricated evidence never execute", async () => {
  for (const [text, candidate] of [
    ["назначаю ОАК", action("ORDER_TEST", { testId: "ct_abdomen" }, "ОАК")],
    ["нужен тропонин", action("ORDER_TEST", { testId: "troponin_invented" }, "тропонин")],
    ["назначаю ОАК", action("ORDER_TEST", { testId: "ct_abdomen" }, "назначаю КТ")],
  ]) {
    const result = await run(text, output([candidate]));
    assert.equal(actions(result).length, 0, text);
    assert.ok(result.unmatchedFragments.length, text);
  }
});

test("category language cannot select an arbitrary test", async () => {
  const text = "Назначаю маркеры воспаления";
  const result = await run(text, output([action("ORDER_TEST", { testId: "crp" }, text)]));
  assert.ok(!actions(result).some((c) => c.params.testId === "crp"));
});

test("numeric parameters bind from the resident, never provider output", async () => {
  const text = "назначаю кетопрофен 100 мг в/м";
  const good = await run(text, output([action("ORDER_MEDICATION", { drugId: "ketoprofen" }, text)]));
  assert.equal(actions(good)[0]?.params.doseMg, 100);
  assert.equal(actions(good)[0]?.params.route, "im");
  const invented = await run(text, output([action("ORDER_MEDICATION", { drugId: "ketoprofen", doseMg: 200 }, text)]));
  assert.equal(actions(invented).length, 0);
});

test("an incomplete order asks for parameters instead of filling them", async () => {
  const text = "назначаю кетопрофен";
  const result = await run(text, output([action("ORDER_MEDICATION", { drugId: "ketoprofen" }, text)]));
  const turn = submitLearnerTurn({ session: session(), text, interpreted: result });
  assert.ok(turn.outcomes.some((item) => item.outcome === "CLARIFY"));
  assert.ok(!turn.session.events.some((event) => event.type === "MEDICATION_ADMINISTERED"));
});

test("provider outage, malformed JSON and timeout do not execute dictionary guesses", async () => {
  for (const provider of [
    { isConfigured: false },
    { isConfigured: true, async complete() { throw new Error("offline"); } },
    fixture("not JSON"),
    { isConfigured: true, complete() { return new Promise(() => {}); } },
  ]) {
    const result = await run("назначаю ОАК", output(), { provider, timeoutBudgetMs: 15 });
    assert.equal(result.mode, "semantic_first_unavailable");
    assert.equal(actions(result).length, 0);
    assert.ok(result.interpretationNotice);
  }
});

test("failed status parsing cannot trigger the old status intent shortcut", async () => {
  const text = "что с пациентом сейчас?";
  const result = await run(text, output(), { provider: { isConfigured: false } });
  const turn = submitLearnerTurn({ session: session(), text, interpreted: result });
  assert.ok(!turn.outcomes.some((item) => item.outcome === "STATUS_SNAPSHOT"));
});

test("a validated current-status request produces a snapshot without changing time", async () => {
  const text = "что с пациентом сейчас?";
  const result = await run(text, output([action("REQUEST_STATUS", {}, text)]));
  const before = session();
  const turn = submitLearnerTurn({ session: before, text, interpreted: result });
  assert.ok(turn.outcomes.some((item) => item.outcome === "STATUS_SNAPSHOT"));
  assert.equal(turn.session.state.clock.elapsedMinutes, before.state.clock.elapsedMinutes);
});

test("bolus is recognized from Cyrillic literal text, never invented by the provider", async () => {
  const text = "Ввожу физраствор 500 мл болюсом";
  const result = await run(text, output([action("ORDER_INFUSION", { fluidId: "crystalloid" }, text)]));
  assert.equal(actions(result)[0]?.params.bolus, true);
  assert.equal(actions(result)[0]?.params.volumeMl, 500);
  assert.equal(actions(result)[0]?.params.durationMinutes, undefined);
  const incomplete = "Ввожу физраствор 500 мл";
  const invented = await run(incomplete, output([action("ORDER_INFUSION", { fluidId: "crystalloid", bolus: true }, incomplete)]));
  assert.equal(actions(invented).length, 0);
});

test("only the requested investigation is ordered; results require clinical time", async () => {
  const text = "Пусть лаборант определит число белых клеток в крови";
  const result = await run(text, output([action("ORDER_TEST", { testId: "cbc" }, text)]));
  const before = session();
  const turn = submitLearnerTurn({ session: before, text, interpreted: result });
  const ordered = turn.session.events.filter((event) => event.type === "TEST_ORDERED");
  assert.equal(ordered.length, 1);
  assert.equal(ordered[0].payload.testId, "cbc");
  assert.ok(!turn.session.events.some((event) => event.type === "TEST_RESULTED"));
  assert.equal(turn.session.state.clock.elapsedMinutes, before.state.clock.elapsedMinutes);
  const received = turn.session.events.find((event) => event.type === "LEARNER_TURN_RECEIVED");
  assert.equal(received.payload.interpreterMode, "semantic_first");
  assert.ok(received.payload.semanticTelemetry.providerEvidence.captured);
});

test("a mentor answer with an abbreviation does not use the shorthand fast path", async () => {
  const provider = fixture(output());
  const result = await run("ОАК", output(), { provider, turnContext: { openMentorQuestion: { expects: ["tests"], textRu: "Какие исследования рассматриваешь?" } } });
  assert.equal(provider.calls.length, 1);
  assert.equal(actions(result).length, 0);
});

test("the displayed reasoning question prevents an abbreviation becoming an order", async () => {
  const before = session();
  const textShown = "Что ожидаешь увидеть в анализах?";
  before.mentorDialogue = [{ textShown, question: { text: textShown } }];
  const context = buildChatTurnContext(before, [{ role: "mentor", textRu: textShown }]);
  assert.equal(context.precedingPrompt, textShown);
  const provider = fixture(output([action("ORDER_TEST", { testId: "cbc" }, "ОАК")]));
  const result = await run("ОАК", output(), { provider, turnContext: context });
  assert.equal(provider.calls.length, 1);
  assert.equal(actions(result).length, 0);
  const afterHospitalMessage = buildChatTurnContext(before, [{ role: "mentor", textRu: textShown }, { role: "env", textRu: "Поступили результаты" }]);
  assert.equal(afterHospitalMessage.precedingPrompt, undefined);
});

test("a quoted order for discussion is blocked without relying on the mentor UI", async () => {
  const text = "Назначаю кетопрофен 100 мг в/в — это вопрос для обсуждения";
  const result = await run(text, output([action("ORDER_MEDICATION", { drugId: "ketoprofen" }, "Назначаю кетопрофен 100 мг в/в")]));
  assert.equal(actions(result).length, 0);
  assert.match(result.interpretationNotice, /обсудить/);
});

test("conflicting provider ambiguity blocks only the affected candidate", async () => {
  const text = "Назначаю ОАК и КТ";
  const result = await run(text, output([
    action("ORDER_TEST", { testId: "cbc" }, "ОАК"),
    action("ORDER_TEST", { testId: "ct_abdomen" }, "КТ"),
  ], { ambiguities: [{ evidenceSpan: "КТ", reason: "ambiguous_target" }] }));
  assert.deepEqual(actions(result).map((c) => c.params.testId), ["cbc"]);
  assert.ok(result.unmatchedFragments.includes("КТ"));
});

test("a rejected clause remains visible next to a valid action", async () => {
  const text = "Назначаю ОАК и тропонин";
  const result = await run(text, output([
    action("ORDER_TEST", { testId: "cbc" }, "ОАК"),
    action("ORDER_TEST", { testId: "invented_troponin" }, "тропонин"),
  ]));
  assert.deepEqual(actions(result).map((c) => c.params.testId), ["cbc"]);
  assert.ok(result.unmatchedFragments.includes("тропонин"));
});

test("recorded semantic commands replay without another provider call", async () => {
  const text = "Назначаю общий анализ крови";
  const provider = fixture(output([action("ORDER_TEST", { testId: "cbc" }, text)]));
  const result = await run(text, output(), { provider });
  const before = session();
  const turn = submitLearnerTurn({ session: before, text, interpreted: result });
  const replayed = reduceEvents(before.state, turn.session.events.slice(before.events.length));
  assert.deepEqual(replayed, turn.session.state);
  assert.equal(provider.calls.length, 1);
});

test("resume uses the recorded interpretation and rejects a changed causal log", async () => {
  const text = "Пусть лаборант определит число белых клеток в крови";
  const provider = fixture(output([action("ORDER_TEST", { testId: "cbc" }, text)]));
  const interpreted = await run(text, output(), { provider });
  const current = submitLearnerTurn({ session: session(), text, interpreted }).session;
  let saved;
  const storage = { setItem(_key, value) { saved = value; }, getItem() { return saved; } };
  const snapshot = createPersistedSession({ session: current, messages: [] });
  savePersistedSession(storage, snapshot);
  const restored = loadPersistedSession(storage, bundle);
  assert.ok(restored, "the semantic-only phrase must be resumable");
  assert.deepEqual(restored.session.state, JSON.parse(JSON.stringify(current.state)));
  assert.equal(provider.calls.length, 1);
  const tampered = JSON.parse(saved);
  tampered.expectedEvents.find((event) => event.type === "TEST_ORDERED").payload.testId = "ct_abdomen";
  savePersistedSession(storage, tampered);
  assert.equal(loadPersistedSession(storage, bundle), null);
});

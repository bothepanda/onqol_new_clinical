/**
 * Interpreter v3A.1 r2 - commitment scope (owner rulings of 2026-09-20).
 *
 *   1. `DECLINED` stays a sixth, non-executable commitment state.
 *   2. Bare interrogative shorthand («КТ ОБП?») stays withheld, but punctuation
 *      alone does not override an explicit order: «назначаю», «делаем»,
 *      «заказываю» are COMMITTED with a trailing question mark.
 *   3. «сначала X, затем Y» is two COMMITTED actions with explicit ordering, not
 *      COMMITTED + FUTURE_PLAN. The ordering is recorded, the clinical core is not
 *      redesigned.
 *   4. Commitment scope is the clause: a conditional or tentative first sentence
 *      cannot withhold an independently committed second sentence.
 *
 * Phrases are written from the language, not taken from the development corpus.
 * The provider is a fixture; everything after it is the real code path.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import diseaseBundle from "../../content/generated/appendicitis.json" with { type: "json" };
import sharedBundle from "../../content/generated/shared.json" with { type: "json" };
import { withShared } from "../../core/content/loadBundle.js";
import { COMMAND } from "../../core/commands/commandTypes.js";
import { createSession } from "../../core/session/createSession.js";
import { submitLearnerTurn } from "../../core/session/submitLearnerTurn.js";
import { exportSession } from "../../core/replay/exportSession.js";
import { interpretHybrid } from "./hybridInterpreter.js";
import { interpretDeterministically } from "./deterministicInterpreter.js";
import { WAVE23_SCHEMA_VERSION } from "./semanticTaskSchemas.js";
import { COMMITMENT, COMMITMENT_POLICY_VERSION, assessCommitment, assessSequence, orderBySequence } from "./commitmentPolicy.js";

const bundle = withShared(diseaseBundle, sharedBundle);
const meta = { schemaVersion: WAVE23_SCHEMA_VERSION, confidence: 0.9 };
const action = (type, params, ...spans) => ({ type, params, evidenceSpans: spans, statedParameters: [] });
const output = (clinicalActions = []) => ({ clinicalActions, patientQuestions: [], ambiguities: [], unresolvedFragments: [], meta });
const fixtureProvider = (modelOutput) => ({ calls: [], isConfigured: true, async complete(request) { this.calls.push(request); return { output: modelOutput, meta: { model: "fixture-model", costUsd: 0.0001 } }; } });
const interpret = async (text, modelOutput) => {
  const provider = fixtureProvider(modelOutput);
  return { result: await interpretHybrid({ text, bundle, provider, idPrefix: "t1" }), provider };
};
const newSession = () => createSession({ sessionId: "v3a1r2", seed: "v3a1r2", mode: "reference", casePresetId: "APP-004", sessionPurpose: "internal_development", bundle, locale: "ru", startIso: "2026-09-19T08:00:00+05:00" });
const run = (text, interpreted = interpretDeterministically({ text, bundle })) => submitLearnerTurn({ session: newSession(), text, interpreted });
const actions = (commands) => commands.filter((c) => c.type !== COMMAND.STATE_REASONING);
const label = (c) => `${c.type}:${c.params.testId ?? c.params.region ?? c.params.topic ?? c.params.afterMinutes ?? ""}`;
const executedLabels = (turn) => turn.outcomes.filter((o) => o.outcome === "EXECUTED" && o.command.type !== COMMAND.STATE_REASONING).map((o) => label(o.command));
const det = (text) => interpretDeterministically({ text, bundle });
const executes = (text) => actions(det(text).commands).map(label);
const withheldStatus = (text) => det(text).withheldCommands?.map((entry) => entry.commitment.status) ?? [];

// ---------------------------------------------------------------- 1. DECLINED

test("r2: DECLINED is a sixth commitment state and is never executable", () => {
  assert.deepEqual(Object.keys(COMMITMENT).sort(), ["COMMITTED", "CONDITIONAL", "DECLINED", "FUTURE_PLAN", "INTERROGATIVE", "TENTATIVE"]);
  for (const text of ["не назначаю КТ", "КТ не нужен", "отмените КТ"]) {
    assert.deepEqual(executes(text), [], text);
    assert.deepEqual(withheldStatus(text), [COMMITMENT.DECLINED], text);
  }
  // A refusal is not lifted by explicit action language elsewhere in the sentence.
  assert.deepEqual(executes("Делаем ОАК, КТ не нужен"), ["ORDER_TEST:cbc"]);
  assert.match(COMMITMENT_POLICY_VERSION, /-r\d+/);
});

// ------------------------------------------------- 2. punctuation vs. explicit order

test("r2: bare interrogative shorthand stays withheld", () => {
  for (const text of ["КТ ОБП?", "ОАК?", "УЗИ ОБП?", "Сделать КТ?", "Назначить КТ ОБП?", "КТ? ОАК?"]) {
    assert.deepEqual(executes(text), [], text);
    assert.ok(withheldStatus(text).every((status) => status === COMMITMENT.INTERROGATIVE), `${text}: ${withheldStatus(text)}`);
  }
  assert.deepEqual(withheldStatus("КТ? ОАК?"), [COMMITMENT.INTERROGATIVE, COMMITMENT.INTERROGATIVE]);
});

test("r2: explicit action language stays COMMITTED with trailing punctuation", () => {
  const cases = [
    ["Назначаю КТ ОБП?", ["ORDER_TEST:ct_abdomen"]],
    ["Делаем КТ?", ["ORDER_TEST:ct_abdomen"]],
    ["Заказываю ОАК?", ["ORDER_TEST:cbc"]],
    ["Заказываю ОАК!", ["ORDER_TEST:cbc"]],
    ["Заказываю ОАК!?", ["ORDER_TEST:cbc"]],
    ["Сделайте ОАК?", ["ORDER_TEST:cbc"]],
    ["Назначаю ОАК, КТ?", ["ORDER_TEST:cbc", "ORDER_TEST:ct_abdomen"]],
    ["Назначаю ОАК и УЗИ ОБП?", ["ORDER_TEST:cbc", "ORDER_TEST:ultrasound_abdomen"]],
  ];
  for (const [text, expected] of cases) {
    assert.deepEqual(executes(text), expected, text);
    assert.deepEqual(withheldStatus(text), [], `${text}: nothing withheld`);
  }
});

test("r2: only the punctuation is overridden - hedges, conditions, deferrals, refusals and lexical questions still stand", () => {
  const cases = [
    ["Назначаю КТ или нет?", COMMITMENT.INTERROGATIVE],
    ["Как думаете, назначаю КТ?", COMMITMENT.INTERROGATIVE],
    ["Может, делаем КТ?", COMMITMENT.TENTATIVE],
    ["Если станет хуже, делаем КТ?", COMMITMENT.CONDITIONAL],
    ["Делаем КТ позже?", COMMITMENT.FUTURE_PLAN],
    ["Не назначаю КТ?", COMMITMENT.DECLINED],
    // «Сделаем» / «закажу» / «назначим» with «?» is «shall we?» / «shall I?», not an order.
    ["Сделаем КТ?", COMMITMENT.INTERROGATIVE],
    ["Закажу ОАК?", COMMITMENT.INTERROGATIVE],
  ];
  for (const [text, status] of cases) {
    assert.deepEqual(executes(text), [], text);
    assert.deepEqual(withheldStatus(text), [status], text);
  }
  // Without the question mark the perfective forms are ordinary orders (unchanged).
  assert.deepEqual(executes("Сделаем КТ"), ["ORDER_TEST:ct_abdomen"]);
  assert.deepEqual(executes("Закажу ОАК"), ["ORDER_TEST:cbc"]);
});

test("r2: a patient question keeps its question form, and a mid-turn question does not reach the next sentence", () => {
  assert.deepEqual(executes("Тошнота бывает?"), ["ASK_PATIENT:nausea_vomiting"]);
  assert.deepEqual(executes("КТ нужен? Заказываю ОАК."), ["ORDER_TEST:cbc"]);
});

test("r2 (model): the same rule holds for a semantic candidate - the learner's words decide, not the model", async () => {
  const cbc = (span) => output([action("ORDER_TEST", { testId: "cbc" }, span)]);
  const bare = await interpret("Проверку клеточного состава крови?", cbc("Проверку клеточного состава крови"));
  assert.deepEqual(actions(bare.result.commands).map(label), [], "bare shorthand with a question mark is withheld");
  assert.equal(bare.result.withheldCommands[0].commitment.status, COMMITMENT.INTERROGATIVE);

  const explicit = await interpret("Организуем проверку клеточного состава крови?", cbc("проверку клеточного состава крови"));
  assert.deepEqual(actions(explicit.result.commands).map(label), ["ORDER_TEST:cbc"], "explicit action language: the question mark is only punctuation");
  assert.equal(executedLabels(run("Организуем проверку клеточного состава крови?", explicit.result)).join(), "ORDER_TEST:cbc");

  const lexical = await interpret("Организуем проверку клеточного состава крови или нет?", cbc("проверку клеточного состава крови"));
  assert.deepEqual(actions(lexical.result.commands).map(label), [], "a lexical question is never lifted");
  assert.equal(lexical.result.withheldCommands[0].commitment.status, COMMITMENT.INTERROGATIVE);
});

// ------------------------------------------------------------ 3. sequence semantics

test("r2: «сначала X, затем Y» is two COMMITTED actions in stated order, not COMMITTED + FUTURE_PLAN", () => {
  for (const text of ["Сначала ОАК, затем КТ", "Сначала ОАК, потом КТ", "Сначала ОАК, а потом КТ.", "Сначала ОАК, далее КТ", "Сначала ОАК, после этого КТ", "Сначала ОАК. Затем КТ."]) {
    const result = det(text);
    assert.deepEqual(actions(result.commands).map(label), ["ORDER_TEST:cbc", "ORDER_TEST:ct_abdomen"], text);
    assert.equal(result.withheldCommands, undefined, `${text}: nothing is withheld`);
    assert.equal(result.commandSequence.marker, "сначала", text);
    assert.equal(result.commandSequence.steps.length, 2, text);
    assert.equal(result.commandSequence.steps[0].connective, null);
    assert.ok(result.commandSequence.steps[1].connective, text);
    assert.deepEqual(result.commandSequence.steps.map((step) => step.commandIds.length), [1, 1], text);
  }
});

test("r2: the sequence is recorded on the turn event and in the export, every command is COMMITTED, and they execute in stated order", () => {
  const turn = run("Сначала КТ, затем ОАК");
  assert.deepEqual(executedLabels(turn), ["ORDER_TEST:ct_abdomen", "ORDER_TEST:cbc"], "the order the learner stated");
  const received = turn.session.events.find((e) => e.type === "LEARNER_TURN_RECEIVED");
  assert.deepEqual(received.payload.interpretedCommands.map((c) => c.commitment), ["COMMITTED", "COMMITTED"]);
  assert.deepEqual(received.payload.withheldCommands, []);
  const [first, second] = received.payload.interpretedCommands;
  assert.deepEqual(received.payload.commandSequence.steps.map((step) => step.commandIds), [[first.id], [second.id]]);
  assert.equal(exportSession({ session: turn.session, generatedAtIso: "2026-09-20T00:00:00Z" }).learner_turns[0].commandSequence.marker, "сначала");
  // A turn without a sequence carries no such field (existing replays are byte-identical).
  const plain = run("КТ, ОАК").session.events.find((e) => e.type === "LEARNER_TURN_RECEIVED");
  assert.equal("commandSequence" in plain.payload, false);
});

test("r2: three steps keep three ordered steps", () => {
  const result = det("Сначала ОАК, затем КТ, затем УЗИ ОБП");
  assert.deepEqual(actions(result.commands).map(label), ["ORDER_TEST:cbc", "ORDER_TEST:ct_abdomen", "ORDER_TEST:ultrasound_abdomen"]);
  assert.deepEqual(result.commandSequence.steps.map((step) => step.step), [1, 2, 3]);
});

test("r2: only the sequence connective stops being a deferral - every other deferral, and a connective with no opener, still withholds", () => {
  assert.deepEqual(executes("ОАК, затем КТ"), ["ORDER_TEST:cbc"], "no opener: «затем» is still a deferral");
  assert.deepEqual(executes("КТ, потом"), []);
  assert.deepEqual(executes("Сначала ОАК, КТ позже"), ["ORDER_TEST:cbc"]);
  assert.deepEqual(executes("Сначала ОАК, КТ на потом"), ["ORDER_TEST:cbc"]);
  assert.deepEqual(executes("Сначала ОАК, после получения СРБ решу вопрос о КТ"), ["ORDER_TEST:cbc"]);
  assert.equal(det("Сначала ОАК, КТ позже").commandSequence, undefined, "a deferral is not a sequence step");
  // The connective does not lift a condition, a hedge or a refusal that comes with it.
  assert.deepEqual(executes("Сначала ОАК, затем КТ, если понадобится"), ["ORDER_TEST:cbc"]);
  assert.deepEqual(executes("Сначала ОАК, затем возможно КТ"), ["ORDER_TEST:cbc"]);
  assert.deepEqual(executes("Сначала ОАК, затем КТ не нужен"), ["ORDER_TEST:cbc"]);
  // «потому», «потом» is matched as a whole token.
  assert.deepEqual(executes("Сначала ОАК, КТ, потому что боль нарастает"), ["ORDER_TEST:cbc", "ORDER_TEST:ct_abdomen"]);
});

test("r2: a lone opener is not a sequence, and metadata never names a command that did not execute", () => {
  const single = det("Сначала ОАК");
  assert.deepEqual(actions(single.commands).map(label), ["ORDER_TEST:cbc"]);
  assert.equal(single.commandSequence, undefined);
  const mixed = det("Сначала ОАК, затем КТ не нужен, затем УЗИ ОБП");
  const ids = new Set(actions(mixed.commands).map((c) => c.id));
  for (const step of mixed.commandSequence?.steps ?? []) for (const id of step.commandIds) assert.ok(ids.has(id), `${id} executes`);
});

test("r2 (model): a semantic candidate inside a stated sequence is COMMITTED, and the sequence orders semantic and deterministic commands together", async () => {
  const text = "Сначала организуем проверку клеточного состава крови, затем КТ";
  const { result } = await interpret(text, output([action("ORDER_TEST", { testId: "cbc" }, "проверку клеточного состава крови")]));
  assert.deepEqual(actions(result.commands).map(label), ["ORDER_TEST:cbc", "ORDER_TEST:ct_abdomen"]);
  assert.equal(result.withheldCommands, undefined);
  assert.equal(result.commandSequence.steps.length, 2);
  // Reverse the stated order in the words: the semantic addition is appended after the deterministic reading,
  // and the sequence puts it back where the learner said it.
  const reversed = await interpret("Сначала КТ, затем организуем проверку клеточного состава крови", output([action("ORDER_TEST", { testId: "cbc" }, "проверку клеточного состава крови")]));
  assert.deepEqual(actions(reversed.result.commands).map(label), ["ORDER_TEST:ct_abdomen", "ORDER_TEST:cbc"]);
  assert.deepEqual(reversed.result.commandSequence.steps.map((step) => step.step), [1, 2]);
});

test("r2: orderBySequence is stable and leaves commands outside the sequence in their slots", () => {
  const a = { id: "a" }; const b = { id: "b" }; const c = { id: "c" }; const x = { id: "x" };
  const sequence = { marker: "сначала", steps: [{ step: 1, connective: null, commandIds: ["b"] }, { step: 2, connective: "затем", commandIds: ["a", "c"] }] };
  assert.deepEqual(orderBySequence([a, x, b, c], sequence).map((cmd) => cmd.id), ["b", "x", "a", "c"]);
  assert.deepEqual(orderBySequence([a, b], null), [a, b]);
  assert.equal(assessSequence({ rawText: "ОАК, КТ", commands: [] }), null);
});

// -------------------------------------------------------- 4. clause-local scope

test("r2: a conditional or tentative first sentence does not withhold an independently committed second sentence", () => {
  const cases = [
    ["Если станет хуже, КТ. ОАК сейчас.", ["ORDER_TEST:cbc"], [COMMITMENT.CONDITIONAL]],
    ["Возможно, КТ. Заказываю ОАК.", ["ORDER_TEST:cbc"], [COMMITMENT.TENTATIVE]],
    ["Может быть, КТ позже. Делаем ОАК.", ["ORDER_TEST:cbc"], [COMMITMENT.FUTURE_PLAN]],
    ["Нужно ли КТ? Делаю ОАК.", ["ORDER_TEST:cbc"], [COMMITMENT.INTERROGATIVE]],
    ["Не назначаю КТ. Назначаю ОАК.", ["ORDER_TEST:cbc"], [COMMITMENT.DECLINED]],
    ["Если ухудшится, КТ. Сначала ОАК, затем УЗИ ОБП.", ["ORDER_TEST:cbc", "ORDER_TEST:ultrasound_abdomen"], [COMMITMENT.CONDITIONAL]],
  ];
  for (const [text, expected, statuses] of cases) {
    assert.deepEqual(executes(text), expected, text);
    assert.deepEqual(withheldStatus(text), statuses, text);
    assert.deepEqual(executedLabels(run(text)), expected, `${text}: the core executes exactly that`);
  }
});

test("r2: whole-turn shortcut commands are judged by their own sentence (WAIT / REASSESS)", () => {
  for (const text of ["Подождём 30 минут. Если станет хуже, КТ.", "Если станет хуже, КТ. Подождём 30 минут.", "Возможно, КТ. Подождём 30 минут."]) {
    const result = det(text);
    assert.deepEqual(actions(result.commands).map(label), ["WAIT:30"], text);
    assert.equal(actions(result.commands)[0].sourceText.toLowerCase().includes("кт"), false, `${text}: the WAIT is read from its own sentence`);
    assert.equal(result.withheldCommands, undefined, text);
  }
  // Inside ONE sentence the condition still governs (unchanged).
  assert.deepEqual(executes("Если станет хуже, подождём 30 минут"), []);
  assert.deepEqual(executes("Подождём 30 минут, если станет хуже"), []);
  const reassess = det("Возможно, КТ. Переоценю боль через 30 минут.");
  assert.deepEqual(actions(reassess.commands).map((c) => c.type), ["REASSESS"]);
  // The shortcut no longer swallows the turn (legacy real-language wave 2), so the hedged CT is READ and then withheld
  // by the commitment gate - reported instead of silently absent. It still does not execute.
  assert.deepEqual((reassess.withheldCommands ?? []).map((w) => [w.type, w.commitment.status]), [["ORDER_TEST", "TENTATIVE"]]);
});

test("r2: a hedge in one sentence and an order for the same test in the next are two clauses - the order executes", () => {
  const result = det("Обсуждаю КТ. Назначаю КТ.");
  assert.deepEqual(actions(result.commands).map(label), ["ORDER_TEST:ct_abdomen"]);
  assert.deepEqual(result.withheldCommands.map((entry) => entry.commitment.status), [COMMITMENT.TENTATIVE]);
  // Within one sentence a duplicate is still one order (chemistry list).
  assert.deepEqual(executes("Глюкоза, билирубин"), ["ORDER_TEST:chemistry"]);
});

test("r2: a cue never crosses a sentence boundary, including a question mark or an exclamation", () => {
  const cmd = (id, sourceText) => ({ id, type: "ORDER_TEST", params: { testId: "cbc" }, sourceText });
  for (const before of ["Если станет хуже.", "Возможно!", "Может быть, позже?", "Не назначаю КТ."]) {
    const rawText = `${before} Заказываю ОАК.`;
    assert.equal(assessCommitment({ rawText, commands: [cmd("a", "Заказываю ОАК")] }).get("a").status, COMMITMENT.COMMITTED, rawText);
  }
});

test("r2: evidence that spans several sentences cannot be attributed to a clause and fails closed", () => {
  const rawText = "Возможно, КТ. Заказываю ОАК.";
  const wide = { id: "w", type: "ORDER_TEST", params: { testId: "cbc" }, sourceText: rawText };
  const verdict = assessCommitment({ rawText, commands: [wide] }).get("w");
  assert.equal(verdict.status, COMMITMENT.TENTATIVE);
  assert.equal(verdict.scope, "multi_sentence_evidence");
  const twoPieces = { id: "p", type: "ORDER_TEST", params: { testId: "cbc" }, sourceText: "Возможно, КТ, Заказываю ОАК" };
  assert.equal(assessCommitment({ rawText, commands: [twoPieces] }).get("p").status, COMMITMENT.TENTATIVE, "a hedged span in the evidence cannot be laundered by adding a committed one");
  // Every sentence it touches commits it -> committed.
  const allCommitted = "Заказываю ОАК. Делаем ОАК.";
  assert.equal(assessCommitment({ rawText: allCommitted, commands: [{ ...wide, sourceText: allCommitted }] }).get("w").status, COMMITMENT.COMMITTED);
});

test("r2 (model): the model cannot move a hedge out of its clause by choosing the evidence", async () => {
  const text = "Возможно, проверить клеточный состав крови. Организуем УЗИ ОБП.";
  const cbcWhole = await interpret(text, output([action("ORDER_TEST", { testId: "cbc" }, text)]));
  assert.ok(!actions(cbcWhole.result.commands).some((c) => c.params.testId === "cbc"), "whole-turn evidence for a hedged test does not execute it");
  const cbcPrecise = await interpret(text, output([action("ORDER_TEST", { testId: "cbc" }, "проверить клеточный состав крови")]));
  assert.ok(!actions(cbcPrecise.result.commands).some((c) => c.params.testId === "cbc"), "precise evidence in the hedged clause is withheld too");
  assert.deepEqual(actions(cbcPrecise.result.commands).map(label), ["ORDER_TEST:ultrasound_abdomen"], "the independently committed sentence executes");
  const laundered = await interpret(text, output([action("ORDER_TEST", { testId: "cbc" }, "проверить клеточный состав крови", "Организуем УЗИ ОБП")]));
  assert.ok(!actions(laundered.result.commands).some((c) => c.params.testId === "cbc"), "a committed span added to the evidence does not waive the hedge");
});

test("r2: a sentence terminator splits only before whitespace, so decimals and abbreviations stay whole", () => {
  assert.deepEqual(executes("Физраствор 0.9% 500 мл в/в за 60 минут"), det("Физраствор 0.9% 500 мл в/в за 60 минут").commands.map(label));
  const fragments = det("Кетопрофен 100 мг в/м. Ок.");
  assert.deepEqual(actions(fragments.commands).map((c) => c.type), ["ORDER_MEDICATION"]);
});

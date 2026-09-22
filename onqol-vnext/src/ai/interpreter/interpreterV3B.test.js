/**
 * Interpreter v3B - conversational context, clause-level parsing, narrowed consultation.
 *
 * Phrases are written from the language, not taken from the development corpus. The provider is a fixture; everything
 * after it is the real code path.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import diseaseBundle from "../../content/generated/appendicitis.json" with { type: "json" };
import sharedBundle from "../../content/generated/shared.json" with { type: "json" };
import { withShared } from "../../core/content/loadBundle.js";
import { COMMAND } from "../../core/commands/commandTypes.js";
import { interpretHybrid } from "./hybridInterpreter.js";
import { interpretDeterministically } from "./deterministicInterpreter.js";
import { WAVE23_SCHEMA_VERSION } from "./semanticTaskSchemas.js";
import { COMMITMENT } from "./commitmentPolicy.js";
import { KIND_MUST_BE_EVIDENT } from "./promotionPolicy.js";
import { segmentClauses } from "./clauseParser.js";
import { buildConversationFrame, frameForModel, resolveFrameReply } from "./conversationContext.js";
import { decideSemanticConsultation } from "./semanticConsultationPolicy.js";
import { buildModelAllowlist } from "./modelConceptValidation.js";

const bundle = withShared(diseaseBundle, sharedBundle);
const meta = { schemaVersion: WAVE23_SCHEMA_VERSION, confidence: 0.9 };
const output = (clinicalActions = []) => ({ clinicalActions, patientQuestions: [], ambiguities: [], unresolvedFragments: [], meta });
const action = (type, params, ...spans) => ({ type, params, evidenceSpans: spans, statedParameters: [] });
const provider = (modelOutput) => ({ calls: [], isConfigured: true, async complete(request) { this.calls.push(request); return { output: modelOutput, meta: { model: "fixture", costUsd: 0.0001 } }; } });
const det = (text, prompt) => interpretDeterministically({ text, bundle, turnContext: prompt ? { precedingPrompt: prompt } : {} });
const acts = (result) => result.commands.filter((c) => c.type !== COMMAND.STATE_REASONING);
const label = (c) => `${c.type}:${c.params.testId ?? c.params.destination ?? c.params.role ?? c.params.intent ?? ""}`;

// ------------------------------------------------------------ clause parser

test("clauses: one segmentation - decimals and «0.9%» stay whole, a spaced dash and «и» split, a list marker is not a clause", () => {
  const text = "1. физ р-р 0.9% 500 мл, доза 2,5 мг - оак и кт";
  const clauses = segmentClauses(text);
  assert.deepEqual(clauses.map((c) => c.text), ["физ р-р 0.9% 500 мл", "доза 2,5 мг", "оак", "кт"]);
  const tokens = text.toLowerCase().match(/[\p{L}\p{N}]+/gu);
  for (const clause of clauses) assert.ok(clause.range[0] >= 0 && clause.range[1] <= tokens.length && clause.range[0] < clause.range[1]);
  assert.equal(clauses[3].range[0], clauses[2].range[1] + 1, "the conjunction word is accounted for in the token ranges");
});

test("clauses: commitment is judged in the clause a command came from, and duplicates merge only afterwards", () => {
  const result = det("Возможно, КТ — но я решил, делаем КТ обп");
  assert.deepEqual(acts(result).map(label), ["ORDER_TEST:ct_abdomen"]);
  assert.deepEqual(result.withheldCommands.map((w) => w.commitment.status), [COMMITMENT.TENTATIVE], "the hedged occurrence is withheld, the decided one executes");
  const partial = det("креатинин, возможно билирубин");
  assert.deepEqual(acts(partial).map((c) => c.params.analytes), [["creatinine"]], "a hedged analyte does not ride along with a committed one");
});

test("clauses: every clause of the result reports its own channel and commitment", () => {
  const { clauses } = det("Давление низковато, назначаю ОАК, КТ если понадобится");
  assert.ok(clauses.length >= 3);
  assert.ok(clauses.some((c) => c.channel === "clinical_action" && c.commitment?.status === COMMITMENT.COMMITTED));
  assert.ok(clauses.some((c) => c.channel === "clinical_action" && c.commitment?.status === COMMITMENT.CONDITIONAL));
});

// ------------------------------------------------------------ sequence ruling

test("sequence: an explicit opener makes both steps COMMITTED and orders the second after the first, whatever the connective", () => {
  for (const connective of ["затем", "далее", "после этого"]) {
    const result = det(`Сначала ОАК, ${connective} КТ`);
    assert.deepEqual(acts(result).map(label), ["ORDER_TEST:cbc", "ORDER_TEST:ct_abdomen"], connective);
    assert.equal(result.withheldCommands, undefined, connective);
    assert.deepEqual(result.commandSequence.steps.map((s) => s.commandIds.length), [1, 1], connective);
  }
});

test("sequence: «позже» and «на потом» stay FUTURE_PLAN, and a bare «потом» with no opener stays deferred", () => {
  for (const text of ["ОАК, КТ позже", "ОАК, КТ на потом", "ОАК, потом КТ"]) {
    const result = det(text);
    assert.deepEqual(acts(result).map(label), ["ORDER_TEST:cbc"], text);
    assert.deepEqual(result.withheldCommands.map((w) => w.commitment.status), [COMMITMENT.FUTURE_PLAN], text);
  }
});

test("sequence: a bare «потом» opens the NEXT step and defers only that step, never the action before it", () => {
  const result = det("Операцию, потом наблюдение");
  assert.deepEqual(acts(result).map(label), ["COMMIT_MANAGEMENT_PLAN:operative"]);
  // ... whereas a postponement or condition that trails an action still qualifies it.
  assert.deepEqual(acts(det("КТ, позже")).map(label), []);
  assert.deepEqual(acts(det("КТ, если понадобится")).map(label), []);
  assert.deepEqual(acts(det("Некрэктомия - только если дренаж не поможет")).map(label), [], "a focus particle does not stop a condition from governing");
});

// ------------------------------------------------------------ context channel

const WHERE = "Куда госпитализируешь — отделение или реанимация?";

test("context: a bare noun answering a where-question fills the slot the question asked about", () => {
  assert.deepEqual(acts(det("реанимацию")).map(label), [], "without the question it is only a noun");
  const result = det("реанимацию", WHERE);
  assert.deepEqual(acts(result).map(label), ["DISPOSITION:icu"]);
  assert.equal(result.contextResolutions[0].via, "slot");
  assert.equal(result.contextResolutions[0].identitySource, "learner", "the act is named by the learner's own word");
});

test("context: a yes/no reply agrees to the question's act - only a non-protected one, and never with a parameter the question carried", () => {
  const ask = "Нужна ли КТ в первые сутки?";
  assert.deepEqual(acts(det("да", ask)).map(label), ["ORDER_TEST:ct_abdomen"]);
  const no = det("нет, не нужна", ask);
  assert.deepEqual(acts(no).map(label), []);
  assert.deepEqual(no.withheldCommands.map((w) => w.commitment.status), [COMMITMENT.DECLINED], "one answer, one record - not one per clause");
  // A protected act named only by the question is not executed by «да».
  assert.deepEqual(acts(det("да", "Оперируем ли сейчас?")).map(label), []);
  assert.deepEqual(acts(det("да", "Нужно ли ввести 1000 мл физраствора за час?")).map(label), []);
  const stripped = det("да", "Нужна ли КТ через 30 минут, 2 раза?");
  for (const command of acts(stripped)) assert.equal(command.params.afterMinutes, undefined);
});

test("context: an ordinal picks an option the question literally listed, with the same identity rule", () => {
  const ask = "Что назначаешь — ОАК или КТ?";
  assert.deepEqual(acts(det("первое", ask)).map(label), ["ORDER_TEST:cbc"]);
  assert.deepEqual(acts(det("второе", ask)).map(label), ["ORDER_TEST:ct_abdomen"]);
  assert.deepEqual(acts(det("второе", "Куда — в отделение или в реанимацию?")).map(label), [], "a protected act chosen only by ordinal is not executed");
  assert.equal(resolveFrameReply({ frame: buildConversationFrame({ precedingPrompt: ask }), replyText: "третье" }), null, "an option that was not offered does not exist");
});

test("context: a reply that carries its own action words is not elliptical and is read like any fragment", () => {
  assert.equal(resolveFrameReply({ frame: buildConversationFrame({ precedingPrompt: "Нужна ли КТ?" }), replyText: "да, назначаю УЗИ" }), null);
  assert.deepEqual(acts(det("назначаю ОАК", "Нужна ли КТ?")).map(label), ["ORDER_TEST:cbc"]);
});

test("context: a nominal answer to a question that asked for reasoning is a mentor answer, not an unrecognised action", () => {
  const result = det("боль, давление", "Что именно наблюдаешь и почему?");
  assert.deepEqual(acts(result).map(label), []);
  assert.deepEqual(result.unmatchedFragments, []);
  assert.ok(result.clauses.every((c) => c.channel === "mentor_answer"));
  assert.equal(decideSemanticConsultation({ deterministic: result, text: "боль, давление" }).consult, false);
});

test("context: the frame shown to a model holds the system's words and structure only", () => {
  const frame = frameForModel(buildConversationFrame({ precedingPrompt: "Куда — в отделение или в реанимацию?\nНужна ли КТ?" }));
  assert.equal(frame.questions.length, 2);
  assert.deepEqual(frame.questions[0].options, ["в отделение", "в реанимацию"]);
  assert.equal(frame.questions[1].kind, "yes_no");
  assert.equal(frameForModel(buildConversationFrame({})), null);
});

// ------------------------------------------------------------ verb ellipsis

test("ellipsis: a bare object after «и» borrows the previous clause's own verb, and only for the same kind of act", () => {
  const result = det("реаниматолога вызываю и старшего");
  assert.deepEqual(acts(result).map(label), ["CALL_STAFF:icuPhysician", "CALL_STAFF:surgeon"]);
  assert.deepEqual(acts(det("оак и живот")).map(label), ["ORDER_TEST:cbc", "EXAMINE:"], "two independent acts are not one borrowed verb");
});

// ------------------------------------------------------------ narrowed consultation

test("consultation: a turn whose clauses are all canonical never reaches the provider", async () => {
  const p = provider(output());
  const result = await interpretHybrid({ text: "ОАК, КТ ОБП, живот", bundle, provider: p, idPrefix: "t1" });
  assert.equal(p.calls.length, 0);
  assert.equal(result.semanticTelemetry.consultation.reason, "canonical_deterministic_form");
});

test("consultation: only the clauses in doubt are sent, and a hedged clause is final", async () => {
  const span = "гляньте желчный на ультразвуке";
  const p = provider(output([action("ORDER_TEST", { testId: "ultrasound_abdomen" }, span)]));
  const text = `ОАК, возможно КТ, ${span}`;
  const result = await interpretHybrid({ text, bundle, provider: p, idPrefix: "t1" });
  assert.equal(p.calls.length, 1);
  const sent = JSON.parse(p.calls[0].messages[1].content).rawLearnerText;
  assert.equal(sent, span, "the canonical clause and the hedged clause are not sent");
  assert.deepEqual(acts(result).map(label).sort(), ["ORDER_TEST:cbc", "ORDER_TEST:ultrasound_abdomen"]);
  assert.deepEqual(result.withheldCommands.map((w) => w.commitment.status), [COMMITMENT.TENTATIVE]);
  const focus = result.semanticTelemetry.consultation.focus;
  assert.equal(focus.whole, false);
  assert.ok(focus.finalClauses >= 2);
});

test("consultation: a model cannot act on a clause that was not sent - its evidence is not in the request", async () => {
  const span = "гляньте желчный на ультразвуке";
  const p = provider(output([action("ORDER_TEST", { testId: "cbc" }, "ОАК"), action("ORDER_TEST", { testId: "ultrasound_abdomen" }, span)]));
  const result = await interpretHybrid({ text: `ОАК, ${span}`, bundle, provider: p, idPrefix: "t1" });
  const decisions = result.semanticTelemetry.candidateDecisions;
  assert.equal(decisions[0].validation, "REJECT", "the canonical clause is not the model's to re-read");
  assert.equal(decisions[1].validation, "ACCEPT");
});

test("consultation: the preceding question travels with the request; the elliptical reply that the frame cannot resolve is what gets sent", async () => {
  const p = provider(output());
  const turnContext = { precedingPrompt: "Что назначаешь — ОАК или КТ?" };
  const result = await interpretHybrid({ text: "давайте что-нибудь посерьёзнее", bundle, provider: p, idPrefix: "t1", turnContext });
  assert.equal(p.calls.length, 1);
  const payload = JSON.parse(p.calls[0].messages[1].content);
  assert.equal(payload.precedingSystemQuestion.questions[0].kind, "choice");
  assert.match(p.calls[0].messages[0].content, /never from the question/);
  assert.equal(result.semanticTelemetry.consultation.consult, true);
});

// ------------------------------------------------------------ rulings kept

test("kept: KIND_MUST_BE_EVIDENT still covers the four widened types, and icuPhysician / radiologist are staff roles", () => {
  for (const type of [COMMAND.TAKE_HISTORY, COMMAND.SET_NPO, COMMAND.ESTABLISH_IV_ACCESS, COMMAND.REQUEST_STATUS]) assert.ok(KIND_MUST_BE_EVIDENT.includes(type), type);
  const roles = buildModelAllowlist({ bundle }).staffRoles;
  assert.ok(roles.includes("icuPhysician") && roles.includes("radiologist"));
});

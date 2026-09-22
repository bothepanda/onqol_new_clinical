/**
 * Interpreter v3A.1 regression suite (offline final remediation).
 *
 * Three false-execution classes, fixed systemically rather than per phrase:
 *   1. generic imaging language with no modality is an imaging clarification,
 *      never an examination;
 *   2. an explicit imaging-modality word disqualifies the physical-exam path;
 *   3. tentative / conditional / question / future-plan (and refused) language is
 *      never executed as a committed action - one explicit status, one gate, for
 *      every command type.
 * Plus: the owner's promotion decisions (WAIT and REQUEST_ANESTHESIA_REVIEW
 * promoted; ORDER_ORAL_INTAKE and OBTAIN_CONSENT protected; REPEAT_LAST and
 * END_CASE explicit controls only; protected model-originated additions), and the
 * pelvic-ultrasound limitation.
 *
 * The provider is a fixture with a fixed model output; everything after it is the
 * real code path. The phrases below are written from the language, not taken from
 * the development corpus.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import diseaseBundle from "../../content/generated/appendicitis.json" with { type: "json" };
import sharedBundle from "../../content/generated/shared.json" with { type: "json" };
import { withShared } from "../../core/content/loadBundle.js";
import { COMMAND, validateCommand } from "../../core/commands/commandTypes.js";
import { createSession } from "../../core/session/createSession.js";
import { submitLearnerTurn } from "../../core/session/submitLearnerTurn.js";
import { buildDebrief } from "../../core/replay/buildDebrief.js";
import { renderNotCommitted, renderUnsupported } from "../renderer/renderStatus.js";
import { interpretHybrid } from "./hybridInterpreter.js";
import { interpretDeterministically } from "./deterministicInterpreter.js";
import { WAVE23_SCHEMA_VERSION } from "./semanticTaskSchemas.js";
import { RESOLUTION, arbitrate } from "./candidateArbitration.js";
import { COMMITMENT, assessCommitment, segmentFragments } from "./commitmentPolicy.js";
import { mentionsImagingCategory, mentionsImagingModality } from "./conceptGrounding.js";
import { buildModelAllowlist } from "./modelConceptValidation.js";
import { CONSULTATION_REASON, decideSemanticConsultation } from "./semanticConsultationPolicy.js";

const bundle = withShared(diseaseBundle, sharedBundle);
const meta = { schemaVersion: WAVE23_SCHEMA_VERSION, confidence: 0.9 };
const action = (type, params, ...spans) => ({ type, params, evidenceSpans: spans, statedParameters: [] });
const output = (clinicalActions = [], patientQuestions = []) => ({ clinicalActions, patientQuestions, ambiguities: [], unresolvedFragments: [], meta });

function fixtureProvider(modelOutput) {
  const calls = [];
  return { calls, isConfigured: true, async complete(request) { calls.push(request); return { output: modelOutput, meta: { model: "fixture-model", costUsd: 0.0001 } }; } };
}
const interpret = async (text, modelOutput) => {
  const provider = fixtureProvider(modelOutput);
  return { result: await interpretHybrid({ text, bundle, provider, idPrefix: "t1" }), provider };
};
const newSession = () => createSession({
  sessionId: "v3a1", seed: "v3a1", mode: "reference", casePresetId: "APP-004", sessionPurpose: "internal_development", bundle, locale: "ru",
  startIso: "2026-09-19T08:00:00+05:00",
});
const run = (text, interpreted = interpretDeterministically({ text, bundle })) => submitLearnerTurn({ session: newSession(), text, interpreted });
const actions = (commands) => commands.filter((c) => c.type !== COMMAND.STATE_REASONING);
const label = (c) => `${c.type}:${c.params.testId ?? c.params.region ?? c.params.topic ?? c.params.role ?? c.params.drugId ?? ""}`;
const executed = (turn) => turn.outcomes.filter((o) => o.outcome === "EXECUTED" && o.command.type !== COMMAND.STATE_REASONING).map((o) => o.command.type);
const decisionFor = (result, type) => result.semanticTelemetry.candidateDecisions.find((d) => d.type === type);

// ============================================================================
// 1 + 2. Imaging
// ============================================================================

test("F1: generic imaging language with no modality is an imaging clarification, never an examination", () => {
  for (const text of ["сделайте визуализацию живота", "нужна визуализация", "хочу снимок живота"]) {
    const interpreted = interpretDeterministically({ text, bundle });
    assert.deepEqual(actions(interpreted.commands).map((c) => c.type), ["ORDER_TEST"], text);
    assert.equal(actions(interpreted.commands)[0].params.testId, undefined, `${text}: no study is guessed`);
    assert.deepEqual(validateCommand(actions(interpreted.commands)[0]), { outcome: "CLARIFY", missing: ["testId"] });

    const turn = run(text, interpreted);
    assert.deepEqual(turn.outcomes.map((o) => o.outcome), ["CLARIFY"], text);
    assert.equal(turn.session.events.some((e) => e.type === "EXAMINATION_PERFORMED"), false, `${text}: nothing was examined`);
    assert.equal(turn.session.events.some((e) => e.type === "TEST_ORDERED"), false, `${text}: nothing was ordered`);
  }
});

test("F1: a model that reads imaging language as a physical examination is turned into the open question, and nothing executes", async () => {
  const text = "сделайте визуализацию живота";
  const { result, provider } = await interpret(text, output([action("EXAMINE", { region: "abdomen" }, "визуализацию живота")]));
  assert.equal(provider.calls.length, 1, "the incomplete deterministic order is semantic-eligible");
  const decision = decisionFor(result, "EXAMINE");
  assert.equal(decision.validation, "CLARIFY");
  assert.ok(decision.reasonCodes.includes("imaging_language_not_examination"));
  assert.deepEqual(actions(result.commands).map(label), ["ORDER_TEST:"], "an incomplete study order, never EXAMINE");
  const turn = run(text, result);
  assert.deepEqual(turn.outcomes.map((o) => o.outcome), ["CLARIFY"]);
  assert.equal(turn.session.events.some((e) => e.type === "EXAMINATION_PERFORMED"), false);
});

test("F1: the modality is found in the clause even when the model trims its evidence span to the examination words", async () => {
  const text = "осмотрите живот ультразвуком";
  const { result } = await interpret(text, output([action("EXAMINE", { region: "abdomen" }, "осмотрите живот")]));
  assert.ok(!actions(result.commands).some((c) => c.type === "EXAMINE"));
  assert.ok(decisionFor(result, "EXAMINE").reasonCodes.includes("imaging_language_not_examination"));
  assert.equal(executed(run(text, result)).length, 0);
});

test("F1: a category word never lets the model pick one study for the learner", async () => {
  const text = "сделайте визуализацию живота";
  const { result } = await interpret(text, output([action("ORDER_TEST", { testId: "ultrasound_abdomen" }, "визуализацию живота")]));
  assert.equal(decisionFor(result, "ORDER_TEST").validation, "CLARIFY");
  assert.deepEqual(actions(result.commands).map(label), ["ORDER_TEST:"]);
});

test("F2: an explicit imaging modality disqualifies the physical-examination path, whichever modality and however it is inflected", () => {
  const expectations = {
    // a named modality the lexicon cannot resolve: not an exam, and not a question about something the learner already answered
    "осмотрите живот ультразвуком": [],
    "осмотрите живот на компьютерной томографии": [],
    "осмотр живота на УЗИ": ["ORDER_TEST:ultrasound_abdomen"],
    "посмотрю живот на КТ": ["ORDER_TEST:ct_abdomen"],
    "осмотрите голову на МРТ": [],
    "осмотрю живот рентгеном": [],
  };
  for (const [text, expected] of Object.entries(expectations)) {
    const interpreted = interpretDeterministically({ text, bundle });
    assert.ok(!actions(interpreted.commands).some((c) => c.type === "EXAMINE"), `${text}: never EXAMINE`);
    assert.deepEqual(actions(interpreted.commands).map(label), expected, text);
  }
});

test("F2: the examination path is untouched when there is no imaging word, and a sibling fragment's modality does not contaminate it", () => {
  for (const text of ["осмотрю живот", "живот", "осмотрю пациента"]) {
    assert.equal(actions(interpretDeterministically({ text, bundle }).commands)[0].type, "EXAMINE", text);
  }
  assert.deepEqual(actions(interpretDeterministically({ text: "осмотрите живот, и УЗИ обп", bundle }).commands).map(label), ["EXAMINE:abdomen", "ORDER_TEST:ultrasound_abdomen"]);
});

test("F2: the two-free-token fast path no longer carries the misreading: the unrecognised fragment is offered to the semantic pass", () => {
  const text = "осмотрите живот ультразвуком";
  const deterministic = interpretDeterministically({ text, bundle });
  assert.deepEqual(deterministic.unmatchedFragments, [text], "nothing was executed or guessed");
  const decision = decideSemanticConsultation({ deterministic, text });
  assert.equal(decision.consult, true);
  assert.equal(decision.reason, CONSULTATION_REASON.UNMATCHED);
});

test("F2: the model names the study the learner said; the physical examination is not what results", async () => {
  const text = "осмотрите живот ультразвуком";
  const { result } = await interpret(text, output([action("ORDER_TEST", { testId: "ultrasound_abdomen" }, text)]));
  assert.deepEqual(actions(result.commands).map(label), ["ORDER_TEST:ultrasound_abdomen"]);
  assert.equal(executed(run(text, result)).length, 1);
});

test("an incomplete deterministic command with no identifying concept is COMPLETED by a validated semantic candidate of the same promoted type, without any positive-evidence requirement", () => {
  const text = "осмотрю пациента, в частности пупочную область";
  const deterministic = { commands: [{ id: "d0", type: "EXAMINE", params: {}, sourceText: "осмотрю пациента" }], unmatchedFragments: [] };
  const out = arbitrate({ deterministic, rawText: text, consulted: true, candidates: [{
    index: 0, source: "clinicalAction", candidate: { type: "EXAMINE", params: { region: "abdomen" }, evidenceSpans: ["осмотрю пациента"] },
    decision: "ACCEPT", reasonCodes: [], evidenceSpans: ["осмотрю пациента"], grounding: "semantic_only",
    validatedCommand: { type: "EXAMINE", params: { region: "abdomen" }, evidence: "осмотрю пациента", evidenceSpans: ["осмотрю пациента"] },
  }] });
  assert.deepEqual(out.finalCommands.map((c) => [c.type, c.params.region]), [["EXAMINE", "abdomen"]]);
  assert.equal(out.conflicts[0].reason, "completes_incomplete_deterministic");
  // a COMPLETE deterministic reading is not completed this way: it needs positive evidence to be corrected
  const complete = arbitrate({ deterministic: { commands: [{ id: "d0", type: "EXAMINE", params: { region: "groin" }, sourceText: "осмотрю пациента" }], unmatchedFragments: [] }, rawText: text, consulted: true, candidates: [{
    index: 0, source: "clinicalAction", candidate: { type: "EXAMINE", params: { region: "abdomen" }, evidenceSpans: ["осмотрю пациента"] },
    decision: "ACCEPT", reasonCodes: [], evidenceSpans: ["осмотрю пациента"], grounding: "semantic_only",
    validatedCommand: { type: "EXAMINE", params: { region: "abdomen" }, evidence: "осмотрю пациента", evidenceSpans: ["осмотрю пациента"] },
  }] });
  assert.deepEqual(complete.finalCommands.map((c) => c.params.region), ["groin"]);
});

test("imaging vocabulary matches whole words only", () => {
  assert.equal(mentionsImagingModality("иду на лапароскопическую аппендэктомию"), false);
  assert.equal(mentionsImagingModality("осмотрите живот"), false);
  for (const yes of ["УЗИ", "ультразвуком", "на МРТ", "рентгеном", "компьютерная томография"]) assert.equal(mentionsImagingModality(yes), true, yes);
  assert.equal(mentionsImagingCategory("визуализация"), true);
  assert.equal(mentionsImagingCategory("ультразвук"), false, "a named modality is not a category");
});

// ============================================================================
// 3. Commitment status - one explicit status, one gate, every command type
// ============================================================================

const NOT_COMMITTED = [
  ["может быть, сделаем КТ позже", "ORDER_TEST", COMMITMENT.FUTURE_PLAN],
  ["возможно, дам кетопрофен 100 мг в/м", "ORDER_MEDICATION", COMMITMENT.TENTATIVE],
  ["возможно, осмотрим живот", "EXAMINE", COMMITMENT.TENTATIVE],
  ["может быть, спрошу про аллергию", "ASK_PATIENT", COMMITMENT.TENTATIVE],
  ["наверное, позову хирурга", "CALL_STAFF", COMMITMENT.TENTATIVE],
  ["возможно, подожду 30 минут", "WAIT", COMMITMENT.TENTATIVE],
  ["рассматриваю нулевой стол", "SET_NPO", COMMITMENT.TENTATIVE],
  ["возможно, переоценю боль через час", "REASSESS", COMMITMENT.TENTATIVE],
  ["может быть, в отделение", "DISPOSITION", COMMITMENT.TENTATIVE],
  ["может быть, перевожу в другой стационар", "TRANSFER", COMMITMENT.TENTATIVE],
  ["может быть, завершить кейс", "END_CASE", COMMITMENT.TENTATIVE],
  ["если ухудшится, позову старшего хирурга", "CALL_STAFF", COMMITMENT.CONDITIONAL],
  ["КТ, если понадобится", "ORDER_TEST", COMMITMENT.CONDITIONAL],
  ["кетопрофен 100 мг в/м по показаниям", "ORDER_MEDICATION", COMMITMENT.CONDITIONAL],
  ["нужно ли КТ?", "ORDER_TEST", COMMITMENT.INTERROGATIVE],
  ["КТ обп?", "ORDER_TEST", COMMITMENT.INTERROGATIVE],
  ["назначить ли кетопрофен 100 мг в/м?", "ORDER_MEDICATION", COMMITMENT.INTERROGATIVE],
  ["КТ потом", "ORDER_TEST", COMMITMENT.FUTURE_PLAN],
  ["после получения СРБ решу вопрос о КТ", "ORDER_TEST", COMMITMENT.FUTURE_PLAN],
  ["не назначаю КТ", "ORDER_TEST", COMMITMENT.DECLINED],
  ["КТ не нужен", "ORDER_TEST", COMMITMENT.DECLINED],
  ["отмените КТ", "ORDER_TEST", COMMITMENT.DECLINED],
  ["Обсуждаю, а не назначаю кетопрофен 100 мг в/м", "ORDER_MEDICATION", COMMITMENT.DECLINED],
];

test("F3: tentative, conditional, question, future-plan and refused wording is withheld for every command type, recorded with its status, and executes nothing", () => {
  for (const [text, type, status] of NOT_COMMITTED) {
    const interpreted = interpretDeterministically({ text, bundle });
    assert.deepEqual(actions(interpreted.commands).map((c) => c.type), [], `${text}: nothing left to execute`);
    const withheld = interpreted.withheldCommands.find((entry) => entry.type === type);
    assert.ok(withheld, `${text}: the ${type} reading is recorded as withheld`);
    assert.equal(withheld.commitment.status, status, text);
    assert.ok(withheld.commitment.cues.length > 0, `${text}: the reason is recorded`);

    const turn = run(text, interpreted);
    assert.equal(executed(turn).length, 0, `${text}: no command executed`);
    assert.deepEqual(turn.session.state.investigations, {}, `${text}: no investigation ordered`);
    assert.equal(turn.session.state.session.status, "active", `${text}: the case is still running`);
    const received = turn.session.events.find((e) => e.type === "LEARNER_TURN_RECEIVED");
    assert.ok(received.payload.withheldCommands.some((entry) => entry.type === type), `${text}: withheld reading is in the event log`);
    assert.ok(received.payload.interpretedCommands.every((c) => c.commitment === "COMMITTED"), `${text}: everything that executes is explicitly COMMITTED`);
  }
});

test("F3: the acknowledgement is neutral - it names no error and asks the learner to say it plainly", () => {
  const { textRu } = renderNotCommitted();
  assert.match(textRu, /Пока ничего не выполнено/);
  assert.doesNotMatch(textRu, /ошиб|неверн|неправильн/i);
});

const COMMITTED = [
  ["КТ без контраста", ["ORDER_TEST:ct_abdomen"]],
  ["сделайте КТ, если можно", ["ORDER_TEST:ct_abdomen"]],
  ["решил: КТ обп", ["ORDER_TEST:ct_abdomen"]],
  ["Возможно, КТ — но я решил, делаем КТ обп", ["ORDER_TEST:ct_abdomen"]],
  ["Назначаю ОАК, КТ позже", ["ORDER_TEST:cbc"]],
  ["ОАК, КТ, если понадобится", ["ORDER_TEST:cbc"]],
  ["УЗИ живота, а КТ не нужно", ["ORDER_TEST:ultrasound_abdomen"]],
  // Owner ruling 2026-09-20: «сначала X, затем Y» is a sequence of two committed actions (see interpreterV3A1r2.test.js).
  ["Сначала ОАК, затем КТ", ["ORDER_TEST:cbc", "ORDER_TEST:ct_abdomen"]],
  ["оцените полиурию, назначаю ОАМ", ["ORDER_TEST:urinalysis"]],
  ["Тошнота бывает?", ["ASK_PATIENT:nausea_vomiting"]],
  ["Скажите, есть ли аллергия на лекарства?", ["ASK_PATIENT:allergies"]],
  ["Что с пациентом сейчас?", ["REQUEST_STATUS:"]],
];

test("F3: a committed action next to an uncommitted one still executes; scope is the clause, not the whole turn; courtesy idioms and inquiries are not deliberation", () => {
  for (const [text, expected] of COMMITTED) {
    assert.deepEqual(actions(interpretDeterministically({ text, bundle }).commands).map(label), expected, text);
  }
});

test("F3: a leading condition governs the sentence it opens, not the next sentence", () => {
  const fragments = segmentFragments("Если станет хуже, КТ. ОАК сейчас.");
  assert.deepEqual(fragments.map((f) => f.sentence), [0, 0, 1]);
  const commands = [
    { id: "a", type: "ORDER_TEST", params: { testId: "ct_abdomen" }, sourceText: "КТ" },
    { id: "b", type: "ORDER_TEST", params: { testId: "cbc" }, sourceText: "ОАК сейчас" },
  ];
  const result = assessCommitment({ rawText: "Если станет хуже, КТ. ОАК сейчас.", commands });
  assert.equal(result.get("a").status, COMMITMENT.CONDITIONAL);
  assert.equal(result.get("b").status, COMMITMENT.COMMITTED);
});

test("F3: fragment token ranges account for the conjunction word, so a later command is found in its own fragment", () => {
  assert.deepEqual(segmentFragments("ОАК, СРБ и ОАМ").map((f) => f.range), [[0, 1], [1, 2], [3, 4]]);
});

test("F3: an authored operative-decision phrase that contains a negation is not read as a refusal, but a hedge still applies", () => {
  const command = { id: "o", type: "OPERATIVE_DECISION", params: { decisionId: "x", choice: "y" }, sourceText: "дренаж не ставлю" };
  assert.equal(assessCommitment({ rawText: "дренаж не ставлю", commands: [command] }).get("o").status, COMMITMENT.COMMITTED);
  const hedged = { ...command, sourceText: "возможно, дренаж не ставлю" };
  assert.equal(assessCommitment({ rawText: "возможно, дренаж не ставлю", commands: [hedged] }).get("o").status, COMMITMENT.TENTATIVE);
});

test("F3: a hedge cue never matches a longer, unrelated word that begins with it (пожалуй / пожалуйста, потом / потому, возможно / возможность, допустим / допустимо)", () => {
  // «пожалуй» (perhaps) was found inside «пожалуйста» (please) and withheld every polite order.
  const ordered = (text) => actions(interpretDeterministically({ text, bundle }).commands).map(label);
  assert.deepEqual(ordered("Пожалуйста, назначьте ОАК"), ["ORDER_TEST:cbc"]);
  assert.deepEqual(ordered("Пожалуйста, осмотрю живот"), ["EXAMINE:abdomen"]);
  assert.deepEqual(ordered("Пожалуйста, пригласите хирурга"), ["CALL_STAFF:surgeon"]);
  assert.deepEqual(ordered("КТ, потому что боль нарастает"), ["ORDER_TEST:ct_abdomen"]);
  assert.deepEqual(ordered("есть возможность сделать УЗИ обп"), ["ORDER_TEST:ultrasound_abdomen"]);
  assert.deepEqual(ordered("допустимо ввести кетопрофен 100 мг в/м"), ["ORDER_MEDICATION:ketoprofen"]);
  // ...while the real hedges are still hedges.
  for (const text of ["пожалуй, КТ", "потом КТ", "возможно, КТ", "допустим, КТ"]) assert.deepEqual(ordered(text), [], text);
});

test("F3: a prohibition that IS the order is not a refusal (nil by mouth), but a real refusal of it still is", () => {
  const npo = { id: "n", type: "SET_NPO", params: {}, sourceText: "ничего не давать через рот" };
  assert.equal(assessCommitment({ rawText: "ничего не давать через рот", commands: [npo] }).get("n").status, COMMITMENT.COMMITTED);
  assert.equal(assessCommitment({ rawText: "Пожалуйста, ничего не вводить внутрь", commands: [{ ...npo, sourceText: "ничего не вводить внутрь" }] }).get("n").status, COMMITMENT.COMMITTED);
  assert.deepEqual(actions(interpretDeterministically({ text: "нулевой стол не нужен", bundle }).commands), [], "«нулевой стол не нужен» is a refusal");
  assert.equal(interpretDeterministically({ text: "нулевой стол не нужен", bundle }).withheldCommands[0].commitment.status, COMMITMENT.DECLINED);
});

test("F3: the hedge and condition markers the repo already knows in Kazakh and English are honoured too", () => {
  const ordered = (text) => actions(interpretDeterministically({ text, bundle }).commands).map(label);
  for (const text of ["maybe КТ обп", "КТ обп later", "possibly ОАК", "КТ обп if needed", "мүмкін КТ обп"]) assert.deepEqual(ordered(text), [], text);
  assert.deepEqual(ordered("КТ обп"), ["ORDER_TEST:ct_abdomen"]);
});

test("F3: a cue never matches inside a longer word", () => {
  // "ли" in «полиурию», "если" is not a substring hit, "стоит" is not found in a longer word.
  const commands = [{ id: "a", type: "ORDER_TEST", params: { testId: "urinalysis" }, sourceText: "ОАМ" }];
  assert.equal(assessCommitment({ rawText: "полиурия, ОАМ", commands }).get("a").status, COMMITMENT.COMMITTED);
  assert.equal(assessCommitment({ rawText: "ОАМ, устоит ли", commands }).get("a").status, COMMITMENT.COMMITTED, "the cue clause is not a trailing/leading clause of ОАМ unless it starts with a cue");
});

test("F3 (model): a semantic candidate the learner hedged, conditioned or asked about is withheld even though it validates", async () => {
  // v3B: a clause the gate would withhold whatever is read from it (its own hedge, or a governing «если …») is FINAL and is
  // not sent to the model at all; the cases below are the ones that still reach it, where the gate applies to the candidate.
  const final = interpretDeterministically({ text: "может быть, стоит заглянуть в общий анализ крови", bundle });
  assert.equal(decideSemanticConsultation({ deterministic: final, text: "может быть, стоит заглянуть в общий анализ крови" }).consult, false);
  const cases = [
    ["Пациент тихий, а нужен ли нам общий анализ крови?", "общий анализ крови", COMMITMENT.INTERROGATIVE],
    ["а нужен ли нам общий анализ крови?", "общий анализ крови", COMMITMENT.INTERROGATIVE],
  ];
  for (const [text, span, status] of cases) {
    const { result, provider } = await interpret(text, output([action("ORDER_TEST", { testId: "cbc" }, span)]));
    assert.equal(provider.calls.length, 1, `${text}: the model was consulted`);
    assert.equal(decisionFor(result, "ORDER_TEST").validation, "ACCEPT", `${text}: the candidate itself is valid`);
    assert.equal(decisionFor(result, "ORDER_TEST").arbitration.resolution, RESOLUTION.WITHHELD, text);
    assert.equal(decisionFor(result, "ORDER_TEST").arbitration.commitment, status, text);
    assert.deepEqual(actions(result.commands), [], `${text}: nothing to execute`);
    assert.equal(result.withheldCommands[0].commitment.status, status);
    assert.equal(executed(run(text, result)).length, 0, text);
  }
  const committed = await interpret("заглянем в общий анализ крови", output([action("ORDER_TEST", { testId: "cbc" }, "заглянем в общий анализ крови")]));
  assert.deepEqual(actions(committed.result.commands).map(label), ["ORDER_TEST:cbc"], "control: the same words without a cue execute");
});

test("F3 (model): when every action is uncommitted the model is not consulted at all", async () => {
  const { result, provider } = await interpret("может быть, назначим КТ позже", output([action("ORDER_TEST", { testId: "ct_abdomen" }, "КТ")]));
  assert.equal(provider.calls.length, 0);
  assert.deepEqual(actions(result.commands), []);
  assert.equal(result.semanticTelemetry.consultation.reason, CONSULTATION_REASON.ALL_UNCOMMITTED);
  assert.equal(result.semanticTelemetry.withheldCommands[0].commitment.status, COMMITMENT.FUTURE_PLAN);
});

test("F3: a trailing condition is attached to the action right before it, using the fragments of withheld commands as carriers", async () => {
  const text = "ОАК, КТ, если понадобится";
  const interpreted = interpretDeterministically({ text, bundle });
  assert.deepEqual(actions(interpreted.commands).map(label), ["ORDER_TEST:cbc"]);
  // The model is consulted for other reasons and concurs with both; the ОАК must not inherit KT's condition.
  const { result } = await interpret("ОАК, КТ, если понадобится и общий анализ крови", output([
    action("ORDER_TEST", { testId: "cbc" }, "ОАК"), action("ORDER_TEST", { testId: "ct_abdomen" }, "КТ"),
  ]));
  assert.ok(actions(result.commands).some((c) => c.params.testId === "cbc"));
  assert.ok(!actions(result.commands).some((c) => c.params.testId === "ct_abdomen"));
});

// ---- control phrases --------------------------------------------------------

test("REPEAT_LAST and END_CASE are read from the control phrase only", () => {
  assert.deepEqual(actions(interpretDeterministically({ text: "повторите ОАК", bundle }).commands).map(label), ["ORDER_TEST:cbc"], "a repeat-the-test order is not a control");
  for (const text of ["повтори", "повторите, пожалуйста", "повтори последнее"]) {
    assert.deepEqual(interpretDeterministically({ text, bundle }).commands.map((c) => c.type), ["REPEAT_LAST"], text);
  }
  assert.deepEqual(interpretDeterministically({ text: "заверши кейс", bundle }).commands.map((c) => c.type), ["END_CASE"]);
  assert.equal(executed(run("заверши кейс")).length, 1, "an explicit control still executes");
});

test("a stated wait is read exactly or not at all: «полчаса» is 30 minutes, «пару часов» is no amount", () => {
  const wait = (text) => interpretDeterministically({ text, bundle }).commands.find((c) => c.type === "WAIT")?.params;
  assert.deepEqual({ ...wait("подождём полчаса") }, { afterMinutes: 30 });
  assert.deepEqual({ ...wait("подождём 2 часа") }, { afterMinutes: 120 });
  assert.deepEqual({ ...wait("подождём час") }, { afterMinutes: 60 });
  assert.deepEqual({ ...wait("подождём 20 минут") }, { afterMinutes: 20 });
  assert.equal(wait("подождём пару часов"), undefined, "no amount is invented");
});

test("history-taking is not read out of «вопрос» or «попросил»", () => {
  assert.deepEqual(actions(interpretDeterministically({ text: "Я бы попросил ОАК", bundle }).commands).map(label), ["ORDER_TEST:cbc"]);
  assert.deepEqual(actions(interpretDeterministically({ text: "у меня вопрос", bundle }).commands), []);
  assert.equal(interpretDeterministically({ text: "проведите опрос пациента", bundle }).commands[0].type, "TAKE_HISTORY");
});

// ============================================================================
// Owner decisions: promotion and protection
// ============================================================================

test("D3: a model never originates REPEAT_LAST or END_CASE, whatever the clinical wording", async () => {
  for (const [text, type] of [["закончим на этом", "END_CASE"], ["еще раз то же самое", "REPEAT_LAST"], ["можно завершать", "END_CASE"]]) {
    const { result } = await interpret(text, output([action(type, {}, text)]));
    const decision = decisionFor(result, type);
    assert.equal(decision.validation, "REJECT", text);
    assert.deepEqual(decision.reasonCodes, ["explicit_control_only"], text);
    assert.ok(!result.commands.some((c) => c.type === type), text);
  }
});

test("D3: nothing semantic can replace a deterministic explicit control", () => {
  const deterministic = { commands: [{ id: "d0", type: "END_CASE", params: {}, sourceText: "завершить кейс" }], unmatchedFragments: [] };
  const out = arbitrate({ deterministic, rawText: "завершить кейс", consulted: true, candidates: [{
    index: 0, source: "clinicalAction", candidate: { type: "ORDER_TEST", params: { testId: "cbc" }, evidenceSpans: ["завершить кейс"] },
    decision: "ACCEPT", reasonCodes: [], evidenceSpans: ["завершить кейс"], grounding: "lexical",
    validatedCommand: { type: "ORDER_TEST", params: { testId: "cbc" }, evidence: "завершить кейс", evidenceSpans: ["завершить кейс"] },
  }] });
  assert.ok(!out.finalCommands.some((c) => c.type === "ORDER_TEST"), "the semantic reading did not take its place");
  assert.ok(!out.finalCommands.some((c) => c.type === "END_CASE"), "and the control was not silently executed against a disagreeing reading");
});

test("D2: ORDER_ORAL_INTAKE and OBTAIN_CONSENT stay protected - a model cannot originate them without the action in the learner's words", async () => {
  for (const [text, type, params] of [["пусть подпишет бумаги", "OBTAIN_CONSENT", {}], ["пациенту разрешено принимать воду", "ORDER_ORAL_INTAKE", { level: "liquids" }]]) {
    const { result } = await interpret(text, output([action(type, params, text)]));
    assert.equal(decisionFor(result, type).validation, "REJECT", text);
    assert.ok(!result.commands.some((c) => c.type === type), text);
  }
});

test("D1: WAIT is promotable, but only with the kind of action evident in the learner's words - a wait spends clinical time that cannot be given back", async () => {
  // evident kind, no stated amount -> a question, never a guessed duration
  const asked = await interpret("подождём немного", output([action("WAIT", {}, "подождём немного")]));
  assert.equal(decisionFor(asked.result, "WAIT").validation, "CLARIFY");
  const askedTurn = run("подождём немного", asked.result);
  assert.deepEqual(askedTurn.outcomes.map((o) => o.outcome), ["CLARIFY"]);
  assert.equal(askedTurn.session.state.clock.elapsedMinutes, 0, "no time passed");

  // kind not evident -> rejected, no clock movement
  const vague = await interpret("ждём развития событий", output([action("WAIT", { untilNextPending: true }, "ждём развития событий")]));
  assert.equal(decisionFor(vague.result, "WAIT").validation, "REJECT");
  assert.ok(decisionFor(vague.result, "WAIT").reasonCodes.includes("action_type_not_evident"));
  assert.equal(run("ждём развития событий", vague.result).session.state.clock.elapsedMinutes, 0);

  // an amount the learner never wrote is never supplied by the model
  const invented = await interpret("подождём пару часов", output([action("WAIT", { afterMinutes: "120" }, "подождём пару часов")]));
  assert.equal(decisionFor(invented.result, "WAIT").validation, "REJECT");
  assert.ok(decisionFor(invented.result, "WAIT").reasonCodes.includes("invented_numeric_parameter"));
});

test("D1: REQUEST_ANESTHESIA_REVIEW is promotable and may correct a deterministic consult call, but needs the anesthesiologist in the learner's words", async () => {
  const text = "нужен взгляд анестезиолога перед операцией";
  const det = interpretDeterministically({ text, bundle });
  assert.deepEqual(actions(det.commands).map((c) => c.type), ["CALL_STAFF"], "premise: the deterministic pass reads a generic staff call");
  const { result } = await interpret(text, output([action("REQUEST_ANESTHESIA_REVIEW", {}, text)]));
  assert.deepEqual(actions(result.commands).map((c) => c.type), ["REQUEST_ANESTHESIA_REVIEW"]);
  assert.equal(result.semanticTelemetry.finalCommands[0].resolution, RESOLUTION.SEMANTIC_OVERRIDE);

  const nameless = await interpret("пусть кто-нибудь посмотрит перед наркозом", output([action("REQUEST_ANESTHESIA_REVIEW", {}, "пусть кто-нибудь посмотрит перед наркозом")]));
  assert.equal(decisionFor(nameless.result, "REQUEST_ANESTHESIA_REVIEW").validation, "REJECT");
  assert.ok(decisionFor(nameless.result, "REQUEST_ANESTHESIA_REVIEW").reasonCodes.includes("action_type_not_evident"));
});

const validated = (index, type, params, spans, extra = {}) => ({
  index, source: "clinicalAction", candidate: { type, params, evidenceSpans: spans }, decision: "ACCEPT", reasonCodes: [], evidenceSpans: spans,
  grounding: "lexical", validatedCommand: { type, params, evidence: spans.join(" "), evidenceSpans: spans }, ...extra,
});

test("D4: a protected model-originated command is ADDED when the learner committed and it is literally grounded", () => {
  const text = "введите кетопрофен 100 мг в/м";
  const out = arbitrate({ deterministic: { commands: [], unmatchedFragments: [text] }, rawText: text, consulted: true, candidates: [
    validated(0, "ORDER_MEDICATION", { drugId: "ketoprofen", dose: "100 мг", doseMg: 100, route: "im" }, [text]),
  ] });
  assert.deepEqual(out.finalCommands.map((c) => c.type), ["ORDER_MEDICATION"]);
  assert.equal(out.resolutions[0].resolution, RESOLUTION.SEMANTIC_ADDED);
});

test("D4: a protected model-originated command that is not literally grounded is not added", () => {
  const text = "введите обезболивающее 100 мг в/м";
  const out = arbitrate({ deterministic: { commands: [], unmatchedFragments: [text] }, rawText: text, consulted: true, candidates: [
    validated(0, "ORDER_MEDICATION", { drugId: "ketoprofen", dose: "100 мг", doseMg: 100, route: "im" }, [text], { grounding: "semantic_only" }),
  ] });
  assert.deepEqual(out.finalCommands, []);
  assert.equal(out.candidateDecisions[0].arbitration.reason, "protected_add_requires_literal_grounding");
});

test("D4: a protected model-originated command the learner did not commit to is withheld, however well grounded", () => {
  for (const text of ["возможно, введите кетопрофен 100 мг в/м", "введите кетопрофен 100 мг в/м, если потребуется", "введите ли кетопрофен 100 мг в/м?"]) {
    const spans = [text.replace(/^возможно, /, "").replace(/, если потребуется$/, "")];
    const out = arbitrate({ deterministic: { commands: [], unmatchedFragments: [text] }, rawText: text, consulted: true, candidates: [
      validated(0, "ORDER_MEDICATION", { drugId: "ketoprofen", dose: "100 мг", doseMg: 100, route: "im" }, spans),
    ] });
    assert.deepEqual(out.finalCommands, [], text);
    assert.equal(out.candidateDecisions[0].arbitration.resolution, RESOLUTION.WITHHELD, text);
  }
});

test("D4: a protected model-originated command never replaces a deterministic reading", () => {
  const deterministic = { commands: [{ id: "d0", type: "ORDER_MEDICATION", params: { drugId: "ketorolac", dose: "30 мг", doseMg: 30, route: "im" }, sourceText: "кеторолак 30 мг в/м" }], unmatchedFragments: [] };
  const out = arbitrate({ deterministic, rawText: "кеторолак 30 мг в/м", consulted: true, candidates: [
    validated(0, "ORDER_MEDICATION", { drugId: "ketoprofen", dose: "30 мг", doseMg: 30, route: "im" }, ["кеторолак 30 мг в/м"]),
  ] });
  assert.ok(!out.finalCommands.some((c) => c.params.drugId === "ketoprofen"));
});

// ============================================================================
// Pelvic ultrasound: no approved modeled result -> a recognised simulator limitation
// ============================================================================

test("pelvic ultrasound: there is no modeled result for APP-004, so it is a recognised limitation and not an allowlisted test", () => {
  const modeled = Object.keys(bundle.trajectories.investigation_timing);
  assert.ok(!modeled.includes("pelvic_ultrasound") && !modeled.includes("ultrasound_pelvis"), "no modeled pelvic study");
  assert.ok(!JSON.stringify(diseaseBundle).match(/pelvic_ultrasound|ultrasound_pelvis/), "no disease content defines one either");
  const allowlist = buildModelAllowlist({ bundle });
  assert.ok(!allowlist.tests.includes("pelvic_ultrasound"));
  assert.deepEqual(allowlist.recognizedUnmodeledTests, ["pelvic_ultrasound"]);

  // A case that DOES model it makes it an ordinary supported test - no interpreter change.
  const modelingCase = structuredClone(bundle);
  modelingCase.trajectories.investigation_timing.pelvic_ultrasound = { etaMinutes: 45 };
  const supported = buildModelAllowlist({ bundle: modelingCase });
  assert.ok(supported.tests.includes("pelvic_ultrasound"));
  assert.deepEqual(supported.recognizedUnmodeledTests, []);
});

test("pelvic ultrasound: ordering it is reported as a simulator limitation - not a learner error and not a substitute study", () => {
  const turn = run("УЗИ малого таза");
  assert.deepEqual(turn.outcomes.map((o) => o.outcome), ["UNSUPPORTED_CONTENT"]);
  assert.equal(turn.outcomes[0].classification, "simulator_limitation");
  assert.deepEqual(turn.session.state.investigations, {}, "no abdominal (or any) ultrasound was guessed");
  const limitation = turn.session.events.find((e) => e.type === "SIMULATOR_LIMITATION_NOTED" && e.payload.kind === "investigation_not_modeled");
  assert.deepEqual({ kind: limitation.payload.kind, id: limitation.payload.id, reason: limitation.payload.reason }, { kind: "investigation_not_modeled", id: "pelvic_ultrasound", reason: "not_modeled" });
  const trail = turn.session.events.find((e) => e.type === "COMMAND_REJECTED");
  assert.equal(trail.payload.classification, "simulator_limitation", "the trail labels it a limitation, not a mistake");

  const message = renderUnsupported(turn.outcomes[0]).textRu;
  assert.match(message, /УЗИ органов малого таза/);
  assert.match(message, /ограничение платформы, а не ошибка/);
  assert.doesNotMatch(message, /Выбери другое/, "no alternative test is suggested");

  const debrief = buildDebrief({ session: turn.session, bundle });
  const entry = debrief.simulatorLimitations.find((item) => item.id === "pelvic_ultrasound");
  assert.equal(entry.kind, "investigation_not_modeled");
  assert.match(entry.pointRu, /не моделируется/);
  assert.match(entry.noteRu, /а не ошибка или пропуск обучающегося/);
  assert.ok(!debrief.contentGovernance.withheldKinds.includes("investigation_not_modeled"), "not a content-approval matter");
});

test("pelvic ultrasound: the model can name it, and the abdominal study is never substituted in either direction", async () => {
  const pelvic = "ультразвук малого таза";
  const named = await interpret(pelvic, output([action("ORDER_TEST", { testId: "pelvic_ultrasound" }, pelvic)]));
  assert.deepEqual(actions(named.result.commands).map(label), ["ORDER_TEST:pelvic_ultrasound"]);
  assert.deepEqual(run(pelvic, named.result).outcomes.map((o) => o.outcome), ["UNSUPPORTED_CONTENT"]);

  const substituted = await interpret(pelvic, output([action("ORDER_TEST", { testId: "ultrasound_abdomen" }, pelvic)]));
  assert.ok(!actions(substituted.result.commands).some((c) => c.params.testId === "ultrasound_abdomen"), "the abdominal study is not chosen for a pelvic request");

  const reversed = await interpret("УЗИ живота, и что-нибудь еще", output([action("ORDER_TEST", { testId: "pelvic_ultrasound" }, "УЗИ живота")]));
  assert.equal(decisionFor(reversed.result, "ORDER_TEST").validation, "REJECT", "a pelvic study is not chosen for an abdominal request");
});

test("pelvic ultrasound: the renderer's label and the content registry agree", () => {
  const entry = sharedBundle.interaction.recognized_unmodeled_tests.find((item) => item.id === "pelvic_ultrasound");
  assert.match(renderUnsupported({ capabilityKey: "test:pelvic_ultrasound" }).textRu, new RegExp(entry.label_ru));
});

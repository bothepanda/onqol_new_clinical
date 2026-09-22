/**
 * Interpreter v3 (semantic arbitration) regression suite.
 *
 * The provider is a fixture that returns a fixed model output. Everything after
 * the provider - schema check, candidate validation, parameter binding,
 * arbitration, and (where relevant) command validation and execution - is the
 * real code path. Cases A-J are the wave's required regression cases.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import diseaseBundle from "../../content/generated/appendicitis.json" with { type: "json" };
import sharedBundle from "../../content/generated/shared.json" with { type: "json" };
import { withShared } from "../../core/content/loadBundle.js";
import { COMMAND, validateCommand } from "../../core/commands/commandTypes.js";
import { createSession } from "../../core/session/createSession.js";
import { submitLearnerTurn } from "../../core/session/submitLearnerTurn.js";
import { interpretHybrid } from "./hybridInterpreter.js";
import { interpretDeterministically } from "./deterministicInterpreter.js";
import { WAVE23_SCHEMA_VERSION } from "./semanticTaskSchemas.js";
import { RESOLUTION, arbitrate } from "./candidateArbitration.js";
import { V3A_PROMOTED_TYPES, V3A_PROTECTED_TYPES, createPromotionPolicy } from "./promotionPolicy.js";
import { CONSULTATION_REASON, decideSemanticConsultation } from "./semanticConsultationPolicy.js";
import { validateActionCandidates } from "./actionCandidateValidation.js";
import { buildModelAllowlist } from "./modelConceptValidation.js";

const bundle = withShared(diseaseBundle, sharedBundle);
const meta = { schemaVersion: WAVE23_SCHEMA_VERSION, confidence: 0.9 };
const action = (type, params, ...spans) => ({ type, params, evidenceSpans: spans, statedParameters: [] });
const output = (clinicalActions = [], patientQuestions = []) => ({ clinicalActions, patientQuestions, ambiguities: [], unresolvedFragments: [], meta });

function fixtureProvider(modelOutput) {
  const calls = [];
  return {
    calls,
    isConfigured: true,
    async complete(request) {
      calls.push(request);
      return { output: modelOutput, meta: { model: "fixture-model", costUsd: 0.0001 } };
    },
  };
}

const interpret = (text, modelOutput, extra = {}) => {
  const provider = fixtureProvider(modelOutput);
  return interpretHybrid({ text, bundle, provider, idPrefix: "t1", ...extra }).then((result) => ({ result, provider }));
};
const newSession = () => createSession({
  sessionId: "v3", seed: "v3", mode: "reference", casePresetId: "APP-004", sessionPurpose: "internal_development", bundle, locale: "ru",
  startIso: "2026-09-19T08:00:00+05:00",
});
const types = (result) => result.commands.filter((c) => c.type !== COMMAND.STATE_REASONING).map((c) => `${c.type}:${c.params.testId ?? c.params.region ?? c.params.topic ?? c.params.role ?? c.params.drugId ?? ""}`);
const decisionFor = (result, type) => result.semanticTelemetry.candidateDecisions.find((d) => d.type === type);

// ---- A ---------------------------------------------------------------------
// v3A.1: the deterministic pass itself no longer reads this as a physical exam (an
// imaging-modality word disqualifies the exam path). It leaves the fragment
// unrecognised, offers it to the semantic pass, and the semantic reading supplies
// the one specific study the learner named.
test("A: the deterministic pass no longer misreads imaging as an examination; the semantic reading supplies the specific study", async () => {
  const text = "посмотрите брюшную полость ультразвуком";
  const deterministic = interpretDeterministically({ text, bundle });
  assert.deepEqual(deterministic.commands.filter((c) => c.type !== COMMAND.STATE_REASONING), [], "premise: never an examination, nothing guessed");
  assert.deepEqual(deterministic.unmatchedFragments, [text]);

  const { result, provider } = await interpret(text, output([action("ORDER_TEST", { testId: "ultrasound_abdomen" }, text)]));
  assert.equal(provider.calls.length, 1, "the unrecognised fragment is semantic-eligible");
  assert.equal(result.mode, "hybrid");
  assert.deepEqual(types(result), ["ORDER_TEST:ultrasound_abdomen"]);
  assert.ok(!result.commands.some((c) => c.type === "EXAMINE"));
  const final = result.semanticTelemetry.finalCommands[0];
  assert.equal(final.resolution, RESOLUTION.SEMANTIC_ADDED);
  assert.deepEqual(final.origins, ["semantic"]);
  assert.deepEqual(result.unmatchedFragments, []);

  const turn = submitLearnerTurn({ session: newSession(), text, interpreted: result });
  assert.equal(turn.outcomes[0].command.type, "ORDER_TEST");
});

// The correction path itself (a positively evidenced semantic reading replacing a
// COMPLETE deterministic reading in a promoted class) no longer arises from the
// physical-exam misreading, so it is pinned at the arbitration boundary with a
// deterministic reading fixed by hand.
test("A2: a positively evidenced semantic reading still CORRECTS a complete deterministic reading in a promoted class", () => {
  const text = "оцените живот на ультразвуке";
  const deterministic = { commands: [{ id: "d0", type: "EXAMINE", params: { region: "abdomen" }, sourceText: text }], unmatchedFragments: [] };
  const out = arbitrate({ deterministic, rawText: text, consulted: true, candidates: [{
    index: 0, source: "clinicalAction", candidate: { type: "ORDER_TEST", params: { testId: "ultrasound_abdomen" }, evidenceSpans: [text] },
    decision: "ACCEPT", reasonCodes: [], evidenceSpans: [text], grounding: "composite",
    validatedCommand: { type: "ORDER_TEST", params: { testId: "ultrasound_abdomen" }, evidence: text, evidenceSpans: [text] },
  }] });
  assert.deepEqual(out.finalCommands.map((c) => c.type), ["ORDER_TEST"]);
  assert.equal(out.resolutions[0].resolution, RESOLUTION.SEMANTIC_OVERRIDE);
  assert.equal(out.conflicts[0].resolution, RESOLUTION.SEMANTIC_OVERRIDE);
});

// ---- B ---------------------------------------------------------------------
test("B: one rejected candidate does not take an unrelated valid one down with it", async () => {
  const text = "Коллеги, проверьте клеточный состав крови";
  const { result } = await interpret(text, output([
    action("CALL_STAFF", { role: "surgeon" }, "Коллеги"),
    action("ORDER_TEST", { testId: "cbc" }, "проверьте клеточный состав крови"),
  ]));
  assert.equal(result.mode, "hybrid", "the task result is usable, not a fallback");
  assert.equal(result.semanticTelemetry.status, "valid");
  assert.deepEqual(types(result), ["ORDER_TEST:cbc"]);
  const staff = decisionFor(result, "CALL_STAFF");
  assert.equal(staff.validation, "REJECT");
  // v3B: the courtesy clause is final and is not sent, so a candidate anchored on it is not the learner's words in the request.
  assert.ok(staff.reasonCodes.some((code) => ["action_type_not_evident", "evidence_not_verbatim"].includes(code)), staff.reasonCodes.join());
  assert.equal(decisionFor(result, "ORDER_TEST").validation, "ACCEPT");
  assert.equal(result.semanticTelemetry.candidateDecisions.length, 2, "telemetry records both decisions");
  assert.equal(result.semanticTelemetry.finalCommands[0].resolution, RESOLUTION.SEMANTIC_ADDED);
  assert.deepEqual(result.unmatchedFragments, [], "the covered fragment no longer surfaces as unresolved");
});

// ---- C ---------------------------------------------------------------------
test("C: a novel phrasing of an allowlisted patient question becomes an ASK_PATIENT and executes normally", async () => {
  const text = "а не бывает ли у вас реакции на какие-то лекарства";
  const { result } = await interpret(text, output([], [{ topic: "allergies", evidenceSpans: ["реакции на какие-то лекарства"] }]));
  assert.equal(result.mode, "hybrid");
  const command = result.commands.find((c) => c.type === COMMAND.ASK_PATIENT);
  assert.ok(command, "the patient question is a standard ASK_PATIENT command");
  assert.deepEqual({ ...command.params }, { topic: "allergies" });
  assert.equal(result.semanticTelemetry.finalCommands[0].resolution, RESOLUTION.SEMANTIC_ADDED);

  const semanticTurn = submitLearnerTurn({ session: newSession(), text, interpreted: result });
  const deterministicTurn = submitLearnerTurn({ session: newSession(), text: "спрошу про аллергию", interpreted: interpretDeterministically({ text: "спрошу про аллергию", bundle }) });
  assert.equal(semanticTurn.outcomes[0].outcome, deterministicTurn.outcomes[0].outcome, "same downstream pipeline as a deterministic ASK_PATIENT");
  assert.equal(semanticTurn.outcomes[0].outcome, "EXECUTED");
});

test("C2: a patient question with an unknown topic or unverifiable evidence is rejected, not executed", async () => {
  const bad = await interpret("интересуюсь родословной пациента", output([], [{ topic: "family_tree", evidenceSpans: ["родословной пациента"] }]));
  assert.ok(!bad.result.commands.some((c) => c.type === COMMAND.ASK_PATIENT));
  assert.equal(bad.result.semanticTelemetry.candidateDecisions[0].validation, "REJECT");
  const invented = await interpret("интересуюсь родословной пациента", output([], [{ topic: "pain", evidenceSpans: ["у вас болит спина"] }]));
  assert.ok(!invented.result.commands.some((c) => c.type === COMMAND.ASK_PATIENT));
  assert.ok(invented.result.semanticTelemetry.candidateDecisions[0].reasonCodes.includes("evidence_not_verbatim"));
});

// ---- D ---------------------------------------------------------------------
test("D: a category of investigations never turns into a guessed test", async () => {
  const text = "проверьте воспалительные маркеры";
  const { result } = await interpret(text, output([action("ORDER_TEST", { testId: "crp" }, text)]));
  assert.ok(!result.commands.some((c) => c.params.testId === "crp"), "no guessed CRP");
  const order = result.commands.find((c) => c.type === COMMAND.ORDER_TEST);
  assert.ok(order, "the recognised kind of order reaches the command pipeline");
  assert.deepEqual(validateCommand(order), { outcome: "CLARIFY", missing: ["testId"] });
  assert.equal(decisionFor(result, "ORDER_TEST").validation, "CLARIFY");
  assert.ok(decisionFor(result, "ORDER_TEST").reasonCodes.includes("category_language_ambiguous"));

  const turn = submitLearnerTurn({ session: newSession(), text, interpreted: result });
  assert.equal(turn.outcomes[0].outcome, "CLARIFY");
  assert.deepEqual(turn.outcomes[0].missing, ["testId"]);
});

test("D2: when the model itself reports the ambiguity, nothing is guessed and the fragment stays unresolved", async () => {
  const text = "проверьте воспалительные маркеры";
  const { result } = await interpret(text, { ...output(), ambiguities: [{ evidenceSpan: "воспалительные маркеры", reason: "ambiguous_target" }] });
  assert.equal(result.commands.length, 0);
  assert.ok(result.unmatchedFragments.length > 0);
});

// ---- E ---------------------------------------------------------------------
test("E: one deterministic-known action plus one novel semantic action both execute", async () => {
  const text = "оак и гляньте желчный на ультразвуке";
  const { result } = await interpret(text, output([
    action("ORDER_TEST", { testId: "cbc" }, "оак"),
    action("ORDER_TEST", { testId: "ultrasound_abdomen" }, "гляньте желчный на ультразвуке"),
  ]));
  assert.deepEqual(types(result).sort(), ["ORDER_TEST:cbc", "ORDER_TEST:ultrasound_abdomen"]);
  const byTest = Object.fromEntries(result.semanticTelemetry.finalCommands.map((c) => [c.params.testId, c]));
  // v3B: the canonical clause «оак» is final and never sent, so the model cannot duplicate it: one origin, not two.
  assert.deepEqual(byTest.cbc.origins, ["deterministic"]);
  assert.equal(byTest.ultrasound_abdomen.resolution, RESOLUTION.SEMANTIC_ADDED);

  const turn = submitLearnerTurn({ session: newSession(), text, interpreted: result });
  assert.equal(turn.outcomes.filter((o) => o.outcome === "EXECUTED").length, 2);
});

// ---- F ---------------------------------------------------------------------
test("F: a numeric parameter the model invents is rejected and never reaches a command", async () => {
  const text = "дайте кетопрофен как обычно";
  const { result } = await interpret(text, output([action("ORDER_MEDICATION", { drugId: "ketoprofen", doseMg: 500 }, "дайте кетопрофен как обычно")]));
  const decision = decisionFor(result, "ORDER_MEDICATION");
  assert.equal(decision.validation, "REJECT");
  assert.ok(decision.reasonCodes.includes("invented_numeric_parameter"));
  assert.doesNotMatch(JSON.stringify(result.commands), /500/);
  assert.ok(result.commands.every((c) => c.params.doseMg === undefined));
});

test("F2: a route or dose the model supplies is rejected; only literal text binds one", async () => {
  const text = "введите кетопрофен по схеме";
  const { result } = await interpret(text, output([action("ORDER_MEDICATION", { drugId: "ketoprofen", route: "iv" }, "введите кетопрофен по схеме")]));
  assert.ok(decisionFor(result, "ORDER_MEDICATION").reasonCodes.includes("invented_route"));
  assert.ok(result.commands.every((c) => c.params.route === undefined));
  const literal = await interpret("введите кетопрофен 100 мг в/в по схеме", output([action("ORDER_MEDICATION", { drugId: "ketoprofen" }, "введите кетопрофен 100 мг в/в по схеме")]));
  const bound = literal.result.commands.find((c) => c.type === COMMAND.ORDER_MEDICATION);
  assert.equal(bound.params.doseMg, 100);
  assert.equal(bound.params.route, "iv");
});

// ---- G ---------------------------------------------------------------------
test("G: tentative high-risk wording never becomes a committed operative action", async () => {
  const text = "возможно, понадобится операция";
  const proposed = [
    action("START_PROCEDURE", { approach: "laparoscopic" }, "возможно, понадобится операция"),
    action("COMMIT_MANAGEMENT_PLAN", { intent: "operative" }, "возможно, понадобится операция"),
    action("OPERATIVE_DECISION", { decisionId: "x", choice: "y" }, "понадобится операция"),
  ];
  // v3B: every clause of this turn is hedged, so the gate would withhold whatever is read from it. It is FINAL and is
  // never sent to the model; nothing is produced and nothing executes.
  const { result, provider } = await interpret(text, output(proposed));
  assert.equal(provider.calls.length, 0, "a fully hedged turn is not consulted");
  for (const forbidden of ["START_PROCEDURE", "OPERATIVE_DECISION", "COMMIT_MANAGEMENT_PLAN"]) {
    assert.ok(!result.commands.some((c) => c.type === forbidden), `${forbidden} must not be produced`);
  }
  const turn = submitLearnerTurn({ session: newSession(), text, interpreted: result });
  assert.equal(turn.session.state.operative.pendingDecision, null);
  assert.ok(turn.outcomes.every((o) => o.outcome !== "EXECUTED"));
  // The candidate-level guard still stands on its own for any caller that does consult (a hand-built or replayed reading).
  const decisions = validateActionCandidates({ output: output(proposed), text, allowlist: buildModelAllowlist({ bundle }) }).candidateResults;
  assert.ok(decisions.every((d) => d.decision === "REJECT"));
  assert.ok(decisions.slice(0, 2).every((d) => d.reasonCodes.includes("tentative_not_committed")));
});

// ---- H ---------------------------------------------------------------------
test("H: a high-risk disagreement between deterministic and semantic readings is clarified, never overridden", async () => {
  const text = "кетопрофен или кеторолак 30 мг в/м";
  const deterministic = interpretDeterministically({ text, bundle });
  assert.equal(deterministic.commands[0].params.drugId, "ketoprofen", "premise: deterministic picked one drug");
  const { result } = await interpret(text, output([action("ORDER_MEDICATION", { drugId: "ketorolac" }, "кеторолак 30 мг в/м")]));

  const orders = result.commands.filter((c) => c.type === COMMAND.ORDER_MEDICATION);
  assert.equal(orders.length, 1);
  assert.equal(orders[0].params.drugId, undefined, "neither drug is executed");
  assert.equal(orders[0].params.doseMg, 30, "what the learner did state is preserved");
  assert.equal(orders[0].params.route, "im");
  assert.equal(result.semanticTelemetry.conflicts[0].resolution, RESOLUTION.CLARIFICATION);
  assert.equal(result.semanticTelemetry.conflicts[0].reason, "protected_class_disagreement");
  assert.equal(result.semanticTelemetry.finalCommands[0].resolution, RESOLUTION.CLARIFICATION);

  const turn = submitLearnerTurn({ session: newSession(), text, interpreted: result });
  assert.equal(turn.outcomes[0].outcome, "CLARIFY");
  assert.deepEqual(turn.outcomes[0].missing, ["drugId"]);
  assert.equal(turn.session.state.medicationsGiven?.length ?? 0, 0);
});

// ---- I ---------------------------------------------------------------------
test("I: provider timeout, auth failure and broken output fall back to the deterministic reading unchanged", async () => {
  const text = "посмотрите брюшную полость ультразвуком";
  const baseline = interpretDeterministically({ text, bundle });
  const failures = [
    { async complete() { throw Object.assign(new Error("timeout"), { code: "provider_timeout" }); } },
    { async complete() { throw Object.assign(new Error("auth"), { code: "provider_auth", statusKind: "provider_auth" }); } },
    { async complete() { return { text: "{" }; } },
    { async complete() { return { output: { clinicalActions: "not-an-array" } }; } },
  ];
  for (const failing of failures) {
    const result = await interpretHybrid({ text, bundle, provider: { isConfigured: true, ...failing } });
    assert.equal(result.mode, "hybrid_fallback_deterministic");
    assert.deepEqual(result.commands, baseline.commands);
    assert.equal(result.semanticTelemetry.clinicalAuthority, "none");
    assert.equal(result.semanticTelemetry.called, true);
  }
});

// ---- J ---------------------------------------------------------------------
test("J: an open clarification answered with just the route keeps inherited parameters and never calls the model", async () => {
  const openClarification = { commandType: "ORDER_MEDICATION", params: { drugId: "ketoprofen", dose: "30мг", doseMg: 30 }, missing: ["route"] };
  const provider = fixtureProvider(output([action("ORDER_MEDICATION", { drugId: "ketoprofen", route: "iv" }, "в/м")]));
  const result = await interpretHybrid({ text: "в/м", bundle, turnContext: { openClarification }, provider });
  assert.equal(provider.calls.length, 0, "the ellipsis is on the deterministic fast path");
  assert.equal(result.semanticTelemetry.consultation.reason, CONSULTATION_REASON.CLARIFICATION_ANSWER);
  assert.deepEqual({ ...result.commands[0].params }, { drugId: "ketoprofen", dose: "30мг", doseMg: 30, route: "im" });
  assert.equal(result.semanticTelemetry.finalCommands[0].resolution, RESOLUTION.DETERMINISTIC_FAST_PATH);
  const turn = submitLearnerTurn({ session: newSession(), text: "в/м", interpreted: result });
  assert.ok(turn.outcomes.length === 1);
});

test("J2: when the model is consulted during an open clarification, inherited parameters survive and a route it invents is rejected", async () => {
  const openClarification = { commandType: "ORDER_MEDICATION", params: { drugId: "ketoprofen", dose: "30мг", doseMg: 30 }, missing: ["route"] };
  const text = "да, как в прошлый раз, введите кетопрофен";
  const { result } = await interpret(text, output([action("ORDER_MEDICATION", { drugId: "ketoprofen", route: "iv" }, "введите кетопрофен")]), { turnContext: { openClarification } });
  assert.ok(decisionFor(result, "ORDER_MEDICATION").reasonCodes.includes("invented_route"));
  assert.ok(result.commands.every((c) => c.params.route !== "iv"));
});

test("a concept the model chose is rejected when the learner's own words name a different one", async () => {
  const named = await interpret("общий анализ крови", output([action("ORDER_TEST", { testId: "ultrasound_abdomen" }, "общий анализ крови")]));
  assert.deepEqual(named.result.commands.filter((c) => c.type === "ORDER_TEST"), []);
  assert.deepEqual(decisionFor(named.result, "ORDER_TEST").reasonCodes, ["evidence_names_other_concept"]);
  const modality = await interpret("ультразвук желчного пузыря", output([action("ORDER_TEST", { testId: "ct_abdomen" }, "ультразвук желчного пузыря")]));
  assert.equal(decisionFor(modality.result, "ORDER_TEST").validation, "REJECT", "a different imaging modality is a contradiction, not a paraphrase");
});

test("the contradiction check matches whole words: an abbreviation inside a longer word names nothing", async () => {
  const text = "проверьте кровь после холецистэктомии";
  const { result } = await interpret(text, output([action("ORDER_TEST", { testId: "cbc" }, text)]));
  assert.equal(decisionFor(result, "ORDER_TEST").validation, "ACCEPT", "«кт» inside «холецистэктомии» is not a CT request");
  assert.equal(decisionFor(result, "ORDER_TEST").grounding, "semantic_only");
});

test("a fasting question is one intent: the generic ASK_PATIENT never displaces the dedicated ASK_FASTING_HISTORY", async () => {
  const text = "уточню, когда последний раз ел";
  const deterministic = interpretDeterministically({ text, bundle });
  assert.deepEqual(deterministic.commands.map((c) => c.type), ["ASK_FASTING_HISTORY"], "premise");
  const { result } = await interpret(text, output([], [{ topic: "fasting", evidenceSpans: ["когда последний раз ел"] }]));
  assert.deepEqual(result.commands.map((c) => c.type), ["ASK_FASTING_HISTORY"]);
  assert.equal(result.semanticTelemetry.candidateDecisions[0].arbitration.resolution, RESOLUTION.DEDUPLICATED);
});

test("evidence that differs from the learner's words only in punctuation is still their words; a changed word is not", async () => {
  const text = "Коллеги, выполню обследование живота";
  const ok = await interpret(text, output([action("EXAMINE", { region: "abdomen" }, "выполню, обследование живота")]));
  assert.equal(decisionFor(ok.result, "EXAMINE").validation, "ACCEPT");
  const changed = await interpret(text, output([action("EXAMINE", { region: "abdomen" }, "выполню осмотр живота")]));
  assert.ok(decisionFor(changed.result, "EXAMINE").reasonCodes.includes("evidence_not_verbatim"));
});

test("a promoted action with no concept is accepted on substantive words, but address and courtesy alone are nothing", async () => {
  // ASK_FASTING_HISTORY has no anchor for this wording: accepted on substantive words. (SET_NPO / REQUEST_STATUS used to be
  // the examples; their kind must now be evident in the words - promotionPolicy KIND_MUST_BE_EVIDENT.)
  const fasting = await interpret("во сколько он в последний раз перекусывал", output([action("ASK_FASTING_HISTORY", {}, "во сколько он в последний раз перекусывал")]));
  assert.equal(decisionFor(fasting.result, "ASK_FASTING_HISTORY").grounding, "semantic_only");
  const address = await interpret("Уважаемые коллеги, сделайте что-нибудь", output([action("ASK_FASTING_HISTORY", {}, "Уважаемые коллеги")]));
  assert.equal(decisionFor(address.result, "ASK_FASTING_HISTORY").validation, "REJECT");
  const openEnded = await interpret("сделайте что-нибудь полезное", output([action("SET_NPO", {}, "сделайте что-нибудь полезное")]));
  assert.equal(decisionFor(openEnded.result, "SET_NPO").validation, "REJECT", "a kind that must be evident is not accepted on substantive words");
  const protectedType = await interpret("делайте что-нибудь полезное", output([action("DISCHARGE", {}, "делайте что-нибудь полезное")]));
  assert.equal(decisionFor(protectedType.result, "DISCHARGE").validation, "REJECT", "protected classes still need the action in the learner's words");
});

test("deterministic boundary: a trailing exclamation no longer hides a route or a bare region", () => {
  const openClarification = { commandType: "ORDER_MEDICATION", params: { drugId: "ketoprofen", dose: "30мг", doseMg: 30 }, missing: ["route"] };
  const route = interpretDeterministically({ text: "в/м!", bundle, turnContext: { openClarification } });
  assert.equal(route.commands[0].params.route, "im");
  const full = interpretDeterministically({ text: "кетопрофен 100 мг в/в!", bundle });
  assert.equal(full.commands[0].params.route, "iv");
  for (const text of ["живот.", "живот!"]) {
    assert.deepEqual(interpretDeterministically({ text, bundle }).commands.map((c) => [c.type, c.params.region]), [["EXAMINE", "abdomen"]]);
  }
});

// ---- candidate independence, policy and arbitration units --------------------
test("a semantic task is never a concept_validation_failure because one candidate is invalid", async () => {
  const span = "гляньте желчный на ультразвуке";
  const { result } = await interpret(`оак и ${span}`, output([
    action("ORDER_TEST", { testId: "not_a_test" }, span),
    action("STATE_REASONING", {}, span),
    action("ORDER_TEST", { testId: "ultrasound_abdomen" }, span),
  ]));
  assert.equal(result.semanticTelemetry.status, "valid");
  assert.deepEqual(result.semanticTelemetry.candidateDecisions.map((d) => d.validation), ["REJECT", "REJECT", "ACCEPT"]);
  assert.ok(result.semanticTelemetry.conceptErrors.some((e) => e.includes("params.testId_unknown")));
});

test("promotion policy covers every command type exactly once and leaves the protected classes protected", () => {
  const policy = createPromotionPolicy();
  assert.deepEqual([...V3A_PROMOTED_TYPES].sort(), [
    "ASK_FASTING_HISTORY", "ASK_PATIENT", "CALL_STAFF", "ESTABLISH_IV_ACCESS", "EXAMINE", "ORDER_TEST",
    "PRESCRIBE_MONITORING", "REASSESS", "REQUEST_ANESTHESIA_REVIEW", "REQUEST_STATUS", "SET_NPO", "TAKE_HISTORY", "WAIT",
  ], "v3A.1 promotes WAIT and REQUEST_ANESTHESIA_REVIEW");
  assert.ok(V3A_PROTECTED_TYPES.every((type) => policy.isProtected(type) && !policy.isPromoted(type)));
  assert.equal(new Set([...V3A_PROMOTED_TYPES, ...V3A_PROTECTED_TYPES]).size, V3A_PROMOTED_TYPES.length + V3A_PROTECTED_TYPES.length, "no type on both lists");
  for (const type of ["ORDER_ORAL_INTAKE", "OBTAIN_CONSENT"]) {
    assert.ok(V3A_PROTECTED_TYPES.includes(type), `${type} is explicitly protected`);
  }
  for (const type of ["REPEAT_LAST", "END_CASE"]) {
    assert.ok(policy.isExplicitControl(type) && policy.isProtected(type) && !policy.isPromoted(type), `${type} is an explicit conversation control`);
  }
  assert.ok(policy.isProtected("STATE_REASONING"), "bookkeeping types stay default-deny");
  assert.ok(policy.requiresEvidentKind("WAIT") && policy.requiresEvidentKind("REQUEST_ANESTHESIA_REVIEW"));
});

test("consultation: canonical forms stay on the deterministic fast path", () => {
  for (const text of ["ОАК", "ОАМ", "КТ ОБП", "УЗИ ОБП", "живот", "оак и кт обп", "кетопрофен 100 мг в/м", "переоценю боль и витальные через час", "БХАК: креатинин, электролиты", "что с пациентом сейчас?", "повтори", "заверши кейс"]) {
    const decision = decideSemanticConsultation({ deterministic: interpretDeterministically({ text, bundle }), text });
    assert.equal(decision.consult, false, `${text} -> ${decision.reason}`);
  }
});

test("consultation: free-form, compound, negated or hedged language is semantic-eligible even when deterministic produced a command", () => {
  for (const text of [
    "кетопрофен или кеторолак 30 мг в/м",
    "оак и оцените состояние желчного", "хочу чтобы вы провели общий анализ крови", "посмотрите брюшную полость ультразвуком",
  ]) {
    const decision = decideSemanticConsultation({ deterministic: interpretDeterministically({ text, bundle }), text });
    assert.equal(decision.consult, true, `${text} -> ${decision.reason}`);
  }
});

test("consultation: when every action the turn named is uncommitted (hedged, conditional, refused) a second reading cannot make it a decision", () => {
  for (const text of ["не назначайте кт", "сделайте оак, если потребуется", "может быть, сделаем кт позже"]) {
    const deterministic = interpretDeterministically({ text, bundle });
    assert.equal(deterministic.commands.filter((c) => c.type !== COMMAND.STATE_REASONING).length, 0, `${text}: nothing committed`);
    assert.ok(deterministic.withheldCommands.length > 0, `${text}: the withheld reading is recorded`);
    const decision = decideSemanticConsultation({ deterministic, text });
    assert.equal(decision.consult, false, text);
    assert.equal(decision.reason, CONSULTATION_REASON.ALL_UNCOMMITTED, text);
  }
});

const cmd = (id, type, params, sourceText) => ({ id, type, params, sourceText });
const candidate = (index, type, params, spans, extra = {}) => ({
  index, source: "clinicalAction", candidate: { type, params, evidenceSpans: spans }, decision: "ACCEPT", reasonCodes: [], evidenceSpans: spans,
  grounding: "lexical", validatedCommand: { type, params, evidence: spans.join(" "), evidenceSpans: spans }, ...extra,
});

test("arbitration: same type + concept deduplicates to one command with both origins; non-overlapping commands are both kept", () => {
  const deterministic = { commands: [cmd("d0", "ORDER_TEST", { testId: "cbc" }, "оак")], unmatchedFragments: [] };
  const out = arbitrate({ deterministic, rawText: "оак, кт обп", consulted: true, candidates: [
    candidate(0, "ORDER_TEST", { testId: "cbc" }, ["оак"]), candidate(1, "ORDER_TEST", { testId: "ct_abdomen" }, ["кт обп"]),
  ] });
  assert.deepEqual(out.finalCommands.map((c) => c.params.testId), ["cbc", "ct_abdomen"]);
  assert.deepEqual(out.resolutions.map((r) => [r.resolution, r.origins]), [["deterministic_preserved", ["deterministic", "semantic"]], ["semantic_added", ["semantic"]]]);
  assert.equal(out.candidateDecisions[0].arbitration.resolution, RESOLUTION.DEDUPLICATED);
});

test("arbitration: a protected semantic candidate never overrides a promoted deterministic command; the conflict is logged", () => {
  const deterministic = { commands: [cmd("d0", "EXAMINE", { region: "abdomen" }, "осмотрю живот")], unmatchedFragments: [] };
  const out = arbitrate({ deterministic, rawText: "осмотрю живот", consulted: true, candidates: [
    candidate(0, "ORDER_PROCEDURE", { procedureId: "drain" }, ["осмотрю живот"]),
  ] });
  assert.deepEqual(out.finalCommands.map((c) => c.type), ["EXAMINE"]);
  assert.equal(out.conflicts[0].reason, "protected_semantic_never_overrides");
});

test("arbitration: a semantic disagreement without positive lexical evidence does not override the deterministic reading", () => {
  const deterministic = { commands: [cmd("d0", "ORDER_TEST", { testId: "chemistry" }, "бхак")], unmatchedFragments: [] };
  const out = arbitrate({ deterministic, rawText: "бхак", consulted: true, candidates: [
    candidate(0, "ORDER_TEST", { testId: "cbc" }, ["бхак"], { grounding: "semantic_only" }),
  ] });
  assert.deepEqual(out.finalCommands.map((c) => c.params.testId), ["chemistry"]);
  assert.equal(out.conflicts[0].reason, "semantic_disagreement_without_lexical_evidence");
});

test("arbitration: a protected deterministic command in disagreement with a different-type reading is withheld, not executed", () => {
  const deterministic = { commands: [cmd("d0", "DISCHARGE", {}, "выписываем")], unmatchedFragments: [] };
  const out = arbitrate({ deterministic, rawText: "выписываем", consulted: true, candidates: [
    candidate(0, "ORDER_TEST", { testId: "cbc" }, ["выписываем"]),
  ] });
  assert.equal(out.finalCommands.length, 0);
  assert.deepEqual(out.unmatchedFragments, ["выписываем"], "the learner is asked to restate");
  assert.equal(out.conflicts[0].resolution, RESOLUTION.CLARIFICATION);
});

test("arbitration: a whole-turn deterministic shortcut only conflicts with its own type", () => {
  const raw = "переоценю боль через час, и сделайте оак";
  const deterministic = { commands: [cmd("d0", "REASSESS", { targets: ["pain"], afterMinutes: 60 }, raw)], unmatchedFragments: [] };
  const out = arbitrate({ deterministic, rawText: raw, consulted: true, candidates: [candidate(0, "ORDER_TEST", { testId: "cbc" }, ["сделайте оак"])] });
  assert.deepEqual(out.finalCommands.map((c) => c.type), ["REASSESS", "ORDER_TEST"]);
});

test("arbitration: a less specific semantic question never replaces a complete deterministic command", () => {
  const deterministic = { commands: [cmd("d0", "ORDER_MEDICATION", { drugId: "ketoprofen", doseMg: 100, route: "im" }, "кетопрофен 100 мг в/м")], unmatchedFragments: [] };
  const out = arbitrate({ deterministic, rawText: "кетопрофен 100 мг в/м", consulted: true, candidates: [
    candidate(0, "ORDER_MEDICATION", {}, ["кетопрофен 100 мг в/м"], { decision: "CLARIFY", grounding: null }),
  ] });
  assert.equal(out.finalCommands[0].params.drugId, "ketoprofen");
  assert.equal(out.candidateDecisions[0].arbitration.reason, "subsumed_by_deterministic");
});

test("arbitration and validation are pure interpreter-layer code: no provider, network, event-log or state imports", () => {
  for (const file of ["candidateArbitration.js", "actionCandidateValidation.js", "semanticConsultationPolicy.js", "promotionPolicy.js", "conceptGrounding.js"]) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
    for (const specifier of imports) assert.doesNotMatch(specifier, /provider|gateway|eventLog|worldState|executeCommand|applyTurn|submitLearnerTurn/i, `${file} imports ${specifier}`);
    assert.doesNotMatch(source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""), /\bfetch\(|\.complete\(|Date\.now\(|Math\.random\(/, `${file} must be deterministic and offline`);
  }
});

test("replay of a turn resolved by arbitration never consults the model or re-arbitrates", async () => {
  const text = "посмотрите брюшную полость ультразвуком";
  const { result } = await interpret(text, output([action("ORDER_TEST", { testId: "ultrasound_abdomen" }, text)]));
  const session = newSession();
  const turn = submitLearnerTurn({ session, text, interpreted: result });
  const recorded = turn.session.events.find((e) => e.type === "LEARNER_TURN_RECEIVED");
  assert.deepEqual(recorded.payload.interpretedCommands.map((c) => c.type), ["ORDER_TEST"], "the FINAL structured interpretation is what is recorded");
  assert.equal(recorded.payload.semanticTelemetry.arbitration.resolutions[0].resolution, RESOLUTION.SEMANTIC_ADDED);
  const { reduceEvents } = await import("../../core/state/worldState.js");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => assert.fail("replay called the network");
  try {
    assert.deepEqual(reduceEvents(session.state, turn.session.events.slice(session.events.length)), turn.session.state);
  } finally { globalThis.fetch = originalFetch; }
  assert.doesNotMatch(JSON.stringify(recorded.payload), /rawProviderPayload|rawOutput|rawProviderOutput/);
});

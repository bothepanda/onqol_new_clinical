/**
 * Regression tests for the mechanisms fixed in the legacy_real_language_development remediation waves.
 *
 * SYNTHETIC sentences only: the corpus itself carries residents' words and lives under private/. Each test states the
 * mechanism, not a sentence from the corpus. See docs/LEGACY_REAL_LANGUAGE_REMEDIATION_2026-09-20.md.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import diseaseBundle from "../../content/generated/appendicitis.json" with { type: "json" };
import sharedBundle from "../../content/generated/shared.json" with { type: "json" };
import { withShared } from "../../core/content/loadBundle.js";
import { COMMAND, validateCommand } from "../../core/commands/commandTypes.js";
import { WAVE23_SCHEMA_VERSION } from "./semanticTaskSchemas.js";
import { interpretDeterministically } from "./deterministicInterpreter.js";
import { validateActionCandidates } from "./actionCandidateValidation.js";
import { buildModelAllowlist } from "./modelConceptValidation.js";

const bundle = withShared(diseaseBundle, sharedBundle);
const det = (text) => interpretDeterministically({ text, bundle });
const actions = (result) => result.commands.filter((c) => c.type !== COMMAND.STATE_REASONING);
const label = (c) => `${c.type}:${c.params.testId ?? c.params.region ?? c.params.role ?? c.params.destination ?? c.params.intent ?? c.params.drugId ?? ""}`;
const labels = (text) => actions(det(text)).map(label);
const action = (type, params, ...spans) => ({ type, params, evidenceSpans: spans, statedParameters: [] });
const output = (clinicalActions = []) => ({ clinicalActions, patientQuestions: [], ambiguities: [], unresolvedFragments: [], meta: { schemaVersion: WAVE23_SCHEMA_VERSION, confidence: 0.9 } });
// Candidate validation on its own, against the real allowlist: the model's output is a fixture.
const allowlist = buildModelAllowlist({ bundle });
const hybrid = async (text, modelOutput) => ({ semanticTelemetry: { candidateDecisions: validateActionCandidates({ output: modelOutput, text, allowlist }).candidateResults.map((r) => ({ type: r.candidate.type, validation: r.decision, reasonCodes: r.reasonCodes })) } });
const decision = (result, type) => result.semanticTelemetry.candidateDecisions.find((d) => d.type === type);

test("a role NOUN is not a call: staff are summoned only by a request", () => {
  assert.deepEqual(labels("реаниматологи этим обычно занимаются"), []);
  assert.deepEqual(labels("я ординатор, а не хирург"), []);
  assert.deepEqual(labels("позовите хирурга"), ["CALL_STAFF:surgeon"]);
  assert.deepEqual(labels("нужна консультация анестезиолога"), ["REQUEST_ANESTHESIA_REVIEW:"]);
  assert.deepEqual(labels("хирурга сюда"), ["CALL_STAFF:surgeon"]);
});

test("a stated delay schedules an order; it is the parameter of a reassessment", () => {
  const withheld = (text) => (det(text).withheldCommands ?? []).map((w) => `${w.type}:${w.commitment.status}`);
  assert.deepEqual(labels("КТ через 72 часа"), []);
  assert.deepEqual(withheld("КТ через 72 часа"), ["ORDER_TEST:FUTURE_PLAN"]);
  assert.deepEqual(labels("переоценю боль через 2 часа"), ["REASSESS:"]);
  // The reassessment clause is read as its own act next to the disposition it shares a fragment with.
  assert.deepEqual(labels("перевод в отделение с переоценкой через 24 часа"), ["DISPOSITION:surgical_ward", "REASSESS:"]);
  assert.equal(actions(det("переоценка через 36 ч")).find((c) => c.type === "REASSESS").params.afterMinutes, 2160, "«ч» is a unit of hours");
});

test("«было бы» is a counterfactual and withholds; the polite «я бы попросил» still orders", () => {
  assert.deepEqual(labels("можно было бы УЗИ, но смысла нет"), []);
  assert.deepEqual(labels("Я бы попросил ОАК"), ["ORDER_TEST:cbc"]);
  assert.deepEqual(labels("скоро нужна будет КТ"), []);
});

test("a study of another body region is not the modeled abdominal CT, and a region word is not a pelvic ultrasound", () => {
  assert.deepEqual(labels("КТ грудной клетки"), []);
  assert.deepEqual(labels("КТ ОБП"), ["ORDER_TEST:ct_abdomen"]);
  assert.deepEqual(labels("КТ живота и малого таза"), ["ORDER_TEST:ct_abdomen"]);
  assert.deepEqual(labels("УЗИ малого таза"), ["ORDER_TEST:pelvic_ultrasound"]);
});

test("litres are volume for an infusion; an oxygen flow is not", () => {
  const infusion = (text) => actions(det(text)).find((c) => c.type === "ORDER_INFUSION");
  assert.equal(infusion("рингер 2 л").params.volumeMl, 2000);
  assert.equal(infusion("физраствор 1,5 л").params.volumeMl, 1500);
  assert.equal(infusion("физраствор 500 мл").params.volumeMl, 500);
  assert.equal(infusion("кислород 5 л/мин"), undefined);
  assert.equal(validateCommand(infusion("откапать физраствор 1 л")).outcome, "CLARIFY", "duration is still asked, never guessed");
});

test("a bare «р-р» and a continuation are not new infusions", () => {
  assert.equal(actions(det("содовые ванночки, р-р соды")).some((c) => c.type === "ORDER_INFUSION"), false);
  assert.equal(actions(det("продолжаем инфузию")).some((c) => c.type === "ORDER_INFUSION"), false);
  assert.equal(actions(det("продолжаем метронидазол")).some((c) => c.type === "ORDER_MEDICATION"), false);
});

test("the control phrase the learner UI prints ends the case", () => {
  assert.deepEqual(labels("конец кейса"), ["END_CASE:"]);
  assert.deepEqual(labels("Хочу завершить кейс"), ["END_CASE:"]);
});

test("a study named as a reported finding or as the method of another act is not ordered", () => {
  assert.deepEqual(labels("УЗИ показало жидкость"), []);
  assert.deepEqual(labels("пунктировать под контролем УЗИ"), []);
  assert.deepEqual(labels("оценка по данным КТ"), []);
  assert.deepEqual(labels("нужна КТ"), ["ORDER_TEST:ct_abdomen"]);
});

test("model: «all the tests» is category language, and one unanchored phrase may not become several different studies", async () => {
  const text = "сделайте все исследования, какие есть";
  const result = await hybrid(text, output([action("ORDER_TEST", { testId: "ultrasound_abdomen" }, text), action("ORDER_TEST", { testId: "ct_abdomen" }, text)]));
  assert.ok(result.semanticTelemetry.candidateDecisions.every((d) => d.validation !== "ACCEPT"), "no study is chosen for the learner");
});

test("model: a role noun in a statement is not a call", async () => {
  const r = await hybrid("я ординатор, а не хирург", output([action("CALL_STAFF", { role: "surgeon" }, "я ординатор, а не хирург")]));
  assert.equal(decision(r, "CALL_STAFF").validation, "REJECT");
});

test("history stems: «распространения» is not history-taking, «расспрошу» is", () => {
  assert.deepEqual(labels("распространения заболевания не знаю"), []);
  assert.deepEqual(labels("расспрошу пациента"), ["TAKE_HISTORY:"]);
});

test("a symptom noun in a declarative is not a patient question", () => {
  assert.deepEqual(labels("катетер не нужен, раз тошноты нет"), []);
  assert.deepEqual(labels("рвота была?"), ["ASK_PATIENT:"]);
});

test("monitoring: a short target is a whole word, a generic request defaults to vitals, an unmodeled object does not", () => {
  const targets = (text) => actions(det(text)).find((c) => c.type === "PRESCRIBE_MONITORING")?.params.targets;
  assert.deepEqual(targets("мониторинг АД и ЧСС"), ["blood_pressure", "heart_rate"]);
  assert.equal(targets("мониторинг стула"), undefined, "no vitals prescribed for something else");
  assert.deepEqual(targets("мониторинг состояния"), ["vitals"]);
  assert.equal(actions(det("надо подумать")).some((c) => c.type === "PRESCRIBE_MONITORING"), false, "«ад» is not found inside «надо»");
  assert.equal(actions(det("витальные каждые 1 час, монитор")).find((c) => c.type === "PRESCRIBE_MONITORING").params.intervalMinutes, 60);
});

test("a whole-turn shortcut yields to a turn that asks for something else", () => {
  assert.deepEqual(labels("КТ ОБП, переоценю боль через час"), ["ORDER_TEST:ct_abdomen", "REASSESS:"]);
});

test("a bare operation name states the plan, and the generic analgesia intent yields to a named drug", () => {
  assert.deepEqual(labels("открытая холецистэктомия"), ["COMMIT_MANAGEMENT_PLAN:operative"]);
  assert.deepEqual(labels("оперируем сегодня"), ["COMMIT_MANAGEMENT_PLAN:operative"]);
  assert.deepEqual(labels("обезбол - кетопрофен 30 мг в/м"), ["ORDER_MEDICATION:ketoprofen"]);
});

test("region stems: digital rectal exam and neurological status are examinations", () => {
  assert.deepEqual(labels("выполню пальцевое исследование прямой кишки"), ["EXAMINE:rectal"]);
  assert.deepEqual(labels("оценить неврологический статус"), ["EXAMINE:neuro"]);
});

// ---- candidate validation ----------------------------------------------------
test("model: TRANSFER to an internal destination, an invented monitoring target and a free-text approach are rejected", async () => {
  const t = await hybrid("переводим в реанимацию", output([action("TRANSFER", { destination: "icu" }, "переводим в реанимацию")]));
  assert.equal(decision(t, "TRANSFER").validation, "REJECT");
  assert.ok(decision(t, "TRANSFER").reasonCodes.includes("transfer_destination_not_other_facility"));
  const m = await hybrid("смотрим по шкале SOFA", output([action("PRESCRIBE_MONITORING", { targets: ["sofa"] }, "смотрим по шкале SOFA")]));
  assert.ok(decision(m, "PRESCRIBE_MONITORING").reasonCodes.includes("params.targets_unknown"));
  const a = await hybrid("начинаем трансректальный доступ", output([action("START_PROCEDURE", { approach: "трансректальный доступ" }, "начинаем трансректальный доступ")]));
  assert.ok(decision(a, "START_PROCEDURE").reasonCodes.includes("params.approach_unknown"));
});

test("model: one unanchored phrase may not become several different orders", async () => {
  const text = "подготовка к вмешательству";
  const result = await hybrid(text, output([action("SET_NPO", {}, text), action("ESTABLISH_IV_ACCESS", {}, text), action("TAKE_HISTORY", {}, text)]));
  for (const type of ["SET_NPO", "ESTABLISH_IV_ACCESS", "TAKE_HISTORY"]) assert.equal(decision(result, type).validation, "REJECT", type);
});

test("model: an unmodeled study named in the words is never read as a modeled one", async () => {
  const x = await hybrid("рентген органов грудной клетки", output([action("ORDER_TEST", { testId: "ct_abdomen" }, "рентген органов грудной клетки")]));
  assert.equal(decision(x, "ORDER_TEST").validation, "REJECT");
  const p = await hybrid("КТ малого таза", output([action("ORDER_TEST", { testId: "ct_abdomen" }, "КТ малого таза")]));
  assert.equal(decision(p, "ORDER_TEST").validation, "REJECT");
  assert.ok(decision(p, "ORDER_TEST").reasonCodes.includes("qualifier_names_unmodeled_study"));
});

test("model: a procedure the registry cannot hold and a specialist it has no role for are not turned into a question", async () => {
  const proc = await hybrid("поставить дренаж", output([action("ORDER_PROCEDURE", {}, "поставить дренаж")]));
  assert.ok(decision(proc, "ORDER_PROCEDURE").reasonCodes.includes("procedure_not_modeled"));
  const staff = await hybrid("консультация кардиолога", output([action("CALL_STAFF", { role: "surgeon" }, "консультация кардиолога")]));
  assert.equal(decision(staff, "CALL_STAFF").validation, "REJECT");
  const icu = await hybrid("позовите реаниматолога", output([action("CALL_STAFF", { role: "icuPhysician" }, "позовите реаниматолога")]));
  assert.equal(decision(icu, "CALL_STAFF").validation, "ACCEPT", "the ICU physician is a modeled role");
});

// Wave B open interpreter items (WAVE_B_FLUIDS_VALIDATION_REPORT §3, §6):
// lungs / neck-vein examination wording, stated hypotheses as reasoning,
// recognised-but-unmodeled interventions, and a bare «рингера» from the
// semantic layer becoming a clarification instead of a silent drop.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resident, bundle } from "../../content/diseases/fluids_01/fluidsHarness.js";
import { interpretSemanticFirst } from "./semanticFirstInterpreter.js";
import { WAVE23_SCHEMA_VERSION } from "./semanticTaskSchemas.js";
import { separateRecognizedUnmodeled } from "./unmodeledInterventions.js";

const say = (text) => {
  const r = resident({ seed: "wave-b-open", stateful: false });
  return r.say(text);
};
const actionTypes = (record) => record.turn.interpreted.commands.map((c) => c.type);
const output = (clinicalActions) => ({ clinicalActions, patientQuestions: [], ambiguities: [], unresolvedFragments: [], meta: { schemaVersion: WAVE23_SCHEMA_VERSION, confidence: 0.9 } });
const fixture = (value) => ({ isConfigured: true, async complete() { return { output: value, meta: { model: "fixture" } }; } });

test("«оцениваю лёгкие и шейные вены» examines both regions; first-person exam verbs need a named region", () => {
  const both = say("оцениваю лёгкие и шейные вены");
  assert.deepEqual(both.turn.interpreted.commands.map((c) => c.params.region), ["cardiorespiratory", "neck_veins"]);
  assert.deepEqual(both.turn.interpreted.unmatchedFragments, []);
  for (const text of ["осматриваю живот", "выслушиваю лёгкие", "аускультация лёгких"]) assert.deepEqual(actionTypes(say(text)), ["EXAMINE"], text);
  assert.deepEqual(actionTypes(say("оцениваю ситуацию")), [], "no region, no examination");
});

test("a stated hypothesis is reasoning, not an unrecognised request", () => {
  const record = say("это перегрузка объёмом");
  const reasoning = record.turn.interpreted.commands.find((c) => c.type === "STATE_REASONING");
  assert.equal(reasoning.params.workingDiagnosis.conceptId, "volume_overload");
  assert.deepEqual(record.turn.interpreted.unmatchedFragments, []);
  assert.ok(!record.envText.includes("Не удалось распознать"));
  const negated = say("это не перегрузка объёмом");
  assert.equal(negated.turn.interpreted.commands.find((c) => c.type === "STATE_REASONING")?.params.workingDiagnosis, undefined);
});

test("oxygen is a recognised simulator limitation, recorded once, never a learner error and never moving the clock", () => {
  const r = resident({ seed: "wave-b-oxygen", stateful: false });
  const before = r.state.clock.elapsedMinutes;
  const record = r.say("дайте кислород через маску");
  assert.equal(r.state.clock.elapsedMinutes, before);
  assert.match(record.envText, /Кислородотерапия — в этой версии симуляции не моделируется/);
  assert.ok(!record.envText.includes("Не удалось распознать"));
  assert.deepEqual(r.state.simulatorLimitations.map((x) => [x.kind, x.id, x.reason]), [["intervention_not_modeled", "oxygen_therapy", "not_modeled"]]);
  const debrief = r.debrief();
  assert.ok(JSON.stringify(debrief).includes("Кислородотерапия: в этой версии симуляции результат не моделируется."));
});

test("a whole-turn measurement shortcut no longer drops a named unmodeled intervention silently; negation is not a request", () => {
  const record = say("дайте кислород и измерьте сатурацию");
  assert.deepEqual(actionTypes(record), ["REASSESS"]);
  assert.deepEqual(record.turn.interpreted.recognizedUnmodeled.map((x) => x.id), ["oxygen_therapy"]);
  assert.equal(say("кислород не нужен").turn.interpreted.recognizedUnmodeled, undefined);
});

test("unmodeled-intervention separation is idempotent and drops a drug order with no identified drug", () => {
  const interpreted = { intent: "CLINICAL_ACTION", rawText: "начинаем норадреналин", unmatchedFragments: [], commands: [{ id: "c1", type: "ORDER_MEDICATION", params: {}, sourceText: "начинаем норадреналин" }] };
  const once = separateRecognizedUnmodeled(interpreted, bundle);
  assert.deepEqual(once.commands, []);
  assert.deepEqual(once.recognizedUnmodeled.map((x) => x.id), ["vasopressor"]);
  assert.deepEqual(separateRecognizedUnmodeled(once, bundle), once);
});

test("semantic «болюс рингера» naming a different Ringer becomes a which-fluid clarification, not a silent drop", async () => {
  const text = "болюс рингера 500 мл";
  const result = await interpretSemanticFirst({ text, bundle, provider: fixture(output([
    { type: "ORDER_INFUSION", params: { fluidId: "ringers_lactate", volumeMl: 500 }, evidenceSpans: [text], statedParameters: [] },
  ])) });
  const infusion = result.commands.find((c) => c.type === "ORDER_INFUSION");
  assert.ok(infusion, "infusion kept");
  assert.equal(infusion.params.fluidId, undefined, "the model never picks the solution");
  assert.deepEqual(result.unmatchedFragments, []);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { createSession } from "./createSession.js";
import { submitLearnerTurn } from "./submitLearnerTurn.js";
import { withShared } from "../content/loadBundle.js";
import diseaseBundle from "../../content/generated/appendicitis.json" with { type: "json" };
import sharedBundle from "../../content/generated/shared.json" with { type: "json" };

const bundle = withShared(diseaseBundle, sharedBundle);
function fresh(seed) {
  return createSession({ sessionId: `route-${seed}`, seed, mode: "reference", casePresetId: "APP-004", sessionPurpose: "internal_development", bundle, locale: "ru", startIso: "2026-08-30T08:00:00.000Z" });
}
function run(seed, texts) {
  let session = fresh(seed);
  const turns = [];
  for (const text of texts) { const turn = submitLearnerTurn({ session, text }); turns.push(turn); session = turn.session; }
  return { session, turns };
}
const base = ["идём на операцию", "венозный доступ", "антибиотикопрофилактика цефазолин 2 г в/в, антибиотикопрофилактика метронидазол 500 мг в/в"];

test("отказ операции без анестезиолога не открывает послеоперационный маршрут", () => {
  const { session, turns } = run("missing-anesthesia", [...base, "получаю согласие", "иду лапароскопически", "перевожу в хирургическое отделение"]);
  assert.equal(turns.at(-2).outcomes[0].outcome, "PREOP_NOT_READY");
  assert.equal(turns.at(-1).outcomes[0].outcome, "DISPOSITION_NOT_READY");
  assert.equal(session.state.operative.completed, false);
  assert.equal(session.state.location, "emergency_department");
});

test("отказ операции без согласия не открывает отделение и выписку", () => {
  const { session, turns } = run("missing-consent", [...base, "вызываю анестезиолога на осмотр", "переоценю витальные через 40 минут", "иду лапароскопически", "перевожу в хирургическое отделение", "выписываю"]);
  assert.equal(turns.at(-3).outcomes[0].outcome, "PREOP_NOT_READY");
  assert.equal(turns.at(-2).outcomes[0].outcome, "DISPOSITION_NOT_READY");
  assert.equal(turns.at(-1).outcomes[0].outcome, "DISCHARGE_NOT_READY");
  assert.equal(session.state.location, "emergency_department");
  assert.equal(session.state.session.status, "active");
});

test("успешная операция автоматически ведёт в recovery, затем разрешает отделение", () => {
  const { session: operated } = run("success", [...base, "вызываю анестезиолога на осмотр", "переоценю витальные через 40 минут", "получаю согласие", "иду лапароскопически", "удаляю аппендикс, аспирирую жидкость"]);
  assert.equal(operated.state.operative.completed, true);
  assert.equal(operated.state.location, "recovery");
  const ward = submitLearnerTurn({ session: operated, text: "перевожу в хирургическое отделение" }).session;
  assert.equal(ward.state.location, "surgical_ward");
});

test("replay after refusals is deterministic", () => {
  const texts = [...base, "получаю согласие", "иду лапароскопически", "перевожу в хирургическое отделение"];
  assert.deepEqual(run("same-refusal", texts).session.events, run("same-refusal", texts).session.events);
});

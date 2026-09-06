import { test } from "node:test";
import assert from "node:assert/strict";
import { interpretTurn } from "./interpretTurn.js";
import { withShared } from "../../core/content/loadBundle.js";
import diseaseBundle from "../../content/generated/appendicitis.json" with { type: "json" };
import sharedBundle from "../../content/generated/shared.json" with { type: "json" };

const bundle = withShared(diseaseBundle, sharedBundle);
const reasoning = (text, turnContext = {}) => interpretTurn({ text, turnContext, bundle }).commands.find((c) => c.type === "STATE_REASONING")?.params;

test("детерминированный RU-корпус фиксирует только явно сказанные reasoning claims", () => {
  assert.equal(reasoning("рабочий диагноз острый аппендицит").workingDiagnosis.conceptId, "acute_appendicitis");
  assert.equal(reasoning("думаю, это апендицит").workingDiagnosis.uncertaintyExpressed, true);
  assert.equal(reasoning("думаю, это не аппендицит"), undefined);
  assert.deepEqual(reasoning("из дифференциального: почечная колика, гастроэнтерит").differential.items.map((x) => x.conceptId), ["renal_colic", "gastroenteritis"]);
  assert.equal(reasoning("в дифференциальном на первом месте почечная колика, затем гастроэнтерит").differential.ranked, true);
  assert.equal(reasoning("пациент гемодинамически стабилен").stability.learnerAssessment, "stable");
  assert.equal(reasoning("планирую операцию, потому что клиника сохраняется").management.rationaleStated, true);
  assert.equal(reasoning("если станет хуже, пересмотрю тактику и позову старшего").contingency.specificity, "specific");
  assert.equal(reasoning("сначала сам оценю пациента, затем консультация хирурга по поводу тактики").consultation.ownAssessmentStated, true);
  assert.equal(reasoning("буду наблюдать час, переоценю боль и витальные").observation.goalStated, true);
  assert.equal(reasoning("планирую перевести пациента в отделение").disposition.destination, "ward");
  assert.equal(reasoning("рабочий диагноз болезнь крона"), undefined);
});

test("reasoning и клиническое действие сохраняются двумя независимыми командами", () => {
  const result = interpretTurn({ text: "думаю, это острый аппендицит, назначаю ОАК", bundle });
  assert.deepEqual(result.commands.map((c) => c.type), ["ORDER_TEST", "STATE_REASONING"]);
});

test("короткий ответ на вопрос наставника обновляет ожидаемый домен", () => {
  const value = reasoning("резкое ухудшение", { openMentorQuestion: { expects: ["contingency"] } });
  assert.equal(value.contingency.stated, true);
});

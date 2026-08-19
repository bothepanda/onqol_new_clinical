import test from "node:test";
import assert from "node:assert/strict";
import { acuteAppendicitisCase } from "../cases/acuteAppendicitis.js";
import { advanceCaseWithParsedActions, createInitialSession } from "../caseEngine.js";
import { validateRouterOutput } from "../semanticRouter.js";
import { scoreSession } from "../scoring.js";
import { validateCase } from "../schemas/caseSchema.js";

function routed(text, conceptIds) {
  if (text === "конец кейса") {
    return {
      actions: [{ id: "end_case", source: "command", confidence: 1 }],
      intents: [{ type: "management", concept_id: "end_case", confidence: 1 }],
      invalidConcepts: [],
      unknownText: "",
    };
  }

  return validateRouterOutput(
    {
      intents: conceptIds.map((conceptId) => ({
        type: "management",
        concept_id: conceptId,
        confidence: 0.95,
      })),
    },
    acuteAppendicitisCase
  );
}

function play(steps) {
  let session = createInitialSession(acuteAppendicitisCase);
  for (const step of steps) {
    session = advanceCaseWithParsedActions(
      acuteAppendicitisCase,
      session,
      step.text,
      routed(step.text, step.concepts || [])
    ).session;
  }
  return session;
}

const idealInputs = [
  { text: "физикальный осмотр и опрос", concepts: ["focused_history", "abdominal_exam"] },
  { text: "ОАК, ОАМ, тест на беременность beta-HCG", concepts: ["cbc", "urinalysis", "pregnancy_test"] },
  {
    text: "AIR: высокий риск. Рабочий диагноз - острый неосложненный аппендицит. В дифдиагнозе внематочная беременность.",
    concepts: ["risk_stratification", "diagnosis_acute_appendicitis", "differential_ectopic"],
  },
  {
    text: "обезболивание, голод. Оперировать здесь: открытая аппендэктомия. Однократный антибиотик перед операцией за 30 минут.",
    concepts: ["analgesia", "npo", "open_appendectomy_here", "preop_single_antibiotic_prophylaxis"],
  },
];

test("case schema is internally consistent", () => {
  const result = validateCase(acuteAppendicitisCase);
  assert.equal(result.ok, true, result.errors.join("\n"));
});

test("ideal pathway produces high reproducible score", () => {
  const first = play([...idealInputs, { text: "конец кейса" }]);
  const second = play([...idealInputs, { text: "конец кейса" }]);

  assert.equal(first.scoring.overallScore, second.scoring.overallScore);
  assert.deepEqual(first.scoring.domainScores, second.scoring.domainScores);
  assert.equal(first.scoring.criticalErrorFlag, false);
  assert.ok(first.scoring.overallScore >= 90);
});

test("acceptable alternative pathway gives limited credit without blocking case", () => {
  const session = play([
    { text: "анамнез и осмотр живота", concepts: ["focused_history", "abdominal_exam"] },
    { text: "ОАК, ОАМ, ХГЧ, УЗИ живота и CRP", concepts: ["cbc", "urinalysis", "pregnancy_test", "abdominal_ultrasound", "crp"] },
    { text: "высокий риск по шкале, острый аппендицит", concepts: ["risk_stratification", "diagnosis_acute_appendicitis"] },
  ]);
  const scoring = scoreSession(acuteAppendicitisCase, session);

  assert.ok(scoring.completed.includes("abdominal_ultrasound"));
  assert.ok(scoring.completed.includes("crp"));
  assert.ok(scoring.domainScores.Investigations > 80);
});

test("missed critical pregnancy test is flagged", () => {
  const session = play([
    { text: "анамнез и осмотр живота", concepts: ["focused_history", "abdominal_exam"] },
    { text: "ОАК и ОАМ", concepts: ["cbc", "urinalysis"] },
    { text: "острый аппендицит, высокий риск", concepts: ["diagnosis_acute_appendicitis", "risk_stratification"] },
    { text: "аппендэктомия здесь, антибиотик перед операцией однократно", concepts: ["open_appendectomy_here", "preop_single_antibiotic_prophylaxis"] },
    { text: "конец кейса" },
  ]);

  assert.equal(session.scoring.criticalErrorFlag, true);
  assert.ok(session.scoring.criticalErrors.includes("pregnancy_test"));
  assert.match(session.report.markdown, /[Сс]татус беременности/);
});

test("operationalized transfer action is tracked but not scored before review", () => {
  const session = play([
    { text: "анамнез и осмотр живота", concepts: ["focused_history", "abdominal_exam"] },
    { text: "ОАК, ОАМ, ХГЧ", concepts: ["cbc", "urinalysis", "pregnancy_test"] },
    { text: "острый аппендицит", concepts: ["diagnosis_acute_appendicitis"] },
    { text: "перевести в областную больницу", concepts: ["transfer_before_source_control"] },
    { text: "конец кейса" },
  ]);

  assert.ok(session.scoring.unsafeActions.includes("transfer_before_source_control"));
  assert.equal(session.scoring.criticalErrorFlag, true);
  assert.equal(session.scoring.penalties, 0);
});

// A conditional recommendation with low certainty is not a hard ban. Routine
// postoperative antibiotics after uncomplicated appendectomy are usually not
// recommended - so this belongs in the debrief, not in a penalty column and
// not in a safety stop.
test("postoperative antibiotics after uncomplicated appendectomy are discussed, not punished", () => {
  const session = play([
    { text: "анамнез и осмотр живота", concepts: ["focused_history", "abdominal_exam"] },
    { text: "ОАК, ОАМ, ХГЧ", concepts: ["cbc", "urinalysis", "pregnancy_test"] },
    { text: "острый аппендицит", concepts: ["diagnosis_acute_appendicitis"] },
    { text: "аппендэктомия здесь, антибиотик перед операцией однократно", concepts: ["open_appendectomy_here", "preop_single_antibiotic_prophylaxis"] },
    { text: "антибиотики после операции 5 дней", concepts: ["postop_antibiotics_uncomplicated"] },
    { text: "конец кейса" },
  ]);

  assert.ok(session.completedActions.includes("postop_antibiotics_uncomplicated"));
  assert.ok(!session.scoring.unsafeActions.includes("postop_antibiotics_uncomplicated"));
  assert.ok(!(session.unsafeActions || []).includes("postop_antibiotics_uncomplicated"));
  assert.match(session.report.markdown, /предлагает не назначать[^.]*рутинно/);
});

test("irrelevant or excessive investigations are deterministic penalties", () => {
  const session = play([
    { text: "анамнез и осмотр живота", concepts: ["focused_history", "abdominal_exam"] },
    { text: "ОАК, ОАМ, ХГЧ, КТ с контрастом", concepts: ["cbc", "urinalysis", "pregnancy_test", "ct_abdomen"] },
  ]);
  const scoring = scoreSession(acuteAppendicitisCase, session);

  assert.ok(scoring.unnecessaryActions.includes("ct_abdomen"));
  assert.ok(scoring.penalties >= 4);
});

test("invalid semantic router concept is rejected", () => {
  const validated = validateRouterOutput(
    {
      intents: [
        { type: "request_test", concept_id: "cbc", confidence: 0.95 },
        { type: "request_test", concept_id: "invented_mri_protocol", confidence: 0.92 },
      ],
    },
    acuteAppendicitisCase
  );

  assert.deepEqual(validated.actions, [
    {
      id: "cbc",
      source: "semantic_router",
      intent_type: "request_test",
      confidence: 0.95,
      routed_concept_id: "cbc",
    },
  ]);
  assert.deepEqual(validated.invalidConcepts, ["invented_mri_protocol"]);
});

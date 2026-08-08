import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { acuteAppendicitisCase } from "../cases/acuteAppendicitis.js";
import {
  advanceCaseWithParsedActions,
  advanceCaseWithSemanticRouter,
  createInitialSession,
} from "../caseEngine.js";
import { appendicitisRouterConceptMap } from "../diseases/appendicitis/router/conceptMap.js";
import { buildAllowedConcepts, routeUserInput, validateRouterOutput } from "../semanticRouter.js";

const here = dirname(fileURLToPath(import.meta.url));
const routerDir = join(here, "../diseases/appendicitis/router");

function readYaml(path) {
  return YAML.parse(readFileSync(path, "utf8"));
}

const routerConcepts = readYaml(join(routerDir, "appendicitis.concepts.yaml"));
const routerAcceptance = readYaml(join(routerDir, "router_tests.ru_kk.yaml"));
const conceptIntentById = new Map(
  routerConcepts.concepts.map((concept) => [concept.concept_id, concept.intent])
);

const fixtures = new Map([
  ["физикальный осмотр и опрос", ["request_history:focused_history", "request_examination:abdominal_exam"]],
  ["сейчас живот какой", ["request_examination:abdominal_exam"]],
  ["что по животу?", ["request_examination:abdominal_exam"]],
  ["пальпирую живот", ["request_examination:abdominal_exam"]],
  ["есть ли симптомы раздражения брюшины?", ["request_examination:abdominal_exam"]],
  ["ОАК срб моча тест на беременность", ["request_test:cbc", "request_test:crp", "request_test:urinalysis", "request_test:pregnancy_test"]],
  ["думаю острый аппендицит", ["diagnosis:diagnosis_acute_appendicitis"]],
  ["беру на операцию", ["management:open_appendectomy_here"]],
  ["консервативно поведу антибиотиками", ["management:antibiotic_observation_course"]],
  [
    "ставлю вену, обезболиваю, голод, ОАК и ХГЧ, потом аппендэктомия здесь",
    ["management:analgesia", "management:npo", "request_test:cbc", "request_test:pregnancy_test", "management:open_appendectomy_here"],
  ],
  [
    "живот пасматреть и апендицит думаю",
    ["request_examination:abdominal_exam", "diagnosis:diagnosis_acute_appendicitis"],
  ],
  [
    "пока похоже на аппендицит или внематочная беременность.\nоак, узи обп + омт, црб, bHCG",
    [
      "diagnosis:diagnosis_acute_appendicitis",
      "diagnosis:differential_ectopic",
      "request_test:cbc",
      "request_test:abdominal_ultrasound",
      "request_test:pelvic_ultrasound",
      "request_test:crp",
      "request_test:pregnancy_test",
    ],
  ],
  ["физикалық қарап, анамнез жинаймын", ["request_history:focused_history", "request_examination:abdominal_exam"]],
  ["қазір іші қандай?", ["request_examination:abdominal_exam"]],
  ["іш бойынша не бар?", ["request_examination:abdominal_exam"]],
  ["ішін пальпациялаймын", ["request_examination:abdominal_exam"]],
  ["ішперде тітіркену белгілері бар ма?", ["request_examination:abdominal_exam"]],
  ["ЖҚА СРБ зәр және жүктілік тесті", ["request_test:cbc", "request_test:crp", "request_test:urinalysis", "request_test:pregnancy_test"]],
  ["жедел аппендицит деп ойлаймын", ["diagnosis:diagnosis_acute_appendicitis"]],
  ["операцияға аламын", ["management:open_appendectomy_here"]],
  [
    "ауырсынуды басамын, аш қалдырамын, қан зәр ХГЧ алып, осы жерде операция жасаймын",
    ["management:analgesia", "management:npo", "request_test:cbc", "request_test:urinalysis", "request_test:pregnancy_test", "management:open_appendectomy_here"],
  ],
  [
    "ишин корем апендицит сиякты",
    ["request_examination:abdominal_exam", "diagnosis:diagnosis_acute_appendicitis"],
  ],
]);

function fakeRouterLLM(prompt) {
  const input = JSON.parse(prompt.user).raw_user_text;
  const mapped = fixtures.get(input);
  assert.ok(mapped, `Missing router fixture for: ${input}`);

  return JSON.stringify({
    intents: mapped.map((item) => {
      const [type, concept_id] = item.split(":");
      return { type, concept_id, confidence: 0.95 };
    }),
  });
}

async function route(text, locale = "ru") {
  return routeUserInput(text, acuteAppendicitisCase, createInitialSession(acuteAppendicitisCase), {
    llm: fakeRouterLLM,
    locale,
    conceptMap: appendicitisRouterConceptMap,
  });
}

test("semantic router maps natural Russian inputs to canonical concepts", async () => {
  const cases = [
    ["физикальный осмотр и опрос", ["focused_history", "abdominal_exam"]],
    ["сейчас живот какой", ["abdominal_exam"]],
    ["что по животу?", ["abdominal_exam"]],
    ["пальпирую живот", ["abdominal_exam"]],
    ["есть ли симптомы раздражения брюшины?", ["abdominal_exam"]],
    ["ОАК срб моча тест на беременность", ["cbc", "crp", "urinalysis", "pregnancy_test"]],
    ["думаю острый аппендицит", ["diagnosis_acute_appendicitis"]],
    ["беру на операцию", ["open_appendectomy_here"]],
    ["консервативно поведу антибиотиками", ["antibiotic_observation_course"]],
    ["ставлю вену, обезболиваю, голод, ОАК и ХГЧ, потом аппендэктомия здесь", ["analgesia", "npo", "cbc", "pregnancy_test", "open_appendectomy_here"]],
    ["живот пасматреть и апендицит думаю", ["abdominal_exam", "diagnosis_acute_appendicitis"]],
  ];

  for (const [input, expectedIds] of cases) {
    const parsed = await route(input, "ru");
    assert.deepEqual(parsed.actions.map((action) => action.id), expectedIds);
  }
});

test("semantic router maps natural Kazakh inputs to the same canonical concepts", async () => {
  const cases = [
    ["физикалық қарап, анамнез жинаймын", ["focused_history", "abdominal_exam"]],
    ["қазір іші қандай?", ["abdominal_exam"]],
    ["іш бойынша не бар?", ["abdominal_exam"]],
    ["ішін пальпациялаймын", ["abdominal_exam"]],
    ["ішперде тітіркену белгілері бар ма?", ["abdominal_exam"]],
    ["ЖҚА СРБ зәр және жүктілік тесті", ["cbc", "crp", "urinalysis", "pregnancy_test"]],
    ["жедел аппендицит деп ойлаймын", ["diagnosis_acute_appendicitis"]],
    ["операцияға аламын", ["open_appendectomy_here"]],
    ["ауырсынуды басамын, аш қалдырамын, қан зәр ХГЧ алып, осы жерде операция жасаймын", ["analgesia", "npo", "cbc", "urinalysis", "pregnancy_test", "open_appendectomy_here"]],
    ["ишин корем апендицит сиякты", ["abdominal_exam", "diagnosis_acute_appendicitis"]],
  ];

  for (const [input, expectedIds] of cases) {
    const parsed = await route(input, "kk");
    assert.deepEqual(parsed.actions.map((action) => action.id), expectedIds);
  }
});

test("critical acceptance: physical examination and history returns both approved findings", async () => {
  const session = createInitialSession(acuteAppendicitisCase);
  const result = await advanceCaseWithSemanticRouter(
    acuteAppendicitisCase,
    session,
    "физикальный осмотр и опрос",
    { llm: fakeRouterLLM, locale: "ru" }
  );

  assert.match(result.reply, /\*\*Анамнез:\*\*/);
  assert.match(result.reply, /\*\*Осмотр живота:\*\*/);
  assert.doesNotMatch(result.reply, /Принято\. Какие данные/);
});

test("critical acceptance: abdominal question returns abdominal examination finding", async () => {
  const session = createInitialSession(acuteAppendicitisCase);
  const result = await advanceCaseWithSemanticRouter(
    acuteAppendicitisCase,
    session,
    "сейчас живот какой",
    { llm: fakeRouterLLM, locale: "ru" }
  );

  assert.match(result.reply, /\*\*Осмотр живота:\*\*/);
  assert.doesNotMatch(result.reply, /Принято\. Какие данные/);
});

test("mixed diagnosis and test request returns only requested test findings without confirmation", async () => {
  const session = createInitialSession(acuteAppendicitisCase);
  const result = await advanceCaseWithSemanticRouter(
    acuteAppendicitisCase,
    session,
    "пока похоже на аппендицит или внематочная беременность.\nоак, узи обп + омт, црб, bHCG",
    { llm: fakeRouterLLM, locale: "ru" }
  );

  assert.match(result.reply, /\*\*ОАК:\*\*/);
  assert.match(result.reply, /\*\*CRP:\*\*/);
  assert.match(result.reply, /\*\*Тест на беременность:\*\*/);
  assert.match(result.reply, /\*\*УЗИ брюшной полости:\*\*/);
  assert.match(result.reply, /\*\*УЗИ органов малого таза:\*\*/);
  assert.doesNotMatch(result.reply, /Гинекологический скрининг/);
  assert.doesNotMatch(result.reply, /верно|правильно|подтверждает|высокая вероятность|диагноз сформулирован/i);
  assert.match(result.reply, /Как интерпретируешь результаты и что делаешь дальше\?/);
});

test("diagnosis intent is recorded without mid-case confirmation", async () => {
  const session = createInitialSession(acuteAppendicitisCase);
  const result = await advanceCaseWithSemanticRouter(
    acuteAppendicitisCase,
    session,
    "думаю острый аппендицит",
    { llm: fakeRouterLLM, locale: "ru" }
  );

  assert.ok(result.session.completedActions.includes("diagnosis_acute_appendicitis"));
  assert.doesNotMatch(result.reply, /верно|правильно|подтверждает|высокая вероятность|диагноз сформулирован/i);
  assert.match(result.reply, /Что думаешь и что будешь делать дальше\?/);
});

test("management choice is recorded without correction and receives a neutral operational prompt", async () => {
  const session = createInitialSession(acuteAppendicitisCase);
  const result = await advanceCaseWithSemanticRouter(
    acuteAppendicitisCase,
    session,
    "консервативно поведу антибиотиками",
    { llm: fakeRouterLLM, locale: "ru" }
  );

  assert.ok(result.session.unsafeActions.includes("antibiotic_observation_course"));
  assert.doesNotMatch(result.reply, /неправильно|ошибка|противопоказано|верно|правильно/i);
  assert.match(result.reply, /Как реализуешь выбранную тактику и что контролируешь дальше\?/);
});

test("partial unknown does not suppress recognized findings or show global failure", () => {
  const parsed = validateRouterOutput(
    {
      intents: [
        { type: "request_test", concept_id: "cbc", confidence: 0.94 },
        { type: "unknown", concept_id: null, confidence: 0.2 },
      ],
    },
    acuteAppendicitisCase
  );
  const result = advanceCaseWithParsedActions(
    acuteAppendicitisCase,
    createInitialSession(acuteAppendicitisCase),
    "ОАК и что-то странное",
    parsed
  );

  assert.deepEqual(parsed.actions.map((action) => action.id), ["cbc"]);
  assert.equal(parsed.unknownText, "unresolved_intent");
  assert.match(result.reply, /\*\*ОАК:\*\*/);
  assert.doesNotMatch(result.reply, /не могу надежно сопоставить|Сформулируй как анамнез/i);
});

test("semantic router rejects hallucinated concept ids", () => {
  const parsed = validateRouterOutput(
    {
      intents: [
        { type: "request_test", concept_id: "cbc", confidence: 0.9 },
        { type: "request_test", concept_id: "invented_serum_marker", confidence: 0.9 },
      ],
    },
    acuteAppendicitisCase
  );

  assert.deepEqual(parsed.actions.map((action) => action.id), ["cbc"]);
  assert.deepEqual(parsed.invalidConcepts, ["invented_serum_marker"]);
});

test("appendicitis router package acceptance concepts are valid dictionary concepts", () => {
  const dictionaryIds = new Set(routerConcepts.concepts.map((concept) => concept.concept_id));
  const acceptedIds = new Set(routerAcceptance.tests.flatMap((row) => row.expected_concepts));

  for (const conceptId of acceptedIds) {
    assert.ok(dictionaryIds.has(conceptId), `${conceptId} is missing from appendicitis.concepts.yaml`);
    assert.ok(
      Object.hasOwn(appendicitisRouterConceptMap, conceptId),
      `${conceptId} is missing from conceptMap.js`
    );
  }
});

test("dictionary concepts map through current Case Card without inventing findings", () => {
  const conceptIds = [
    "acute_appendicitis",
    "ectopic_pregnancy",
    "cbc",
    "crp",
    "beta_hcg",
    "abdominal_ultrasound",
    "pelvic_ultrasound",
    "abdominal_palpation",
  ];
  const parsed = validateRouterOutput(
    {
      intents: conceptIds.map((conceptId) => ({
        type: conceptIntentById.get(conceptId),
        concept_id: conceptId,
        confidence: 0.96,
      })),
    },
    acuteAppendicitisCase,
    { conceptMap: appendicitisRouterConceptMap }
  );

  assert.deepEqual(parsed.invalidConcepts, []);
  assert.deepEqual(parsed.recognizedButUndefined, []);
  assert.deepEqual(parsed.actions.map((action) => action.id), [
    "diagnosis_acute_appendicitis",
    "differential_ectopic",
    "cbc",
    "crp",
    "pregnancy_test",
    "abdominal_ultrasound",
    "pelvic_ultrasound",
    "abdominal_exam",
  ]);
  assert.deepEqual(parsed.actions.map((action) => action.routed_concept_id), conceptIds);
});

test("recognized dictionary concepts absent from the Case Card stay undefined", () => {
  const parsed = validateRouterOutput(
    {
      intents: [
        { type: "request_examination", concept_id: "rovsing_sign", confidence: 0.95 },
        { type: "request_examination", concept_id: "psoas_sign", confidence: 0.95 },
        { type: "request_examination", concept_id: "obturator_sign", confidence: 0.95 },
      ],
      unresolved_fragments: [],
    },
    acuteAppendicitisCase,
    { conceptMap: appendicitisRouterConceptMap }
  );

  assert.deepEqual(parsed.actions, []);
  assert.deepEqual(parsed.invalidConcepts, []);
  assert.deepEqual(parsed.recognizedButUndefined, ["rovsing_sign", "psoas_sign", "obturator_sign"]);
});

test("Ortolani negative example does not route to abdominal exam or other special signs", () => {
  const ortolaniRow = routerAcceptance.tests.find((row) => row.input === "Ортолани и obturator какие?");
  assert.ok(ortolaniRow);
  assert.deepEqual(ortolaniRow.expected_concepts, ["obturator_sign"]);

  const parsed = validateRouterOutput(
    {
      intents: ortolaniRow.expected_concepts.map((conceptId) => ({
        type: conceptIntentById.get(conceptId),
        concept_id: conceptId,
        confidence: 0.97,
      })),
    },
    acuteAppendicitisCase,
    { conceptMap: appendicitisRouterConceptMap }
  );

  assert.deepEqual(parsed.actions.map((action) => action.id), []);
  assert.deepEqual(parsed.recognizedButUndefined, ["obturator_sign"]);
});

test("router prompt exposes dictionary concepts but keeps case validation authoritative", () => {
  const allowedConceptIds = buildAllowedConcepts(acuteAppendicitisCase, appendicitisRouterConceptMap).map(
    (concept) => concept.concept_id
  );

  assert.ok(allowedConceptIds.includes("acute_appendicitis"));
  assert.ok(allowedConceptIds.includes("diagnosis_acute_appendicitis"));
  assert.ok(allowedConceptIds.includes("obturator_sign"));
});

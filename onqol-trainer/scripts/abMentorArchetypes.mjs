#!/usr/bin/env node
/**
 * Live, read-only voice sample for behavior-spec archetypes B, C, E, F and H.
 * It records what happened; it does not grade replies or alter policy.
 */
import { writeFileSync } from "node:fs";

import { buildV35Case } from "../src/clinical/v35/createCase.js";
import { advanceV25Session, createV25Session } from "../src/clinical/v25/engine.js";
import {
  appendicitisRouterConceptMap,
  resolveConcept,
} from "../src/clinical/diseases/appendicitis/router/conceptRegistry.js";
import { DEFAULT_MODELS, requestOpenAI } from "../server/openaiGateway.mjs";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("Нужен OPENAI_API_KEY в окружении или .env.local.");
  process.exit(2);
}

const model = process.env.OPENAI_MENTOR_MODEL || DEFAULT_MODELS.mentor;
// Hardcoded until 21.08.2026, which silently overwrote the previous day's
// baseline on the next run - the one file the comparison depends on.
const REPORT_PATH =
  process.argv.slice(2).find((arg) => arg.startsWith("--report="))?.split("=")[1] ||
  "AB_MENTOR_ARCHETYPES.md";
const CASE_PRESET = "APP-001";
const SEED = "mentor-archetypes-20260820";

const emptyPayload = Object.freeze({
  intents: [],
  unresolved_fragments: [],
  action_parameters: [],
});

const setupTurns = [
  {
    text: "собираю анамнез и осматриваю живот",
    payload: {
      ...emptyPayload,
      intents: [
        { type: "request_history", concept_id: "focused_history", confidence: 0.99 },
        { type: "request_examination", concept_id: "abdominal_exam", confidence: 0.99 },
      ],
    },
  },
  {
    text: "рабочая версия аппендицит, но исключаю внематочную; ОАК и ХГЧ",
    payload: {
      ...emptyPayload,
      intents: [
        { type: "diagnosis", concept_id: "diagnosis_acute_appendicitis", confidence: 0.99 },
        { type: "diagnosis", concept_id: "differential_ectopic", confidence: 0.99 },
        { type: "request_test", concept_id: "cbc", confidence: 0.99 },
        { type: "request_test", concept_id: "pregnancy_test", confidence: 0.99 },
      ],
      reasoning: {
        working_diagnosis: {
          stated: true,
          concept_id: "diagnosis_acute_appendicitis",
          uncertainty_stated: true,
        },
        differential: {
          stated: true,
          ranked: true,
          has_dangerous_alternative: true,
          items: [
            { concept_id: "diagnosis_acute_appendicitis", rank: 1 },
            { concept_id: "differential_ectopic", rank: 2, dangerous: true },
          ],
        },
      },
    },
  },
];

const scenarios = [
  {
    id: "B",
    title: "частичный, но полезный ответ",
    turns: [{ label: "целевая реплика", text: "лапаротомия, ревизия, санация" }],
  },
  {
    id: "C",
    title: "честное незнание после попытки",
    turns: [
      { label: "попытка перед признанием", text: "лапаротомия, ревизия, санация" },
      { label: "целевая реплика", text: "не знаю" },
    ],
  },
  {
    id: "E",
    title: "перекладывание решения",
    turns: [{ label: "целевая реплика", text: "это реаниматологи решают" }],
  },
  {
    id: "F",
    title: "последовательная расплывчатость",
    turns: [
      { label: "шаг 1", text: "смотрю пациента" },
      { label: "шаг 2", text: "живот смотрю" },
      { label: "шаг 3", text: "все анализы что есть" },
    ],
  },
  {
    id: "H",
    title: "прыжок к радикальному варианту",
    turns: [
      {
        label: "целевая реплика",
        text: "сразу лапаротомия, ревизия и санация всей брюшной полости",
      },
    ],
  },
];

function router(payload = emptyPayload) {
  return () => JSON.stringify({ ...emptyPayload, ...payload });
}

function options(payload, mentorLLM, mentor) {
  return {
    mentor,
    mentorLLM,
    actionExtractorLLM: router(payload),
    conceptMap: appendicitisRouterConceptMap,
    conceptRegistry: resolveConcept,
  };
}

async function mentorLLM(prompt) {
  const { output } = await requestOpenAI({
    apiKey,
    task: "mentor",
    prompt,
    models: {
      router: process.env.OPENAI_ROUTER_MODEL || DEFAULT_MODELS.router,
      simulator: process.env.OPENAI_SIMULATOR_MODEL || DEFAULT_MODELS.simulator,
      mentor: model,
    },
  });
  return output;
}

function splitTurn(result, definition) {
  const mentorText = result.mentor?.text || "";
  const engineReply =
    mentorText && result.reply?.endsWith(mentorText)
      ? result.reply.slice(0, -mentorText.length).trim()
      : result.reply;
  return {
    ...definition,
    engineReply,
    mentorText,
    mode: result.mentor?.mode || null,
    source: result.mentor?.source || null,
    repairAttempted: Boolean(result.mentor?.repairAttempted),
    rejectionReasons: result.mentor?.rejectionReasons || [],
    telemetry: result.mentor?.telemetry || [],
    policy: result.mentorPolicy
      ? {
          mode: result.mentorPolicy.mode,
          adequacy: result.mentorPolicy.adequacy,
          issue_id: result.mentorPolicy.issue_id,
          scaffolding_level: result.mentorPolicy.scaffolding_level,
        }
      : null,
  };
}

async function runScenario(definition) {
  const { caseData } = buildV35Case({ seed: SEED, requestedPresetId: CASE_PRESET });
  let session = createV25Session({ caseData, mode: "reference", seed: SEED });
  for (const setup of setupTurns) {
    const result = await advanceV25Session({
      caseData,
      session,
      input: setup.text,
      options: options(setup.payload, undefined, false),
    });
    session = result.session;
  }

  const turns = [];
  for (const turn of definition.turns) {
    const result = await advanceV25Session({
      caseData,
      session,
      input: turn.text,
      options: options(emptyPayload, mentorLLM, true),
    });
    session = result.session;
    turns.push(splitTurn(result, turn));
  }
  return { ...definition, turns };
}

function blockquote(value, empty) {
  const text = String(value || "").trim();
  if (!text) return `> *(${empty})*`;
  return text
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
}

function renderReport(results) {
  const lines = [
    "# Живой прогон ментора · архетипы поведения",
    "",
    `**${new Date().toISOString().slice(0, 10)}** · кейс ${CASE_PRESET} · seed \`${SEED}\` · модель \`${model}\``,
    "",
    "Архетипы B, C, E, F и H из `ONQOL_MENTOR_BEHAVIOR_SPEC.md`, §22.",
    "Перед каждым сценарием отдельная сессия детерминированно доведена до решения по тому же кейсу; подготовительные ходы не вызывали ментора.",
    "Результаты ниже записаны дословно и не оценены.",
    "",
  ];

  for (const scenario of results) {
    lines.push(`## ${scenario.id} · ${scenario.title}`, "");
    for (const [index, turn] of scenario.turns.entries()) {
      if (scenario.turns.length > 1) lines.push(`### ${turn.label}`, "");
      lines.push("**Резидент:**", "", blockquote(turn.text, "нет реплики"), "");
      lines.push("**Движок:**", "", blockquote(turn.engineReply, "движок ничего не ответил"), "");
      const tags = [
        `mode: \`${turn.mode || "none"}\``,
        `source: \`${turn.source || "none"}\``,
        `починка: ${turn.repairAttempted ? "да" : "нет"}`,
        `отказ: ${turn.rejectionReasons.length ? turn.rejectionReasons.map((item) => `\`${item}\``).join(", ") : "нет"}`,
        `телеметрия: ${turn.telemetry.length ? turn.telemetry.map((item) => `\`${item}\``).join(", ") : "нет"}`,
      ];
      lines.push(`**Ментор** — ${tags.join(" · ")}`, "");
      lines.push(blockquote(turn.mentorText, "ментор не вмешивался"), "");
      lines.push(
        `<sub>policy: mode \`${turn.policy?.mode || "none"}\` · adequacy \`${turn.policy?.adequacy || "none"}\` · issue \`${turn.policy?.issue_id || "none"}\` · scaffolding \`${turn.policy?.scaffolding_level ?? "none"}\`</sub>`,
        ""
      );
    }
    lines.push("---", "");
  }

  lines.push(
    "*Сгенерировано `npm run ab:mentor:archetypes`. Файл фиксирует результат для чтения; автоматической оценки в нём нет.*"
  );
  return `${lines.join("\n")}\n`;
}

const results = [];
for (const scenario of scenarios) {
  console.log(`Прогон архетипа ${scenario.id}…`);
  results.push(await runScenario(scenario));
}

writeFileSync(REPORT_PATH, renderReport(results), "utf8");
console.log(`Отчёт: ${REPORT_PATH}`);

const measuredTurns = results.flatMap((scenario) => scenario.turns);
const failed = measuredTurns.filter(
  (turn) => turn.source !== "llm" || turn.rejectionReasons.includes("mentor_agent_error")
);
if (failed.length) {
  console.error(`Живой замер неполный: ${failed.length} реплик не пришли напрямую от модели.`);
  process.exitCode = 1;
}

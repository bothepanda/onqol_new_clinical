import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { buildV35Case } from "../src/clinical/v35/createCase.js";
import { advanceV25Session, createV25Session } from "../src/clinical/v25/engine.js";
import {
  appendicitisRouterConceptMap,
  resolveConcept,
} from "../src/clinical/diseases/appendicitis/router/conceptRegistry.js";
import { CLINICAL_REPORT_CATEGORIES } from "../src/clinical/governance/clinicalReport.js";
import {
  PILOT_RU_PHASE_LABELS,
  PILOT_RU_REPORT_UI,
  PILOT_RU_UI,
  pilotRuPhaseLabel,
} from "../src/pilot/ruRuntimeCopy.js";

const root = path.resolve(import.meta.dirname, "..");
export const REVIEW_PATH = path.join(root, "PILOT_RU_RUNTIME_COPY_REVIEW_2026-08-20.md");
export const SNAPSHOT_PATH = path.join(root, "PILOT_RU_RUNTIME_SNAPSHOTS_2026-08-20.json");

const ACTIVE_CASE_IDS = Object.freeze(["APP-001", "APP-002", "APP-003", "APP-004"]);
const FIXED_NOW = "2026-08-20T12:00:00.000+05:00";
const OLD_STATIC_UNIQUE_COUNT = 1364;
const OLD_NEEDS_OWNER_REVIEW_COUNT = 1006;

const source = Object.freeze({
  ui: ["src/pilot/ruRuntimeCopy.js", "src/V25Trainer.jsx"],
  report: ["src/pilot/ruRuntimeCopy.js", "src/clinical/governance/clinicalReport.js"],
  caseStart: [
    "src/clinical/v35/createCase.js",
    "src/clinical/v35/phenotypes.js",
    "src/clinical/v35/sessionSelector.js",
    "src/clinical/v25/engine.js",
  ],
  engine: ["src/clinical/v25/engine.js", "src/clinical/v25/turnPlanner.js"],
  findings: [
    "src/clinical/v25/engine.js",
    "src/clinical/v35/createCase.js",
    "src/clinical/v35/phenotypes.js",
    "src/clinical/v35/examSlots.js",
  ],
  mentor: [
    "src/clinical/v25/engine.js",
    "src/clinical/core/mentorBrief.js",
    "src/clinical/core/mentorAgent.js",
  ],
  order: ["src/clinical/core/operationalization.js", "src/clinical/v25/engine.js"],
  debrief: ["src/clinical/v25/debrief.js", "src/clinical/v25/engine.js"],
});

function normalize(text) {
  return String(text || "").replace(/\r\n/gu, "\n").trim();
}

function displayText(markdown) {
  return normalize(markdown)
    .replace(/^#{1,6}\s+/gmu, "")
    .replace(/\*\*([^*]+)\*\*/gu, "$1")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/^[-*]\s+/gmu, "• ");
}

function semanticBlocks(markdown) {
  return displayText(markdown)
    .split(/\n\s*\n/gu)
    .map(normalize)
    .filter(Boolean);
}

function reviewEntry({
  id,
  screen,
  runtimeState,
  text,
  sourceFiles,
  caseId = null,
  phase = null,
  note = null,
  status = "needs owner review",
}) {
  return Object.freeze({
    id,
    screen,
    runtime_state: runtimeState,
    case_id: caseId,
    phase,
    text: displayText(text),
    source_files: [...sourceFiles],
    status,
    note,
  });
}

function fixedUiEntries() {
  const reportCategories = CLINICAL_REPORT_CATEGORIES
    .map((entry) => `${entry.label_ru}: ${entry.hint_ru}.`)
    .join("\n");
  return [
    reviewEntry({
      id: "ui-start",
      screen: "Стартовый экран",
      runtimeState: "start",
      text: ["ON QOL", PILOT_RU_UI.subtitle, "РУС", PILOT_RU_UI.landingTitle, PILOT_RU_UI.landingBody].join("\n"),
      sourceFiles: source.ui,
    }),
    reviewEntry({
      id: "ui-consent",
      screen: "Согласие и конфиденциальность",
      runtimeState: "start / consent not accepted",
      text: [
        PILOT_RU_UI.pilotDataTitle,
        PILOT_RU_UI.pilotDataBody,
        PILOT_RU_UI.pilotDataRetention,
        PILOT_RU_UI.providerPolicyLink,
        PILOT_RU_UI.pilotDataRestriction,
        PILOT_RU_UI.pilotConsent,
      ].join("\n"),
      sourceFiles: source.ui,
    }),
    reviewEntry({
      id: "ui-access-code",
      screen: "Доступ к пилоту",
      runtimeState: "start / access required",
      text: [PILOT_RU_UI.accessCode, PILOT_RU_UI.accessCodePlaceholder, PILOT_RU_UI.accessCodeHelp].join("\n"),
      sourceFiles: source.ui,
    }),
    reviewEntry({
      id: "ui-mode",
      screen: "Выбор режима",
      runtimeState: "start / consent accepted / service ready",
      text: [PILOT_RU_UI.modeRegionLabel, PILOT_RU_UI.reference, PILOT_RU_UI.referenceBody].join("\n"),
      sourceFiles: source.ui,
      note: "В активном маршруте пилота отображается только REFERENCE-FULL; режим реального стационара отсутствует.",
    }),
    ...[
      ["ui-network-checking", "Проверка соединения", "start / service checking", PILOT_RU_UI.backendChecking],
      ["ui-network-ready", "Соединение установлено", "start / service ready", PILOT_RU_UI.backendReady],
      ["ui-network-code", "Требуется код", "start / access denied", PILOT_RU_UI.backendCodeRequired],
      ["ui-network-unavailable", "Сервис недоступен", "start / service unavailable", PILOT_RU_UI.backendUnavailable],
      ["ui-loading", "Ожидание ответа", "session / request pending", PILOT_RU_UI.loading],
      ["ui-error-retry", "Ошибка и повтор", "session / request failed", `${PILOT_RU_UI.requestError}\n${PILOT_RU_UI.retry}`],
    ].map(([id, screen, runtimeState, text]) => reviewEntry({ id, screen, runtimeState, text, sourceFiles: source.ui })),
    reviewEntry({
      id: "ui-session-chrome",
      screen: "Экран кейса",
      runtimeState: "session / in progress",
      text: [
        PILOT_RU_UI.alpha,
        PILOT_RU_UI.case,
        PILOT_RU_UI.referenceShort,
        PILOT_RU_UI.synthetic,
        PILOT_RU_UI.state,
        PILOT_RU_UI.clinicalTime,
        PILOT_RU_UI.phase,
        PILOT_RU_UI.actions,
        PILOT_RU_UI.noActions,
        PILOT_RU_UI.known,
        PILOT_RU_UI.hidden,
        PILOT_RU_UI.sessionCode,
        PILOT_RU_UI.sessionCodeHelp,
        PILOT_RU_UI.sessionData,
        PILOT_RU_UI.download,
        PILOT_RU_UI.placeholder,
        PILOT_RU_UI.send,
        PILOT_RU_UI.finish,
        PILOT_RU_UI.restart,
      ].join("\n"),
      sourceFiles: source.ui,
    }),
    reviewEntry({
      id: "ui-interrupt",
      screen: "Преждевременное прерывание",
      runtimeState: "session / interrupt confirmation",
      text: [PILOT_RU_UI.finishConfirm, PILOT_RU_UI.cancel, PILOT_RU_UI.finishConfirmAction].join("\n"),
      sourceFiles: source.ui,
    }),
    reviewEntry({
      id: "ui-report-dialog",
      screen: "Сообщение о клинической ошибке",
      runtimeState: "session / report dialog",
      text: [
        PILOT_RU_REPORT_UI.title,
        PILOT_RU_REPORT_UI.lead,
        PILOT_RU_REPORT_UI.category,
        PILOT_RU_REPORT_UI.role,
        PILOT_RU_REPORT_UI.comment,
        PILOT_RU_REPORT_UI.commentPlaceholder,
        PILOT_RU_REPORT_UI.disputed,
        PILOT_RU_REPORT_UI.disputedPlaceholder,
        PILOT_RU_REPORT_UI.submit,
        PILOT_RU_REPORT_UI.cancel,
      ].join("\n"),
      sourceFiles: source.report,
    }),
    reviewEntry({
      id: "ui-report-categories",
      screen: "Категории клинической ошибки",
      runtimeState: "session / report category selection",
      text: reportCategories,
      sourceFiles: source.report,
    }),
    reviewEntry({
      id: "ui-report-saved",
      screen: "Сообщение сохранено",
      runtimeState: "session / report saved",
      text: [PILOT_RU_REPORT_UI.saved, PILOT_RU_REPORT_UI.exportQueue].join("\n"),
      sourceFiles: source.report,
    }),
  ];
}

function routerFixture(intents = [], reasoning = null) {
  return async () => JSON.stringify({ intents, unresolved_fragments: [], action_parameters: [], reasoning });
}

const invalidServiceResponse = async () => "not valid structured output";

function runtimeOptions(intents = [], reasoning = null) {
  return {
    locale: "ru",
    actionExtractorLLM: routerFixture(intents, reasoning),
    simulatorLLM: invalidServiceResponse,
    mentorLLM: invalidServiceResponse,
    provider: "openai",
    model: "pilot-runtime-fixture",
    routerModel: "pilot-runtime-fixture",
    mentorModel: "pilot-runtime-fixture",
    mentor: true,
    conceptMap: appendicitisRouterConceptMap,
    conceptRegistry: resolveConcept,
  };
}

function createPilotSession(caseData, seed, suffix = "main") {
  return createV25Session({
    caseData,
    mode: "reference",
    seed,
    locale: "ru",
    sessionId: `snapshot-${suffix}-${seed}`,
    sessionCode: `SNAP-${suffix.toUpperCase()}`,
    startedAt: FIXED_NOW,
    learnerId: "anon:pilot-review-fixture",
    institutionId: "synthetic-pilot",
    cohortId: "N8-RU-REFERENCE",
    participantConsent: {
      accepted: true,
      policy_version: "pilot-data-notice-2026-08-20",
      accepted_at: FIXED_NOW,
      provider_processing_disclosed: true,
      provider_default_abuse_log_retention_days: 30,
      local_retention_days: 7,
    },
  });
}

function assertScopedRuntime(built, session) {
  const caseId = built.selection.case_preset_id;
  if (!ACTIVE_CASE_IDS.includes(caseId)) throw new Error(`Inactive case reached review: ${caseId}`);
  if (session.locale !== "ru") throw new Error(`Non-RU locale reached review: ${session.locale}`);
  if (session.scenario.mode !== "reference") throw new Error("Real facility mode reached RU review.");
  if (session.scenario.effectiveResourceProfileId !== "REFERENCE-FULL") {
    throw new Error(`Unexpected resource profile: ${session.scenario.effectiveResourceProfileId}`);
  }
  if (session.scoring?.mode === "numeric") throw new Error("Numeric scoring reached RU review.");
}

function findReachableCases() {
  const found = new Map();
  for (let index = 0; index < 2000 && found.size < ACTIVE_CASE_IDS.length; index += 1) {
    const seed = `pilot-ru-review-${index}`;
    const built = buildV35Case({ seed, locale: "ru", mode: "learner" });
    const caseId = built.selection.case_preset_id;
    if (ACTIVE_CASE_IDS.includes(caseId) && !found.has(caseId)) found.set(caseId, { seed, built });
  }
  const missing = ACTIVE_CASE_IDS.filter((caseId) => !found.has(caseId));
  if (missing.length) throw new Error(`No learner-route seed found for: ${missing.join(", ")}`);
  return found;
}

async function advance(caseData, session, input, intents = [], reasoning = null) {
  return advanceV25Session({ caseData, session, input, options: runtimeOptions(intents, reasoning) });
}

function runtimeEntry({ id, screen, result, caseId, sourceFiles, note = null }) {
  return reviewEntry({
    id,
    screen,
    runtimeState: result.session.finished ? "complete" : result.session.pathState,
    caseId,
    phase: pilotRuPhaseLabel(result.session.pathState || result.session.phase),
    text: result.reply,
    sourceFiles,
    note,
  });
}

async function caseStartAndFindingEntries(reachableCases) {
  const entries = [];
  for (const caseId of ACTIVE_CASE_IDS) {
    const { seed, built } = reachableCases.get(caseId);
    const { caseData } = built;
    let session = createPilotSession(caseData, seed, caseId.toLowerCase());
    assertScopedRuntime(built, session);
    entries.push(reviewEntry({
      id: `${caseId.toLowerCase()}-start`,
      screen: `Начало ${caseId}`,
      runtimeState: session.pathState,
      caseId,
      phase: pilotRuPhaseLabel(session.pathState),
      text: `${caseData.title}\n${session.messages[0].content}`,
      sourceFiles: source.caseStart,
      note: `Воспроизводимый код сценария: ${seed}; способ выбора: ${built.selection.selection_method}.`,
    }));
    const history = await advance(caseData, session, "Собираю полный анамнез.", [
      { type: "request_history", concept_id: "focused_history", confidence: 0.99 },
    ]);
    session = history.session;
    entries.push(runtimeEntry({ id: `${caseId.toLowerCase()}-history`, screen: `${caseId}: анамнез`, result: history, caseId, sourceFiles: source.findings }));
    const examination = await advance(caseData, session, "Провожу полный осмотр живота.", [
      { type: "request_examination", concept_id: "abdominal_exam", confidence: 0.99 },
    ]);
    entries.push(runtimeEntry({ id: `${caseId.toLowerCase()}-examination`, screen: `${caseId}: осмотр`, result: examination, caseId, sourceFiles: source.findings }));
  }
  return entries;
}

async function stablePathEntries(reachableCases) {
  const { seed, built } = reachableCases.get("APP-002");
  const { caseData } = built;
  const caseId = "APP-002";
  let session = createPilotSession(caseData, seed, "stable-path");
  const entries = [];
  const step = async ({ id, screen, input, intents = [], reasoning = null, expectedState, sourceFiles = source.engine, note = null }) => {
    const result = await advance(caseData, session, input, intents, reasoning);
    session = result.session;
    if (expectedState && session.pathState !== expectedState) throw new Error(`${id}: expected ${expectedState}, received ${session.pathState}`);
    entries.push(runtimeEntry({ id, screen, result, caseId, sourceFiles, note }));
    return result;
  };

  await step({
    id: "phase-primary-assessment",
    screen: "Первичная оценка",
    input: "По имеющимся данным пациентка стабильна.",
    reasoning: { stability: { stated: true, learner_assessment: "stable" } },
    expectedState: "primary_assessment",
    sourceFiles: source.mentor,
    note: "Сообщение наставника получено по активному маршруту после проверки ответа сервиса.",
  });
  await step({ id: "phase-data-gathering", screen: "Сбор данных", input: "Собираю полный анамнез.", intents: [{ type: "request_history", concept_id: "focused_history", confidence: 0.99 }], expectedState: "data_gathering", sourceFiles: source.findings });
  const differentialText = "Женщина с острой болью справа внизу живота; вероятнее аппендицит, опасно пропустить внематочную беременность.";
  await step({
    id: "phase-differential",
    screen: "Дифференциальный ряд",
    input: differentialText,
    reasoning: {
      problem_representation: { stated: true, verbatim: differentialText },
      differential: {
        stated: true,
        ranked: true,
        has_dangerous_alternative: true,
        items: [
          { concept_id: "diagnosis_acute_appendicitis", rank: 1, dangerous: false, evidence_for: [], evidence_against: [] },
          { concept_id: "differential_ectopic", rank: 2, dangerous: true, evidence_for: [], evidence_against: [] },
        ],
      },
    },
    expectedState: "differential_1",
    sourceFiles: source.mentor,
  });
  await step({ id: "phase-tests", screen: "Исследования и результаты", input: "Назначаю общий анализ крови.", intents: [{ type: "request_test", concept_id: "cbc", confidence: 0.99 }], expectedState: "tests_and_treatment", sourceFiles: source.findings });
  await step({ id: "phase-reassessment", screen: "Переоценка", input: "Повторно осматриваю живот через 30 минут.", intents: [{ type: "request_examination", concept_id: "serial_reexamination", confidence: 0.99 }], expectedState: "reassessment", sourceFiles: source.findings });
  await step({
    id: "phase-decision",
    screen: "Клиническое решение",
    input: "Рабочий диагноз — острый аппендицит.",
    intents: [{ type: "diagnosis", concept_id: "diagnosis_acute_appendicitis", confidence: 0.99 }],
    reasoning: { working_diagnosis: { stated: true, concept_id: "diagnosis_acute_appendicitis", uncertainty_stated: false } },
    expectedState: "decision",
    sourceFiles: source.mentor,
  });
  await step({ id: "premature-discharge", screen: "Преждевременная выписка", input: "Выписываю пациентку с рекомендациями.", intents: [{ type: "management", concept_id: "discharge_and_followup", confidence: 0.99 }] });
  const sessionBeforeOrderClarification = session;
  await step({ id: "order-clarification", screen: "Уточнение назначения", input: "Обезболю пациентку.", intents: [{ type: "management", concept_id: "analgesia", confidence: 0.99 }], sourceFiles: source.order });
  session = sessionBeforeOrderClarification;
  await step({
    id: "phase-preop",
    screen: "Подготовка к операции",
    input: "Получаю согласие, уведомляю анестезиолога и операционную, провожу проверку безопасности и антибиотикопрофилактику.",
    intents: [
      { type: "management", concept_id: "informed_consent", confidence: 0.99 },
      { type: "management", concept_id: "notify_anesthesia", confidence: 0.99 },
      { type: "management", concept_id: "notify_operating_team", confidence: 0.99 },
      { type: "management", concept_id: "who_sign_in", confidence: 0.99 },
      { type: "management", concept_id: "who_time_out", confidence: 0.99 },
      { type: "management", concept_id: "preop_single_antibiotic_prophylaxis", confidence: 0.99 },
    ],
    expectedState: "preop",
  });
  await step({ id: "operation-approach", screen: "Выбор операционного доступа", input: "Выбираю лапароскопический доступ.", intents: [{ type: "management", concept_id: "operative_approach_laparoscopic", confidence: 0.99 }] });
  await step({ id: "operation-start", screen: "Начало операции", input: "Начинаю операцию.", intents: [{ type: "management", concept_id: "appendectomy_procedure_start", confidence: 0.99 }] });
  await step({ id: "phase-operation", screen: "Контроль источника", input: "Аппендэктомия выполнена, контроль источника завершён.", intents: [{ type: "management", concept_id: "appendectomy_here", confidence: 0.99 }], expectedState: "operation", sourceFiles: source.findings });
  await step({ id: "phase-postop-destination", screen: "Послеоперационный маршрут", input: "Передаю пациентку из операционной в хирургическое отделение.", intents: [{ type: "management", concept_id: "structured_handover", confidence: 0.99 }], expectedState: "postop_destination" });
  await step({ id: "phase-ward-care", screen: "Послеоперационное наблюдение", input: "Контролирую после операции показатели, боль, живот, диурез, питание и рану.", intents: [{ type: "management", concept_id: "active_observation", confidence: 0.99 }], expectedState: "ward_care" });
  await step({ id: "phase-discharge", screen: "Выписка и дальнейшее наблюдение", input: "Фиксирую готовность к выписке, лекарства, инструкции, дальнейшее наблюдение и критерии возврата.", intents: [{ type: "management", concept_id: "discharge_and_followup", confidence: 0.99 }], expectedState: "discharge" });

  const completed = await advance(caseData, session, "конец кейса", [], null);
  if (completed.session.pathState !== "complete" || completed.session.terminal_status !== "completed") throw new Error("Stable path did not reach a completed formative debrief.");
  semanticBlocks(completed.reply).forEach((text, index) => {
    entries.push(reviewEntry({
      id: `debrief-${String(index + 1).padStart(2, "0")}`,
      screen: "Формирующий разбор",
      runtimeState: "complete",
      caseId,
      phase: pilotRuPhaseLabel("complete"),
      text,
      sourceFiles: source.debrief,
      note: index === 0 ? "Числовая оценка отключена; блок получен из завершённой сессии." : null,
    }));
  });
  return entries;
}

function exclusionRows() {
  return [
    ["Словари распознавания и конфигурация сопоставления", "Внутренние данные распознавания; в интерфейсе не отображаются."],
    ["Внутренние инструкции сервисов и спецификация наставника", "Управляют работой системы и не являются текстом интерфейса."],
    ["Казахская сессия", "Язык пилота — русский; переключатель отсутствует."],
    ["Реальный стационар и казахстанские профили ресурсов", "Маршрут пилота принудительно использует REFERENCE-FULL."],
    ["APP-005, осложнения и альтернативные заболевания", "Эти ветви не активны для участника в заданном объёме пилота."],
    ["Числовая оценка и полный тестовый режим", "Пилот формирующий; внутренний тестовый маршрут не используется."],
    ["Резервный локальный ответ без сервиса", "Начало пилотной сессии закрыто до успешной проверки сервиса."],
    ["Заметки ревьюеров, сведения об источниках, телеметрия и CI", "Участнику не отображаются."],
  ].map(([scopeName, note]) => ({ scope: scopeName, status: "not applicable", note }));
}

export async function buildPilotRuRuntimeReview() {
  const reachableCases = findReachableCases();
  const entries = [...fixedUiEntries(), ...(await caseStartAndFindingEntries(reachableCases)), ...(await stablePathEntries(reachableCases))];
  const ids = new Set();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new Error(`Duplicate review entry id: ${entry.id}`);
    ids.add(entry.id);
    if (!entry.text) throw new Error(`Empty learner text in ${entry.id}`);
  }
  return {
    schema_version: "pilot-ru-runtime-snapshots-v2.0",
    generated_for_date: "2026-08-20",
    scope: {
      locale: "ru",
      case_preset_ids: [...ACTIVE_CASE_IDS],
      cohort: "N=8 residents",
      resource_profile: "REFERENCE-FULL",
      real_facility_mode: false,
      scoring_mode: "formative_only",
      production_review_id: "ONQOL-REFERENCE-FULL-20260820",
    },
    reachability: {
      method: "learner-mode seeds plus createV25Session(reference) and advanceV25Session integration fixtures; invalid service envelopes exercise the active validated fallback path",
      case_seeds: Object.fromEntries(ACTIVE_CASE_IDS.map((caseId) => [caseId, reachableCases.get(caseId).seed])),
    },
    counts: {
      previous_static_unique_strings: OLD_STATIC_UNIQUE_COUNT,
      previous_needs_owner_review: OLD_NEEDS_OWNER_REVIEW_COUNT,
      runtime_review_entries: entries.length,
      unique_rendered_text_blocks: new Set(entries.map((entry) => entry.text)).size,
    },
    entries,
    exclusions: exclusionRows(),
  };
}

function escapeTable(value) {
  return String(value || "").replaceAll("|", "\\|").replaceAll("\n", "<br>");
}

function sectionTable(entries) {
  return [
    "| Экран / состояние | Кейс / этап | Фактически отображаемый русский текст | Исходный файл | Статус | Примечание |",
    "| --- | --- | --- | --- | --- | --- |",
    ...entries.map((entry) => `| ${entry.screen}<br>\`${entry.runtime_state}\` | ${entry.case_id ? `${entry.case_id}<br>${entry.phase || "-"}` : "Общий интерфейс"} | ${escapeTable(entry.text)} | ${entry.source_files.map((file) => `\`${file}\``).join("<br>")} | \`${entry.status}\` | ${escapeTable(entry.note || "")} |`),
  ].join("\n");
}

export function renderReviewMarkdown(review) {
  const common = review.entries.filter((entry) => !entry.case_id);
  const caseStarts = review.entries.filter((entry) => /^app-00[1-4]-(?:start|history|examination)$/u.test(entry.id));
  const activeRuntime = review.entries.filter((entry) => entry.case_id && !caseStarts.includes(entry));
  const exclusions = [
    "| Элемент | Статус | Почему не входит |",
    "| --- | --- | --- |",
    ...review.exclusions.map((entry) => `| ${entry.scope} | \`${entry.status}\` | ${entry.note} |`),
  ].join("\n");
  return `# ON QOL · проверка фактически отображаемого русского текста

**Дата:** 20.08.2026

**Объём:** APP-001–APP-004; русский язык; \`REFERENCE-FULL\`; режим реального стационара отключён; N=8 резидентов

**Идентификатор проверки:** \`ONQOL-REFERENCE-FULL-20260820\`

**Статус допуска:** \`ru_language_review = pending\`

## Как сформирован пакет

Пакет больше не собирается простым поиском строк по исходному коду. Стартовые
экраны используют тот же модуль русского текста, что и рабочий интерфейс.
Для каждого кейса найден воспроизводимый код сценария; далее кейс пройден через
\`createV25Session(... mode: "reference")\` и \`advanceV25Session\`. Тестовая
проверка намеренно передаёт некорректный ответ внешнего сервиса, чтобы получить
собственную проверяемую резервную формулировку активного маршрута, а не заранее
написанную строку теста.

До фильтрации пакет содержал **${review.counts.previous_static_unique_strings}**
уникальных статических строк, включая **${review.counts.previous_needs_owner_review}**
строк, требовавших решения владельца. После проверки достижимости осталось
**${review.counts.runtime_review_entries}** записей и
**${review.counts.unique_rendered_text_blocks}** уникальных отображаемых
текстовых блоков. Структурированные снимки:
\`PILOT_RU_RUNTIME_SNAPSHOTS_2026-08-20.json\`.

Статус \`approved\` намеренно не проставлен: решение владельца ещё не записано.
Все отображаемые блоки остаются \`needs owner review\`; исключённые ветви имеют
\`not applicable\`.

## Общий интерфейс

${sectionTable(common)}

## Начало APP-001–APP-004 и результаты обследования

${sectionTable(caseStarts)}

## Основные фазы, наставник, ошибки маршрута и завершение

${sectionTable(activeRuntime)}

## Не применимо к этому пилоту

${exclusions}

## Решение владельца

**Ревьюер:** _________________________________________________

**Роль:** ____________________________________________________

**Решение:** одобрено / одобрено с условиями / отклонено

**Дата:** ____________________________________________________

**Подпись:** _________________________________________________

**Комментарии:**



До заполнения этого блока \`pilotReleaseApprovals.js\` сохраняет
\`ru_language_review.status = "pending"\`.
`;
}

export function renderSnapshotJson(review) {
  return `${JSON.stringify(review, null, 2)}\n`;
}

export async function writeOrCheckArtifacts({ check = false } = {}) {
  const review = await buildPilotRuRuntimeReview();
  const outputs = [[REVIEW_PATH, renderReviewMarkdown(review)], [SNAPSHOT_PATH, renderSnapshotJson(review)]];
  if (check) {
    const stale = outputs.filter(([filePath, content]) => !fs.existsSync(filePath) || fs.readFileSync(filePath, "utf8") !== content);
    if (stale.length) throw new Error(`RU runtime review artifacts are stale: ${stale.map(([filePath]) => path.relative(root, filePath)).join(", ")}`);
    return review;
  }
  for (const [filePath, content] of outputs) fs.writeFileSync(filePath, content, "utf8");
  return review;
}

async function main() {
  try {
    const check = process.argv.includes("--check");
    const review = await writeOrCheckArtifacts({ check });
    process.stdout.write(`${check ? "Verified" : "Wrote"} RU runtime review: ${review.counts.runtime_review_entries} entries, ${review.counts.unique_rendered_text_blocks} unique rendered blocks.\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

#!/usr/bin/env node
/**
 * A/B harness for the mentor rework (base rules v2, migration step 1).
 *
 *   npm run ab:mentor            offline: no model call, template voice
 *   npm run ab:mentor -- --live  calls the configured mentor model
 *   npm run ab:mentor -- --json  machine-readable output
 *
 * PATH A is not a re-run of the old code. It is the session that actually
 * happened: the assistant replies frozen in replay-91ba7206.json, produced by
 * V3.5 on 19.08.2026. Comparing against a reconstruction of the old pipeline
 * would compare against a reconstruction; this compares against the evening the
 * learner walked out.
 *
 * PATH B replays the same learner turns and the same recorded router output
 * through the current code. Offline it exercises everything except the mentor's
 * voice - the prerequisite closure, the loop, the non-answers, the telemetry -
 * and the mentor column shows the deterministic fallback, which is what a pilot
 * without a gateway would see. With --live it also exercises the voice, the
 * post-checks and the repair loop against the real model.
 *
 * The world is identical in both columns by construction: the case is rebuilt
 * from the frozen seed and preset, and no path may add a patient fact.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { buildV35Case } from "../src/clinical/v35/createCase.js";
import { advanceV25Session, createV25Session } from "../src/clinical/v25/engine.js";
import { buildMentorTelemetry } from "../src/clinical/v25/replayExport.js";
import { replay91baRouter } from "../src/clinical/__tests__/fixtures/replay91baRouter.js";
import {
  appendicitisRouterConceptMap,
  resolveConcept,
} from "../src/clinical/diseases/appendicitis/router/conceptRegistry.js";
import { DEFAULT_MODELS } from "../server/openaiGateway.mjs";
import { DETERMINISTIC_SHARE_LIMIT, harnessVerdict } from "./abMentorVerdict.mjs";
import { repeatedEngineBlocks } from "./abMentorMetrics.mjs";

const args = new Set(process.argv.slice(2));
const live = args.has("--live");
const asJson = args.has("--json");

const FIXTURE_URL = new URL("../src/clinical/__tests__/fixtures/replay-91ba7206.json", import.meta.url);
const fixture = JSON.parse(readFileSync(FIXTURE_URL, "utf8"));

// The two strings the pilot must never see again, and the acceptance criteria
// from CLAUDE_CODE_TASK_BASE_RULES_V2.md.
const FORBIDDEN = [
  "Эти данные не заданы в карте пациента.",
  "Не распознано:",
];

/**
 * Which models this run actually uses.
 *
 * Resolved here rather than left to `buildOpenAIRequest`, because that function
 * only falls back to DEFAULT_MODELS when the whole `models` object is omitted.
 * Passing `{ mentor: undefined }` - which is what `env.X || undefined` produces
 * for an unset variable - overrode the default with nothing, sent
 * `model: undefined` to the provider, and turned every turn into a transport
 * error. The run then reported the resulting templates as its result.
 */
function resolveModels() {
  return {
    router: process.env.OPENAI_ROUTER_MODEL || DEFAULT_MODELS.router,
    simulator: process.env.OPENAI_SIMULATOR_MODEL || DEFAULT_MODELS.simulator,
    mentor: process.env.OPENAI_MENTOR_MODEL || DEFAULT_MODELS.mentor,
  };
}

const models = resolveModels();

async function mentorLLM() {
  if (!live) return null;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("--live needs OPENAI_API_KEY in the environment.");
    process.exit(2);
  }
  const { requestOpenAI } = await import("../server/openaiGateway.mjs");
  return async (prompt) => {
    const { output } = await requestOpenAI({ apiKey, task: "mentor", prompt, models });
    return output;
  };
}

function learnerTurns() {
  return fixture.transcript.filter((entry) => entry.role === "user").map((entry) => entry.content);
}

/** Path A: what the trainer said that evening, straight out of the fixture. */
function recordedPath() {
  const turns = [];
  let pending = null;
  for (const entry of fixture.transcript) {
    if (entry.role === "user") {
      pending = { learner: entry.content, reply: "" };
      turns.push(pending);
    } else if (pending) {
      pending.reply = pending.reply ? `${pending.reply}\n\n${entry.content}` : entry.content;
    }
  }
  return turns;
}

/** Path B: the same learner turns through the current engine. */
async function currentPath(llm) {
  const { caseData } = buildV35Case({
    seed: fixture.effective_seed,
    requestedPresetId: fixture.case_preset_id,
  });
  let session = createV25Session({
    caseData,
    mode: fixture.mode,
    seed: fixture.effective_seed,
  });
  const turns = [];
  for (const learner of learnerTurns()) {
    const result = await advanceV25Session({
      caseData,
      session,
      input: learner,
      options: {
        mentor: true,
        mentorLLM: llm || undefined,
        actionExtractorLLM: replay91baRouter,
        conceptMap: appendicitisRouterConceptMap,
        conceptRegistry: resolveConcept,
      },
    });
    session = result.session;
    // The engine appends the mentor's line to its own reply before returning, so
    // the two are split back apart here. A reader comparing the mentor's voice
    // against the mockup needs to see what the mentor said, not the concatenation.
    const mentorText = result.mentor?.text || "";
    const engineOnly =
      mentorText && result.reply?.endsWith(mentorText)
        ? result.reply.slice(0, -mentorText.length).trim()
        : result.reply;
    turns.push({
      learner,
      reply: result.reply,
      engineReply: engineOnly,
      mentorText,
      mentor: result.mentor
        ? {
            mode: result.mentor.mode,
            source: result.mentor.source,
            rejectionReasons: result.mentor.rejectionReasons || [],
            repairAttempted: Boolean(result.mentor.repairAttempted),
            telemetry: result.mentor.telemetry || [],
          }
        : null,
      shadow: result.mentorPolicy
        ? { mode: result.mentorPolicy.mode, issue_id: result.mentorPolicy.issue_id }
        : null,
      pathState: session.pathState,
      sourceControl: Boolean(session.temporalState?.sourceControl),
      procedureStarted: Boolean(session.workingMemory?.operativeState?.procedure_started),
    });
  }
  return { turns, session, telemetry: buildMentorTelemetry(session) };
}

/**
 * Is the path to theatre actually open, and after how many turns?
 *
 * The recorded learner never said "начинаю операцию" - she gave up on turn 7 -
 * so the acceptance criterion "reaches theatre in <=6 turns" cannot be read off
 * her transcript. This replays her turns and then asks for the operation, which
 * answers the question the criterion was really asking: is anything still in
 * the way, and what.
 */
async function theatreProbe() {
  const { caseData } = buildV35Case({
    seed: fixture.effective_seed,
    requestedPresetId: fixture.case_preset_id,
  });
  let session = createV25Session({
    caseData,
    mode: fixture.mode,
    seed: fixture.effective_seed,
  });
  const options = {
    mentor: true,
    actionExtractorLLM: replay91baRouter,
    conceptMap: appendicitisRouterConceptMap,
    conceptRegistry: resolveConcept,
  };
  const recorded = learnerTurns();
  for (let index = 0; index < recorded.length; index += 1) {
    const result = await advanceV25Session({
      caseData,
      session,
      input: recorded[index],
      options,
    });
    session = result.session;
    let probe = await advanceV25Session({
      caseData,
      session,
      input: "начинаю операцию",
      options: {
        ...options,
        actionExtractorLLM: () =>
          JSON.stringify({
            intents: [
              {
                type: "management",
                concept_id: "procedure_start",
                confidence: 0.99,
                requested_fragment: "начинаю операцию",
              },
            ],
            unresolved_fragments: [],
            action_parameters: [],
          }),
      },
    });
    let mentorGates = 0;
    while (
      mentorGates < 2 &&
      !probe.session.workingMemory?.operativeState?.procedure_started &&
      probe.session.actionLog.findLast(
        (entry) => entry.action_id === "appendectomy_procedure_start"
      )?.action_decision === "mentor_gate_held"
    ) {
      mentorGates += 1;
      probe = await advanceV25Session({
        caseData,
        session: probe.session,
        input: "начинаю операцию",
        options: {
          ...options,
          actionExtractorLLM: () =>
            JSON.stringify({
              intents: [
                {
                  type: "management",
                  concept_id: "procedure_start",
                  confidence: 0.99,
                  requested_fragment: "начинаю операцию",
                },
              ],
              unresolved_fragments: [],
              action_parameters: [],
            }),
        },
      });
    }
    if (probe.session.workingMemory?.operativeState?.procedure_started) {
      return { turn: index + 2 + mentorGates, blocked: null, mentor_gates: mentorGates };
    }
    if (index === recorded.length - 1) {
      return {
        turn: null,
        blocked: (probe.plan?.prerequisiteWarnings || [])
          .map((warning) => warning.missing)
          .concat(
            (probe.blockedOperations || []).map((operation) => operation.reason_id || "pathway")
          ),
        reply: probe.reply,
      };
    }
  }
  return { turn: null, blocked: [] };
}

function repeatedQuestions(turns) {
  const seen = new Map();
  const repeats = [];
  for (const [index, turn] of turns.entries()) {
    for (const question of String(turn.reply).match(/[^.!?\n]*\?/g) || []) {
      const key = question.trim();
      if (!key) continue;
      if (seen.has(key)) repeats.push({ question: key, first: seen.get(key), again: index + 1 });
      else seen.set(key, index + 1);
    }
  }
  return repeats;
}

function forbiddenHits(turns) {
  return turns.flatMap((turn, index) =>
    FORBIDDEN.filter((needle) => String(turn.reply).includes(needle)).map((needle) => ({
      turn: index + 1,
      needle,
    }))
  );
}

function box(title) {
  return `\n${"=".repeat(78)}\n${title}\n${"=".repeat(78)}`;
}

function printTranscripts(a, b) {
  console.log(box("ТРАНСКРИПТЫ — реплей 91ba7206, кейс APP-003"));
  const count = Math.max(a.length, b.length);
  for (let index = 0; index < count; index += 1) {
    const learner = a[index]?.learner || b[index]?.learner;
    console.log(`\n──── ХОД ${index + 1} ────`);
    console.log(`РЕЗИДЕНТ: ${learner}`);
    console.log(`\n[A] V3.5, как было (запись сессии):\n${a[index]?.reply || "(нет хода)"}`);
    const mentor = b[index]?.mentor;
    const tag = mentor
      ? ` [mentor ${mentor.mode}/${mentor.source}${mentor.repairAttempted ? "/repaired" : ""}${
          mentor.rejectionReasons.length ? `/${mentor.rejectionReasons.join(",")}` : ""
        }]`
      : "";
    console.log(`\n[B] текущий код${live ? " + модель" : " (без модели)"}${tag}:\n${b[index]?.reply || "(нет хода)"}`);
  }
}

function printStats(a, b, telemetry, probe) {
  console.log(box("СТАТИСТИКА"));
  const rows = [
    ["ходов", a.length, b.turns.length],
    ["запрещённых строк", forbiddenHits(a).length, forbiddenHits(b.turns).length],
    ["дословных повторов вопроса", repeatedQuestions(a).length, repeatedQuestions(b.turns).length],
    ["дословных повторов движка", repeatedEngineBlocks(a).length, repeatedEngineBlocks(b.turns).length],
    ["дошли до операционной сами", "нет (сессия брошена)", b.turns.some((turn) => turn.procedureStarted || turn.sourceControl) ? "да" : "нет"],
  ];
  console.log(["", "A (запись)", "B (текущий код)"].map((cell) => String(cell).padEnd(28)).join(""));
  for (const row of rows) {
    console.log(row.map((cell) => String(cell).padEnd(28)).join(""));
  }

  console.log("\nМентор, путь B:");
  // Printed first and always: "the run measured something other than we thought"
  // must never again be invisible.
  console.log(
    `  модель в запросе:      ${live ? models.mentor : "не вызывалась (прогон без модели)"}`
  );
  console.log(`  реплик ментора:        ${telemetry.summary.mentor_turns}`);
  console.log(`  из модели:             ${telemetry.summary.from_model}`);
  console.log(`  из шаблона:            ${telemetry.summary.from_template}`);
  console.log(`  промолчал:             ${telemetry.summary.from_silence || 0}`);
  console.log(`  с починкой:            ${telemetry.summary.repaired}`);
  console.log(`  совпало с регекс-policy: ${telemetry.summary.policy_agreement}`);
  const reasons = Object.entries(telemetry.summary.rejection_reasons);
  console.log(
    `  rejectionReason:       ${reasons.length ? reasons.map(([k, v]) => `${k}×${v}`).join(", ") : "нет"}`
  );
  const flags = [...new Set(telemetry.turns.flatMap((turn) => turn.telemetry_flags))];
  if (flags.length) console.log(`  телеметрия:            ${flags.join(", ")}`);

  console.log("\nПуть в операционную (зонд «начинаю операцию» после каждого хода):");
  if (probe.turn) {
    console.log(`  ✓ операция начинается с хода ${probe.turn} — путь открыт, ничего не мешает`);
  } else {
    console.log(`  ✗ операция не начинается ни на одном ходе. Блокирует: ${probe.blocked.join(", ") || "неизвестно"}`);
    if (probe.reply) console.log(`    последний ответ: ${probe.reply.split("\n")[0]}`);
  }

  for (const hit of forbiddenHits(b.turns)) {
    console.log(`\n  ✗ ход ${hit.turn}: «${hit.needle}» всё ещё в ответе резиденту`);
  }
  for (const repeat of repeatedQuestions(b.turns)) {
    console.log(`\n  ✗ вопрос повторён дословно (ходы ${repeat.first} и ${repeat.again}): «${repeat.question}»`);
  }
  for (const repeat of repeatedEngineBlocks(b.turns)) {
    console.log(`\n  ✗ блок движка повторён дословно (ходы ${repeat.first} и ${repeat.again}): «${repeat.block}»`);
  }
  if (!live) {
    console.log(
      "\n  ! Прогон без модели: колонка B показывает детерминированный фолбэк, а не голос ментора."
    );
    console.log("    Для сравнения голоса: OPENAI_API_KEY=... npm run ab:mentor -- --live");
  }
}

/**
 * A run written out for a person to read, not a machine to parse.
 *
 * The point is one comparison that has never been made: the mentor's live voice
 * against the evening of 91ba7206 and against the mockup. So every turn shows
 * the learner's words, what the engine answered, and what the mentor said - in
 * full, unedited, with the mode and the source beside it. Nothing here judges
 * the quality of a reply; that is the reader's job.
 */
function reportMarkdown({ a, b, telemetry, verdict, probe }) {
  const summary = telemetry.summary;
  const reasons = Object.entries(summary.rejection_reasons);
  const lines = [];

  lines.push(`# ${live ? "Живой" : "Офлайн"} прогон ментора · фикстура 91ba7206`);
  lines.push("");
  lines.push(`**${new Date().toISOString().slice(0, 10)}** · кейс APP-003 · seed \`${fixture.effective_seed}\``);
  lines.push("");
  lines.push(
    live
      ? "Сравнение живого голоса ментора с записью 91ba7206."
      : "Проверка детерминированной логики на записи 91ba7206; живой голос здесь не измеряется."
  );
  lines.push("До 20.08.2026 харнесс сравнивал шаблоны с шаблонами: имя модели не доходило");
  lines.push("до запроса, и все реплики откатывались на детерминированный рендер.");
  lines.push("");
  lines.push("Здесь ничего не оценено и не прокомментировано. Читать глазами и сравнивать");
  lines.push("с `onqol-mentor-ab-mockup.html` и записями V12–V14.");
  lines.push("");
  lines.push("## Чем мерили");
  lines.push("");
  lines.push("| | |");
  lines.push("|---|---|");
  lines.push(`| Модель ментора | ${live ? `\`${models.mentor}\`` : "не вызывалась"} |`);
  const spokeAloud = b.filter((turn) => turn.mentorText).length;
  lines.push(`| Решений ментора | ${summary.mentor_turns} из ${b.length} ходов |`);
  lines.push(`| Из них с текстом | ${spokeAloud} — остальные \`CONTINUE\`, режим молчания |`);
  lines.push(`| Из модели | **${summary.from_model}** |`);
  lines.push(`| Из шаблона | ${summary.from_template} |`);
  lines.push(`| Промолчал (реплика не прошла) | ${summary.from_silence || 0} |`);
  lines.push(`| Доля шаблонов | ${verdict.share === null ? "—" : `${Math.round(verdict.share * 100)}%`} |`);
  lines.push(`| Отклонений | ${reasons.length ? reasons.map(([k, v]) => `\`${k}\`×${v}`).join(", ") : "нет"} |`);
  lines.push(`| Починок | ${summary.repaired} |`);
  lines.push(`| Дословных повторов вопроса | ${repeatedQuestions(b).length} |`);
  lines.push(`| Дословных повторов движка | ${repeatedEngineBlocks(b).length} |`);
  lines.push(`| Совпало с детерминированной политикой | ${summary.policy_agreement} из ${summary.mentor_turns} |`);
  const flags = [...new Set(telemetry.turns.flatMap((turn) => turn.telemetry_flags))];
  lines.push(`| Флаги телеметрии | ${flags.length ? flags.map((f) => `\`${f}\``).join(", ") : "нет"} |`);
  lines.push(
    `| Вердикт прогона | ${
      verdict.ok
        ? live
          ? "замер состоялся"
          : "офлайн-проверка прошла; голос не измерялся"
        : verdict.failures.map((f) => f.code).join(", ")
    } |`
  );
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push("## Ходы");
  lines.push("");
  for (const [index, turn] of b.entries()) {
    const mentor = turn.mentor;
    lines.push(`### Ход ${index + 1}`);
    lines.push("");
    lines.push("**Резидент:**");
    lines.push("");
    lines.push(`> ${turn.learner.split("\n").join("\n> ")}`);
    lines.push("");
    lines.push("**Движок:**");
    lines.push("");
    lines.push(turn.engineReply ? blockquote(turn.engineReply) : "> *(движок ничего не ответил)*");
    lines.push("");
    if (mentor && turn.mentorText) {
      const tags = [
        `mode: \`${mentor.mode}\``,
        `source: \`${mentor.source}\``,
        `починка: ${mentor.repairAttempted ? "да" : "нет"}`,
        `отказ: ${mentor.rejectionReasons.length ? mentor.rejectionReasons.map((r) => `\`${r}\``).join(", ") : "нет"}`,
      ];
      if (mentor.telemetry.length) {
        tags.push(`телеметрия: ${mentor.telemetry.map((flag) => `\`${flag}\``).join(", ")}`);
      }
      lines.push(`**Ментор** — ${tags.join(" · ")}`);
      lines.push("");
      lines.push(blockquote(turn.mentorText));
    } else {
      lines.push(`**Ментор:** не вмешивался${mentor ? ` (mode: \`${mentor.mode}\`)` : ""}`);
    }
    lines.push("");
    lines.push(`<sub>Для сравнения — что было в записи 91ba7206 на этом ходе:</sub>`);
    lines.push("");
    lines.push(a[index]?.reply ? blockquote(a[index].reply) : "> *(нет хода)*");
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  lines.push("## Строки, ради которых всё переделывалось");
  lines.push("");
  lines.push("В записи `91ba7206` старый тренажёр отвечал так. Ниже — что стоит на их месте.");
  lines.push("");
  lines.push("Искали две строки; в этой записи встречается только одна, зато четырежды:");
  lines.push("");
  const hits = forbiddenHits(a);
  for (const needle of FORBIDDEN) {
    const count = hits.filter((hit) => hit.needle === needle).length;
    lines.push(`- «${needle}» — ${count === 0 ? "**в этой записи не встречается**" : `${count} раз(а)`}`);
  }
  lines.push("");
  if (!hits.length) {
    lines.push("*Ни одной из искомых строк в записи нет — фикстура могла быть обновлена.*");
  }
  for (const hit of hits) {
    const turn = b[hit.turn - 1];
    lines.push(`### Ход ${hit.turn} — «${hit.needle}»`);
    lines.push("");
    lines.push("**Было:**");
    lines.push("");
    lines.push(blockquote(a[hit.turn - 1]?.reply || ""));
    lines.push("");
    lines.push("**Стало:**");
    lines.push("");
    lines.push(blockquote(turn?.reply || "*(нет хода)*"));
    lines.push("");
  }
  lines.push("---");
  lines.push("");
  lines.push(`Путь в операционную: ${probe.turn ? `открыт с хода ${probe.turn}` : `не открылся (${probe.blocked.join(", ") || "причина неизвестна"})`}.`);
  lines.push("");
  lines.push(
    `*Сгенерировано \`${live ? "npm run ab:mentor -- --live" : "npm run ab:mentor"} --report=<файл>\`. Правки в этот файл вносить нет смысла: он перезаписывается прогоном.*`
  );
  return lines.join("\n");
}

function blockquote(text) {
  return String(text)
    .split("\n")
    .map((line) => (line.trim() ? `> ${line}` : ">"))
    .join("\n");
}

function printVerdict(verdict) {
  console.log(box("ВЕРДИКТ ПРОГОНА"));
  if (verdict.ok) {
    // Offline the share is 100% by construction, so saying "the measurement
    // succeeded" next to it would read as approval of a voice nobody heard.
    if (!live) {
      console.log("  ✓ прогон без модели прошёл: движок, петля и телеметрия проверены");
      console.log("    голос ментора НЕ измерялся — все реплики из шаблона по построению");
      return;
    }
    console.log("  ✓ замер состоялся: модель отвечала");
    if (verdict.share !== null) {
      console.log(`    доля реплик из шаблона: ${Math.round(verdict.share * 100)}%`);
    }
    return;
  }
  for (const failure of verdict.failures) {
    console.log(`  ✗ ${failure.code}`);
    console.log(`    ${failure.detail}`);
  }
  console.log(
    "\n  Прогон завершается с ненулевым кодом. Транспортная ошибка и плохой ответ" +
      "\n  модели — разные вещи, и ни одна из них не является успешной приёмкой."
  );
}

const llm = await mentorLLM();
const a = recordedPath();
const b = await currentPath(llm);
const probe = await theatreProbe();

const verdict = harnessVerdict({
  telemetry: b.telemetry,
  live,
  limit: Number(
    [...args].find((arg) => arg.startsWith("--max-deterministic="))?.split("=")[1]
  ) || DETERMINISTIC_SHARE_LIMIT,
});

if (asJson) {
  console.log(
    JSON.stringify(
      {
        models: live ? models : null,
        recorded: a,
        current: b.turns,
        telemetry: b.telemetry,
        theatre: probe,
        metrics: {
          repeated_questions: repeatedQuestions(b.turns),
          repeated_engine_blocks: repeatedEngineBlocks(b.turns),
        },
        verdict,
      },
      null,
      2
    )
  );
} else {
  printTranscripts(a, b.turns);
  printStats(a, b, b.telemetry, probe);
  printVerdict(verdict);
}

const reportPath = [...args].find((arg) => arg.startsWith("--report="))?.split("=")[1];
if (reportPath) {
  writeFileSync(
    reportPath,
    `${reportMarkdown({ a, b: b.turns, telemetry: b.telemetry, verdict, probe })}\n`,
    "utf8"
  );
  console.log(`\nОтчёт для чтения: ${reportPath}`);
}

process.exitCode = verdict.exitCode;

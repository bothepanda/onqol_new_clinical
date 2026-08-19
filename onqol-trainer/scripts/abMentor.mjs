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
import { readFileSync } from "node:fs";

import { buildV35Case } from "../src/clinical/v35/createCase.js";
import { advanceV25Session, createV25Session } from "../src/clinical/v25/engine.js";
import { buildMentorTelemetry } from "../src/clinical/v25/replayExport.js";
import { replay91baRouter } from "../src/clinical/__tests__/fixtures/replay91baRouter.js";
import {
  appendicitisRouterConceptMap,
  resolveConcept,
} from "../src/clinical/diseases/appendicitis/router/conceptRegistry.js";

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

async function mentorLLM() {
  if (!live) return null;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("--live needs OPENAI_API_KEY in the environment.");
    process.exit(2);
  }
  const { requestOpenAI } = await import("../server/openaiGateway.mjs");
  return async (prompt) => {
    const { output } = await requestOpenAI({
      apiKey,
      task: "mentor",
      prompt,
      models: {
        router: process.env.OPENAI_ROUTER_MODEL || undefined,
        simulator: process.env.OPENAI_SIMULATOR_MODEL || undefined,
        mentor: process.env.OPENAI_MENTOR_MODEL || undefined,
      },
    });
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
    turns.push({
      learner,
      reply: result.reply,
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
    const probe = await advanceV25Session({
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
    if (probe.session.workingMemory?.operativeState?.procedure_started) {
      return { turn: index + 2, blocked: null };
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
    ["дошли до операционной сами", "нет (сессия брошена)", b.turns.some((turn) => turn.procedureStarted || turn.sourceControl) ? "да" : "нет"],
  ];
  console.log(["", "A (запись)", "B (текущий код)"].map((cell) => String(cell).padEnd(28)).join(""));
  for (const row of rows) {
    console.log(row.map((cell) => String(cell).padEnd(28)).join(""));
  }

  console.log("\nМентор, путь B:");
  console.log(`  реплик ментора:        ${telemetry.summary.mentor_turns}`);
  console.log(`  из модели:             ${telemetry.summary.from_model}`);
  console.log(`  из шаблона:            ${telemetry.summary.from_template}`);
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
  if (!live) {
    console.log(
      "\n  ! Прогон без модели: колонка B показывает детерминированный фолбэк, а не голос ментора."
    );
    console.log("    Для сравнения голоса: OPENAI_API_KEY=... npm run ab:mentor -- --live");
  }
}

const llm = await mentorLLM();
const a = recordedPath();
const b = await currentPath(llm);
const probe = await theatreProbe();

if (asJson) {
  console.log(JSON.stringify({ recorded: a, current: b.turns, telemetry: b.telemetry, theatre: probe }, null, 2));
} else {
  printTranscripts(a, b.turns);
  printStats(a, b, b.telemetry, probe);
}

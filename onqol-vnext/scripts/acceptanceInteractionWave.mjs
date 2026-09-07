#!/usr/bin/env node
/**
 * Interaction Reliability Wave — pilot acceptance demo (§25).
 *
 * One fresh learner_pilot session, deterministic interpreter, natural Russian.
 * Drives the ten §25 behaviours and then inspects the exported session against
 * the §25 checklist. Writes evidence and exits non-zero on any failed check.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import diseaseBundle from "../src/content/generated/appendicitis.json" with { type: "json" };
import sharedBundle from "../src/content/generated/shared.json" with { type: "json" };
import { withShared } from "../src/core/content/loadBundle.js";
import { createSession } from "../src/core/session/createSession.js";
import { submitLearnerTurn } from "../src/core/session/submitLearnerTurn.js";
import { exportSession } from "../src/core/replay/exportSession.js";
import { reduceEvents, createInitialState } from "../src/core/state/worldState.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundle = withShared(diseaseBundle, sharedBundle);

let session = createSession({
  sessionId: "acceptance-interaction-wave",
  seed: "acceptance-iw-2026-09-07",
  mode: "reference",
  casePresetId: "APP-004",
  sessionPurpose: "learner_pilot",
  bundle,
  locale: "ru",
  startIso: "2026-09-07T08:00:00+05:00",
});

const transcript = [];
const say = (text) => {
  const turn = submitLearnerTurn({ session, text });
  session = turn.session;
  transcript.push({
    text,
    elapsedMinutes: session.state.clock.elapsedMinutes,
    interpreterMode: turn.interpreted.mode ?? "deterministic",
    commands: turn.interpreted.commands.map((c) => c.type),
    outcomes: turn.outcomes.map((o) => o.outcome),
    unmatchedFragments: turn.interpreted.unmatchedFragments ?? [],
  });
  return turn;
};

// 1 natural history/examination
say("опрос и осмотр живота");
// 2 several investigations in one message + abbreviation (3) + a typo/slang (4)
say("оак оам срб и узи обп");
say("кт обп");
// 5 incomplete medication order
say("кетопрофен");
// 6 short contextual reply to the clarification
say("100 мг в/в");
// natural analgesia slang -> clarification, then completed
say("обезбол");
say("парацетамол 1 г внутрь");
// 7 repeat / reassess later (also advances the clock so pending work drains)
say("переоценю боль и живот через 2 часа");
say("узи обп");            // duplicate while (maybe) still pending -> ALREADY_PENDING or repeat after result
// 8 receive automatically returned pending results (9 advance time already happened)
say("что с пациентом сейчас?");
// 10 export happens below

const exported = exportSession({ session, generatedAtIso: "2026-09-07T12:00:00.000Z" });

// ---- §25 checklist -------------------------------------------------------
const checks = [];
const check = (name, pass, detail = "") => checks.push({ name, pass: Boolean(pass), detail });

const turns = exported.learner_turns;
const droppedTurns = turns.filter((t) => t.interpretedCommands.length === 0 && t.intent === "CLINICAL_ACTION");
check("no unexplained dropped learner turns", droppedTurns.length === 0, `${droppedTurns.length} dropped`);

const everyRejectExplained = exported.events
  .filter((e) => e.type === "COMMAND_REJECTED")
  .every((e) => e.payload.reasonKey || e.payload.capabilityKey || e.payload.reasonTextRu || (e.payload.governanceBlocked ?? []).length);
check("every rejection carries an explainable reason (§12)", everyRejectExplained);

const orderTestEvents = exported.events.filter((e) => e.type === "TEST_ORDERED");
const distinctPendingByTest = new Set(orderTestEvents.map((e) => e.payload.testId));
check("no duplicate pending events from parser error (§13)",
  orderTestEvents.length === distinctPendingByTest.size,
  `${orderTestEvents.length} TEST_ORDERED / ${distinctPendingByTest.size} distinct`);

check("interpreter mode is recorded (§17)",
  Array.isArray(exported.interpreter?.modes) && exported.interpreter.modes.length > 0,
  JSON.stringify(exported.interpreter?.modes));

const clarifications = exported.events.filter((e) => e.type === "CLARIFICATION_REQUESTED");
const answeredClarification = turns.some((t) => (t.interpretedCommands ?? []).some((c) => c.params?.route || c.params?.doseMg));
check("clarification links are auditable", clarifications.length > 0 && answeredClarification);

check("the clinical clock moved", session.state.clock.elapsedMinutes > 0, `${session.state.clock.elapsedMinutes} min`);

const resulted = Object.values(session.state.investigations).filter((i) => i.status === "resulted");
check("result lifecycle is coherent (something ordered has resulted after time passed)",
  resulted.length > 0,
  `${resulted.length} resulted`);
check("revealed.results only holds results actually shown (§16)",
  session.state.revealed.results.every((id) => ["resulted", "preliminary"].includes(session.state.investigations[id]?.status)),
  JSON.stringify(session.state.revealed.results));

// clinical validation stays rule-based: the incomplete/again-incomplete med
// order never executed as a guess
const medOrders = exported.events.filter((e) => (e.payload.commandType === "ORDER_MEDICATION"));
const noGuessedMed = medOrders.every((e) => e.type !== "COMMAND_ACCEPTED" || (e.payload.params?.drugId && e.payload.params?.route));
check("no medication executed without the learner's drug+route", noGuessedMed);

// replay without a new interpretation call
const rebuilt = reduceEvents(
  createInitialState({
    session: {
      id: session.state.session.id, seed: session.state.session.seed, mode: session.state.session.mode,
      locale: session.state.session.locale, purpose: session.state.session.purpose,
      casePresetId: session.state.session.casePresetId,
      jurisdictionContext: session.state.session.jurisdictionContext, interactionFlags: session.state.session.interactionFlags,
      presetRuntimeStatus: session.state.session.presetRuntimeStatus, productionReleaseAllowed: session.state.session.productionReleaseAllowed,
      presentationCategory: session.state.session.presentationCategory, contentVersions: session.state.session.contentVersions,
      patientTruthApproved: session.state.session.patientTruthApproved,
    },
    patient: {
      truth: session.patient.truth, initialPhysiology: session.patient.initialPhysiology,
      initialSymptoms: session.patient.initialSymptoms, demographics: session.patient.demographics,
      presentation: session.patient.presentation,
    },
    hospital: {
      profileId: session.state.hospital.profileId, profileTitleKey: session.state.hospital.profileTitleKey,
      capabilities: session.state.hospital.capabilities, staff: session.state.hospital.staff,
      dynamicConstraints: session.state.hospital.dynamicConstraints, jurisdiction: session.state.hospital.jurisdiction,
      radiologyPolicy: session.state.hospital.radiologyPolicy,
    },
    clock: session.clockRoot,
  }),
  exported.events,
);
check("event-log replay reproduces state without re-interpreting", JSON.stringify(rebuilt) === JSON.stringify(exported.current_state));

const outPath = path.join(root, "docs/evidence/INTERACTION_WAVE_ACCEPTANCE_2026-09-07.json");
const allPass = checks.every((c) => c.pass);
mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify({
  status: allPass ? "PASS" : "FAIL",
  generatedAt: "2026-09-07",
  interpreter: exported.interpreter,
  finalElapsedMinutes: session.state.clock.elapsedMinutes,
  checks,
  transcript,
  export: exported,
}, null, 2)}\n`);

for (const c of checks) console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}${c.detail ? `  (${c.detail})` : ""}`);
console.log(`\nacceptance:interaction-wave ${allPass ? "PASS" : "FAIL"} — ${path.relative(root, outPath)}`);
process.exit(allPass ? 0 : 1);

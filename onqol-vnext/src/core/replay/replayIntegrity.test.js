import { test } from "node:test";
import assert from "node:assert/strict";
import { createSession } from "../session/createSession.js";
import { submitLearnerTurn } from "../session/submitLearnerTurn.js";
import { createInitialState, reduceEvents } from "../state/worldState.js";
import { exportSession } from "./exportSession.js";
import { buildDebrief } from "./buildDebrief.js";
import { withShared } from "../content/loadBundle.js";
import diseaseBundle from "../../content/generated/appendicitis.json" with { type: "json" };
import sharedBundle from "../../content/generated/shared.json" with { type: "json" };

const bundle = withShared(diseaseBundle, sharedBundle);

function playThrough(seed, mode = "reference", realProfileId) {
  let session = createSession({
    sessionId: "replay",
    seed,
    mode,
    realProfileId,
    casePresetId: "APP-004",
    sessionPurpose: "internal_development",
    bundle,
    locale: "ru",
    startIso: "2026-08-23T02:15:00+05:00",
  });
  const script = [
    "опрошу пациента",
    "живот",
    "ОАК и СРБ",
    "кетопрофен 100 мг в/м",
    "переоценю боль через 90 минут",
    "идём на операцию",
    "нулевой стол",
    "венозный доступ",
    "антибиотикопрофилактика цефазолин 2 г в/в, антибиотикопрофилактика метронидазол 500 мг в/в",
    "вызываю анестезиолога на осмотр",
    "переоценю витальные через 40 минут",
    "получаю согласие",
    "иду лапароскопически",
    "удалю аппендикс, аспирирую жидкость из малого таза",
    "в отделение",
    "vitals каждые 4 часа",
  ];
  for (const text of script) session = submitLearnerTurn({ session, text }).session;
  return session;
}

test("the same seed reproduces the same patient, resource events and stochastic outcomes", () => {
  const first = playThrough("determinism-seed");
  const second = playThrough("determinism-seed");
  assert.deepEqual(first.state, second.state);
  assert.deepEqual(
    first.events.map((event) => [event.type, event.atMinutes]),
    second.events.map((event) => [event.type, event.atMinutes]),
  );
});

test("different seeds diverge", () => {
  const first = playThrough("seed-alpha");
  const second = playThrough("seed-beta");
  assert.notDeepEqual(first.state.demographics, second.state.demographics);
});

test("replaying the exported event log from the seed reproduces the exported state exactly", () => {
  const session = playThrough("replay-seed");
  const exported = exportSession({ session, generatedAtIso: "2026-08-23T12:00:00.000Z" });

  const rebuilt = reduceEvents(
    createInitialState({
      session: {
        id: session.state.session.id,
        seed: session.state.session.seed,
        mode: session.state.session.mode,
        locale: session.state.session.locale,
        purpose: session.state.session.purpose,
        jurisdictionContext: session.state.session.jurisdictionContext,
        interactionFlags: session.state.session.interactionFlags,
        presetRuntimeStatus: session.state.session.presetRuntimeStatus,
        productionReleaseAllowed: session.state.session.productionReleaseAllowed,
        presentationCategory: session.state.session.presentationCategory,
        contentVersions: session.state.session.contentVersions,
        patientTruthApproved: session.state.session.patientTruthApproved,
      },
      patient: {
        truth: session.patient.truth,
        initialPhysiology: session.patient.initialPhysiology,
        initialSymptoms: session.patient.initialSymptoms,
        demographics: session.patient.demographics,
        presentation: session.patient.presentation,
      },
      hospital: {
        profileId: session.state.hospital.profileId,
        profileTitleKey: session.state.hospital.profileTitleKey,
        capabilities: session.state.hospital.capabilities,
        staff: session.state.hospital.staff,
        dynamicConstraints: session.state.hospital.dynamicConstraints,
        jurisdiction: session.state.hospital.jurisdiction,
        radiologyPolicy: session.state.hospital.radiologyPolicy,
      },
      clock: session.clockRoot,
    }),
    exported.events,
  );

  assert.deepEqual(rebuilt, exported.current_state);
});

test("the export carries the full causal trail: what was said, read, executed and refused", () => {
  const session = playThrough("trail-seed");
  const exported = exportSession({ session, generatedAtIso: "2026-08-23T12:00:00.000Z" });

  assert.ok(exported.learner_turns.length >= 10);

  const examTurn = exported.learner_turns.find((turn) => turn.rawText === "живот");
  assert.ok(examTurn, "raw learner text is present");
  assert.deepEqual(
    examTurn.interpretedCommands.map((command) => command.type),
    ["EXAMINE"],
    "what the interpreter thought it meant is present",
  );
  assert.equal(examTurn.commandOutcomes[0].outcome, "EXECUTED", "what the system executed is present");

  // A refusal is recorded as such, distinctly from an execution.
  const refusedTurn = submitLearnerTurn({ session, text: "кетопрофен 100 мг" });
  const refusedExport = exportSession({ session: refusedTurn.session, generatedAtIso: "2026-08-23T12:00:00.000Z" });
  const clarified = refusedExport.learner_turns.at(-1);
  assert.equal(clarified.commandOutcomes[0].eventType, "CLARIFICATION_REQUESTED");
  assert.deepEqual(clarified.commandOutcomes[0].missing, ["route"]);

  // Governance decisions ride on every command outcome, so the audit trail
  // can always answer "was anything withheld here" rather than only when
  // something happened to be.
  for (const outcome of exported.learner_turns.flatMap((turn) => turn.commandOutcomes)) {
    assert.ok(Array.isArray(outcome.governanceBlocked));
  }
});

test("the debrief separates simulator limitation from learner omission", () => {
  const session = playThrough("debrief-seed");
  const debrief = buildDebrief({ session, bundle });

  assert.ok(debrief.simulatorLimitations.length > 0, "unapproved content is reported as a platform limitation");
  for (const entry of debrief.simulatorLimitations) {
    assert.match(entry.noteRu, /ограничение платформы, а не пропуск обучающегося/);
  }

  // No numeric competence score, ever (Governance Spec §22).
  assert.equal("score" in debrief, false);
  assert.equal(JSON.stringify(debrief).includes('"score"'), false);

  // Approved reviewed rules may now populate the reference comparison.
  assert.equal(debrief.referenceComparison.available, true);
});

test("the debrief never claims a treatment was not given when the event log shows it was", () => {
  const session = playThrough("debrief-fidelity");
  const debrief = buildDebrief({ session, bundle });
  const gaveProphylaxis = debrief.observedBehavior.some(
    (entry) => entry.type === "MEDICATION_ADMINISTERED" && entry.detail.purpose === "prophylaxis",
  );
  assert.ok(gaveProphylaxis);
  assert.equal(
    debrief.importantMisses.some((miss) => miss.itemId === "antibiotic_prophylaxis"),
    false,
    "an item the learner actually completed must never appear as an omission",
  );
});

test("the export contains no hidden patient truth in the learner-facing trail", () => {
  const session = playThrough("privacy-seed");
  const exported = exportSession({ session, generatedAtIso: "2026-08-23T12:00:00.000Z" });
  const trail = JSON.stringify(exported.learner_turns);
  assert.equal(trail.includes(session.patient.truth.operativeTruthRu), false);
});

test("the export records a real content hash, not the literal string 'unversioned'", () => {
  // Regression: the hash was written only into contentIndex.json, never into
  // the disease bundle `exportSession` actually reads, so every exported
  // session claimed "unversioned" - defeating the guarantee that two
  // replays with equal content_versions ran against identical content.
  const session = playThrough("content-version-seed");
  const exported = exportSession({ session, generatedAtIso: "2026-08-23T12:00:00.000Z" });
  const version = exported.content_versions.acute_appendicitis;
  assert.notEqual(version, "unversioned");
  assert.match(version, /^[0-9a-f]{16}$/);
});

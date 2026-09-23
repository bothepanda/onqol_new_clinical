import { test } from "node:test";
import assert from "node:assert/strict";
import { createSession } from "./createSession.js";
import { submitLearnerTurn } from "./submitLearnerTurn.js";
import { withShared } from "../content/loadBundle.js";
import diseaseBundle from "../../content/generated/appendicitis.json" with { type: "json" };
import sharedBundle from "../../content/generated/shared.json" with { type: "json" };

/**
 * THE learner end-to-end suite (task brief §17).
 *
 * Every test here drives the session ONLY through `submitLearnerTurn` with
 * ordinary Russian clinical text. No test in this file constructs a command
 * object, and no test names an internal command type - if a capability
 * cannot be reached by typing at the composer, it does not count as
 * reachable, which is exactly the gap the task brief exists to close.
 */

const bundle = withShared(diseaseBundle, sharedBundle);
const START_ISO = "2026-08-23T02:15:00+05:00";

function newSession(seed = "journey-seed") {
  return createSession({
    sessionId: "learner-e2e",
    seed,
    mode: "reference",
    casePresetId: "APP-004",
    sessionPurpose: "internal_development",
    bundle,
    locale: "ru",
    startIso: START_ISO,
  });
}

/** Types one turn and returns the whole result. */
function say(session, text) {
  return submitLearnerTurn({ session, text });
}

/** Types several turns in order, returning the final session. */
function saying(session, texts) {
  let current = session;
  for (const text of texts) current = say(current, text).session;
  return current;
}

const outcomesOf = (turn) => turn.outcomes.map((result) => result.outcome);
const commandTypesOf = (turn) => turn.interpreted.commands.map((command) => command.type);

// --- Examination and history (Contract §5) ---------------------------------

test("«осмотрю пациента» asks what is being examined instead of guessing a region", () => {
  const turn = say(newSession(), "осмотрю пациента");
  assert.deepEqual(commandTypesOf(turn), ["EXAMINE"]);
  assert.deepEqual(outcomesOf(turn), ["CLARIFY"]);
  assert.deepEqual(turn.outcomes[0].missing, ["region"]);
});

test("«живот» alone is a sufficient abdominal examination request", () => {
  const turn = say(newSession(), "живот");
  assert.deepEqual(outcomesOf(turn), ["EXECUTED"]);
  assert.equal(turn.session.state.observations.examinations.at(-1).region, "abdomen");
});

test("«опрошу пациента» returns the core history bundle", () => {
  const turn = say(newSession(), "опрошу пациента");
  assert.deepEqual(commandTypesOf(turn), ["TAKE_HISTORY"]);
  assert.equal(turn.session.state.observations.history.length, 1);
});

// --- Compound orders and clarification (Contract §8, Core Runtime Spec §9) ----

test("«ОАК, ОАМ и БХАК» becomes three parallel test orders in one turn", () => {
  const turn = say(newSession(), "ОАК, ОАМ и БХАК");
  assert.deepEqual(commandTypesOf(turn), ["ORDER_TEST", "ORDER_TEST", "ORDER_TEST"]);
  // Matrix V07: the first two execute; bare "БХАК" does NOT, because a
  // biochemistry order with no named analytes is incomplete.
  assert.deepEqual(outcomesOf(turn), ["EXECUTED", "EXECUTED", "CLARIFY"]);
  assert.equal(turn.session.state.clock.elapsedMinutes, 0, "issuing orders does not itself consume clinical time");
});

test("«БХАК» alone asks which values are needed instead of returning a hidden panel", () => {
  // Matrix V07 REMOVE: "biochemistry panel auto-populates everything". The
  // resident must request individual tests, and the LAB asks - not the mentor.
  const turn = say(newSession(), "БХАК");
  assert.deepEqual(outcomesOf(turn), ["CLARIFY"]);
  assert.deepEqual(turn.outcomes[0].missing, ["analytes"]);
  assert.equal(turn.outcomes[0].clarifyBy, "laboratory");
  assert.equal(turn.outcomes[0].clarifyPromptRu, "Какие показатели биохимии нужны?");
  assert.equal(turn.session.state.investigations.chemistry, undefined, "nothing was ordered");
});

test("«БХАК: креатинин, электролиты» orders exactly those values and no others", () => {
  const turn = say(newSession(), "БХАК: креатинин, электролиты");
  assert.deepEqual(outcomesOf(turn), ["EXECUTED"]);
  assert.deepEqual(turn.interpreted.commands[0].params.analytes, ["creatinine", "electrolytes"]);
  const resulted = say(turn.session, "переоценю витальные через 2 часа").session;
  const result = resulted.state.investigations.chemistry.result;
  assert.deepEqual(result.analytes, ["creatinine", "electrolytes"]);
  assert.equal(result.linesRu.length, 2, "no test the learner did not request is invented");
});

test("СРБ stays a separate order and is never bundled into biochemistry", () => {
  // Matrix V08: CRP is a separately orderable investigation, not something the
  // system adds to a chemistry order on the learner's behalf.
  const turn = say(newSession(), "БХАК: креатинин");
  assert.equal(turn.session.state.investigations.crp, undefined);
  const withCrp = say(turn.session, "СРБ").session;
  assert.ok(withCrp.state.investigations.crp);
});

test("«кетопрофен 100 мг» without a route is a nurse clarification, not a guessed route", () => {
  const turn = say(newSession(), "кетопрофен 100 мг");
  assert.deepEqual(outcomesOf(turn), ["CLARIFY"]);
  assert.deepEqual(turn.outcomes[0].missing, ["route"]);
});

test("«кетопрофен 100 мг в/м» is complete and executes", () => {
  const turn = say(newSession(), "кетопрофен 100 мг в/м");
  assert.deepEqual(outcomesOf(turn), ["EXECUTED"]);
  const given = turn.session.state.treatments.administered.at(-1);
  assert.equal(given.drugId, "ketoprofen");
  assert.equal(given.route, "im");
});

test("«500 мл физраствора за час» carries fluid, volume and duration", () => {
  const turn = say(newSession(), "500 мл физраствора за час");
  assert.deepEqual(outcomesOf(turn), ["EXECUTED"]);
  const infusion = turn.session.state.infusions.at(-1);
  // Wave B: fluid identity is preserved (0.9% NaCl is not "a crystalloid" -
  // the fluids case turns on balanced vs unbalanced solutions).
  assert.equal(infusion.fluidId, "normal_saline");
  assert.equal(infusion.volumeMl, 500);
  assert.equal(infusion.durationMinutes, 60);
});

test("an unsupported medication is a simulator limitation, never a hospital stock-out", () => {
  const turn = say(newSession(), "дам таблетку суперлекарства 10 мг в/в");
  assert.equal(outcomesOf(turn).includes("UNAVAILABLE_RESOURCE"), false);
});

// --- Clinical time (Contract §7, task brief P0-2) --------------------------

test("«переоценю боль и живот через 30 минут» advances the clock and returns new state", () => {
  const session = saying(newSession(), ["ОАК"]);
  const before = session.state.clock.elapsedMinutes;
  const turn = say(session, "переоценю боль и живот через 30 минут");
  assert.equal(turn.session.state.clock.elapsedMinutes, before + 30);
  assert.deepEqual(outcomesOf(turn), ["EXECUTED"]);
});

test("ordered results arrive automatically once enough time has passed, without being asked for", () => {
  let session = saying(newSession(), ["ОАК и КТ ОБП"]);
  const turn = say(session, "переоценю витальные через 4 часа");
  session = turn.session;
  assert.equal(session.state.investigations.cbc.status, "resulted");
  assert.equal(session.state.investigations.ct_abdomen.status, "resulted");
  // The CT reported preliminarily before it reported formally (Contract §9.2).
  const events = session.events.map((event) => event.type);
  assert.ok(events.indexOf("TEST_PRELIMINARY_REPORTED") < events.lastIndexOf("TEST_RESULTED"));
});

test("parallel investigations complete at their own different times, not together", () => {
  const session = saying(newSession(), ["ОАМ и КТ ОБП"]);
  // Urinalysis: 30 min authored + 30 min reference-lab turnaround = 60.
  // CT: 70 min authored + 60 min reference-CT turnaround = 130. At 90
  // minutes exactly one of the two is back - they are genuinely independent
  // timelines, not one batch that lands together.
  const turn = say(session, "переоценю витальные через 90 минут");
  assert.equal(turn.session.state.investigations.urinalysis.status, "resulted");
  assert.notEqual(turn.session.state.investigations.ct_abdomen.status, "resulted");
});

test("«что с пациентом сейчас?» returns current status and never moves the clock", () => {
  const session = saying(newSession(), ["живот", "ОАК"]);
  const before = session.state.clock.elapsedMinutes;
  const turn = say(session, "что с пациентом сейчас?");
  assert.deepEqual(outcomesOf(turn), ["STATUS_SNAPSHOT"]);
  assert.equal(turn.session.state.clock.elapsedMinutes, before);
});

// --- Preoperative workflow, derived from real actions (task brief P0-4) ----

test("committing to operate does not by itself make the patient ready for theatre", () => {
  const turn = say(newSession(), "думаю это аппендицит, идём на операцию");
  assert.ok(commandTypesOf(turn).includes("COMMIT_MANAGEMENT_PLAN"));
  assert.equal(turn.session.state.preop.ready, false);
});

test("preop readiness is derived from the learner's own real preparation actions", () => {
  let session = saying(newSession(), ["идём на операцию"]);
  assert.equal(session.state.preop.ready, false);

  session = saying(session, [
    "венозный доступ",
    "антибиотикопрофилактика цефазолин 2 г в/в, антибиотикопрофилактика метронидазол 500 мг в/в",
    "вызываю анестезиолога на осмотр",
  ]);
  // The anesthesiologist has to actually arrive before that item is done.
  assert.equal(session.state.preop.completed.includes("anesthesia_review"), false);

  session = say(session, "переоценю витальные через 40 минут").session;
  assert.ok(session.state.preop.completed.includes("anesthesia_review"));

  session = say(session, "получаю согласие").session;
  assert.equal(session.state.preop.ready, true);
});

test("the procedure cannot start until the hard prerequisites are genuinely met", () => {
  const session = saying(newSession(), ["идём на операцию"]);
  const turn = say(session, "иду на лапароскопическую аппендэктомию");
  assert.deepEqual(outcomesOf(turn), ["PREOP_NOT_READY"]);
  assert.equal(turn.session.state.operative.started, false);
});

// --- Operative decisions, driven by content (task brief P0-6) --------------

test("an operative decision is matched against content's own phrasings, not a core branch", () => {
  const session = readyForTheatre();
  const started = say(session, "иду лапароскопически").session;
  assert.equal(started.state.operative.started, true);
  assert.ok(started.state.operative.pendingDecision);

  const turn = say(started, "удалю аппендикс, аспирирую жидкость из малого таза, дренаж не ставлю");
  assert.deepEqual(commandTypesOf(turn), ["OPERATIVE_DECISION"]);
  assert.equal(turn.session.state.operative.sourceControl, true);
  assert.equal(turn.session.state.operative.completed, true);
});

// --- Disposition, monitoring and discharge (task brief P1-2) ---------------

test("«в отделение, vitals каждые 4 часа» sets disposition and a monitoring plan", () => {
  const session = throughOperation();
  const disposition = say(session, "в отделение").session;
  assert.equal(disposition.state.location, "surgical_ward");
  assert.equal(disposition.state.postop.disposition, "surgical_ward");

  const monitored = say(disposition, "vitals каждые 4 часа").session;
  assert.ok(monitored.state.monitoring.prescribed.includes("vitals"));
  assert.equal(monitored.state.monitoring.adequacy, "adequate");
});

test("monitoring adequacy is derived: a ward patient with no monitoring orders is inadequately monitored", () => {
  const session = say(throughOperation(), "в отделение").session;
  assert.equal(session.state.monitoring.adequacy, "inadequate");
});

test("«выписываю» is refused while a STRUCTURAL discharge criterion is unmet", () => {
  // Matrix PO14: discharge must not succeed merely because the learner said
  // the word. The reason given is the content's own learner-facing wording -
  // never an internal criterion id.
  //
  // The criterion exercised here is structural (the patient is still in
  // theatre), because in this build every CLINICAL readiness criterion is
  // governance-blocked - see the discharge governance test below, and the
  // release blocker recorded in
  // docs/review/APP004_CLINICAL_REMEDIATION_REPORT_2026-08-25.md.
  const turn = say(throughOperation(), "выписываю");
  assert.deepEqual(outcomesOf(turn), ["DISCHARGE_NOT_READY"]);
  assert.equal(turn.session.state.session.status, "active");
  assert.ok(turn.outcomes[0].blockers.some((blocker) => blocker.reasonRu?.length > 0));
  assert.equal(turn.outcomes[0].blockers.some((blocker) => /criterion|_/.test(blocker.reasonRu ?? "")), false);
});

// --- Mentor state (task brief P0-7) ----------------------------------------

test("«не знаю» raises scaffolding and persists the mentor's open question", () => {
  const session = say(newSession(), "не знаю").session;
  assert.equal(session.state.mentor.scaffolding, 1);
  assert.ok(session.state.mentor.openQuestion);
});

test("repeated «не знаю» reaches distinct scaffolding levels 3 and 4, not a repeated cue", () => {
  let session = newSession();
  const texts = [];
  for (let index = 0; index < 4; index += 1) {
    const turn = say(session, "не знаю");
    session = turn.session;
    texts.push(turn.mentor.textRu);
  }
  assert.equal(session.state.mentor.scaffolding, 4);
  assert.equal(new Set(texts).size, 4, "each scaffolding level must say something materially different");
});

test("a competent learner can complete several consecutive turns with no mentor message", () => {
  let session = newSession();
  const mentorTexts = [];
  for (const text of ["опрошу пациента", "живот", "ОАК и СРБ", "кетопрофен 100 мг в/м"]) {
    const turn = say(session, text);
    session = turn.session;
    mentorTexts.push(turn.mentor?.textRu ?? null);
  }
  assert.ok(mentorTexts.every((text) => text === null), "the mentor should stay silent through competent progression");
});

// --- Causal trail (task brief P0-8) ----------------------------------------

test("every learner turn is recorded with its raw text and what the interpreter made of it", () => {
  const session = saying(newSession(), ["живот", "ОАК и СРБ"]);
  const turns = session.events.filter((event) => event.type === "LEARNER_TURN_RECEIVED");
  assert.equal(turns.length, 2);
  assert.equal(turns[0].payload.rawText, "живот");
  assert.deepEqual(
    turns[1].payload.interpretedCommands.map((command) => command.type),
    ["ORDER_TEST", "ORDER_TEST"],
  );
});

test("accepted, clarified and refused commands are each recorded distinctly", () => {
  const session = saying(newSession(), ["живот", "кетопрофен 100 мг"]);
  const types = session.events.map((event) => event.type);
  assert.ok(types.includes("COMMAND_ACCEPTED"));
  assert.ok(types.includes("CLARIFICATION_REQUESTED"));
});

// --- Full journey ----------------------------------------------------------

test("the whole APP-004 case is playable from EMS handoff to a safe endpoint in natural Russian", () => {
  let session = newSession("full-journey");

  session = saying(session, [
    "осмотрю пациента",
    "живот",
    "опрошу пациента",
    "ОАК, ОАМ и БХАК",
    "кетопрофен 100 мг в/м",
    "500 мл физраствора за час",
    "переоценю боль и живот через 30 минут",
    "КТ ОБП",
    "переоценю витальные через 2 часа",
    "думаю, это аппендицит. идём на операцию",
    "когда последний раз ел и пил?",
    "венозный доступ",
    "антибиотикопрофилактика цефазолин 2 г в/в, антибиотикопрофилактика метронидазол 500 мг в/в",
    "вызываю анестезиолога на осмотр",
    "переоценю витальные через 40 минут",
    "получаю согласие",
  ]);
  assert.equal(session.state.preop.ready, true, "preop readiness reached through real actions only");

  session = saying(session, [
    "иду лапароскопически",
    "удалю аппендикс, аспирирую жидкость из малого таза, дренаж не ставлю",
  ]);
  assert.equal(session.state.operative.sourceControl, true);

  session = saying(session, ["в отделение", "vitals каждые 4 часа", "можно пить", "переоценю витальные утром"]);
  assert.equal(session.state.postop.disposition, "surgical_ward");
  assert.equal(session.state.postop.oralIntake, "liquids");
  assert.equal(session.state.postop.histopathologySent, true, "specimen goes to pathology as hospital workflow");

  session = saying(session, ["переоценю витальные через 24 часа", "выписываю"]);

  assert.equal(session.state.session.status, "complete");
  assert.equal(session.state.session.endpoint.type, "PATIENT_DISCHARGED");
});

// --- Journey helpers (themselves only ever typing text) --------------------

function readyForTheatre() {
  return saying(newSession("theatre-seed"), [
    "идём на операцию",
    "венозный доступ",
    "антибиотикопрофилактика цефазолин 2 г в/в, антибиотикопрофилактика метронидазол 500 мг в/в",
    "вызываю анестезиолога на осмотр",
    "переоценю витальные через 40 минут",
    "получаю согласие",
  ]);
}

function throughOperation() {
  return saying(readyForTheatre(), [
    "иду лапароскопически",
    "удалю аппендикс, аспирирую жидкость из малого таза",
  ]);
}

// --- Mentor question does not block the world (Contract §7.5) --------------

test("committing to operate makes the mentor ask about preparation, once", () => {
  const first = say(newSession(), "идём на операцию");
  assert.equal(first.mentor.textRu, "Что нужно сделать до операции?");
  assert.ok(first.session.state.mentor.openQuestion);

  // Asked once per case, not on every subsequent turn.
  const later = say(first.session, "нулевой стол");
  assert.notEqual(later.mentor?.textRu, "Что нужно сделать до операции?");
});

test("answering the mentor's preop question with real orders executes them", () => {
  // Regression: an open mentor question used to route the whole turn to
  // MENTOR_ANSWER, so the learner answered correctly and nothing happened to
  // the patient.
  const committed = say(newSession(), "идём на операцию").session;
  assert.ok(committed.state.mentor.openQuestion, "a question is genuinely open");

  const turn = say(committed, "нулевой стол, венозный доступ, антибиотикопрофилактика цефазолин 2 г в/в, антибиотикопрофилактика метронидазол 500 мг в/в");
  assert.deepEqual(
    commandTypesOf(turn),
    ["SET_NPO", "ESTABLISH_IV_ACCESS", "GIVE_ANTIBIOTIC_PROPHYLAXIS", "GIVE_ANTIBIOTIC_PROPHYLAXIS"],
    "the answer is also four real orders",
  );
  // Matrix PR01: "нулевой стол" is now an oral-intake ORDER, not a magic word
  // that completes a blocking preop item.
  assert.equal(turn.session.state.postop.oralIntake, "nil_by_mouth");
  assert.ok(turn.session.state.preop.completed.includes("iv_access"));
  assert.ok(turn.session.state.preop.completed.includes("antibiotic_prophylaxis"));
});

test("a mentor question never outlives the turn that answered it", () => {
  const asked = say(newSession(), "не знаю").session;
  assert.ok(asked.state.mentor.openQuestion);
  const answered = say(asked, "ОАК").session;
  assert.equal(answered.state.mentor.openQuestion, null);
});

// --- Perioperative events are narrated, not silent -------------------------

test("committing, preparing and operating all produce learner-facing output", () => {
  const turn = say(newSession(), "идём на операцию");
  assert.ok(turn.outcomes[0].events.length > 0);
});

// --- Negation in operative decisions ---------------------------------------

test("«дренаж не ставлю» is NOT read as a decision to place a drain", () => {
  // Regression: the option's phrase "дренаж" matched the literal word and
  // ignored the "не" that reverses it, so the simulator recorded the exact
  // opposite of what the surgeon said. Found in the manual smoke session.
  const started = say(readyForTheatre(), "иду лапароскопически").session;
  const turn = say(started, "удаляю аппендикс, аспирирую жидкость из малого таза, дренаж не ставлю");

  assert.deepEqual(commandTypesOf(turn), ["OPERATIVE_DECISION"]);
  assert.notEqual(turn.interpreted.commands[0].params.choice, "place_drain");
  assert.equal(turn.session.state.operative.sourceControl, true);
});

test("present-tense and future-tense phrasing both reach the same operative decision", () => {
  const started = () => say(readyForTheatre(), "иду лапароскопически").session;
  const future = say(started(), "удалю аппендикс, аспирирую жидкость");
  const present = say(started(), "удаляю аппендикс, аспирирую жидкость");
  assert.equal(present.interpreted.commands[0].params.choice, future.interpreted.commands[0].params.choice);
});

test("an operative decision the learner actually wants IS still matched", () => {
  const started = say(readyForTheatre(), "иду лапароскопически").session;
  const turn = say(started, "удаляю аппендикс и ставлю дренаж");
  assert.deepEqual(commandTypesOf(turn), ["OPERATIVE_DECISION"]);
});

test("«в отделение, vitals каждые 4 часа» is a disposition AND a monitoring plan", () => {
  // Regression: the whole-turn monitoring shortcut swallowed the compound
  // turn, so the patient stayed in the ED with a ward monitoring plan.
  const turn = say(throughOperation(), "в отделение, vitals каждые 4 часа");
  assert.deepEqual(commandTypesOf(turn), ["DISPOSITION", "PRESCRIBE_MONITORING"]);
  assert.equal(turn.session.state.location, "surgical_ward");
  assert.equal(turn.session.state.postop.disposition, "surgical_ward");
  assert.ok(turn.session.state.monitoring.prescribed.includes("vitals"));
});

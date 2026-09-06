import { test } from "node:test";
import assert from "node:assert/strict";

import { createSession } from "./createSession.js";
import { submitLearnerTurn } from "./submitLearnerTurn.js";
import { withShared } from "../content/loadBundle.js";
import { renderEvent } from "../../ai/renderer/renderEvent.js";
import { renderNoPendingWork, renderUnrecognizedFragments } from "../../ai/renderer/renderStatus.js";
import diseaseBundle from "../../content/generated/appendicitis.json" with { type: "json" };
import sharedBundle from "../../content/generated/shared.json" with { type: "json" };

const bundle = withShared(diseaseBundle, sharedBundle);

function newSession(seed = "mtcms870-4v7hpo") {
  return createSession({
    sessionId: "reported-session-regression",
    seed,
    mode: "reference",
    casePresetId: "APP-004",
    sessionPurpose: "internal_development",
    bundle,
    locale: "ru",
    startIso: "2026-08-23T08:32:00+05:00",
  });
}

const say = (session, text) => submitLearnerTurn({ session, text });
const commandTypes = (turn) => turn.interpreted.commands.map((command) => command.type);

test("reported session: «опрос и посмотреть живот» performs both actions", () => {
  const turn = say(newSession(), "опрос и посмотреть живот");
  assert.deepEqual(commandTypes(turn), ["TAKE_HISTORY", "EXAMINE"]);
  assert.equal(turn.session.state.observations.history.length, 1);
  assert.equal(turn.session.state.observations.examinations.at(-1).region, "abdomen");
  assert.deepEqual(turn.interpreted.unmatchedFragments, []);
});

test("reported session: a focused vomiting question is answered from generated patient truth", () => {
  const turn = say(newSession(), "рвота была?");
  assert.deepEqual(commandTypes(turn), ["ASK_PATIENT"]);
  assert.deepEqual(turn.outcomes.map((result) => result.outcome), ["EXECUTED"]);
  const event = turn.outcomes[0].events.find((candidate) => candidate.type === "PATIENT_QUESTION_ANSWERED");
  const rendered = renderEvent({ event, bundle, patient: turn.session.patient });
  assert.equal(rendered.speakerRu, "Пациент");
  assert.equal(rendered.textRu, turn.session.patient.presentation.nauseaVomitingRu);
});

test("reported session: mixed tests keep chemistry and report the unsupported fragment", () => {
  const turn = say(
    newSession(),
    "оак, оам, узи обп и омт, алт аст билирубин креатинин мочевина срб",
  );
  const ordered = turn.interpreted.commands.map((command) => command.params.testId);
  assert.deepEqual(ordered, ["cbc", "urinalysis", "ultrasound_abdomen", "crp", "chemistry"]);
  assert.deepEqual(
    [...turn.interpreted.commands.at(-1).params.analytes].sort(),
    ["alt_ast", "bilirubin", "creatinine", "urea"],
  );
  assert.deepEqual(turn.interpreted.unmatchedFragments, ["омт"]);
  assert.match(renderUnrecognizedFragments(turn.interpreted.unmatchedFragments).textRu, /ОМТ|омт/);
});

test("reported session: «получить резульатты» advances to the next due result", () => {
  const ordered = say(newSession(), "ОАК, ОАМ и СРБ").session;
  const turn = say(ordered, "получить резульатты");
  assert.deepEqual(commandTypes(turn), ["WAIT"]);
  assert.equal(turn.session.state.clock.elapsedMinutes, 60);
  assert.equal(turn.session.state.investigations.urinalysis.status, "resulted");
  assert.equal(turn.session.state.investigations.cbc.status, "ordered");
  assert.ok(turn.timeEvents.some((event) => event.type === "TEST_RESULTED"));
});

test("waiting for results with nothing pending produces a visible response", () => {
  const turn = say(newSession(), "получить результаты");
  assert.deepEqual(turn.outcomes.map((result) => result.outcome), ["NO_PENDING_WORK"]);
  assert.match(renderNoPendingWork().textRu, /нет назначенных/i);
});

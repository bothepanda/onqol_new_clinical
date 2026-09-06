import { test } from "node:test";
import assert from "node:assert/strict";
import { renderStatusSnapshot } from "./renderStatus.js";
import { withShared } from "../../core/content/loadBundle.js";
import { createSession } from "../../core/session/createSession.js";
import { submitLearnerTurn } from "../../core/session/submitLearnerTurn.js";
import { buildLearnerVisibleState } from "../../core/state/learnerView.js";
import diseaseBundle from "../../content/generated/appendicitis.json" with { type: "json" };
import sharedBundle from "../../content/generated/shared.json" with { type: "json" };

const bundle = withShared(diseaseBundle, sharedBundle);

// The three reviewed postoperative pain lines, verbatim.
const COPY = {
  significant: "Послеоперационная боль выраженная.",
  improving: "Послеоперационная боль уменьшается.",
  controlled_on_oral_analgesia: "Послеоперационная боль контролируется пероральными анальгетиками.",
};
const OBSOLETE = /не моделируется/;

function snapshotFor(learnerVisiblePatch) {
  const base = {
    clock: { elapsedMinutes: 600 },
    location: "surgical_ward",
    physiologyKnownAt: { atMinutes: 590, values: { heartRate: 88, systolicBp: 120, respiratoryRate: 16, temperatureC: 37.2 } },
    painScore: null,
    painState: "post_source_control",
    postopPainStage: null,
    revealedResults: [],
  };
  return renderStatusSnapshot({ ...base, ...learnerVisiblePatch });
}

// --- A/B/C: each stage renders its reviewed copy ---------------------------

for (const stage of ["significant", "improving", "controlled_on_oral_analgesia"]) {
  test(`postoperative status snapshot renders the reviewed Russian copy for stage "${stage}"`, () => {
    const rendered = snapshotFor({ postopPainStage: stage });
    assert.ok(rendered.textRu.includes(COPY[stage]), `expected "${COPY[stage]}" in: ${rendered.textRu}`);
    assert.equal(OBSOLETE.test(rendered.textRu), false, "obsolete 'not modelled' statement must be gone");
    // No numeric pain score is introduced.
    assert.equal(/Боль\s+\d/.test(rendered.textRu), false);
    // Only the one reviewed line for this stage - no other stage's wording.
    for (const other of Object.keys(COPY).filter((s) => s !== stage)) {
      assert.equal(rendered.textRu.includes(COPY[other]), false);
    }
  });
}

// --- D: the obsolete statement never appears when the trajectory is authoritative

test("D: the obsolete 'послеоперационная боль ... не моделируется' line never appears post-source-control", () => {
  // No stage set yet -> no pain line at all, and certainly not the old text.
  const none = snapshotFor({ postopPainStage: null });
  assert.equal(OBSOLETE.test(none.textRu), false);
  assert.equal(/Послеоперационная боль/.test(none.textRu), false, "no stage set -> no postoperative pain line (never time-inferred)");
  for (const stage of Object.keys(COPY)) {
    assert.equal(OBSOLETE.test(snapshotFor({ postopPainStage: stage }).textRu), false);
  }
});

// --- The stage shown is the one the live approved model actually wrote -----

test("the rendered stage is exactly the authoritative model output, never inferred from elapsed time", () => {
  let session = createSession({
    sessionId: "renderstatus-postop",
    seed: "renderstatus-postop",
    mode: "reference",
    casePresetId: "APP-004",
    sessionPurpose: "internal_development",
    bundle,
    locale: "ru",
    startIso: "2026-08-25T09:00:00+05:00",
  });
  const toTheatre = [
    "идём на операцию",
    "венозный доступ",
    "антибиотикопрофилактика цефазолин 2 г в/в, антибиотикопрофилактика метронидазол 500 мг в/в",
    "вызываю анестезиолога на осмотр",
    "переоценю витальные через 40 минут",
    "получаю согласие",
    "иду лапароскопически",
    "удаляю аппендикс, аспирирую жидкость, дренаж не ставлю",
    "в отделение, vitals каждые 4 часа",
  ];
  for (const text of toTheatre) session = submitLearnerTurn({ session, text }).session;
  assert.equal(session.state.operative.completed, true);

  // Immediately after the operation, before the first milestone: the model's
  // declared initial state ("significant").
  const early = submitLearnerTurn({ session, text: "переоценю боль через 30 минут" });
  session = early.session;
  const earlyView = buildLearnerVisibleState(session.state);
  assert.equal(earlyView.postopPainStage, "significant");
  assert.ok(renderStatusSnapshot(earlyView).textRu.includes(COPY.significant));

  // Well past both milestone gates: "improving" then "controlled_on_oral_analgesia".
  session = submitLearnerTurn({ session, text: "переоценю боль через 4 часа" }).session;
  session = submitLearnerTurn({ session, text: "переоценю боль через 12 часов" }).session;
  const lateView = buildLearnerVisibleState(session.state);
  assert.equal(lateView.postopPainStage, session.state.symptoms.postopPainStage);
  assert.ok(["improving", "controlled_on_oral_analgesia"].includes(lateView.postopPainStage));
  assert.ok(renderStatusSnapshot(lateView).textRu.includes(COPY[lateView.postopPainStage]));
});

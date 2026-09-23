// The grounded mentor pipeline for fluids_01 with a scripted provider:
// retrieved cards -> draft -> verifier -> at most one regeneration -> safe fallback.
// The provider is faked, so these prove the DETERMINISTIC guarantees (what may
// be offered, cited, quoted, counted); the verifier's own judgement is only
// exercised live (docs/WAVE_B_FLUIDS_VALIDATION_REPORT.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderGroundedMentorText } from "./statefulGroundedMentor.js";
import { runGroundedDialogue, FALLBACK } from "./groundedDialogue.js";
import { buildRetrievalView } from "./cardRetrieval.js";
import { buildLearnerVisibleState } from "../../core/state/learnerView.js";
import { resident, dialogueContext, fluidsLibrary } from "../../content/diseases/fluids_01/fluidsHarness.js";

const ALL_TRUE = { supported: true, patientGrounded: true, noNewManagement: true, noHiddenDiagnosis: true, appropriateQuestion: true, allSentencesClassified: true, noFalseAttribution: true, reasons: [] };
const STATEMENT = "При ресусцитации вводят 500 мл кристаллоида за менее чем 15 минут и сразу переоценивают ЧСС, АД, CRT, диурез и лёгкие.";
const sentence = (text, kind = "clinical", cardIds = ["FLU-RESUS-001"], factIds = []) => ({ text, kind, cardIds, factIds });
const draft = (sentences, question = { text: "Что из этого ты сделаешь сейчас?", expects: "решение о переоценке" }) => ({ mode: "TEACH", sentences, question });

function provider({ drafts, verdicts = [] }) {
  const calls = [];
  return {
    calls,
    async complete(request) {
      calls.push(request);
      const name = request.responseFormat.json_schema.name;
      const queue = name === "mentor_draft" ? drafts : verdicts;
      const next = queue.length > 1 ? queue.shift() : queue[0] ?? ALL_TRUE;
      return { text: JSON.stringify(next), meta: {} };
    },
  };
}
const draftCalls = (p) => p.calls.filter((c) => c.responseFormat.json_schema.name === "mentor_draft");

function scene() {
  const r = resident({ seed: "grounded" });
  r.say("измеряю давление и пульс");
  const record = r.say("болюс 500 мл стерофундина");
  return {
    r,
    record,
    args: {
      context: dialogueContext(r, record),
      issueId: record.mentor.openQuestion.issueId,
      library: fluidsLibrary,
      visibleState: buildRetrievalView(buildLearnerVisibleState(r.state)),
      concepts: record.mentor.concepts,
      deterministicFallbackText: record.mentor.textRu,
    },
  };
}

test("an approved, cited, number-faithful draft is accepted and audited with its cards", async () => {
  const { args } = scene();
  const p = provider({ drafts: [draft([sentence(STATEMENT)])] });
  const result = await renderGroundedMentorText({ provider: p, ...args });
  assert.equal(result.audit.status, "accepted");
  assert.deepEqual(result.audit.cardIds, ["FLU-RESUS-001"]);
  assert.equal(result.audit.regenerations, 0);
});

test("the provider is offered only a bounded, approved subset - never the library, never a pending or draft card", async () => {
  const { args } = scene();
  const lib = structuredClone(fluidsLibrary);
  lib.cards.push({ ...structuredClone(lib.cards[0]), id: "FLU-DRAFT-999", review_status: "draft", reviewed_by: [], retrieval: { issue_ids: [args.issueId] } });
  const p = provider({ drafts: [draft([sentence(STATEMENT)])] });
  await renderGroundedMentorText({ provider: p, ...args, library: lib });
  const offered = draftCalls(p)[0] && JSON.parse(draftCalls(p)[0].messages[1].content).cards.map((c) => c.id);
  assert.ok(offered.length > 0 && offered.length <= fluidsLibrary.retrieval_limit, `offered ${offered.length}`);
  assert.ok(!offered.includes("FLU-DRAFT-999"), "a draft card was offered");
  assert.ok(!offered.includes("FLU-RESUS-002"), "the pending_review card was offered");
});

test("a draft card cannot be cited: it is not in the scoped library, so the draft is rejected, regenerated once, and the safe fallback is shown", async () => {
  const { args } = scene();
  const p = provider({ drafts: [draft([sentence(STATEMENT, "clinical", ["FLU-DRAFT-999"])])] });
  const result = await renderGroundedMentorText({ provider: p, ...args });
  assert.equal(result.audit.status, "fallback");
  assert.equal(result.audit.regenerations, 1);
  assert.equal(result.text, args.deterministicFallbackText);
});

test("the pending_review card cannot be cited even though it exists in the library", async () => {
  const { args } = scene();
  const pending = fluidsLibrary.cards.find((c) => c.review_status === "pending_review");
  assert.equal(pending.id, "FLU-RESUS-002");
  const p = provider({ drafts: [draft([sentence(pending.statement, "clinical", [pending.id])])] });
  const result = await renderGroundedMentorText({ provider: p, ...args });
  assert.equal(result.audit.status, "fallback");
  assert.ok(!result.text.includes("250"));
  assert.equal(result.text, args.deterministicFallbackText);
});

test("F10 an unsupported number is rejected: a figure that is not in the cited card never reaches the learner", async () => {
  const { args } = scene();
  const p = provider({ drafts: [draft([sentence("При ресусцитации вводят 750 мл кристаллоида за менее чем 15 минут.")])] });
  const result = await renderGroundedMentorText({ provider: p, ...args });
  assert.equal(result.audit.status, "fallback");
  assert.ok(!/750/.test(result.text));
  // ...and a number in the QUESTION is never allowed.
  const q = provider({ drafts: [draft([sentence(STATEMENT)], { text: "Сколько мл ты введёшь через 30 минут?", expects: "объём" })] });
  assert.equal((await renderGroundedMentorText({ provider: q, ...args })).audit.status, "fallback");
});

test("an unsupported treatment recommendation is rejected by the verifier; one regeneration may recover, a second failure falls back", async () => {
  const { args } = scene();
  const bad = { ...ALL_TRUE, noNewManagement: false, reasons: ["unsupported_management"] };
  const recovers = provider({ drafts: [draft([sentence(STATEMENT)])], verdicts: [bad, ALL_TRUE] });
  const ok = await renderGroundedMentorText({ provider: recovers, ...args });
  assert.equal(ok.audit.status, "accepted");
  assert.equal(ok.audit.regenerations, 1);
  const stuck = provider({ drafts: [draft([sentence(STATEMENT)])], verdicts: [bad, bad] });
  const failed = await renderGroundedMentorText({ provider: stuck, ...args });
  assert.equal(failed.audit.status, "fallback");
  assert.deepEqual(failed.audit.reasons.includes("unsupported_management"), true);
  assert.equal(failed.text, args.deterministicFallbackText);
});

test("a hidden patient fact is rejected: a fact id the learner was never shown, or a value that is not in the shown fact", async () => {
  const { r, record, args } = scene();
  const factId = args.context.facts.find((f) => f.text.startsWith("Измерено"))?.id;
  assert.ok(factId, "the measurement the learner took is a displayed fact");
  const unknownFact = provider({ drafts: [draft([sentence("Креатинин у него 118.", "patient_fact", [], ["never-shown"])])] });
  assert.equal((await renderGroundedMentorText({ provider: unknownFact, ...args })).audit.status, "fallback");
  const invented = provider({ drafts: [draft([sentence("Лактат у него 3,4 в последнем измерении.", "patient_fact", [], [factId])])] });
  assert.equal((await renderGroundedMentorText({ provider: invented, ...args })).audit.status, "fallback");
  const faithful = provider({ drafts: [draft([sentence("В последнем измерении ЧСС 112.", "patient_fact", [], [factId])])] });
  assert.equal((await renderGroundedMentorText({ provider: faithful, ...args })).audit.status, "accepted");
  // the brief itself carries nothing hidden
  const brief = JSON.stringify(r.briefFor(record));
  assert.ok(!brief.includes("118") && !brief.includes("akiCreatinine"));
});

test("a false source attribution is rejected", async () => {
  const { args } = scene();
  const bad = { ...ALL_TRUE, noFalseAttribution: false, reasons: ["false_attribution"] };
  const p = provider({ drafts: [draft([sentence("По KDIGO вводят 500 мл кристаллоида за менее чем 15 минут.")])], verdicts: [bad, bad] });
  const result = await renderGroundedMentorText({ provider: p, ...args });
  assert.equal(result.audit.status, "fallback");
  assert.ok(result.audit.reasons.includes("false_attribution"));
});

test("scope: a session purpose the library is not approved for never reaches the provider", async () => {
  const { args } = scene();
  const p = provider({ drafts: [draft([sentence(STATEMENT)])] });
  const result = await runGroundedDialogue({ provider: p, context: { ...args.context, sessionPurpose: "learner_pilot" }, library: fluidsLibrary });
  assert.equal(result.audit.errorCode, "scope_not_approved");
  assert.equal(result.text, FALLBACK);
  assert.equal(p.calls.length, 0);
});

test("the library-level policy addendum reaches BOTH the author and the verifier", async () => {
  const { args } = scene();
  const p = provider({ drafts: [draft([sentence(STATEMENT)])] });
  await renderGroundedMentorText({ provider: p, ...args });
  for (const call of p.calls) assert.match(call.messages[0].content, /ДОПОЛНЕНИЕ ДЛЯ ЭТОЙ БИБЛИОТЕКИ/);
});

test("the resident's own number may be restated in a conversational sentence, never in a clinical one or the question", async () => {
  const { args } = scene();
  const ok = provider({ drafts: [draft([sentence("Вводишь 500 мл болюсом.", "conversation", []), sentence(STATEMENT)])] });
  assert.equal((await renderGroundedMentorText({ provider: ok, ...args })).audit.status, "accepted");
  // A number that is neither in the cited card/fact nor in the resident's words is not:
  const invented = provider({ drafts: [draft([sentence("Вводишь 700 мл болюсом.", "conversation", [])])] });
  assert.equal((await renderGroundedMentorText({ provider: invented, ...args })).audit.status, "fallback");
});

test("a refused draft records a categorical reason code, never content", async () => {
  const { args } = scene();
  const p = provider({ drafts: [draft([sentence("При ресусцитации вводят 750 мл.")])] });
  const result = await renderGroundedMentorText({ provider: p, ...args });
  assert.deepEqual(result.audit.reasons, ["unsupported_number"]);
});

test("a library may reserve the grounded rewrite for higher scaffold rungs: below it, no provider call is made", async () => {
  const { args } = scene();
  const p = provider({ drafts: [draft([sentence(STATEMENT)])] });
  const low = await renderGroundedMentorText({ provider: p, ...args, intent: { mode: "PROBE", scaffolding: 1, expects: [], questionRu: "Как поймёшь, что болюс подействовал?" } });
  assert.equal(p.calls.length, 0);
  assert.equal(low.audit.errorCode, "deterministic_by_policy");
  assert.equal(low.text, args.deterministicFallbackText);
  const high = await renderGroundedMentorText({ provider: p, ...args, intent: { mode: "TEACH", scaffolding: 3, expects: [], questionRu: "x" } });
  assert.ok(p.calls.length > 0 && high.audit.status === "accepted");
});

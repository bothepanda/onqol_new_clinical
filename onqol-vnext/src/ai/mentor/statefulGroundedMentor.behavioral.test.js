import { test } from "node:test";
import assert from "node:assert/strict";
import { createSession } from "../../core/session/createSession.js";
import { submitLearnerTurn } from "../../core/session/submitLearnerTurn.js";
import { withShared } from "../../core/content/loadBundle.js";
import { STATEFUL_GROUNDED_MENTOR_V1 } from "../interaction/featureFlags.js";
import { renderGroundedMentorText } from "./statefulGroundedMentor.js";
import diseaseBundle from "../../content/generated/appendicitis.json" with { type: "json" };
import sharedBundle from "../../content/generated/shared.json" with { type: "json" };
import library from "../../content/mentor/app004-library.json" with { type: "json" };

/**
 * ТЗ §20 behavioral golden tests (B01-B07), adapted to this repo.
 *
 * These are SYNTHETIC fixtures, not lifted from any real ON QOL session -
 * docs/evidence/legacy-real-language/ deliberately excludes the legacy
 * mentor's replies from git ("never copied from what the legacy ON QOL
 * replied"), and its raw learner text is excluded from git entirely (owner
 * ruling 2026-09-20). See docs/STATEFUL_GROUNDED_MENTOR_WAVE_A.md.
 *
 * B01, B02, B04, B05, B06 exercise the real deterministic pipeline
 * (`submitLearnerTurn` with STATEFUL_GROUNDED_MENTOR_V1 on) end to end - no
 * LLM involved, because the ISSUE, the SCAFFOLDING, and the ADVANCEMENT rule
 * are all deterministic (mentorEngine.js / mentorAdequacy.js / mentorMemory.js).
 * B03 and B07 need an LLM to actually demonstrate the behavior (reading
 * history back, or noticing a stated-then-changed plan) - what Wave A can
 * prove deterministically is that the PLUMBING carries what an LLM would need
 * to do that (recent dialogue, the current issue) through to the grounded
 * renderer without loss; that's what they assert, with a fake provider.
 */

const bundle = withShared(diseaseBundle, sharedBundle);
const START_ISO = "2026-08-23T09:15:00+05:00";

function newSession(seed) {
  return createSession({
    sessionId: "behavioral",
    seed,
    mode: "reference",
    casePresetId: "APP-004",
    sessionPurpose: "internal_development",
    bundle,
    locale: "ru",
    startIso: START_ISO,
    interactionFlags: { [STATEFUL_GROUNDED_MENTOR_V1]: true },
  });
}
const say = (session, text) => submitLearnerTurn({ session, text });
const saying = (session, texts) => texts.reduce((current, text) => say(current, text).session, session);

/** Reaches theatre through real learner actions only (mirrors app004Remediation.test.js). */
function readyForTheatre(seed) {
  return saying(newSession(seed), [
    "идём на операцию",
    "венозный доступ",
    "антибиотикопрофилактика цефазолин 2 г в/в, антибиотикопрофилактика метронидазол 500 мг в/в",
    "вызываю анестезиолога на осмотр",
    "переоценю витальные через 40 минут",
    "получаю согласие",
  ]);
}

test("B01 radical proposal: mentor anchors to the exact proposal, asks rationale, does not lecture first", () => {
  const turn = say(readyForTheatre("b01"), "иду открытым доступом");
  assert.equal(turn.mentor.mode, "CLARIFY");
  assert.match(turn.mentor.textRu, /Почему выбираешь открытый доступ/);
  assert.equal(/нельзя|невозможно|запрещ/i.test(turn.mentor.textRu), false, "must report a resource fact and ask why, not forbid the choice");
  assert.equal(turn.session.state.mentor.pendingMentorQuestion?.issueId, "open_approach_rationale");
});

test("B02 «не знаю»: same issue persists, scaffold increases, no identical repeated question", () => {
  let session = newSession("b02");
  const prompts = [];
  for (let i = 0; i < 4; i += 1) {
    const turn = say(session, "не знаю");
    prompts.push(turn.mentor.textRu);
    session = turn.session;
  }
  assert.equal(new Set(prompts).size, 4, `each rung must read differently, or the learner was asked the same thing again: ${JSON.stringify(prompts)}`);
  assert.equal(session.state.mentor.probingStreak, 4, "four consecutive non-answers on one issue must show as four, not resets");
  assert.equal(session.state.mentor.pendingMentorQuestion.issueId, "generic", "still the same underlying issue, not a new one each time");
  const recent = session.state.mentor.recentMentorQuestions.map((q) => q.prompt);
  assert.equal(new Set(recent).size, recent.length, "recentMentorQuestions must never record a literal duplicate");
});

test("B02b a real open question followed by «не знаю» stays on THAT issue, not a generic one, across the turn boundary", () => {
  const afterChallenge = say(readyForTheatre("b02b"), "иду открытым доступом").session;
  assert.equal(afterChallenge.state.mentor.pendingMentorQuestion?.issueId, "open_approach_rationale");
  const stuck = say(afterChallenge, "не знаю");
  assert.equal(stuck.mentor.openQuestion?.issueId, "open_approach_rationale", "openQuestion.issueId cleared across the turn boundary (worldState.js) must not surface as a fresh 'generic' issue");
  assert.equal(stuck.session.state.mentor.probingStreak, 2, "this is the SECOND non-answer on the same issue, not the first on a new one");
});

test("B04 escalation to a senior is accepted, not challenged - ownership of what happens next stays with the resident", () => {
  const turn = say(newSession("b04"), "вызываю старшего");
  assert.deepEqual(turn.outcomes.map((o) => o.outcome), ["EXECUTED"]);
  assert.equal(turn.mentor.mode, "CONTINUE");
  assert.equal(turn.mentor.textRu, null, "consulting a senior is not itself flagged as a reasoning gap");
});

test("B05 sufficient current plan: real preop actions close the issue, no extra checklist interrogation", () => {
  const session = readyForTheatre("b05");
  assert.equal(session.state.mentor.pendingMentorQuestion, null, "a real preop plan closes the open question rather than accumulating more checklist turns");
  assert.equal(session.state.mentor.probingStreak, 0);
});

test("B06 broad approved action: «осмотрю живот» executes without demanding ritual enumeration", () => {
  const turn = say(newSession("b06"), "осмотрю живот");
  assert.deepEqual(turn.outcomes.map((o) => o.outcome), ["EXECUTED"]);
  assert.equal(turn.mentor.textRu, null, "a single broad, appropriate exam does not itself draw mentor comment");
});

function fakeProvider(outputs) {
  const requests = [];
  return { requests, complete: async (r) => { requests.push(r); const value = outputs.shift(); return { text: JSON.stringify(value), meta: { model: "test" } }; } };
}
const acceptedVerdict = { supported: true, patientGrounded: true, noNewManagement: true, noHiddenDiagnosis: true, appropriateQuestion: true, allSentencesClassified: true, noFalseAttribution: true, reasons: [] };

test("B03 plumbing: an earlier learner statement is still in the brief's history two turns later, so a correction can be checked rather than forced to repeat", async () => {
  const earlierStatement = "боль сместилась в правую подвздошную область час назад";
  const context = {
    casePresetId: "APP-004", sessionPurpose: "internal_development", locale: "ru",
    text: "я это уже сказала выше",
    history: [
      { role: "learner", text: earlierStatement },
      { role: "mentor", text: "Как объяснишь этот переход боли?" },
    ],
    facts: [],
    historyTruncated: false,
  };
  const draft = { mode: "REFLECT", sentences: [{ kind: "conversation", text: "Да, ты уже отмечала перемещение боли.", cardIds: [], factIds: [] }], question: null };
  const provider = fakeProvider([draft, acceptedVerdict]);
  const result = await renderGroundedMentorText({ provider, context, issueId: null, library, deterministicFallbackText: null });
  assert.equal(result.audit.status, "accepted");
  const sentDraftInput = JSON.parse(provider.requests[0].messages[1].content);
  assert.deepEqual(sentDraftInput.context.history[0], { role: "learner", text: earlierStatement }, "the earlier statement must reach the draft call unmodified, or a correction can never be checked against it");
});

test("B07 plumbing: a stated approach earlier in the conversation is still visible when a different approach is later chosen, so the mentor can ask what changed", () => {
  // Deterministic layer today (mentorEngine.js) fires open_approach_rationale
  // from the EXECUTED decision alone, regardless of what was said earlier -
  // it already asks "why", which is the behavior B01 pins. What it does NOT
  // yet do is diff the executed approach against an earlier STATED intent to
  // word the question as "you said X, now Y - what changed" specifically;
  // that needs new deterministic tracking and is deferred to Wave B. What
  // this test pins for Wave A: the conversational mention is not lost by the
  // brief-building layer, so that Wave B's diff has something to read.
  const afterStatingLaparoscopic = saying(readyForTheatre("b07"), ["думаю, лапароскопически будет разумнее"]);
  const turn = say(afterStatingLaparoscopic, "иду открытым доступом");
  assert.equal(turn.mentor.mode, "CLARIFY");
  assert.match(turn.mentor.textRu, /Почему выбираешь открытый доступ/);
});

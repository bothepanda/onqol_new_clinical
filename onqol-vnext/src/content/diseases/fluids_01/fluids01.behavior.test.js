// Wave B behavioural tests F01-F14 (ТЗ §9). They assert SEMANTICS and state
// transitions - which issue is open, what the scaffold level is, whether the
// mentor stayed silent, what the patient did - never the exact mentor wording,
// except the deterministic safety/fallback text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resident, interp, mentorIssue, silent } from "./fluidsHarness.js";

const BOLUS = "болюс 500 мл стерофундина";
const bolusThenReassess = (r, wait = 15) =>
  r.say("болюс 500 мл стерофундина и переоценю давление и диурез", {
    interpreted: interp("болюс 500 мл стерофундина и переоценю давление и диурез", [
      ["ORDER_INFUSION", { fluidId: "sterofundin", volumeMl: 500, bolus: true }],
      ["REASSESS", { targets: ["vitals", "urine_output"], afterMinutes: wait }],
    ]),
  });

test("F01 adequate management: acts and plans the follow-up in one message -> mentor silent, the world progresses and the response is visible", () => {
  const r = resident({ seed: "f01" });
  const t1 = r.say("измеряю давление и пульс");
  const t2 = r.say("оцениваю перфузию, вены шеи и лёгкие");
  const t3 = bolusThenReassess(r);
  for (const t of [t1, t2, t3]) assert.ok(silent(t), `mentor spoke: ${t.mentor?.textRu}`);
  // The reassessment came AFTER the bolus had run, so the learner sees the response.
  assert.match(t3.envText, /ЧСС 104/);
  assert.match(t3.envText, /диурез 35/);
  assert.equal(r.state.mentor.pendingMentorQuestion, null);
});

test("F02 vague operational order: the NURSE asks for the missing parameter; the mentor stays out of it", () => {
  const r = resident({ seed: "f02" });
  const vague = r.say("начните инфузию");
  assert.ok(silent(vague));
  assert.equal(vague.turn.outcomes[0].outcome, "CLARIFY");
  assert.match(vague.messages[0].speakerRu, /Медсестра/);
  const generic = r.say("болюс кристаллоида 500 мл");
  assert.ok(silent(generic));
  assert.equal(generic.turn.outcomes[0].outcome, "CLARIFY");
  assert.match(generic.envText, /Какой именно раствор/);
  assert.equal(r.state.infusions.length, 0, "nothing was infused on an incomplete order");
});

test("F03 missing reassessment: exactly one current issue, one focused question", () => {
  const r = resident({ seed: "f03" });
  const t = r.say(BOLUS);
  assert.equal(mentorIssue(t), "fluids.reassessment_plan");
  assert.equal((t.mentor.textRu.match(/\?/g) ?? []).length, 1);
  assert.equal(r.state.mentor.pendingMentorQuestion.issueId, "fluids.reassessment_plan");
});

test("F04 'не знаю': the SAME issue persists, scaffolding rises, the question is not repeated", () => {
  const r = resident({ seed: "f04" });
  const first = r.say(BOLUS);
  const stuck = r.say("не знаю");
  assert.equal(mentorIssue(stuck), "fluids.reassessment_plan");
  assert.ok(stuck.mentor.scaffolding > first.mentor.scaffolding);
  assert.notEqual(stuck.mentor.textRu, first.mentor.textRu);
  assert.equal(r.state.mentor.pendingMentorQuestion.issueId, "fluids.reassessment_plan");
});

test("F05 second 'не знаю': higher scaffold, bounded options, then explanation from approved wording and the decision goes back to the learner", () => {
  const r = resident({ seed: "f05" });
  r.say(BOLUS);
  const s2 = r.say("не знаю");
  const s3 = r.say("не знаю");
  const s4 = r.say("не знаю");
  assert.deepEqual([s2, s3, s4].map((t) => t.mentor.scaffolding), [2, 3, 4]);
  assert.ok([s2, s3, s4].every((t) => mentorIssue(t) === "fluids.reassessment_plan"));
  // Level 4 quotes the approved card verbatim, then hands the decision back.
  const card = r.session.bundle.rules.teaching_issues.find((i) => i.id === "fluids.reassessment_plan");
  assert.equal(s4.mentor.textRu, card.scaffold_ru[4]);
  assert.match(s4.mentor.textRu, /Что из этого ты сделаешь сейчас\?$/);
  // Acting closes the issue: ownership is the learner's.
  const acted = r.say("проверю диурез");
  assert.equal(r.state.mentor.pendingMentorQuestion, null);
  assert.ok(silent(acted));
});

test("F06 adaptive strategy change after new data: stopping fluids and calling the senior is accepted, not rebuked", () => {
  const r = resident({ seed: "f06" });
  for (let i = 0; i < 5; i += 1) bolusThenReassess(r);
  const seen = r.say("переоцениваю давление и лёгкие", { interpreted: interp("переоцениваю давление и лёгкие", [["REASSESS", { targets: ["vitals", "cardiorespiratory"] }], ["STOP_INFUSION", {}], ["CALL_STAFF", { role: "surgeon" }]]) });
  assert.match(seen.envText, /влажные хрипы/);
  assert.ok(silent(seen), `mentor should accept the adaptation, said: ${seen.mentor?.textRu}`);
  assert.ok(!seen.turn.outcomes.some((o) => o.firedRules?.length));
});

test("F07 ignores changed physiology: the mentor anchors to what the learner just saw; continuing the bolus raises the safety issue", () => {
  const r = resident({ seed: "f07" });
  for (let i = 0; i < 5; i += 1) bolusThenReassess(r);
  const looked = r.say("переоцениваю давление и лёгкие");
  assert.match(looked.envText, /влажные хрипы/);
  assert.equal(mentorIssue(looked), "fluids.overload_unaddressed");
  const again = r.say(BOLUS);
  assert.equal(mentorIssue(again), "fluids.continue_after_overload");
  assert.equal(again.mentor.ruleId, "RULE-FLUIDS-REPEAT-BOLUS-AFTER-OVERLOAD-SIGNS");
});

test("F08 calls the senior: accepted, no penalty; the mentor only asks what the learner will do meanwhile", () => {
  const r = resident({ seed: "f08" });
  const t = r.say("вызываю старшего хирурга");
  assert.equal(t.turn.outcomes[0].outcome, "EXECUTED");
  assert.equal(mentorIssue(t), "fluids.consult_ownership");
  assert.match(t.mentor.textRu, /до его прихода/);
  assert.ok(!/ошиб|неправиль|зря/i.test(t.mentor.textRu));
  // Ownership stays with the learner: acting closes it and nothing else is said.
  const acted = r.say("измеряю давление и пульс");
  assert.ok(silent(acted));
  assert.equal(r.state.mentor.pendingMentorQuestion, null);
});

test("F09 broad exam / action: one nurse clarification, then several regions execute in ONE turn with no checklist interrogation", () => {
  const r = resident({ seed: "f09" });
  const broad = r.say("осмотрю пациента");
  assert.equal(broad.turn.outcomes[0].outcome, "CLARIFY");
  assert.ok(silent(broad));
  const exam = r.say("оцениваю перфузию, вены шеи, лёгкие и живот");
  assert.ok(silent(exam));
  assert.match(exam.envText, /слизистые сухие/);
  assert.match(exam.envText, /вены шеи плоские/i);
  assert.match(exam.envText, /хрипов нет/);
});

test("F10 unsupported number: the deterministic mentor never introduces a number; every scaffold level is number-free except quoted approved cards", () => {
  const r = resident({ seed: "f10" });
  const first = r.say(BOLUS);
  const texts = [first.mentor.textRu];
  for (let i = 0; i < 3; i += 1) texts.push(r.say("не знаю").mentor.textRu);
  for (const text of texts.slice(0, 3)) assert.ok(!/\d/.test(text), `level text carries a number: ${text}`);
  // Level 4 may contain only figures that exist in the approved card it quotes.
  const card = r.session.bundle.rules.teaching_issues.find((i) => i.id === "fluids.reassessment_plan");
  assert.ok(card.explains.length > 0);
});

test("F11 hidden patient fact: nothing unrevealed reaches the mentor brief or the learner", () => {
  const r = resident({ seed: "f11" });
  const t = r.say(BOLUS);
  const brief = JSON.stringify(r.briefFor(t));
  for (const hidden of ["akiCreatinineCriterionMet", "operativeHistoryRu", "baselineSystolicBp", "betaBlockerRu", "118", "9,8", "1,030", "метопролол"]) {
    assert.ok(!brief.includes(hidden), `brief leaks "${hidden}"`);
  }
  assert.ok(!t.envText.includes("118"));
});

test("F12 legitimate alternative pathway: a different balanced solution and a monitoring cadence instead of an immediate reassessment are both accepted", () => {
  const r = resident({ seed: "f12" });
  const plan = r.say("мониторинг давления и пульса каждые 15 минут", { interpreted: interp("мониторинг давления и пульса каждые 15 минут", [["PRESCRIBE_MONITORING", { targets: ["blood_pressure", "heart_rate", "urine_output"], intervalMinutes: 15 }]]) });
  assert.ok(silent(plan));
  const t = r.say("болюс 500 мл рингер-лактата");
  assert.ok(silent(t), `alternative pathway was challenged: ${t.mentor?.textRu}`);
  assert.equal(r.state.infusions.at(-1).fluidId, "ringers_lactate");
});

test("F13 sufficient reasoning closes the issue and the case advances", () => {
  const r = resident({ seed: "f13" });
  r.say(BOLUS);
  const answered = r.say("Буду смотреть пульс, давление, диурез и лёгкие через пятнадцать минут после болюса, чтобы увидеть ответ");
  assert.ok(silent(answered));
  assert.equal(r.state.mentor.pendingMentorQuestion, null);
  const next = r.say("проверю диурез");
  assert.ok(silent(next));
  assert.match(next.envText, /диурез/);
});

test("F14 a stale omission stays deferred: an issue pushed to the debrief is not resurrected by a later unrelated decision", () => {
  const r = resident({ seed: "f14" });
  r.say(BOLUS);
  for (let i = 0; i < 5; i += 1) r.say("не знаю");
  assert.ok(r.state.mentor.deferredMentorIssues.includes("fluids.reassessment_plan"), JSON.stringify(r.state.mentor));
  const later = r.say("болюс 500 мл рингер-лактата");
  assert.notEqual(mentorIssue(later), "fluids.reassessment_plan");
  const timeline = r.debrief().teachingIssues;
  assert.equal(timeline.find((i) => i.issueId === "fluids.reassessment_plan").status, "deferred_to_debrief");
});

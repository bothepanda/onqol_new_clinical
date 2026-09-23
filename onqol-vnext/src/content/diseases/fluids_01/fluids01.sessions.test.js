// Five complete scripted residents (ТЗ §10). Each finishes the case with
// "завершить кейс" and is checked for behavioural invariants - issue lifecycle,
// scaffolding, patient progression, mentor silence, deferral, debrief evidence -
// never for the mentor's exact words. Compound clauses the deterministic lexicon
// cannot parse are passed as structured interpretations (`interp`), exactly what
// the semantic interpreter hands the same pipeline in the live app.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resident, interp, silent, mentorIssue } from "./fluidsHarness.js";

const bolusThenLook = (fluidId, targets = ["vitals", "urine_output", "perfusion"]) =>
  interp("болюс и переоценю", [
    ["ORDER_INFUSION", { fluidId, volumeMl: 500, bolus: true }],
    ["REASSESS", { targets, afterMinutes: 15 }],
  ]);
const finish = (r) => r.say("завершить кейс");
const fired = (r) => r.turns.flatMap((t) => t.turn.outcomes.flatMap((o) => (o.firedRules ?? []).map((rule) => rule.id)));
const spokenIssues = (r) => [...new Set(r.turns.filter((t) => !silent(t)).map(mentorIssue))];

test("A strong resident: measures, examines, orders labs, boluses with a follow-up plan twice, monitors - the mentor never speaks and the patient recovers", () => {
  const r = resident({ seed: "A" });
  r.say("измеряю давление и пульс");
  r.say("оцениваю перфузию, вены шеи и лёгкие");
  r.say("проверю диурез");
  r.say("беру ОАК, лактат, креатинин с электролитами и КЩС");
  r.say("болюс", { interpreted: bolusThenLook("sterofundin") });
  r.say("жду 5 минут");
  r.say("болюс", { interpreted: bolusThenLook("ringers_lactate") });
  r.say("мониторинг", { interpreted: interp("мониторинг", [["PRESCRIBE_MONITORING", { targets: ["blood_pressure", "heart_rate", "urine_output"], intervalMinutes: 30 }]]) });
  finish(r);
  assert.ok(r.turns.every(silent), `mentor spoke: ${r.turns.filter((t) => !silent(t)).map((t) => t.mentor.textRu)}`);
  assert.deepEqual(fired(r), []);
  assert.deepEqual(
    [r.state.physiology.heartRate, r.state.physiology.systolicBp, r.state.physiology.crtSeconds, r.state.physiology.urineOutputMlPerHr],
    [96, 122, 2, 55],
  );
  assert.match(r.transcript.map((m) => m.textRu).join(" "), /Hb 126/);
  assert.equal(r.state.session.status, "complete");
  assert.deepEqual(r.debrief().teachingIssues, []);
});

test("B average resident: one issue is raised, answered in words, and closed; the correction is then repeated unprompted", () => {
  const r = resident({ seed: "B" });
  r.say("измеряю давление и пульс");
  const bolus = r.say("болюс 500 мл рингер-лактата");
  assert.equal(mentorIssue(bolus), "fluids.reassessment_plan");
  const answered = r.say("Буду смотреть давление, пульс и диурез после болюса, чтобы понять, есть ли ответ");
  assert.ok(silent(answered));
  assert.equal(r.state.mentor.pendingMentorQuestion, null);
  r.say("переоцениваю давление и диурез");
  r.say("болюс", { interpreted: bolusThenLook("hartmann") });
  r.say("оцениваю перфузию");
  finish(r);
  assert.deepEqual(spokenIssues(r), ["fluids.reassessment_plan"]);
  assert.deepEqual(fired(r), []);
  const [issue] = r.debrief().teachingIssues;
  assert.equal(issue.issueId, "fluids.reassessment_plan");
  assert.equal(issue.status, "corrected_then_independent");
  assert.ok(issue.correction && issue.laterBehavior.handledUnprompted >= 1 && issue.laterBehavior.repeatedOmissions === 0);
  assert.match(issue.summaryRu, /самостоятельно/);
  assert.doesNotMatch(issue.summaryRu, /провал|не справил/i);
});

test("C vague resident: incomplete orders are answered by the NURSE; the mentor raises at most one issue at a time and only about a real decision", () => {
  const r = resident({ seed: "C" });
  const a = r.say("начните инфузию");
  const b = r.say("дайте какой-нибудь кристаллоид");
  const c = r.say("физраствор");
  for (const t of [a, b, c]) assert.ok(silent(t), `mentor answered an operational gap: ${t.mentor?.textRu}`);
  assert.equal(r.state.infusions.length, 0);
  const acted = r.say("болюс 500 мл физраствора");
  assert.equal(r.state.infusions.length, 1);
  assert.equal(mentorIssue(acted), "fluids.reassessment_plan", "the current gap outranks the fluid-choice rationale");
  assert.equal(r.turns.filter((t) => !silent(t)).length, 1);
  r.say("переоцениваю давление и диурез");
  finish(r);
  assert.equal(r.state.session.status, "complete");
});

test("D frequently stuck resident: progressive scaffolding on ONE issue, ownership returned, then a neutral generic ladder - never a repeated question", () => {
  const r = resident({ seed: "D" });
  const first = r.say("болюс 500 мл стерофундина");
  const levels = [r.say("не знаю"), r.say("не знаю"), r.say("не знаю")];
  assert.deepEqual(levels.map((t) => t.mentor.scaffolding), [2, 3, 4]);
  assert.ok(levels.every((t) => mentorIssue(t) === "fluids.reassessment_plan"));
  const texts = [first, ...levels].map((t) => t.mentor.textRu);
  assert.equal(new Set(texts).size, texts.length, "a question was repeated verbatim");
  r.say("проверю диурез");
  assert.equal(r.state.mentor.pendingMentorQuestion, null);
  const lost = r.say("не знаю");
  assert.equal(mentorIssue(lost), "generic");
  assert.doesNotMatch(lost.mentor.textRu, /гипотез|стабилен ли пациент/, "the diagnostic-workup ladder was used on a fluids case");
  r.say("измеряю давление и пульс");
  finish(r);
  const [issue] = r.debrief().teachingIssues.filter((i) => i.issueId === "fluids.reassessment_plan");
  assert.equal(issue.highestScaffold, 4);
  assert.equal(issue.status, "corrected_after_prompt");
});

test("E adaptive resident: overload appears, the resident changes course - no rebuke, the observation prompt closes, the safety rule never fires", () => {
  const r = resident({ seed: "E" });
  r.say("измеряю давление и пульс");
  for (let i = 0; i < 5; i += 1) r.say("болюс", { interpreted: bolusThenLook("sterofundin", ["vitals", "urine_output"]) });
  const overload = r.say("переоцениваю давление и лёгкие");
  assert.match(overload.envText, /влажные хрипы/);
  assert.equal(mentorIssue(overload), "fluids.overload_unaddressed", "the mentor anchors to what was just seen");
  const adapted = r.say("останавливаю инфузию, зову старшего");
  assert.ok(silent(adapted), "a legitimate change of plan was challenged");
  assert.equal(r.state.mentor.pendingMentorQuestion, null);
  const later = r.say("оцениваю перфузию и лёгкие");
  assert.ok(silent(later));
  finish(r);
  assert.ok(!fired(r).includes("RULE-FLUIDS-REPEAT-BOLUS-AFTER-OVERLOAD-SIGNS"));
  const timeline = r.debrief().teachingIssues;
  assert.deepEqual(timeline.map((i) => i.issueId), ["fluids.overload_unaddressed"]);
  assert.equal(timeline[0].status, "corrected_after_prompt");
  assert.equal(r.state.physiology.respiratoryRate, 26, "the consequence of the earlier course was real");
});

test("E2 the resident who did NOT adapt: bolus after seeing overload -> safety issue, correction recorded as a safety-relevant event", () => {
  const r = resident({ seed: "E2" });
  for (let i = 0; i < 5; i += 1) r.say("болюс", { interpreted: bolusThenLook("sterofundin", ["vitals"]) });
  r.say("переоцениваю давление и лёгкие");
  const again = r.say("болюс 500 мл стерофундина");
  assert.equal(mentorIssue(again), "fluids.continue_after_overload");
  r.say("останавливаю инфузию");
  finish(r);
  const safety = r.debrief().teachingIssues.find((i) => i.issueId === "fluids.continue_after_overload");
  assert.equal(safety.safetyRelevant, true);
  assert.match(safety.summaryRu, /значимое для безопасности/);
});

test("every scripted resident reaches a valid terminal point without a hidden phrase: the case ends only on the resident's own words", () => {
  const r = resident({ seed: "T" });
  r.say("измеряю давление и пульс");
  assert.equal(r.state.session.status, "active");
  finish(r);
  assert.equal(r.state.session.status, "complete");
});

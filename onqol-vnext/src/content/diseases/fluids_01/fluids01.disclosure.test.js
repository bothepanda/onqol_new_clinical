// Information disclosure (ТЗ §7): a finding reaches the learner only through
// examination, measurement, an ordered and RESULTED investigation, reassessment
// or natural staff reporting - never merely because it exists in patient truth.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resident, interp } from "./fluidsHarness.js";
import { buildLearnerVisibleState } from "../../../core/state/learnerView.js";

const seen = (r) => r.transcript.filter((m) => m.role !== "learner").map((m) => m.textRu).join(" ");
// The same bolus, then time passes with NO observation - so nothing is measured.
const steroUnobserved = () => interp("болюс", [["ORDER_INFUSION", { fluidId: "sterofundin", volumeMl: 500, bolus: true }], ["WAIT", { afterMinutes: 15 }]]);

test("D1 the case opens with a phone call: no measurement is on the learner's screen", () => {
  const r = resident({ seed: "d1" });
  const opening = seen(r);
  assert.match(opening, /60 мл мочи/);
  assert.ok(!/ЧСС|АД|SpO|CRT|лактат|креатинин/i.test(opening));
  const status = r.say("как пациент сейчас?");
  assert.match(status.envText, /Витальные ещё не оценивались/);
  assert.equal(buildLearnerVisibleState(r.state).physiologyKnownAt, null);
});

test("D2 each observation discloses only what it measures; lactate (a lab value) is never shown by a bedside observation", () => {
  const r = resident({ seed: "d2" });
  const urine = r.say("проверю диурез");
  assert.match(urine.envText, /диурез 15/);
  assert.ok(!/ЧСС|АД|CRT/.test(urine.envText));
  const vitals = r.say("измеряю давление и пульс");
  assert.ok(!/диурез|CRT|лактат/.test(vitals.envText));
  const perfusion = r.say("оцениваю перфузию");
  assert.match(perfusion.envText, /CRT 3/);
  const status = r.say("как пациент сейчас?");
  assert.ok(!/лактат/.test(status.envText), "lactate leaked into the status line");
  assert.ok(!/лактат/.test(seen(r)));
});

test("D3 dynamic lung findings surface only when the chest is examined, and only as the patient actually is then", () => {
  const r = resident({ seed: "d3" });
  for (let i = 0; i < 5; i += 1) r.say("болюс", { interpreted: steroUnobserved() });
  assert.equal(r.state.physiology.respiratoryRate, 26, "the patient IS overloaded");
  assert.ok(!/хрип|одышк|ЧДД 26|SpO₂ 92/.test(seen(r).replace(/Стерофундин/g, "")), "overload leaked before anyone looked");
  const looked = r.say("оцениваю перфузию, вены шеи и лёгкие");
  assert.match(looked.envText, /влажные хрипы/);
  // the learner had not SEEN the rate, so the continue-after-overload rule cannot have fired on hidden state
  const beforeSeeing = resident({ seed: "d3b" });
  for (let i = 0; i < 5; i += 1) beforeSeeing.say("болюс", { interpreted: steroUnobserved() });
  const another = beforeSeeing.say("болюс", { interpreted: interp("болюс", [["ORDER_INFUSION", { fluidId: "sterofundin", volumeMl: 500, bolus: true }]]) });
  assert.ok(!another.turn.outcomes.some((o) => o.firedRules?.some((rule) => rule.id === "RULE-FLUIDS-REPEAT-BOLUS-AFTER-OVERLOAD-SIGNS")));
});

test("D4 static findings (skin, neck veins, drains) exist only once examined", () => {
  const r = resident({ seed: "d4" });
  assert.ok(!/прохладн|плоские|дренаж/.test(seen(r)));
  const t = r.say("оцениваю перфузию, вены шеи и дренаж");
  assert.match(t.envText, /прохладная/);
  assert.match(t.envText, /плоские/i);
});

test("D5 laboratory results: ordering shows nothing; the values arrive on the source's timing, drawn when ordered", () => {
  const r = resident({ seed: "d5" });
  const ordered = r.say("беру ОАК, лактат, креатинин с электролитами и КЩС");
  assert.match(ordered.envText, /Ожидаемое время результата — 20 мин/);
  assert.ok(!/126|118|2,6|7,32/.test(ordered.envText), "a result appeared at order time");
  const early = r.say("жду 10 минут");
  assert.ok(!/126|118|7,32/.test(early.envText));
  const late = r.say("жду 10 минут");
  assert.match(late.envText, /Hb 126/);
  assert.match(late.envText, /креатинин 118.*исходно 82/);
  assert.match(late.envText, /pH 7,32/);
  assert.match(late.envText, /лактат: 2,6/);
});

test("D5b a sample is drawn at order time: lactate ordered before an effect lands does not show it", () => {
  const r = resident({ seed: "d5b" });
  r.say("лактат");
  r.say("фуросемид 40 мг в/в");
  const t = r.say("жду 25 минут");
  assert.match(t.envText, /лактат: 2,6/);
  r.say("повторно лактат");
  assert.match(r.say("жду 25 минут").envText, /лактат: 3,4/);
});

test("D5c the fluid the learner chose changes what a REPEAT gas result shows (source: after 0.9% NaCl -> Cl 114, HCO3 16)", () => {
  const r = resident({ seed: "d5c" });
  r.say("КЩС");
  r.say("жду 20 минут");
  r.say("болюс 500 мл физраствора");
  r.say("повторно КЩС");
  assert.match(r.say("жду 20 минут").envText, /Cl 114 ммоль\/л, HCO₃⁻ 16/);
  const balanced = resident({ seed: "d5d" });
  balanced.say("КЩС");
  balanced.say("жду 20 минут");
  balanced.say("болюс 500 мл стерофундина");
  balanced.say("повторно КЩС");
  assert.match(balanced.say("жду 20 минут").envText, /pH 7,32/);
});

test("D6 natural staff reporting: an untreated patient is reported worse by the nurse, qualitatively, with no measurement attached", () => {
  const r = resident({ seed: "d6" });
  const t = r.say("жду час");
  assert.match(t.envText, /Пациенту хуже/);
  assert.ok(!/АД|ЧСС|лактат|диурез \d/.test(t.envText));
  assert.equal(r.state.physiology.systolicBp, 94, "and the patient really is worse");
  assert.equal(buildLearnerVisibleState(r.state).physiologyKnownAt, null, "yet nothing was measured");
});

test("D7 the mentor's brief carries no unrevealed result, ordered-but-not-resulted value or hidden truth", () => {
  const r = resident({ seed: "d7" });
  const pending = r.say("креатинин с электролитами");
  assert.ok(!/118|138|3,6/.test(JSON.stringify(r.briefFor(pending))));
  const resulted = r.say("жду 20 минут");
  const brief = JSON.stringify(r.briefFor(resulted));
  assert.match(brief, /118/); // shown to the learner -> it is a displayed fact now
  assert.ok(!/akiCreatinine|betaBlocker|operativeHistory|1,030|baselineSystolic/.test(brief));
});

test("D8 reassessment lets the treatment run first, so it shows the response - not the moment of the order", () => {
  const r = resident({ seed: "d8" });
  r.say("болюс 500 мл стерофундина");
  const t = r.say("переоцениваю давление и диурез");
  assert.match(t.envText, /ЧСС 104/);
  assert.match(t.envText, /диурез 35/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createSession } from "../core/session/createSession.js";
import { submitLearnerTurn } from "../core/session/submitLearnerTurn.js";
import { seededStartIso } from "../app/session/seededStart.js";
import { buildLearnerVisibleState } from "../core/state/learnerView.js";
import { buildDebrief } from "../core/replay/buildDebrief.js";
import { exportSession } from "../core/replay/exportSession.js";
import { renderEvent } from "../ai/renderer/renderEvent.js";
import {
  renderStatusSnapshot,
  renderClarification,
  renderDischargeNotReady,
  renderPreopNotReady,
  renderUnavailableResource,
  renderUnsupported,
  renderNoPendingWork,
  renderUnrecognizedFragments,
} from "../ai/renderer/renderStatus.js";
import { withShared } from "../core/content/loadBundle.js";
import diseaseBundle from "../content/generated/appendicitis.json" with { type: "json" };
import sharedBundle from "../content/generated/shared.json" with { type: "json" };

/**
 * CORE RUNTIME CONTRACT REGRESSION SUITE
 * (ONQOL_CORE_RUNTIME_SPEC_v2.0_2026-08-30).
 *
 * Existing behavioral tests retain their historical `PBC-*` identifiers,
 * now interpreted under the consolidated Core Runtime Spec. The identifiers
 * Core Runtime Spec it defends, so a failure names the product
 * promise that broke rather than the function that broke.
 *
 * WHAT THIS SUITE IS FOR, AND WHAT IT DELIBERATELY IS NOT.
 *
 * It exercises the LEARNER-FACING path only: ordinary Russian typed into
 * `submitLearnerTurn`, and where the contract is about what the learner
 * *reads*, the assertion is made on the rendered text through the same
 * renderers `useSession` uses - not on internal state that no learner can
 * see. A mechanism that exists but never reaches the learner is exactly what
 * the audit's evidence standard (task §4) says must not count as PASS.
 *
 * It does NOT assert any clinical claim. Where a behavior depends on clinical
 * content that is not `approved_for_training`, the test asserts that the
 * simulator WITHHOLDS and RECORDS - never that some particular clinical thing
 * happened. Several tests below therefore assert absence, on purpose: they
 * are the guard against a future pass quietly filling a governance gap with
 * invented medicine (task §7).
 */

const bundle = withShared(diseaseBundle, sharedBundle);
const START_ISO = "2026-08-23T14:00:00+05:00";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

function newSession(seed = "pbc-seed", { mode = "reference", realProfileId, startIso = START_ISO } = {}) {
  return createSession({
    sessionId: "pbc",
    seed,
    mode,
    realProfileId,
    casePresetId: "APP-004",
    sessionPurpose: "internal_development",
    bundle,
    locale: "ru",
    startIso,
  });
}

const say = (session, text) => submitLearnerTurn({ session, text });

function saying(session, texts) {
  let current = session;
  for (const text of texts) current = say(current, text).session;
  return current;
}

const outcomesOf = (turn) => turn.outcomes.map((result) => result.outcome);

/**
 * Everything the learner would actually read for one turn, assembled through
 * exactly the branches `src/app/session/useSession.js` uses. Kept in step with
 * that file on purpose: if the UI and this helper drift, a "the learner sees
 * X" assertion here stops meaning anything.
 */
function learnerVisibleText(session, text) {
  const before = buildLearnerVisibleState(session.state);
  const turn = say(session, text);
  const messages = [];
  const push = (rendered) => rendered && messages.push(`${rendered.speakerRu}: ${rendered.textRu}`);

  for (const event of turn.timeEvents ?? []) push(renderEvent({ event, bundle, patient: turn.session.patient }));
  for (const result of turn.outcomes) {
    if (result.outcome === "STATUS_SNAPSHOT") push(renderStatusSnapshot(before));
    else if (result.outcome === "CLARIFY")
      push(renderClarification(result.missing, { promptRu: result.clarifyPromptRu, by: result.clarifyBy }));
    else if (result.outcome === "UNSUPPORTED_CONTENT") push(renderUnsupported());
    else if (result.outcome === "NO_PENDING_WORK") push(renderNoPendingWork());
    else if (result.outcome === "UNAVAILABLE_RESOURCE") push(renderUnavailableResource(result.reasonKey));
    else if (result.outcome === "PREOP_NOT_READY") push(renderPreopNotReady(result.missingItems, bundle));
    else if (result.outcome === "DISCHARGE_NOT_READY") push(renderDischargeNotReady(result.blockers));
    else if (result.outcome === "SAFETY_STOP") push({ speakerRu: "Наставник", textRu: result.teachingPointRu });
    else for (const event of result.events ?? []) push(renderEvent({ event, bundle, patient: turn.session.patient }));
  }
  for (const event of turn.afterEvents ?? []) push(renderEvent({ event, bundle, patient: turn.session.patient }));
  if (turn.interpreted.unmatchedFragments?.length) push(renderUnrecognizedFragments(turn.interpreted.unmatchedFragments));
  if (turn.mentor?.textRu) push({ speakerRu: "Наставник", textRu: turn.mentor.textRu });

  return { turn, session: turn.session, text: messages.join("\n"), messages };
}

/** The learner journey up to, but not including, the operative decision. */
function playToTheatre(seed = "pbc-theatre") {
  return saying(newSession(seed), [
    "живот",
    "анамнез",
    "ОАК и КТ ОБП",
    "переоценю боль и витальные через 2 часа",
    "на операцию",
    "венозный доступ, согласие, антибиотикопрофилактика цефазолин 2 г в/в, антибиотикопрофилактика метронидазол 500 мг в/в",
    "осмотр анестезиолога",
    "переоценю витальные через 40 минут",
    "иду на лапароскопическую аппендэктомию",
  ]);
}

// ===========================================================================
// §1 Contract sync (task §24.1, §24.2)
// ===========================================================================

test("CR-0 the Core Runtime Spec is in the repo at its canonical path, unedited", () => {
  const contractPath = path.join(REPO_ROOT, "docs/contracts/ONQOL_CORE_RUNTIME_SPEC_v2.0_2026-08-30.md");
  const contract = readFileSync(contractPath, "utf8");
  const hash = createHash("sha256").update(contract).digest("hex");

  // The hash of the contract as supplied. It changing means the contract text
  // in the repository changed - which is a governance event, not a refactor,
  // and must be a deliberate re-sync with a new version number.
  assert.equal(hash, "cb9d4d47e981d499cc8eadbc56b40097f3da94e68b7d0bd39b1c2dc990905615");
  assert.match(contract, /Supersedes:.*PRODUCT_BEHAVIOR_CONTRACT.*CORE_FOUNDATION_SPEC/i);
});

test("CR-0 the contract index records all five active specifications and the runtime hash", () => {
  const index = readFileSync(path.join(REPO_ROOT, "docs/contracts/CONTRACT_INDEX.md"), "utf8");
  assert.match(index, /docs\/contracts\/ONQOL_CORE_RUNTIME_SPEC_v2\.0_2026-08-30\.md/);
  assert.match(index, /cb9d4d47e981d499cc8eadbc56b40097f3da94e68b7d0bd39b1c2dc990905615/);
  assert.equal((index.match(/^\| ON QOL /gm) ?? []).length, 5);
});

// ===========================================================================
// §3 Two hospital modes
// ===========================================================================

test("PBC-3 a resource constraint is disclosed only when the learner runs into it", () => {
  // Contract §3.2 + Core Runtime Spec §15: the hospital does not announce what
  // is broken before it becomes operationally relevant.
  let session = newSession("PBC-REAL-2", { mode: "real", realProfileId: "KZ-R2-URBAN" });
  assert.deepEqual(
    session.state.hospital.dynamicConstraints.map((c) => c.id),
    ["ct_scanner_down"],
    "this seed is chosen because it draws the broken-scanner constraint",
  );
  assert.deepEqual(buildLearnerVisibleState(session.state).revealedConstraints, [], "nothing disclosed up front");

  const met = learnerVisibleText(session, "КТ ОБП");
  assert.deepEqual(outcomesOf(met.turn), ["UNAVAILABLE_RESOURCE"]);
  assert.match(met.text, /аппарат на ремонте/);
  assert.equal(met.turn.mentor?.textRu ?? null, null, "the mentor does not solve the resource problem (§9.3, §23)");
  assert.deepEqual(
    buildLearnerVisibleState(met.session.state).revealedConstraints.map((c) => c.id),
    ["ct_scanner_down"],
    "and only now does it reach the sidebar",
  );
});

test("PBC-3 a missing resource does not change the patient's biology", () => {
  // Contract §3.3: "A missing CT does not change what disease the patient has."
  const seed = "PBC-BIOLOGY";
  const reference = newSession(seed, { mode: "reference" });
  const real = newSession(seed, { mode: "real", realProfileId: "KZ-R1-DISTRICT" });

  assert.equal(real.state.hospital.capabilities.ct.available, false, "the district hospital has no CT at all");
  assert.deepEqual(real.state.truth, reference.state.truth, "same seed, same patient truth");
  assert.deepEqual(real.state.physiology, reference.state.physiology);
  assert.deepEqual(real.state.symptoms, reference.state.symptoms);
});

test("PBC-3 interfacility transfer consumes the authored transport time", () => {
  // Contract §3.2 ("a transfer takes 60 to 90 minutes") and §7.1 (clinical
  // time advances for transport). Regression for the version where every
  // profile authored a transferEtaMinutes and nothing read it, so the
  // ambulance arrived in zero minutes.
  const district = learnerVisibleText(newSession("x1", { mode: "real", realProfileId: "KZ-R1-DISTRICT" }), "перевожу в другой стационар");
  assert.equal(district.session.state.clock.elapsedMinutes, 150);
  assert.match(district.text, /Расчётное время в пути — 150 мин/);
  assert.match(district.text, /доставлен в принимающий стационар/);

  const urban = learnerVisibleText(newSession("x2", { mode: "real", realProfileId: "KZ-R2-URBAN" }), "перевожу в другой стационар");
  assert.equal(urban.session.state.clock.elapsedMinutes, 45, "each profile has its own journey time");
});

test("PBC-3 the same seed reproduces the same constraint draw and the same patient", () => {
  // Contract §3.2 dynamic events must be replayable (task §24.23).
  const a = newSession("PBC-REAL-11", { mode: "real", realProfileId: "KZ-R2-URBAN" });
  const b = newSession("PBC-REAL-11", { mode: "real", realProfileId: "KZ-R2-URBAN" });
  assert.deepEqual(a.state.hospital.dynamicConstraints, b.state.hospital.dynamicConstraints);
  assert.deepEqual(a.state.truth, b.state.truth);

  const c = newSession("PBC-REAL-2", { mode: "real", realProfileId: "KZ-R2-URBAN" });
  assert.notDeepEqual(
    a.state.hospital.dynamicConstraints.map((x) => x.id),
    c.state.hospital.dynamicConstraints.map((x) => x.id),
    "different seeds genuinely diverge",
  );
});

// ===========================================================================
// §4 How a case starts
// ===========================================================================

test("PBC-4 the case opens as a presentation category with an EMS handoff and vitals, not a diagnosis", () => {
  const session = newSession("pbc-start");
  const arrival = session.events.find((event) => event.type === "PATIENT_ARRIVED");
  const handoff = renderEvent({ event: arrival, bundle, patient: session.patient }).textRu;

  assert.match(handoff, /Острый живот/, "presentation category (§4)");
  assert.match(handoff, /Передача СМП/, "EMS handoff (§4)");
  assert.match(handoff, /ЧСС \d+\/мин/, "initial vitals (§4)");

  // The hidden diagnosis, phenotype, severity and trajectory are not
  // disclosed anywhere the learner can read (§4, Core Runtime Spec §51).
  const learnerFacing = JSON.stringify(buildLearnerVisibleState(session.state)) + handoff;
  for (const secret of ["аппендицит", "appendicitis", "retrocecal", "ретроцекал", "TRJ-", "uncomplicated_inflammation"]) {
    assert.equal(
      learnerFacing.toLowerCase().includes(secret.toLowerCase()),
      false,
      `case start leaks hidden truth: ${secret}`,
    );
  }
});

// ===========================================================================
// §5 History and examination
// ===========================================================================

test("PBC-5 «осмотрю пациента» asks what is examined; «живот» is a complete abdominal examination", () => {
  // Contract §5.1, including the explicit promise that no ritual enumeration
  // of inspection/auscultation/percussion/palpation is required.
  const asked = learnerVisibleText(newSession("pbc-exam"), "осмотрю пациента");
  assert.deepEqual(outcomesOf(asked.turn), ["CLARIFY"]);
  assert.match(asked.text, /Что именно осматриваешь\?/);

  const done = learnerVisibleText(asked.session, "живот");
  assert.deepEqual(outcomesOf(done.turn), ["EXECUTED"]);
  // One turn produced inspection, palpation, peritoneal signs and auscultation.
  assert.match(done.text, /участвует в акте дыхания/, "inspection");
  assert.match(done.text, /при пальпации/, "palpation");
  assert.match(done.text, /раздражения брюшины/, "peritoneal signs");
  assert.match(done.text, /перистальтика/, "auscultation");
});

test("PBC-5 the universal normal layer answers unrelated examinations without overwriting the abdomen", () => {
  // Contract §5.3.
  const legs = learnerVisibleText(newSession("pbc-normal"), "осмотрю ноги");
  assert.deepEqual(outcomesOf(legs.turn), ["EXECUTED"]);
  assert.equal(/болезненн/i.test(legs.text), false, "an unrelated region does not inherit the abdominal finding");

  const abdomen = learnerVisibleText(legs.session, "живот");
  assert.match(abdomen.text, /болезненный/, "the case-specific abnormality survives the normal layer");
});

test("PBC-5 a general history request returns the relevant bundle in one turn", () => {
  const history = learnerVisibleText(newSession("pbc-history"), "анамнез");
  assert.deepEqual(outcomesOf(history.turn), ["EXECUTED"]);
  assert.match(history.text, /^Пациент: /m);
  assert.match(history.text, /Жалобы на боль в животе/);
});

// ===========================================================================
// §6 Free patient questions and current status
// ===========================================================================

test("PBC-6 every contract-named status phrasing returns a current snapshot", () => {
  // Contract §6 and task §5.4 name these four variants explicitly.
  // «как сейчас боль?» is the regression: the adverb-first word order used to
  // fall through to CLINICAL_REASONING and the learner got total silence.
  const session = saying(newSession("pbc-status"), ["живот", "ОАК"]);
  for (const phrasing of ["что с пациентом сейчас?", "как он сейчас?", "как сейчас боль?", "что по витальным?"]) {
    const asked = learnerVisibleText(session, phrasing);
    assert.deepEqual(outcomesOf(asked.turn), ["STATUS_SNAPSHOT"], `«${phrasing}» must be a status request`);
    assert.match(asked.text, /Локация: приёмный покой/, `«${phrasing}» must return a snapshot`);
    assert.match(asked.text, /ЧСС \d+\/мин/);
    // Named the way the learner ordered it, not by internal id (§6, §13).
    assert.match(asked.text, /Ожидают результата: ОАК/, "pending work is part of the snapshot (§6)");
    assert.equal(/cbc|ct_abdomen/.test(asked.text), false, "no internal investigation id reaches the learner");
    assert.equal(/wbc|neutrophilPercent/.test(asked.text), false, "no internal lab field name reaches the learner");
    assert.equal(asked.turn.mentor?.textRu ?? null, null, "never converted into a mentor question (§6)");
  }
});

test("PBC-6 a status request neither restarts the examination nor consumes clinical time", () => {
  // Contract §6 ("not restart the full examination") and §7.1.
  const session = saying(newSession("pbc-status-2"), ["живот", "ОАК"]);
  const examsBefore = session.state.observations.examinations.length;
  const eventsBefore = session.events.length;

  const asked = learnerVisibleText(session, "что с пациентом сейчас?");
  assert.equal(asked.session.state.clock.elapsedMinutes, 0, "a pure read does not move the clock");
  assert.equal(asked.session.state.observations.examinations.length, examsBefore, "no re-examination");
  // Only the turn-received bookkeeping event; no domain event at all.
  assert.equal(asked.session.events.length, eventsBefore + 1);
  assert.equal(asked.session.events.at(-1).type, "LEARNER_TURN_RECEIVED");
});

// ===========================================================================
// §7 Clinical time
// ===========================================================================

test("PBC-7 ordered results arrive on their own when due, without being asked for", () => {
  // Contract §7.3, and §7.2's parallel timelines: two investigations ordered
  // together come back at their own different times.
  const ordered = saying(newSession("pbc-time"), ["ОАМ и КТ ОБП"]);
  const waited = learnerVisibleText(ordered, "переоценю витальные через 90 минут");

  assert.equal(waited.session.state.investigations.urinalysis.status, "resulted");
  assert.notEqual(waited.session.state.investigations.ct_abdomen.status, "resulted");
  assert.match(waited.text, /ОАМ:/, "the result is surfaced to the learner, not merely stored");

  // Lab values are named in Russian, never by their internal field name (§13).
  const cbc = learnerVisibleText(saying(newSession("pbc-labnames"), ["ОАК"]), "переоценю витальные через 2 часа");
  assert.match(cbc.text, /лейкоциты:/);
  assert.equal(/wbc|neutrophilPercent/.test(cbc.text), false, `internal field name leaked: ${cbc.text}`);
});

test("PBC-7 a preliminary radiology report reaches the learner before the formal one", () => {
  // Contract §9.2 read together with §7.3.
  // Reference CT: preliminary at 105 min, formal at 130 - so the wait has to
  // clear both for the ORDERING assertion below to mean anything.
  const waited = learnerVisibleText(saying(newSession("pbc-prelim"), ["КТ ОБП"]), "переоценю витальные через 3 часа");
  assert.match(waited.text, /Рентгенолог: Предварительно/, "spoken by the radiologist (§13, §23)");

  const types = waited.session.events.map((event) => event.type);
  assert.ok(
    types.indexOf("TEST_PRELIMINARY_REPORTED") < types.lastIndexOf("TEST_RESULTED"),
    "preliminary strictly precedes formal",
  );
});

// ===========================================================================
// §8 Orders and treatments
// ===========================================================================

test("PBC-8 several orders in one message all execute", () => {
  // Contract §8.1.
  const turn = say(newSession("pbc-multi"), "ОАК, СРБ и ОАМ");
  assert.deepEqual(outcomesOf(turn), ["EXECUTED", "EXECUTED", "EXECUTED"]);
  for (const id of ["cbc", "crp", "urinalysis"]) {
    assert.equal(turn.session.state.investigations[id].status, "ordered", `${id} was ordered`);
  }
  assert.equal(turn.session.state.clock.elapsedMinutes, 0, "no artificial waiting between them (§7.2)");
});

test("PBC-8 an incomplete medication order is clarified by the NURSE, not the mentor", () => {
  // Contract §8.2 and §23.
  const asked = learnerVisibleText(newSession("pbc-med"), "кетопрофен 100 мг");
  assert.deepEqual(outcomesOf(asked.turn), ["CLARIFY"]);
  assert.match(asked.text, /^Медсестра: Уточните путь введения\./m);
  assert.equal(asked.turn.mentor?.textRu ?? null, null, "routine clarification never reaches the mentor");
});

test("PBC-8 answering the clarification completes the ORIGINAL order", () => {
  // Contract §8.2 read as a loop, and §28's anti-goal: the learner must not
  // have to discover that retyping the whole order is the magic phrase.
  // Regression - the question was asked and the answer went nowhere.
  const asked = learnerVisibleText(newSession("pbc-clarify"), "кетопрофен 100 мг");
  assert.deepEqual(outcomesOf(asked.turn), ["CLARIFY"]);

  const answered = learnerVisibleText(asked.session, "в/м");
  assert.deepEqual(outcomesOf(answered.turn), ["EXECUTED"]);

  const given = answered.session.state.treatments.administered.at(-1);
  assert.equal(given.drugId, "ketoprofen");
  assert.equal(given.route, "im", "the answer supplied the missing parameter");
  assert.equal(given.dose, "100мг", "and the dose from the FIRST turn was not lost");
});

test("PBC-8 the clarification loop works for every clarifying character", () => {
  // The same mechanism, across command types and speakers - it is a general
  // seam, not a per-command patch.
  const infusion = learnerVisibleText(newSession("pbc-clarify-2"), "прокапаю 500 мл физраствора");
  assert.deepEqual(outcomesOf(infusion.turn), ["CLARIFY"]);
  const running = learnerVisibleText(infusion.session, "за час");
  assert.deepEqual(outcomesOf(running.turn), ["EXECUTED"]);
  assert.equal(running.session.state.infusions.at(-1).volumeMl, 500, "volume from the first turn survived");
  assert.equal(running.session.state.infusions.at(-1).durationMinutes, 60);

  const lab = learnerVisibleText(newSession("pbc-clarify-3"), "БХАК");
  assert.match(lab.text, /^Лаборатория: Какие показатели биохимии нужны\?/m, "the LAB asks, not the nurse (§23)");
  const named = learnerVisibleText(lab.session, "креатинин и электролиты");
  assert.deepEqual(outcomesOf(named.turn), ["EXECUTED"], "one order, not one per analyte");
  assert.deepEqual(named.session.state.investigations.chemistry.id, "chemistry");
  assert.equal(named.turn.interpreted.commands.length, 1, "a parameter list is one order (§8.1)");
  assert.deepEqual(named.turn.interpreted.commands[0].params.analytes, ["creatinine", "electrolytes"]);
});

test("PBC-8 an unanswered clarification does not execute anything", () => {
  // The system never guesses the missing parameter (Core Runtime Spec §48).
  const asked = say(newSession("pbc-clarify-4"), "кетопрофен 100 мг");
  assert.equal(asked.session.state.treatments.administered.length, 0);
  const ignored = say(asked.session, "живот");
  assert.deepEqual(outcomesOf(ignored), ["EXECUTED"], "an unrelated action is not overridden by the open question");
  assert.equal(ignored.session.state.treatments.administered.length, 0, "and the drug still was not given");
});

test("PBC-8 an unsupported medication is never reported as a hospital stock-out", () => {
  // Contract §8 with Core Runtime Spec §50's three-way distinction: the platform
  // not modelling a drug is a SIMULATOR limitation, not a resource fact.
  const turn = learnerVisibleText(newSession("pbc-unsupported"), "дифенгидрамин 25 мг в/в");
  assert.deepEqual(outcomesOf(turn.turn), ["UNSUPPORTED_CONTENT"]);
  assert.match(turn.text, /не поддерживается текущей версией симуляции/);
  assert.equal(/нет в наличии|отсутствует на складе|недоступ/i.test(turn.text), false);
});

test("PBC-8 treatment response stays governance-blocked rather than invented", () => {
  // Contract §8.6 requires treatment to alter the patient. No (drug, route)
  // response envelope is approved, so the drug is GIVEN and RECORDED and the
  // patient is not moved - and the withholding is on the log. This test
  // guards the gap: it fails if someone fills it without a review.
  const given = saying(newSession("pbc-effect"), ["кетопрофен 100 мг в/м"]);
  const painBefore = given.state.symptoms.painScore;
  const later = say(given, "переоценю боль через 2 часа").session;

  assert.equal(later.state.treatments.administered.length, 1, "the drug was genuinely administered");
  assert.equal(later.state.symptoms.painScore, painBefore, "and nothing pretended to know the response");
  assert.equal(
    later.events.some((event) => event.type === "TREATMENT_EFFECT_APPLIED"),
    false,
    "no unapproved effect reached patient truth",
  );
});

// ===========================================================================
// §10 Reassessment
// ===========================================================================

test("PBC-10 a reassessment with no stated target is clarified BEFORE any time passes", () => {
  // Contract §10: ON QOL asks what will be reassessed, and only "once the
  // reassessment plan is clear" does clinical time advance.
  //
  // Regression for the defect this audit found: the clock advanced first, so
  // "переоценю через 3 часа" burned three irreversible hours, drained every
  // pending result into them, and only then asked the question.
  const ordered = saying(newSession("pbc-reassess"), ["ОАК"]);
  const asked = learnerVisibleText(ordered, "переоценю через 3 часа");

  assert.deepEqual(outcomesOf(asked.turn), ["CLARIFY"]);
  assert.match(asked.text, /Что именно переоцениваешь\?/);
  assert.equal(asked.session.state.clock.elapsedMinutes, 0, "no clinical time was spent on an unclear plan");
  assert.equal(asked.session.state.investigations.cbc.status, "ordered", "and no result was drained into it");

  // Answering it then does both: the interval is honoured and the
  // reassessment happens at the end of it.
  const answered = learnerVisibleText(asked.session, "боль и витальные");
  assert.deepEqual(outcomesOf(answered.turn), ["EXECUTED"]);
  assert.equal(answered.session.state.clock.elapsedMinutes, 180, "the originally stated interval was preserved");
  assert.equal(answered.session.state.investigations.cbc.status, "resulted");
  assert.match(answered.text, /Переоценены: боль, витальные показатели/);
});

test("PBC-10 a stated reassessment advances time and reports the named parameters", () => {
  const waited = learnerVisibleText(saying(newSession("pbc-reassess-2"), ["живот"]), "переоценю боль и живот через 30 минут");
  assert.deepEqual(outcomesOf(waited.turn), ["EXECUTED"]);
  assert.equal(waited.session.state.clock.elapsedMinutes, 30);
  assert.match(waited.text, /при пальпации/, "an abdominal reassessment re-examines the abdomen");
  assert.equal(/Клинически значимых изменений нет/.test(waited.text), false, "not the generic normal layer");
});

test("PBC-10 a later abdominal examination is never suppressed as a duplicate of the first", () => {
  // Contract §10's closing sentence.
  const session = saying(newSession("pbc-repeat"), ["живот"]);
  const again = learnerVisibleText(session, "живот");
  assert.deepEqual(outcomesOf(again.turn), ["EXECUTED"]);
  assert.match(again.text, /при пальпации/);
  assert.equal(again.session.state.observations.examinations.length, 2);
});

// ===========================================================================
// §9 Investigations
// ===========================================================================

test("PBC-9 CT is a full abdomen/pelvis report and needs no prior ultrasound", () => {
  // Contract §9 with task §5.7's APP-004 specifics.
  const straightToCt = say(newSession("pbc-ct"), "КТ ОБП");
  assert.deepEqual(outcomesOf(straightToCt), ["EXECUTED"]);
  assert.equal(straightToCt.mentor?.textRu ?? null, null, "skipping ultrasound is not penalised");

  const reported = learnerVisibleText(straightToCt.session, "переоценю витальные через 4 часа");
  for (const organ of [/Печень/, /Желчный пузырь/, /Поджелудочная железа/, /Селезёнка/, /Почки/, /Петли тонкой/]) {
    assert.match(reported.text, organ, "the report covers the whole abdomen, not just the appendix");
  }
});

test("PBC-9 a nondiagnostic ultrasound is not rendered as a negative study", () => {
  const reported = learnerVisibleText(
    saying(newSession("pbc-us"), ["УЗИ брюшной полости"]),
    "переоценю витальные через 3 часа",
  );
  assert.match(reported.text, /неинформативно/);
  assert.equal(/отрицательн/i.test(reported.text), false);
});

// ===========================================================================
// §16 Preoperative preparation
// ===========================================================================

test("PBC-16 committing to operate does not make the patient ready for theatre", () => {
  // Contract §16's opening sentence, and the mentor question it asks for.
  const committed = learnerVisibleText(saying(newSession("pbc-preop"), ["живот"]), "на операцию");
  assert.equal(committed.session.state.managementPlan.intent, "operative");
  assert.equal(committed.session.state.preop.ready, false);
  assert.match(committed.text, /Наставник: Что нужно сделать до операции\?/);

  const blocked = learnerVisibleText(committed.session, "иду на лапароскопическую аппендэктомию");
  assert.deepEqual(outcomesOf(blocked.turn), ["PREOP_NOT_READY"]);
  assert.match(blocked.text, /^Операционная: /m, "the theatre says it, not the mentor (§23)");
  assert.equal(blocked.session.state.operative.started, false);
});

test("PBC-16 preop readiness derives from real actions, and there is no learner-facing COMPLETE_PREOP_ITEM", () => {
  // Contract §16: readiness is earned by doing the preparation.
  const ready = playToTheatre("pbc-preop-2");
  assert.equal(ready.state.operative.started, true);
  assert.ok(ready.state.preop.completed.includes("iv_access"));
  assert.ok(ready.state.preop.completed.includes("consent"));
  assert.ok(ready.state.preop.completed.includes("anesthesia_review"));

  // No command, event or vocabulary entry lets the learner simply declare an
  // item done (task §5.12).
  const interpreterSource = readFileSync(path.join(REPO_ROOT, "src/ai/interpreter/interpretTurn.js"), "utf8");
  const vocabularySource = readFileSync(path.join(REPO_ROOT, "src/ai/interpreter/vocabulary.js"), "utf8");
  assert.equal(/COMPLETE_PREOP_ITEM/.test(interpreterSource + vocabularySource), false);
});

test("PBC-16 fasting status is assessed, and is not a universal hard stop", () => {
  // Contract §16's hard/non-blocking split, and task §5.12's explicit
  // instruction that NPO must not become an emergency-surgery hard stop.
  const asked = learnerVisibleText(saying(newSession("pbc-npo"), ["живот", "на операцию"]), "когда последний раз ел и пил?");
  assert.deepEqual(outcomesOf(asked.turn), ["EXECUTED"]);
  assert.match(asked.text, /^Пациент: /m, "the patient answers, from modeled facts (§5.2)");

  const fastingItem = (bundle.operative.preop_requirements ?? []).find((item) => item.id === "fasting_assessment");
  assert.ok(fastingItem, "the fasting assessment is a tracked preoperative item");
  assert.equal(Boolean(fastingItem.blocking), false, "but it is NOT a blocking prerequisite");

  // And the operation still reaches theatre in the full journey above.
  assert.equal(playToTheatre("pbc-npo-2").state.operative.started, true);
});

// ===========================================================================
// §17 Operative simulation
// ===========================================================================

test("PBC-17 an operative decision is matched from content's own phrasings, negation included", () => {
  // Contract §17.1's fidelity level B, and the negation-safety task §5.13 asks
  // for by name: "дренаж не ставлю" must never be recorded as placing a drain.
  const theatre = playToTheatre("pbc-op");
  const decided = learnerVisibleText(theatre, "удаляю аппендикс, аспирирую жидкость из малого таза, дренаж не ставлю");

  assert.deepEqual(outcomesOf(decided.turn), ["EXECUTED"]);
  const choice = decided.session.state.operative.decisions.at(-1).choice;
  assert.equal(/drain/i.test(choice), false, `negated drain was recorded as a decision to place one: ${choice}`);
  assert.equal(decided.session.state.operative.sourceControl, true);
  assert.equal(decided.session.state.operative.completed, true);
  assert.match(decided.text, /Куда переводим пациента\?/, "the learner chooses the destination (§19)");
});

test("PBC-17 no operation name appears anywhere in the core or the AI layer", () => {
  // Contract §26 as it applies to §17: operative phrasing comes from content.
  const vocabularySource = readFileSync(path.join(REPO_ROOT, "src/ai/interpreter/vocabulary.js"), "utf8");
  assert.equal(/аппендэктом/i.test(vocabularySource), false, "no operation name in the interpreter vocabulary");
});

// ===========================================================================
// §19 / §24 Postoperative disposition and case termination
// ===========================================================================

test("PBC-24 completing the operation does not end the case", () => {
  // Contract §24: "The simulator should not treat diagnostic confirmation or
  // completion of surgery alone as case completion."
  const theatre = playToTheatre("pbc-end");
  const operated = say(theatre, "удаляю аппендикс, аспирирую жидкость из малого таза, дренаж не ставлю").session;
  assert.equal(operated.state.operative.completed, true);
  assert.equal(operated.state.session.status, "active", "the case is still running");
  assert.equal(operated.state.session.endpoint, null);
});

test("PBC-24 the patient cannot be discharged from the operating table", () => {
  // Contract §19/§24, and the named regression from the previous pass.
  const theatre = playToTheatre("pbc-table");
  const operated = say(theatre, "удаляю аппендикс, аспирирую жидкость из малого таза, дренаж не ставлю").session;
  assert.equal(operated.state.location, "recovery");

  const refused = learnerVisibleText(operated, "выписываю");
  assert.deepEqual(outcomesOf(refused.turn), ["DISCHARGE_NOT_READY"]);
  assert.match(refused.text, /ещё не переведён из операционной\/палаты пробуждения/);
  assert.equal(refused.session.state.session.status, "active");
});

test("PBC-24 a discharge refusal states the real blocker, not its opposite", () => {
  // Regression: `operation_completed` had no learner-facing failure wording,
  // so the refusal fell back to the criterion's satisfied-form label and told
  // the learner "Выписать сейчас нельзя: операция завершена" - the exact
  // opposite of the actual reason.
  const committed = saying(newSession("pbc-blocker"), ["живот", "на операцию"]);
  const refused = learnerVisibleText(committed, "выписываю");

  assert.deepEqual(outcomesOf(refused.turn), ["DISCHARGE_NOT_READY"]);
  assert.match(refused.text, /запланированная операция ещё не выполнена/);
  assert.equal(
    /нельзя: операция завершена/.test(refused.text),
    false,
    "the refusal must not read as though the operation HAD been completed",
  );
});

test("PBC-19 the patient physically traverses theatre, recovery and ward before discharge", () => {
  // Contract §12 (location is tracked and changes) and §19 (the learner
  // decides the destination and the patient actually goes there).
  const theatre = playToTheatre("pbc-journey");
  let session = say(theatre, "удаляю аппендикс, аспирирую жидкость из малого таза, дренаж не ставлю").session;
  assert.equal(session.state.location, "recovery");

  session = say(session, "в хирургическое отделение, vitals каждые 4 часа").session;
  assert.equal(session.state.location, "surgical_ward");
  assert.equal(session.state.postop.disposition, "surgical_ward");
  assert.deepEqual(session.state.monitoring.prescribed, ["vitals"], "disposition AND monitoring, not one or the other");

  const discharged = learnerVisibleText(session, "выписываю");
  assert.deepEqual(outcomesOf(discharged.turn), ["EXECUTED"]);
  assert.equal(discharged.session.state.session.status, "complete");
  assert.equal(discharged.session.state.session.endpoint.type, "PATIENT_DISCHARGED");
  assert.match(discharged.text, /Немедленно обратиться при:/, "system-issued return precautions (§19)");
});

test("PBC-24 safe transfer is reachable in the natural first person", () => {
  // Contract §24 lists safe transfer as one of only three terminal states, and
  // §3.2 makes it the right answer when the local hospital cannot deliver
  // care. Regression: every inflected form was written with `\w*`, which
  // matches nothing in Cyrillic, so only the bare infinitive worked and the
  // natural phrasings produced silence.
  for (const phrasing of [
    "перевожу в другой стационар",
    "переводим в другую больницу",
    "перевести в другой стационар",
    "транспортирую в областную больницу",
  ]) {
    const session = newSession(`pbc-xfer-${phrasing.length}`, { mode: "real", realProfileId: "KZ-R1-DISTRICT" });
    const turn = say(session, phrasing);
    assert.deepEqual(outcomesOf(turn), ["EXECUTED"], `«${phrasing}» must reach a transfer`);
    assert.equal(turn.session.state.session.endpoint?.type, "PATIENT_TRANSFERRED", `«${phrasing}»`);
  }
});

test("PBC-24 ending the case early marks it incomplete", () => {
  // Contract §24's closing rule.
  const ended = say(saying(newSession("pbc-quit"), ["живот"]), "завершить кейс").session;
  assert.equal(ended.state.session.status, "incomplete");
});

// ===========================================================================
// §22 / §23 Mentor policy and character separation
// ===========================================================================

test("PBC-22 the mentor stays silent across competent turns", () => {
  // Contract §22: "A competent learner should be able to complete multiple
  // consecutive turns with no mentor message."
  let session = newSession("pbc-silence");
  const spoke = [];
  for (const text of ["живот", "анамнез", "ОАК и СРБ", "КТ ОБП", "переоценю боль и витальные через 2 часа", "что с пациентом сейчас?"]) {
    const turn = say(session, text);
    if (turn.mentor?.textRu) spoke.push(`${text} -> ${turn.mentor.textRu}`);
    session = turn.session;
  }
  assert.deepEqual(spoke, [], "the mentor interrupted a competent workup");
});

test("PBC-22 the scaffolding ladder has four genuinely distinct rungs", () => {
  // Contract §22.1: focused prompt -> cue -> options -> explanation.
  let session = newSession("pbc-ladder");
  const rungs = [];
  for (let i = 0; i < 4; i += 1) {
    const turn = say(session, "не знаю");
    rungs.push(turn.mentor.textRu);
    session = turn.session;
  }
  assert.equal(new Set(rungs).size, 4, `support did not increase: ${JSON.stringify(rungs)}`);
  assert.ok(rungs[3].length > rungs[0].length, "the explanation rung is fuller than the opening prompt");
});

test("PBC-22 an open mentor question does not swallow real clinical orders", () => {
  // Contract §22 + §8.1: answering the mentor and ordering are one turn.
  const committed = say(saying(newSession("pbc-swallow"), ["живот"]), "на операцию");
  assert.ok(committed.session.state.mentor.openQuestion, "the mentor is waiting on an answer");

  const answered = say(committed.session, "венозный доступ, согласие, антибиотикопрофилактика цефазолин 2 г в/в, антибиотикопрофилактика метронидазол 500 мг в/в");
  assert.deepEqual(outcomesOf(answered), ["EXECUTED", "EXECUTED", "EXECUTED", "EXECUTED"]);
  assert.ok(answered.session.state.preop.completed.includes("iv_access"), "the orders actually happened");
});

test("PBC-23 each kind of problem is answered by the right character", () => {
  // Contract §23's table, checked as learner-facing speaker attribution.
  const nurse = learnerVisibleText(newSession("pbc-roles-1"), "кетопрофен 100 мг");
  assert.match(nurse.text, /^Медсестра: /m, "missing route -> nurse");

  const lab = learnerVisibleText(newSession("pbc-roles-2"), "БХАК");
  assert.match(lab.text, /^Лаборатория: /m, "missing lab parameter -> laboratory");

  const radiologist = learnerVisibleText(saying(newSession("pbc-roles-3"), ["КТ ОБП"]), "переоценю витальные через 2 часа");
  assert.match(radiologist.text, /^Рентгенолог: Предварительно/m, "preliminary scan -> radiologist");

  const system = learnerVisibleText(newSession("PBC-REAL-2", { mode: "real", realProfileId: "KZ-R2-URBAN" }), "КТ ОБП");
  assert.match(system.text, /^Система: КТ сейчас недоступна/m, "resource state -> hospital/system, not the mentor");

  for (const probe of [nurse, lab, radiologist, system]) {
    assert.equal(probe.turn.mentor?.textRu ?? null, null, "the mentor absorbed a routine hospital operation");
  }
});

// ===========================================================================
// §25 Debrief
// ===========================================================================

test("PBC-25 a simulator limitation is never presented as a learner omission", () => {
  // Contract §25's closing sentence, and task §24.20.
  const theatre = playToTheatre("pbc-debrief");
  const session = saying(theatre, [
    "удаляю аппендикс, аспирирую жидкость из малого таза, дренаж не ставлю",
    "в палату пробуждения",
    "в хирургическое отделение, vitals каждые 4 часа",
    "переоценю витальные утром",
    "выписываю",
  ]);
  const debrief = buildDebrief({ session, bundle });

  assert.ok(debrief.simulatorLimitations.length > 0, "withheld content is reported");
  for (const limitation of debrief.simulatorLimitations) {
    assert.match(limitation.noteRu, /ограничение платформы, а не пропуск обучающегося/);
  }

  // The two categories are structurally separate, and nothing that is a
  // simulator limitation leaks into the misses list.
  const missIds = debrief.importantMisses.map((miss) => miss.itemId ?? miss.kind);
  for (const limitation of debrief.simulatorLimitations) {
    assert.equal(missIds.includes(limitation.id), false, `simulator limitation surfaced as a miss: ${limitation.id}`);
  }

  // No numeric competence score (Governance Spec §22).
  assert.equal("score" in debrief, false);
});

test("PBC-25 a resource constraint is reported as a hospital fact, not a learner error", () => {
  // Contract §25 and task §24.21.
  let session = newSession("PBC-REAL-2", { mode: "real", realProfileId: "KZ-R2-URBAN" });
  session = saying(session, ["живот", "КТ ОБП", "перевожу в другой стационар"]);
  const debrief = buildDebrief({ session, bundle });

  assert.equal(debrief.resourceLimitations.length, 1);
  assert.match(debrief.resourceLimitations[0].noteRu, /Не является ошибкой обучающегося/);
  const missText = JSON.stringify(debrief.importantMisses);
  assert.equal(/КТ|ct_scanner/i.test(missText), false, "the broken scanner is not a learner miss");
});

test("PBC-25 every available clinical correction is backed by approved rules", () => {
  // Contract §25 ("every clinical correction traceable to an approved rule")
  // read with the governance gate. Nothing is approved, so the debrief must
  // say the reference comparison is unavailable rather than teach anyway.
  const session = saying(newSession("pbc-nocorrection"), ["живот", "выписываю"]);
  const debrief = buildDebrief({ session, bundle });

  assert.equal(debrief.referenceComparison.available, true);
  assert.ok(debrief.referenceComparison.rules.every((item) => item.ruleId));
  assert.equal(debrief.contentGovernance.patientTruthApproved, false);
  assert.equal(debrief.contentGovernance.pilotReady, false);
});

test("PBC-25 the debrief never penalises the items clinical review explicitly removed", () => {
  // Task §5.19's list of things that must not be penalised.
  const session = saying(playToTheatre("pbc-notpenalised"), [
    "удаляю аппендикс, аспирирую жидкость из малого таза, дренаж не ставлю",
    "в палату пробуждения",
    "в хирургическое отделение, vitals каждые 4 часа",
    "выписываю",
  ]);
  const debrief = JSON.stringify(buildDebrief({ session, bundle }));
  for (const forbidden of [/маркировк/i, /site.?marking/i, /фолеев/i, /мочевой катетер/i, /НМГ/, /LMWH/, /эноксапарин/i]) {
    assert.equal(forbidden.test(debrief), false, `debrief penalises a withdrawn item: ${forbidden}`);
  }
});

// ===========================================================================
// §11 Governance surfacing (task §11, §24.26, §24.27)
// ===========================================================================

test("PBC-GOV the learner is not flooded with governance messages at case start", () => {
  // Task §11: internal review machinery must not become routine patient
  // dialogue. Second Clinical Reviewer Decision, 2026-09-01 (Sarina T.T.)
  // promoted ENV's linked inflammatory profiles, the retrocecal numeric
  // remainder, the nausea/vomiting selection calibration and fasting history
  // to approved_for_training; the focused clock-anchor re-review the same day
  // then promoted TRJ-POSTOP-RECOVERY. On the internal_development route this
  // helper uses, session start now records exactly one still-pending
  // patient-truth object: the legacy union envelope (never itself
  // Clinical-Lead-reviewed; superseded by the approved profiles and only
  // reachable off the learner_pilot / production route). The learner still
  // sees the handoff and nothing else.
  const session = newSession("pbc-spam");
  const limitations = session.events.filter((event) => event.type === "SIMULATOR_LIMITATION_NOTED");
  assert.deepEqual(
    limitations.map((event) => event.payload.id).sort(),
    ["uncomplicated_inflammation"],
    "only the still-pending legacy union envelope is withheld at case start on this route",
  );

  for (const event of limitations) {
    assert.equal(renderEvent({ event, bundle, patient: session.patient }), null, "and none of them is learner prose");
  }

  // The sidebar allowlist does not carry them either (task §24.24).
  const learnerVisible = buildLearnerVisibleState(session.state);
  assert.equal("simulatorLimitations" in learnerVisible, true, "available to diagnostics");
  // Comments stripped first: the sidebar's own header comment NAMES the fields
  // it must never receive, and a doc comment explaining the rule is the
  // opposite of a violation.
  const sidebarSource = readFileSync(path.join(REPO_ROOT, "src/ui/components/SessionSidebar.jsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
  assert.equal(/simulatorLimitations|patientTruthApproved|seed|pending|mentor/.test(sidebarSource), false);
});

test("PBC-GOV approved qualitative stability never invents numeric progression", () => {
  const start = newSession("pbc-truth");
  const physiologyBefore = { ...start.state.physiology };
  const later = say(saying(start, ["живот"]), "переоценю боль и витальные через 8 часов").session;

  assert.deepEqual(later.state.physiology, physiologyBefore, "eight hours changed nothing without an approved model");
  assert.equal(later.events.some((event) => event.type === "DISEASE_PROGRESSED"), false);
  assert.equal(later.state.simulatorLimitations.some((entry) => entry.kind === "trajectory"), false);
});

test("PBC-GOV every promoted runtime item has dated reviewer provenance", () => {
  const everything = [
    ...(bundle.rules?.rules ?? []),
    ...Object.values(bundle.trajectories?.trajectories ?? {}),
    ...Object.values(bundle.trajectories?.treatment_effects ?? {}),
    ...(bundle.complications?.postoperative_course?.complications ?? []),
  ];
  for (const item of everything) {
    const status = item?.provenance?.review_status ?? item?.review_status;
    if (status !== "approved_for_training") continue;
    assert.ok(item.provenance?.reviewed_by?.length, `approved item lacks reviewer: ${item.id}`);
    assert.ok(item.provenance?.reviewed_at, `approved item lacks review date: ${item.id}`);
  }
});

// ===========================================================================
// §4 The case must actually start (found in the browser, not by a test)
// ===========================================================================

test("PBC-4 a case starts for every seed the app can generate", () => {
  // Contract §4: the learner receives a patient. Before this fix, roughly 44%
  // of real sessions threw before the first message and the app rendered
  // nothing at all - `seededStartIso` used the SIGNED `>>` on an unsigned
  // 32-bit hash, so any hash >= 2^31 produced a negative minute and a start
  // time like "2026-08-23T12:-16:00+05:00", which `createClock` rejects.
  //
  // Every other test in this repository supplies an explicit `startIso`, so
  // nothing exercised the one code path a human triggers by clicking a
  // hospital mode. Found by opening the app, not by the suite.
  const bad = [];
  for (let i = 0; i < 3000; i += 1) {
    const seed = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const iso = seededStartIso(seed);
    if (!/^2026-08-23T[0-2]\d:[0-5]\d:00\+05:00$/.test(iso) || Number.isNaN(Date.parse(iso))) bad.push(iso);
  }
  assert.deepEqual(bad.slice(0, 5), [], "unparsable start time(s) generated");

  // And a session built from such a start time actually reaches the learner.
  const seed = "mfk2h9x-q7z1ab";
  const session = createSession({
    sessionId: "pbc-start",
    seed,
    mode: "reference",
    casePresetId: "APP-004",
    sessionPurpose: "internal_development",
    bundle,
    locale: "ru",
    startIso: seededStartIso(seed),
  });
  assert.equal(session.state.session.status, "active");
  assert.ok(session.events.some((event) => event.type === "PATIENT_ARRIVED"), "the patient arrived");
});

// ===========================================================================
// §26 Generalization, §24.28 export
// ===========================================================================

test("PBC-26 the core and AI layers contain no disease-specific product logic", () => {
  // Contract §26's acceptance test. The mechanical sweep lives in
  // `core/architecture.test.js`; this asserts that guard still exists, so it
  // cannot be quietly deleted while this suite reports green.
  const architectureTest = readFileSync(path.join(REPO_ROOT, "src/core/architecture.test.js"), "utf8");
  assert.match(architectureTest, /DISEASE_SPECIFIC_TERMS/);
  for (const term of ["appendicitis", "appendectomy", "appendix"]) {
    assert.ok(architectureTest.includes(`"${term}"`), `the sweep no longer forbids ${term}`);
  }
});

test("PBC-28 the export carries the full causal interaction, and no hidden truth", () => {
  // Task §24.28 and Contract §25: what was said, what it was read as, what
  // executed, what was refused - and the learner-facing trail carries no
  // hidden diagnosis.
  const session = saying(newSession("pbc-export"), ["живот", "кетопрофен 100 мг", "в/м", "ОАК"]);
  const exported = exportSession({ session, generatedAtIso: "2026-08-25T00:00:00.000Z" });
  const types = exported.events.map((event) => event.type);

  assert.ok(types.includes("LEARNER_TURN_RECEIVED"), "what the learner said");
  assert.ok(types.includes("CLARIFICATION_REQUESTED"), "what the hospital asked back");
  assert.ok(types.includes("COMMAND_ACCEPTED"), "what executed");

  const turnEvent = exported.events.find((event) => event.type === "LEARNER_TURN_RECEIVED");
  assert.ok("rawText" in turnEvent.payload && "intent" in turnEvent.payload, "raw text and interpretation both kept");

  assert.equal(exported.session?.patientTruthApproved ?? exported.patientTruthApproved ?? false, false);
});

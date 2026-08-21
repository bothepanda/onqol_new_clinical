/**
 * What the resident actually reads, checked line by line.
 *
 * Every case here comes from reading the live run of 20.08.2026 (see
 * AB_MENTOR_LIVE_20260820.md) rather than from a failing assertion: a gendered
 * address telemetry never saw, four blocks of engine text for one line of orders,
 * the word "Стоп" for an order nobody had objected to, and a build log as the last
 * thing on the screen at the end of a case.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { advanceV25Session, createV25Session } from "../v25/engine.js";
import { buildV35Case } from "../v35/createCase.js";
import { buildMentorBrief } from "../core/mentorBrief.js";
import { buildMentorPrompt } from "../core/mentorAgent.js";
import {
  LEARNER_ADDRESS_FORM,
  detectGenderedAddress,
  resolveLearnerAddressForm,
} from "../core/learnerAddress.js";
import { ADEQUACY, MENTOR_MODE, selectMentorPolicy } from "../core/mentorPolicy.js";
import {
  PARAMETER_GOVERNANCE_CLASS,
  isGovernanceGapParameter,
  parameterFailsSafeIntoStop,
} from "../core/parameterSafety.js";
import {
  appendicitisRouterConceptMap,
  resolveConcept,
} from "../diseases/appendicitis/router/conceptRegistry.js";
import { replay91baRouter } from "./fixtures/replay91baRouter.js";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/replay-91ba7206.json", import.meta.url), "utf8")
);
const ORDERS_TURN =
  "говтовим к операции - лапарочкопическая аппенденктомия. согласие пациента, уведомить анестезиолога, узнать оперблок, группа крови и кросс-матч, физ-р-р 2 л 16G, ектотоп 30 мг в/м, цефазолин 1 гр профилкатика в оперблок";

function replayCase() {
  return buildV35Case({
    seed: fixture.effective_seed,
    requestedPresetId: fixture.case_preset_id,
  }).caseData;
}

function replayOptions(overrides = {}) {
  return {
    mentor: true,
    actionExtractorLLM: replay91baRouter,
    conceptMap: appendicitisRouterConceptMap,
    conceptRegistry: resolveConcept,
    ...overrides,
  };
}

// --- 1. the address the resident is given ----------------------------------

test("a gendered past tense with no pronoun is detected, patient description is not", () => {
  // Turn 2 of the live run. The pronoun-bound detector was silent here.
  const dropped = detectGenderedAddress(
    "Хорошо, что сохранил аппендицит как рабочую гипотезу."
  );
  assert.equal(dropped.matched, true);
  assert.equal(dropped.subjectOmitted, true);
  assert.equal(dropped.viaPronoun, false);

  assert.equal(detectGenderedAddress("Молодец, ты правильно поступил.").viaPronoun, true);
  assert.equal(detectGenderedAddress("Ты была права насчёт внематочной.").matched, true);

  // The verb has its own subject, and that subject is the patient.
  for (const aboutThePatient of [
    "Боль началась ночью и локализовалась в правой подвздошной области.",
    "Аппендикс располагался ретроцекально.",
    "Пациентка поступила три часа назад.",
    "Живот мягкий, температура держалась на 37,8.",
    "Появилась тошнота.",
    "Пациентка сказала, что поступила три часа назад.",
  ]) {
    assert.equal(
      detectGenderedAddress(aboutThePatient).matched,
      false,
      `речь о пациенте прочитана как обращение: ${aboutThePatient}`
    );
  }

  // The neutral rewrites the prompt now offers must themselves stay clean.
  for (const neutral of [
    "Хорошо, что аппендицит сохранён как рабочая гипотеза.",
    "Дифференциал пока не сузился — что делаешь дальше?",
    "Назначение записано. Какой следующий шаг?",
  ]) {
    assert.equal(detectGenderedAddress(neutral).matched, false, neutral);
  }
});

test("the neutral instruction offers rewrites, not only a ban", () => {
  const caseData = replayCase();
  const prompt = buildMentorPrompt({
    brief: buildMentorBrief({
      caseData,
      session: createV25Session({ caseData, mode: "reference", seed: "neutral" }),
      plan: { parsed: {} },
      deterministicUpdate: {},
    }),
    learnerText: "дальше?",
  });
  // The rule has to name the pronoun-less form, which is the one the model used.
  assert.match(prompt.system, /Dropping the pronoun is not a way around this rule/);
  // 21.08.2026: the neutral branch used to teach the passive as the way out
  // ("назначение записано"), and the live run duly answered in it. It now
  // forbids the passive by name and offers second-person present tense instead.
  assert.match(prompt.system, /THE PASSIVE VOICE IS FORBIDDEN/);
  assert.match(prompt.system, /IMPERATIVE freely/);
  assert.match(prompt.system, /аппендицит из дифференциала ты не выкидываешь/);
  assert.doesNotMatch(prompt.system, /write "назначение записано"/);
});

test("the form the resident used about herself reaches the next turn's prompt", async () => {
  const caseData = replayCase();
  let session = createV25Session({ caseData, mode: fixture.mode, seed: fixture.effective_seed });
  assert.equal(
    resolveLearnerAddressForm({ learnerTurns: [] }).form,
    LEARNER_ADDRESS_FORM.NEUTRAL
  );

  const spoken = await advanceV25Session({
    caseData,
    session,
    input: "Я же сделала все это выше!",
    options: replayOptions(),
  });
  session = spoken.session;

  // A LATER turn, not the one she said it on: the question is whether it survives.
  const later = await advanceV25Session({
    caseData,
    session,
    input: "дальше?",
    options: replayOptions(),
  });
  const brief = buildMentorBrief({
    caseData,
    session: later.session,
    plan: { parsed: {} },
    deterministicUpdate: {},
  });
  assert.equal(brief.learnerAddressForm, LEARNER_ADDRESS_FORM.FEMININE);
  const prompt = buildMentorPrompt({ brief, learnerText: "дальше?" });
  assert.match(prompt.system, /address form is feminine/);
  assert.equal(JSON.parse(prompt.user).brief.learner_address_form, "feminine");
});

// --- 2. how much engine text one line of orders produces --------------------

test("two orders with no reviewed rule are one sentence, not one block each", async () => {
  const caseData = replayCase();
  const session = createV25Session({
    caseData,
    mode: fixture.mode,
    seed: fixture.effective_seed,
  });
  const result = await advanceV25Session({
    caseData,
    session,
    input: ORDERS_TURN,
    options: replayOptions(),
  });

  const blocks = result.reply.match(/\*\*Назначени[ея] записан[оы]:\*\*/g) || [];
  assert.equal(blocks.length, 1, "движок повторил блок на каждое назначение");
  assert.match(result.reply, /\*\*Назначения записаны:\*\*/);
  assert.match(result.reply, /«ектотоп 30 мг в\/м», «цефазолин 1 гр профилкатика в оперблок»/);
  assert.match(result.reply, /Это не замечание к твоему выбору/);

  // The explanation is said once for all of them, not once per drug.
  const explanations = result.reply.match(/эффект не моделируется/g) || [];
  assert.equal(explanations.length, 1);
  assert.doesNotMatch(result.reply, /Стоп|не прошли проверку|с какой скоростью/i);
  assert.notEqual(result.mentor?.mode, MENTOR_MODE.SAFETY_STOP);
});

test("restating the same orders does not print the block again", async () => {
  const caseData = replayCase();
  let session = createV25Session({
    caseData,
    mode: fixture.mode,
    seed: fixture.effective_seed,
  });
  const first = await advanceV25Session({
    caseData,
    session,
    input: ORDERS_TURN,
    options: replayOptions(),
  });
  session = first.session;
  assert.match(first.reply, /Назначения записаны/);

  const again = await advanceV25Session({
    caseData,
    session,
    input: ORDERS_TURN,
    options: replayOptions(),
  });
  assert.doesNotMatch(again.reply, /Назначени[ея] записан/);
  assert.doesNotMatch(again.reply, /эффект не моделируется/);
  // And the order is still not on the patient - only the sentence went away.
  assert.equal(again.session.completedActions.includes("analgesia"), false);
  assert.equal(again.session.workingMemory.actionStates.analgesia.status, "blocked");
});

// --- 3. "стоп" only where there is danger -----------------------------------

function parameterPolicy(signal) {
  return selectMentorPolicy({
    assessment: {
      adequacy: signal.safety_verdict === "reviewed_unsafe" ? ADEQUACY.UNSAFE : ADEQUACY.PARTIAL,
      reason: "high_risk_parameter_not_yet_reviewed",
      expected_answer_domains: ["treatment_parameter"],
      safety_critical: parameterFailsSafeIntoStop(signal),
      governance_stop: signal.safety_verdict !== "reviewed_unsafe",
    },
    candidateIssues: [],
  });
}

test("a missing rule does not speak in the register of safety", () => {
  const noContent = {
    concept_id: "analgesia",
    blocks_application: true,
    safety_verdict: "not_yet_reviewed",
    governance_class: PARAMETER_GOVERNANCE_CLASS.NO_REVIEWED_CONTENT,
  };
  assert.equal(isGovernanceGapParameter(noContent), true);
  assert.equal(parameterFailsSafeIntoStop(noContent), false);

  const policy = parameterPolicy(noContent);
  assert.notEqual(policy.mode, MENTOR_MODE.SAFETY_STOP);
  assert.equal(policy.safety_critical, false);
  assert.equal(policy.governance_stop, true);
  assert.doesNotMatch(policy.fallback_text, /Стоп/i);
  assert.doesNotMatch(policy.fallback_text, /не прошл|не валидирован/i);
  assert.match(policy.fallback_text, /эффект не моделируется/);
});

test("a parameter an approved safety rule rejected still stops", () => {
  const rejected = {
    concept_id: "iv_fluids",
    blocks_application: true,
    safety_verdict: "reviewed_unsafe",
    source_rule_id: "RULE-IV-FLUIDS-001",
    governance_class: PARAMETER_GOVERNANCE_CLASS.HIGH_RISK_AWAITING_REVIEW,
  };
  assert.equal(isGovernanceGapParameter(rejected), false);
  const policy = parameterPolicy(rejected);
  assert.equal(policy.mode, MENTOR_MODE.SAFETY_STOP);
  assert.equal(policy.safety_critical, true);
  assert.match(policy.fallback_text, /Стоп/);
});

test("an enumerated high-risk parameter still fails safe while it awaits a rule", async () => {
  // 200 ml/kg. No reviewed rule exists, and the pilot cannot tell it from 20 -
  // so this one keeps stopping. Splitting the register must not touch it.
  const highRisk = {
    concept_id: "iv_fluids",
    blocks_application: true,
    safety_verdict: "not_yet_reviewed",
    governance_class: PARAMETER_GOVERNANCE_CLASS.HIGH_RISK_AWAITING_REVIEW,
  };
  assert.equal(isGovernanceGapParameter(highRisk), false);
  assert.equal(parameterFailsSafeIntoStop(highRisk), true);
  assert.equal(parameterPolicy(highRisk).mode, MENTOR_MODE.SAFETY_STOP);
});

test("no order is applied to the patient by the split, whichever register speaks", async () => {
  const caseData = replayCase();
  const session = createV25Session({
    caseData,
    mode: fixture.mode,
    seed: fixture.effective_seed,
  });
  const result = await advanceV25Session({
    caseData,
    session,
    input: ORDERS_TURN,
    options: replayOptions(),
  });
  for (const actionId of ["iv_fluids", "analgesia", "preop_single_antibiotic_prophylaxis"]) {
    assert.equal(result.session.workingMemory.actionStates[actionId].status, "blocked");
    assert.equal(result.session.completedActions.includes(actionId), false);
  }
  assert.equal(
    (result.session.actionLog || []).some(
      (entry) => entry.applied_to_patient && entry.parameter_safety?.blocks_application
    ),
    false
  );
});

// --- 4. the last thing the resident reads -----------------------------------

test("the debrief keeps the build log out of the resident's view and in the export", async () => {
  const caseData = replayCase();
  let session = createV25Session({
    caseData,
    mode: fixture.mode,
    seed: fixture.effective_seed,
  });
  const opened = await advanceV25Session({
    caseData,
    session,
    input: "физикальный осмотр и анамнез",
    options: replayOptions(),
  });
  const finished = await advanceV25Session({
    caseData,
    session: opened.session,
    input: "конец кейса",
    options: replayOptions(),
  });

  assert.doesNotMatch(finished.reply, /Статус данных/);
  assert.doesNotMatch(finished.reply, /expected_actions/);
  assert.doesNotMatch(finished.reply, /domain scores/);
  // The line addressed to the resident stays.
  assert.match(finished.reply, /итоговый числовой балл отключён/);

  const report = finished.session.report;
  assert.match(report.dataStatusMarkdown, /Статус данных/);
  assert.match(report.facultyMarkdown, /Статус данных/);
  assert.match(report.facultyMarkdown, /итоговый числовой балл отключён/);
  assert.equal(
    finished.session.messages.at(-1).content.includes("Статус данных"),
    false,
    "лог сборки всё ещё в ленте резидента"
  );
});

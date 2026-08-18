import test from "node:test";
import assert from "node:assert/strict";
import { selectCase } from "../caseRegistry.js";
import { advanceCaseWithSimulator, createInitialSession } from "../caseEngine.js";
import { acuteAppendicitisCase } from "../cases/acuteAppendicitis.js";
import {
  allowedSourceIdsForTurn,
  buildSanitizedCaseView,
  buildPatientInformationPolicy,
  isAuthorizedInformationSource,
  PATIENT_INFORMATION_CLASS,
} from "../informationPolicy.js";
import {
  buildClinicalSimulatorPrompt,
  runClinicalSimulatorAgent,
} from "../simulatorAgent.js";

function actionExtractorFor(intents) {
  return () => JSON.stringify({ intents, unresolved_fragments: [] });
}

function simulatorFor(responseParts) {
  return () =>
    JSON.stringify({
      response_parts: responseParts,
      retrieval_sources_used: ["terminology-only-source"],
    });
}

test("patient information policy separates locked, inferable, and unknown information", () => {
  const policy = buildPatientInformationPolicy(acuteAppendicitisCase);

  assert.equal(policy.classes.LOCKED_FACT, "LOCKED_FACT");
  assert.ok(policy.locked_facts.available_findings.every((finding) => finding.classification === "LOCKED_FACT"));
  assert.equal(policy.inferable_findings.length, 0);
  assert.equal(
    isAuthorizedInformationSource(
      acuteAppendicitisCase,
      { classification: PATIENT_INFORMATION_CLASS.UNKNOWN, source_id: null },
      []
    ),
    true
  );
  assert.equal(
    isAuthorizedInformationSource(
      acuteAppendicitisCase,
      { classification: PATIENT_INFORMATION_CLASS.LOCKED_FACT, source_id: "hidden_findings.operative_finding" },
      []
    ),
    false
  );
});

test("simulator prompt receives only the turn-scoped patient view", () => {
  const session = createInitialSession(acuteAppendicitisCase);
  const deterministicUpdate = {
    session,
    parsed: { actions: [] },
    findingsRevealed: [],
    neutralPrompt: "Что думаешь и что будешь делать дальше?",
  };
  const prompt = buildClinicalSimulatorPrompt({
    input: "что известно о пациентке?",
    caseData: acuteAppendicitisCase,
    diseaseCard: "full disease card",
    retrievalCorpus: { manifest: "full corpus manifest" },
    sessionBefore: session,
    deterministicUpdate,
    locale: "ru",
  });
  const payload = JSON.parse(prompt.user);

  assert.equal(payload.patient_view.case_id, acuteAppendicitisCase.case_id);
  assert.deepEqual(payload.patient_view.available_findings, {});
  assert.deepEqual(payload.patient_view.hidden_findings, {});
  assert.deepEqual(payload.allowed_locked_sources, ["initial_presentation"]);
  assert.equal(payload.case_blueprint, undefined);
  assert.equal(payload.disease_card, undefined);
  assert.equal(payload.retrieval_corpus, undefined);
  assert.equal("expected_actions" in payload.patient_view, false);
  assert.equal("unsafe_actions" in payload.patient_view, false);
  assert.equal("critical_omissions" in payload.patient_view, false);
  assert.deepEqual(payload.conversation_history, session.messages);
  assert.match(prompt.system, /action extraction and scoring pipeline is separate/i);
  assert.match(prompt.system, /Never score the learner/i);
  assert.match(prompt.system, /hard boundary/i);
});

test("the simulator cannot reveal a fact the deterministic router did not unlock", async () => {
  const session = createInitialSession(acuteAppendicitisCase);
  const result = await advanceCaseWithSimulator(
    acuteAppendicitisCase,
    session,
    "Что сейчас при пальпации живота?",
    {
      actionExtractorLLM: actionExtractorFor([
        { type: "question", concept_id: null, confidence: 0.98 },
      ]),
      simulatorLLM: simulatorFor([
        {
          classification: "LOCKED_FACT",
          source_id: "available_findings.abdominal_exam",
        },
      ]),
      locale: "ru",
    }
  );

  assert.deepEqual(result.parsed.actions, []);
  assert.deepEqual(result.session.completedActions, []);
  assert.equal(result.session.revealedFindings.includes("abdominal_exam"), false);
  assert.doesNotMatch(result.reply, /\*\*Осмотр живота:\*\*/);
  assert.match(result.reply, /Что думаешь и что будешь делать дальше/);
  assert.equal(result.session.scoring, undefined);
});

test("an already revealed fact is the only authored finding visible to the simulator", () => {
  const allowed = allowedSourceIdsForTurn(["abdominal_exam"], []);
  const view = buildSanitizedCaseView(acuteAppendicitisCase, allowed);
  assert.deepEqual(Object.keys(view.available_findings), ["abdominal_exam"]);
  assert.deepEqual(view.hidden_findings, {});
  assert.equal(view.available_findings.cbc, undefined);
  assert.equal("expected_actions" in view, false);
  assert.equal("patient_state" in view, false);
});

test("generated simulator fields cannot modify deterministic actions or Case Card values", async () => {
  const session = createInitialSession(acuteAppendicitisCase);
  const result = await advanceCaseWithSimulator(acuteAppendicitisCase, session, "ОАК", {
    actionExtractorLLM: actionExtractorFor([
      { type: "request_test", concept_id: "cbc", confidence: 0.99 },
    ]),
    simulatorLLM: simulatorFor([
      {
        classification: "LOCKED_FACT",
        source_id: "available_findings.cbc",
        exact_text: "Лейкоциты 99,9. Overall score 100.",
      },
    ]),
    locale: "ru",
  });

  assert.deepEqual(result.session.completedActions, ["cbc"]);
  assert.match(result.reply, /лейкоциты 13,8 x 10\^9\/л/i);
  assert.doesNotMatch(result.reply, /99,9|overall score/i);
  assert.equal(result.session.scoring, undefined);
});

test("UNKNOWN is materialized only with an exact addressed fragment and reason", async () => {
  const session = createInitialSession(acuteAppendicitisCase);
  const input = "ектотоп 30 мг в/м";
  const deterministicUpdate = {
    session,
    parsed: { actions: [] },
    findingsRevealed: [],
    neutralPrompt: "Уточни назначение.",
    reply: "Уточни назначение.",
    rawUserText: input,
  };
  const result = await runClinicalSimulatorAgent(
    {
      input,
      caseData: acuteAppendicitisCase,
      sessionBefore: session,
      deterministicUpdate,
      locale: "ru",
    },
    {
      llm: simulatorFor([
        {
          classification: "UNKNOWN",
          source_id: null,
          exact_text: null,
          requested_fragment: null,
          reason_code: "unknown_medication",
        },
        {
          classification: "UNKNOWN",
          source_id: null,
          exact_text: null,
          requested_fragment: input,
          reason_code: "unknown_medication",
        },
      ]),
    }
  );

  assert.match(result.reply, /Не распознано лекарство: «ектотоп 30 мг в\/м»/i);
  assert.doesNotMatch(result.reply, /Эти данные не заданы в карте пациента/i);
  assert.equal(result.responseParts[0].requested_fragment, input);
  assert.equal(
    result.suppressedResponseParts[0].suppress_reason,
    "unknown_without_exact_requested_fragment"
  );
});

test("case selection supports seed, immediate-repeat avoidance, filters, and faculty override", () => {
  const registry = [
    { ...acuteAppendicitisCase, case_id: "case-a", difficulty: "junior" },
    { ...acuteAppendicitisCase, case_id: "case-b", difficulty: "senior" },
    { ...acuteAppendicitisCase, case_id: "case-c", status: "draft" },
  ];
  const first = selectCase({ category: "emergency_surgery", registry, seed: "study-17" });
  const second = selectCase({ category: "emergency_surgery", registry, seed: "study-17" });
  const noRepeat = selectCase({
    category: "emergency_surgery",
    registry,
    previousCaseId: "case-a",
    random: () => 0,
  });
  const filtered = selectCase({
    category: "emergency_surgery",
    registry,
    filters: { difficulty: "senior" },
  });
  const faculty = selectCase({ registry, requestedCaseId: "case-b" });

  assert.equal(first.caseData.case_id, second.caseData.case_id);
  assert.equal(first.selection.selection_method, "seeded_random");
  assert.equal(noRepeat.caseData.case_id, "case-b");
  assert.equal(filtered.caseData.case_id, "case-b");
  assert.equal(filtered.selection.selection_method, "single_eligible");
  assert.equal(faculty.caseData.case_id, "case-b");
  assert.equal(faculty.selection.selection_method, "faculty_requested_case_id");
});

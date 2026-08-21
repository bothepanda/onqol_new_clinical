// Replay c1b4c2d9 (APP-002, seed reference-1691b522, 21.08.2026), five turns
// that ended with the resident typing "конец кейса" and leaving.
//
// WHAT THE REPLAY SHOWED
//
// Turn 2, "о аппендицит определенно": a working diagnosis on an eight-minute-old
// case with no investigations, in a pregnancy-possible patient. Four teaching
// rules fired. The mentor said nothing, because the turn was scored SUFFICIENT -
// the resident had, after all, expressed a diagnosis - and the policy read
// "sufficient to advance" as "nothing to teach".
//
// Turns 3-5, "оперируем" / "в операционную!" / "берем пациента и катим в
// оперблок!!": the engine recorded the appendectomy decision and moved the path
// to preop, then answered all three turns with the same sentence, "уточни, какие
// данные хочешь получить или какое действие выполняешь". The one thing it knew
// and did not say was that the approach had not been chosen.
//
// The debrief then reported one deferred item out of six. The other five had no
// entry in the label table the debrief used, and a `.filter(Boolean)` removed
// them without a trace on screen; they survived only in the export.
//
// Each test below fails on the behaviour recorded in that replay.
import assert from "node:assert/strict";
import test from "node:test";

import { buildV35Case } from "../v35/createCase.js";
import { advanceV25Session, createV25Session } from "../v25/engine.js";
import { mentorHeuristics } from "../core/mentorHeuristics.js";
import { ADEQUACY, MENTOR_MODE, selectMentorPolicy } from "../core/mentorPolicy.js";
import {
  appendicitisRouterConceptMap,
  resolveConcept,
} from "../diseases/appendicitis/router/conceptRegistry.js";

const CLARIFY_PROMPT = "Уточни, какие данные хочешь получить или какое действие выполняешь.";
const APPROACH_PROMPT = "Какой операционный доступ выбираешь и когда начинаешь?";

function routed(type, conceptId, requestedFragment) {
  return { type, concept_id: conceptId, confidence: 0.97, requested_fragment: requestedFragment };
}

/** The router output recorded for this session, keyed by what the resident typed. */
const REPLAY = {
  "физикальный осмотр и опрос": {
    intents: [
      routed("request_examination", "abdominal_exam", "физикальный осмотр"),
      routed("request_history", "focused_history", "опрос"),
    ],
  },
  "о аппендицит определенно": {
    intents: [routed("diagnosis", "diagnosis_acute_appendicitis", "о аппендицит определенно")],
    reasoning: {
      working_diagnosis: {
        stated: true,
        concept_id: "diagnosis_acute_appendicitis",
        uncertainty_stated: false,
      },
      differential: {
        stated: true,
        ranked: false,
        has_dangerous_alternative: false,
        items: [{ concept_id: "diagnosis_acute_appendicitis", rank: null, dangerous: false }],
      },
    },
  },
  оперируем: {
    intents: [routed("management", "decision_for_appendectomy", "оперируем")],
  },
  "в операционную!": {
    intents: [routed("management", "operative_intent", "в операционную!")],
  },
};

function replayRouter(prompt) {
  const raw = JSON.parse(prompt.user).raw_user_text;
  return JSON.stringify({
    intents: [],
    unresolved_fragments: [],
    action_parameters: [],
    ...(REPLAY[raw] || {}),
  });
}

function options(overrides = {}) {
  return {
    mentor: true,
    actionExtractorLLM: replayRouter,
    conceptMap: appendicitisRouterConceptMap,
    conceptRegistry: resolveConcept,
    ...overrides,
  };
}

function replayCase() {
  return buildV35Case({ seed: "reference-1691b522", requestedPresetId: "APP-002" }).caseData;
}

async function play(inputs, overrides = {}) {
  const caseData = replayCase();
  let session = createV25Session({ caseData, mode: "reference", seed: "reference-1691b522" });
  const turns = [];
  for (const input of inputs) {
    const result = await advanceV25Session({
      caseData,
      session,
      input,
      options: options(overrides),
    });
    session = result.session;
    turns.push(result);
  }
  return { caseData, session, turns };
}

test("every teaching rule can state its own gap in the debrief", () => {
  const caseRules = replayCase().mentor_rules || [];
  const missing = [...mentorHeuristics, ...caseRules]
    .filter((rule) => !rule.debrief_line_ru)
    .map((rule) => rule.id);
  assert.deepEqual(missing, []);
  // The gap this replaces was a table of seven labels for nineteen rules.
  assert.ok(mentorHeuristics.length + caseRules.length >= 19);
});

test("a debrief line is a statement about reasoning, never about the patient", () => {
  const caseRules = replayCase().mentor_rules || [];
  for (const rule of [...mentorHeuristics, ...caseRules]) {
    // Gendered Russian past tense about the learner is banned in mentor_line and
    // stays banned here: "ты назначил" excludes half the cohort.
    assert.doesNotMatch(rule.debrief_line_ru, /\bты\s+\w+(?:л|ла)\b/iu, rule.id);
    assert.doesNotMatch(rule.debrief_line_ru, /пациентка? жалуется|температура \d/iu, rule.id);
  }
});

test("an adequate turn with an important omission is challenged, not nodded through", () => {
  const policy = selectMentorPolicy({
    assessment: { adequacy: ADEQUACY.SUFFICIENT, reason: "current_reasoning_is_expressed" },
    candidateIssues: [
      {
        issue_id: "premature_closure",
        type: "outstanding_priority",
        severity: 3,
        relevant_to_current_turn: true,
      },
    ],
  });
  assert.equal(policy.mode, MENTOR_MODE.CHALLENGE);
  assert.equal(policy.issue_id, "premature_closure");
  // Advancing and teaching are separate answers: the case still moves on.
  assert.equal(policy.reasoning_sufficient_to_advance, true);
});

test("an adequate turn with only a minor gap is still left alone", () => {
  const policy = selectMentorPolicy({
    assessment: { adequacy: ADEQUACY.SUFFICIENT, reason: "current_reasoning_is_expressed" },
    candidateIssues: [
      {
        issue_id: "checkpoint_problem_representation",
        type: "outstanding_priority",
        severity: 1,
        relevant_to_current_turn: true,
      },
    ],
  });
  assert.equal(policy.mode, MENTOR_MODE.CONTINUE);
  assert.equal(policy.issue_id, null);
});

test("the diagnosis declared on turn two is asked what it rests on", async () => {
  const { turns } = await play(["физикальный осмотр и опрос", "о аппендицит определенно"]);
  const diagnosisTurn = turns[1];
  assert.notEqual(diagnosisTurn.mentor.mode, MENTOR_MODE.CONTINUE);
  // Grounds first: the dangerous alternative and stability stay queued for the
  // turns after, but an unsupported claim is answered before either of them.
  assert.equal(diagnosisTurn.mentor.issueId, "hypothesis_without_grounds");
  assert.match(diagnosisTurn.reply, /на основании каких данных/iu);
});

test("a diagnosis the resident grounds in their own words is not interrogated", () => {
  const policy = selectMentorPolicy({
    assessment: { adequacy: ADEQUACY.SUFFICIENT, reason: "current_reasoning_is_expressed" },
    candidateIssues: [],
  });
  assert.equal(policy.mode, MENTOR_MODE.CONTINUE);
});

test("the turn that decides the operation is asked for the approach, not for an action", async () => {
  const { turns } = await play([
    "физикальный осмотр и опрос",
    "о аппендицит определенно",
    "оперируем",
  ]);
  const decisionTurn = turns[2];
  assert.equal(decisionTurn.plan.plannerPrompt, APPROACH_PROMPT);
  assert.doesNotMatch(decisionTurn.reply, new RegExp(CLARIFY_PROMPT));
});

test("an unmapped turn after the decision still asks for the approach", async () => {
  const { turns } = await play([
    "физикальный осмотр и опрос",
    "о аппендицит определенно",
    "оперируем",
    "в операционную!",
  ]);
  assert.equal(turns[3].plan.plannerPrompt, APPROACH_PROMPT);
});

test("the clarifying prompt is never repeated verbatim twice in a row", async () => {
  const { turns } = await play(["ммм", "ну эээ"], { mentor: false });
  assert.match(turns[0].reply, new RegExp(CLARIFY_PROMPT));
  assert.doesNotMatch(turns[1].reply, new RegExp(CLARIFY_PROMPT));
  assert.match(turns[1].reply, /Назови конкретно/);
});

test("every deferred issue reaches the resident's debrief, not only the export", async () => {
  const { session, turns } = await play([
    "физикальный осмотр и опрос",
    "о аппендицит определенно",
    "оперируем",
    "в операционную!",
    "конец кейса",
  ]);
  const deferred = session.workingMemory.deferredMentorIssues.map((issue) => issue.issue_id);
  assert.ok(deferred.includes("premature_closure"));
  assert.ok(deferred.includes("appendicitis_ectopic_not_excluded"));

  const debrief = turns.at(-1).reply;
  const rules = new Map(
    [...mentorHeuristics, ...(replayCase().mentor_rules || [])].map((rule) => [
      rule.id,
      rule.debrief_line_ru,
    ])
  );
  for (const issueId of deferred) {
    assert.ok(
      debrief.includes(rules.get(issueId)),
      `debrief drops ${issueId}, which is exactly what replay c1b4c2d9 did`
    );
  }
});

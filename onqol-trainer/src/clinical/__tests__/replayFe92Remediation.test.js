// Replay fe92b8b5 (APP-004 retrocecal, seed reference-6ad0e8b4, 21.08.2026).
//
// The first session run after the mentor learned to push back, and it broke one
// step later. On turn 5 the mentor asked "Аппендицит остаётся рабочей гипотезой.
// Какие полученные данные её поддерживают?" - which is the intended behaviour.
// On turn 6 the resident answered it: "боль при разгибании правого бедра, данные
// кт, лекйцоциты высокие". The trainer replied "Уточни, какие данные хочешь
// получить или какое действие выполняешь", recorded nothing, and then told the
// resident in the debrief that the grounds for the working diagnosis were never
// named.
//
// The question was asked with `expects: ["diagnostic reasoning"]` - free text the
// model invented, because the rule declared no answer domain and the per-issue
// table in mentorAgent.js covered six ids out of nineteen. The interpreter that
// has to recognise an answer knows a closed vocabulary of domains, so an answer
// in any other domain is not an answer at all.
//
// A mentor that asks a question it cannot receive an answer to is worse than a
// mentor that stays silent: it invites the resident to think, then tells them
// they did not.
import assert from "node:assert/strict";
import test from "node:test";

import { buildV35Case } from "../v35/createCase.js";
import { advanceV25Session, createV25Session } from "../v25/engine.js";
import { mentorHeuristics } from "../core/mentorHeuristics.js";
import { MENTOR_MODE } from "../core/mentorPolicy.js";
import {
  appendicitisRouterConceptMap,
  resolveConcept,
} from "../diseases/appendicitis/router/conceptRegistry.js";

const CLARIFY_PROMPT = "Уточни, какие данные хочешь получить или какое действие выполняешь.";
const GROUNDS = "боль при разгибании правого бедра, данные кт, лекйцоциты высокие";

/**
 * The answer domains interpretPendingMentorAnswer() can actually recognise. A
 * rule may only promise an answer the engine knows how to receive.
 */
const RECOGNISED_DOMAINS = new Set([
  "contingency",
  "observation",
  "stability",
  "management",
  "reassessment",
  "treatment_parameter",
  "diagnosis_grounds",
  "counter_evidence",
  "current_decision",
  "immediate_actions",
  "ownership",
  "action_scope",
  "operative_objective",
  "operative_approach",
]);

function routed(type, conceptId, requestedFragment) {
  return { type, concept_id: conceptId, confidence: 0.98, requested_fragment: requestedFragment };
}

const REPLAY = {
  "осмотр и опрос": {
    intents: [
      routed("request_examination", "abdominal_exam", "осмотр"),
      routed("request_history", "focused_history", "опрос"),
    ],
  },
  "оак узи обп": {
    intents: [
      routed("request_test", "cbc", "оак"),
      routed("request_test", "abdominal_ultrasound", "узи обп"),
    ],
  },
  "кт обп": { intents: [routed("request_test", "ct_abdomen", "кт обп")] },
  "о аппендицит!": {
    intents: [routed("diagnosis", "diagnosis_acute_appendicitis", "о аппендицит!")],
    reasoning: {
      working_diagnosis: {
        stated: true,
        concept_id: "diagnosis_acute_appendicitis",
        uncertainty_stated: false,
      },
    },
  },
  // The router produced nothing for the answer: no intent, no reasoning delta.
  // Recognising it is the engine's job, from the question that is still open.
  [GROUNDS]: { intents: [] },
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

function replayCase() {
  return buildV35Case({ seed: "reference-6ad0e8b4", requestedPresetId: "APP-004" }).caseData;
}

async function play(inputs) {
  const caseData = replayCase();
  let session = createV25Session({ caseData, mode: "reference", seed: "reference-6ad0e8b4" });
  const turns = [];
  for (const input of inputs) {
    const result = await advanceV25Session({
      caseData,
      session,
      input,
      options: {
        mentor: true,
        actionExtractorLLM: replayRouter,
        conceptMap: appendicitisRouterConceptMap,
        conceptRegistry: resolveConcept,
      },
    });
    session = result.session;
    turns.push(result);
  }
  return { session, turns };
}

const UP_TO_DIAGNOSIS = ["осмотр и опрос", "оак узи обп", "кт обп", "о аппендицит!"];

test("the question about grounds promises an answer the engine can receive", async () => {
  const { session, turns } = await play(UP_TO_DIAGNOSIS);
  assert.equal(turns.at(-1).mentor.mode, MENTOR_MODE.CHALLENGE);
  const pending = session.workingMemory.pendingMentorQuestion;
  assert.equal(pending.issue_id, "hypothesis_without_grounds");
  // "diagnostic reasoning" - what the model invented when the rule promised
  // nothing - is not in the vocabulary and made the answer unreadable.
  for (const domain of pending.expects) {
    assert.ok(RECOGNISED_DOMAINS.has(domain), `unrecognisable answer domain: ${domain}`);
  }
});

test("the answer to that question is recorded as the learner's own evidence", async () => {
  const { session } = await play([...UP_TO_DIAGNOSIS, GROUNDS]);
  const items = session.workingMemory.reasoningState.differential.items;
  const evidence = items.flatMap((item) => item.evidence_for);
  assert.deepEqual(evidence, [GROUNDS]);
  // Naming what supports one hypothesis is not the same as having formed a
  // differential, and the engine must not claim the stronger thing.
  assert.equal(session.workingMemory.reasoningState.differential.stated, false);
});

test("answering the mentor is not met with 'уточни, какое действие выполняешь'", async () => {
  const { turns } = await play([...UP_TO_DIAGNOSIS, GROUNDS]);
  const answerTurn = turns.at(-1);
  assert.doesNotMatch(answerTurn.reply, new RegExp(CLARIFY_PROMPT));
  assert.match(answerTurn.reply, /Ответ зафиксирован/);
});

test("a filler does not close the question, and is not answered as if nothing was said", async () => {
  const { session, turns } = await play([...UP_TO_DIAGNOSIS, "ммм"]);
  // Nothing was named, so the grounds stay unnamed - a resident cannot close a
  // teaching question by typing anything at all.
  const evidence = session.workingMemory.reasoningState.differential.items.flatMap(
    (item) => item.evidence_for
  );
  assert.deepEqual(evidence, []);
  // The engine's own closing line points back at the open question instead of
  // asking which action is being performed. (A speaking mentor may replace it
  // with its own clarification, which is also not the clarify prompt.)
  assert.equal(turns.at(-1).plan.plannerPrompt, "Ответь на вопрос выше или назови следующее действие.");
  assert.doesNotMatch(turns.at(-1).reply, new RegExp(CLARIFY_PROMPT));
});

test("the debrief does not report grounds as missing after they were given", async () => {
  const { turns } = await play([...UP_TO_DIAGNOSIS, GROUNDS, "конец кейса"]);
  const debrief = turns.at(-1).reply;
  assert.doesNotMatch(debrief, /Основания для рабочего диагноза не были названы/);
  // The ladder moves on instead: arguments for exist, arguments against do not.
  assert.match(debrief, /Доводы против ведущей гипотезы не были названы/);
});

test("a rule that asks a question may only promise a domain the engine knows", () => {
  // Rules that still fall back to whatever domain the model invents. The list
  // may shrink and may never grow: a new question without a declared domain is
  // a new instance of this replay.
  const undeclared = new Set([
    "premature_closure",
    "unranked_differential",
    "investigation_without_purpose",
    "imaging_before_examination",
    "waiting_for_every_result",
    "consultation_replacing_reasoning",
    "ed_clock_disposition",
    "checkpoint_problem_representation",
    "checkpoint_hypotheses",
  ]);
  for (const rule of mentorHeuristics) {
    if (!String(rule.mentor_line || "").includes("?")) continue;
    const declared = rule.expected_answer_domains || [];
    if (!declared.length) {
      assert.ok(undeclared.has(rule.id), `${rule.id} asks a question and promises no answer domain`);
      continue;
    }
    for (const domain of declared) {
      assert.ok(RECOGNISED_DOMAINS.has(domain), `${rule.id} promises unknown domain ${domain}`);
    }
  }
});

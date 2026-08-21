// The contracts base rules v2 introduced (BASE_RULES_V2_PROPOSAL.md,
// CLAUDE_CODE_TASK_BASE_RULES_V2.md). Everything here is new behaviour; the
// contracts it replaces are marked "CONTRACT CHANGED" in the older mentor tests.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { advanceV25Session, createV25Session } from "../v25/engine.js";
import { buildV35Case } from "../v35/createCase.js";
import { createV25Case } from "../v25/caseFactory.js";
import { composeCaseWithCore } from "../core/composeCase.js";
import { buildMentorBrief, buildMentorCaseCard } from "../core/mentorBrief.js";
import {
  MAX_MENTOR_CHARS,
  MAX_MENTOR_CHARS_TEACHING,
  buildMentorPrompt,
  maxMentorChars,
  runMentorAgent,
  validateMentorPayload,
} from "../core/mentorAgent.js";
import {
  MENTOR_BEHAVIOR_SPEC,
  MENTOR_BEHAVIOR_SPEC_SOURCE,
} from "../core/mentorBehaviorSpec.js";
import { detectLegacyPractices } from "../core/legacyPractices.js";
import {
  expressedActionIds,
  prerequisiteSatisfied,
} from "../core/prerequisiteClosure.js";
import {
  CLINICAL_RULE_STATUS,
  DOSING_RULE_REGISTRY,
  approvedDosingRules,
  validateDosingRule,
} from "../governance/clinicalGovernance.js";
import { replay91baRouter } from "./fixtures/replay91baRouter.js";
import {
  appendicitisRouterConceptMap,
  resolveConcept,
} from "../diseases/appendicitis/router/conceptRegistry.js";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/replay-91ba7206.json", import.meta.url), "utf8")
);

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

function briefFor(caseData, overrides = {}) {
  return buildMentorBrief({
    caseData,
    session: createV25Session({ caseData, mode: "reference", seed: "v2" }),
    plan: { parsed: {} },
    deterministicUpdate: {},
    ...overrides,
  });
}

// --- 1.1 the specification IS the prompt ----------------------------------

test("the system prompt reproduces the behaviour specification verbatim", () => {
  const markdown = readFileSync(
    new URL(`../../../${MENTOR_BEHAVIOR_SPEC_SOURCE}`, import.meta.url),
    "utf8"
  );
  assert.equal(
    MENTOR_BEHAVIOR_SPEC,
    markdown,
    `${MENTOR_BEHAVIOR_SPEC_SOURCE} changed. Run: npm run spec:sync`
  );

  const prompt = buildMentorPrompt({ brief: briefFor(replayCase()), learnerText: "дальше?" });
  assert.ok(prompt.system.includes(markdown));
  // The four base rules follow the specification and outrank it.
  for (const bound of [
    "THE WORLD IS DETERMINISTIC",
    "NUMBERS COME FROM THE KNOWLEDGE BASE",
    "NO DIAGNOSTIC CONFIRMATION BEFORE THE DEBRIEF",
    "QUESTIONS.",
    "DO NOT SAY WHAT THE ENGINE ALREADY SAID",
    "REINFORCE REQUIRES AN ANCHOR",
  ]) {
    assert.ok(prompt.system.includes(bound), `hard bound missing: ${bound}`);
  }
});

// --- 1.2 full context ------------------------------------------------------

test("the mentor receives the whole transcript, not a six-message window", async () => {
  const caseData = replayCase();
  let session = createV25Session({ caseData, mode: fixture.mode, seed: fixture.effective_seed });
  for (const entry of fixture.transcript.filter((item) => item.role === "user").slice(0, 5)) {
    const result = await advanceV25Session({
      caseData,
      session,
      input: entry.content,
      options: replayOptions(),
    });
    session = result.session;
  }
  const brief = buildMentorBrief({
    caseData,
    session,
    plan: { parsed: {} },
    deterministicUpdate: {},
  });
  assert.ok(brief.transcript.length > 6);
  assert.equal(brief.learnerTurns.length, 5);
  assert.ok(brief.learnerTurns[0].includes("физикальный осмотр"));
  // The first turn is still readable on turn five - that is the whole point.
  assert.ok(JSON.stringify(brief.transcript).includes("физикальный осмотр"));
});

test("the case card marks what the learner has not been given", () => {
  const caseData = replayCase();
  const session = {
    ...createV25Session({ caseData, mode: "reference", seed: "card" }),
    revealedFindings: ["abdominal_exam"],
  };
  const card = buildMentorCaseCard(caseData, session);
  assert.deepEqual(
    card.revealed_findings.map((finding) => finding.finding_id),
    ["abdominal_exam"]
  );
  assert.ok(card.unrevealed_findings.length > 0);
  assert.ok(card.unrevealed_findings.every((finding) => finding.do_not_mention === true));
  assert.ok(card.modelled_actions.some((action) => action.action_id === "ct_abdomen"));
  assert.equal(card.patient.age, 56);
  // The answer key is not in the card, by construction.
  assert.ok(!JSON.stringify(card).includes(caseData.patient_state.diagnosis_truth));
});

// --- 1.6 length by mode ----------------------------------------------------

test("the length limit follows the teaching move", () => {
  assert.equal(maxMentorChars({ mode: "CLARIFY", scaffoldingLevel: 4 }), MAX_MENTOR_CHARS);
  assert.equal(maxMentorChars({ mode: "TEACH", scaffoldingLevel: 2 }), MAX_MENTOR_CHARS);
  assert.equal(maxMentorChars({ mode: "TEACH", scaffoldingLevel: 3 }), MAX_MENTOR_CHARS_TEACHING);
  assert.equal(maxMentorChars({ mode: "TEACH", scaffoldingLevel: 4 }), MAX_MENTOR_CHARS_TEACHING);

  const caseData = replayCase();
  const brief = {
    ...briefFor(caseData),
    candidateIssues: [{ issue_id: "stuck", safety_critical: false }],
    mentorPolicy: null,
  };
  const long = `${"Разбираем по шагам. ".repeat(70)}Что делаешь первым?`;
  assert.ok(long.length > MAX_MENTOR_CHARS && long.length < MAX_MENTOR_CHARS_TEACHING);

  assert.equal(
    validateMentorPayload(
      { mode: "CLARIFY", issue_id: "stuck", mentor_text: long, factual_claims: [], scaffolding_level: 4 },
      brief,
      caseData,
      []
    ).telemetry.includes("over_length_budget"),
    true
  );
  assert.equal(
    validateMentorPayload(
      { mode: "TEACH", issue_id: "stuck", mentor_text: long, factual_claims: [], scaffolding_level: 3 },
      brief,
      caseData,
      []
    ).ok,
    true
  );
});

// --- 1.7 repair loop -------------------------------------------------------

test("a rejected reply buys one repair before the template", async () => {
  const caseData = replayCase();
  const brief = {
    ...briefFor(caseData),
    candidateIssues: [
      {
        issue_id: "current",
        type: "current_decision",
        safety_critical: false,
        fallback_text: "Авторский шаблон.",
        evidence: [],
      },
    ],
    mentorPolicy: null,
  };
  const prompts = [];
  const result = await runMentorAgent(
    { brief, learnerText: "что дальше?", caseData, revealedFindingIds: [] },
    {
      llm: async (prompt) => {
        prompts.push(JSON.parse(prompt.user));
        return JSON.stringify(
          prompts.length === 1
            ? {
                mode: "CLARIFY",
                issue_id: "current",
                mentor_text: "Держи давление выше 90. Что дальше?",
                factual_claims: [],
                question_domain: null,
              }
            : {
                mode: "CLARIFY",
                issue_id: "current",
                mentor_text: "Что считаешь порогом для смены плана?",
                factual_claims: [],
                question_domain: null,
              }
        );
      },
    }
  );

  assert.equal(prompts.length, 2, "the first rejection must be repaired, not abandoned");
  assert.equal(result.source, "llm");
  assert.equal(result.repairAttempted, true);
  assert.deepEqual(result.rejectionReasons, ["uncited_numeric_fact"]);
  assert.equal(result.text, "Что считаешь порогом для смены плана?");
  // The repair call names the reason and the offending number.
  assert.equal(prompts[1].repair_request.rejected_reason, "uncited_numeric_fact");
  assert.match(prompts[1].repair_request.instruction_ru, /90/);
});

test("a second failure falls silent rather than reciting the template", async () => {
  const caseData = replayCase();
  const brief = {
    ...briefFor(caseData),
    candidateIssues: [
      {
        issue_id: "current",
        type: "current_decision",
        safety_critical: false,
        fallback_text: "Авторский шаблон.",
        evidence: [],
      },
    ],
    mentorPolicy: null,
  };
  let calls = 0;
  const result = await runMentorAgent(
    { brief, learnerText: "что дальше?", caseData, revealedFindingIds: [] },
    {
      llm: async () => {
        calls += 1;
        return JSON.stringify({
          mode: "CLARIFY",
          issue_id: "current",
          mentor_text: "Держи давление выше 90. Что дальше?",
          factual_claims: [],
          question_domain: null,
        });
      },
    }
  );
  assert.equal(calls, 2, "exactly one repair, never a third attempt");
  // The authored template is no longer what speaks when the model's reply cannot
  // be used: it is the wooden register this rewrite exists to remove, and the
  // engine's own closing prompt already carries the turn. Silence instead.
  assert.equal(result.mode, "CONTINUE");
  assert.equal(result.text, "");
  assert.deepEqual(result.rejectionReasons, ["uncited_numeric_fact", "uncited_numeric_fact"]);
});

// --- 2.1 the router gates execution, not speech ----------------------------

test("an unrecognised fragment reaches the mentor and is never executed", async () => {
  const caseData = replayCase();
  const session = createV25Session({ caseData, mode: "reference", seed: "unmapped" });
  const spoken = [];
  const result = await advanceV25Session({
    caseData,
    session,
    input: "группа крови и кросс-матч",
    options: replayOptions({
      actionExtractorLLM: () =>
        JSON.stringify({
          intents: [],
          unresolved_fragments: ["группа крови и кросс-матч"],
          action_parameters: [],
        }),
      mentorLLM: async (prompt) => {
        const turn = JSON.parse(prompt.user);
        spoken.push(turn);
        return JSON.stringify({
          mode: "CLARIFY",
          issue_id: turn.brief.candidate_issues[0].issue_id,
          mentor_text: "Кросс-матч в этом кейсе не смоделирован. Что ещё готовишь к операции?",
          factual_claims: [],
          question_domain: "management",
        });
      },
    }),
  });

  assert.doesNotMatch(result.reply, /Не распознано/);
  assert.match(result.reply, /Кросс-матч в этом кейсе не смоделирован/);
  assert.deepEqual(
    spoken[0].brief.unrecognized_fragments,
    ["группа крови и кросс-матч"],
    "the fragment has to reach the mentor for it to answer honestly"
  );
  // Speech only. Nothing was applied to the patient and the clock did not move.
  assert.deepEqual(result.session.completedActions, []);
  assert.equal(
    result.session.temporalState.clockMinutes,
    session.temporalState.clockMinutes
  );
});

test("without a mentor the honest deterministic line stays", async () => {
  const caseData = replayCase();
  const result = await advanceV25Session({
    caseData,
    session: createV25Session({ caseData, mode: "reference", seed: "no-mentor" }),
    input: "группа крови и кросс-матч",
    options: {
      actionExtractorLLM: () =>
        JSON.stringify({
          intents: [],
          unresolved_fragments: ["группа крови и кросс-матч"],
          action_parameters: [],
        }),
      conceptMap: appendicitisRouterConceptMap,
      conceptRegistry: resolveConcept,
    },
  });
  assert.match(result.reply, /Не распознано/);
});

// --- 2.2 prerequisites close over the whole transcript ---------------------

test("a prerequisite is closed by an action expressed in an earlier turn", async () => {
  const caseData = replayCase();
  let session = createV25Session({ caseData, mode: fixture.mode, seed: fixture.effective_seed });
  for (const entry of fixture.transcript.filter((item) => item.role === "user").slice(0, 4)) {
    const result = await advanceV25Session({
      caseData,
      session,
      input: entry.content,
      options: replayOptions(),
    });
    session = result.session;
  }

  // Turn 4 named consent, the anaesthetist and the theatre. Two turns later they
  // are still closed, without the learner repeating a phrase.
  for (const actionId of ["informed_consent", "notify_anesthesia", "notify_operating_team"]) {
    assert.equal(prerequisiteSatisfied(session, actionId), true, `${actionId} not closed`);
  }
  assert.ok(expressedActionIds(session).has("iv_access"));

});

// CDR-18 (owner, 20.08.2026): the WHO checkpoints are theatre work, largely the
// nursing team's, and stop gating the resident. What they were protecting is
// gated on its own terms, before induction.
test("the WHO checkpoints no longer block, consent before induction does", async () => {
  const caseData = replayCase();
  let session = createV25Session({ caseData, mode: fixture.mode, seed: fixture.effective_seed });
  const start = () =>
    JSON.stringify({
      intents: [
        { type: "management", concept_id: "procedure_start", confidence: 0.99, requested_fragment: "начинаю операцию" },
      ],
      unresolved_fragments: [],
      action_parameters: [],
    });

  // Approach chosen, nothing else: the stop names consent, and never a checkpoint.
  for (const entry of fixture.transcript
    .filter((item) => item.role === "user")
    .slice(0, 5)) {
    const result = await advanceV25Session({
      caseData,
      session,
      input: entry.content,
      options: replayOptions(),
    });
    session = result.session;
  }
  const withoutConsent = {
    ...session,
    completedActions: session.completedActions.filter((id) => id !== "informed_consent"),
    workingMemory: {
      ...session.workingMemory,
      actionStates: Object.fromEntries(
        Object.entries(session.workingMemory.actionStates).filter(
          ([actionId]) => actionId !== "informed_consent"
        )
      ),
    },
  };
  const bare = await advanceV25Session({
    caseData,
    session: withoutConsent,
    input: "начинаю операцию",
    options: replayOptions({ actionExtractorLLM: start }),
  });
  assert.match(bare.reply, /До индукции не хватает.*согласие/is);
  assert.doesNotMatch(bare.reply, /Sign In|Time Out/i);
  assert.equal(bare.session.workingMemory.operativeState.procedure_started, false);

  // Consent and the anaesthetist were named on turn 4. Close the two standing
  // risks explicitly: this test owns only the WHO/consent prerequisite.
  const consentReady = {
    ...session,
    completedActions: [...new Set([...session.completedActions, "pregnancy_test", "analgesia"])],
  };
  const started = await advanceV25Session({
    caseData,
    session: consentReady,
    input: "начинаю операцию",
    options: replayOptions({ actionExtractorLLM: start }),
  });
  assert.equal(started.session.workingMemory.operativeState.procedure_started, true);
  assert.doesNotMatch(started.reply, /Sign In|Time Out/i);
});

test("an order transcribed but not applied still closes its prerequisite", () => {
  const session = {
    completedActions: [],
    workingMemory: {
      actionStates: { analgesia: { action_id: "analgesia", status: "blocked" } },
      orderRecords: { analgesia: { action_id: "analgesia", slots: { agent: "кеторолак" } } },
    },
  };
  assert.equal(prerequisiteSatisfied(session, "analgesia"), true);
  assert.equal(prerequisiteSatisfied(session, "iv_fluids"), false);
});

// --- 2.3 the parameter stop is stated once ---------------------------------

test("the same governance stop is not repeated verbatim on a later turn", async () => {
  const caseData = replayCase();
  let session = createV25Session({ caseData, mode: fixture.mode, seed: fixture.effective_seed });
  const replies = [];
  for (const entry of fixture.transcript.filter((item) => item.role === "user")) {
    const result = await advanceV25Session({
      caseData,
      session,
      input: entry.content,
      options: replayOptions(),
    });
    session = result.session;
    replies.push(result.reply);
  }
  const questions = replies.flatMap((reply) => reply.match(/[^.!?\n]*\?/g) || []);
  assert.equal(
    questions.length,
    new Set(questions.map((question) => question.trim())).size,
    "the mentor asked the same question twice"
  );
  assert.equal(replies.some((reply) => reply.includes("Не распознано")), false);
  assert.equal(
    replies.some((reply) => reply.includes("Эти данные не заданы в карте пациента.")),
    false
  );
  // The dangerous parameter is still blocked. Saying it once is not accepting it.
  assert.equal(session.completedActions.includes("iv_fluids"), false);
});

// --- 3.1 dosing rules ------------------------------------------------------

test("every rule in the dosing registry is signed, and only teaches", () => {
  // The registry was empty until 20.08.2026. It now holds the appendectomy
  // prophylaxis package; the invariant that replaced "it is empty" is that
  // nothing can be in it without two signatures and a verbatim source line.
  assert.ok(DOSING_RULE_REGISTRY.length > 0);
  for (const rule of DOSING_RULE_REGISTRY) {
    assert.equal(validateDosingRule(rule).ok, true, `${rule.rule_id} fails validation`);
    assert.equal(rule.review_status, CLINICAL_RULE_STATUS.APPROVED);
    assert.ok(rule.reviewed_by.length >= 2, `${rule.rule_id} needs two signatures`);
    assert.ok(rule.source_line_verbatim, `${rule.rule_id} needs a verbatim source line`);
    assert.deepEqual(rule.allowed_runtime_effects, ["mentor_teaching"]);
    assert.equal(rule.score_weight, 0);
  }
  // Every signed rule reaches the mentor; the registry is its only source.
  assert.deepEqual(
    approvedDosingRules().map((rule) => rule.rule_id),
    DOSING_RULE_REGISTRY.map((rule) => rule.rule_id)
  );
});

test("the mentor is given only the dose scoped to the current issue", () => {
  const rule = DOSING_RULE_REGISTRY.find(
    (candidate) => candidate.rule_id === "dosing.cefazolin.prophylaxis"
  );
  assert.ok(rule);
  const brief = briefFor(replayCase(), {
    plan: {
      parsed: {},
      parameterSafetySignals: [{
        concept_id: "antibiotic_prophylaxis",
        blocks_application: true,
        source_rule_id: rule.rule_id,
      }],
      operationalizationStates: [],
    },
  });
  assert.deepEqual(brief.approvedDosingRules.map((candidate) => candidate.rule_id), [rule.rule_id]);

  const serialized = JSON.stringify(brief.approvedDosingRules);
  // The answer key stays out of the mentor's context, as everywhere else.
  assert.doesNotMatch(serialized, /score_weight|reviewed_by|next_review_due/);
  // So does the Kazakhstan regimen: holding both figures at once is one step
  // from telling a resident which of the two is wrong. Debrief material.
  assert.doesNotMatch(serialized, /knf_rule|kp_rk_status|jurisdiction_decision/);
  assert.doesNotMatch(serialized, /source_line_verbatim/);

  // What it does get: enough to paraphrase the rule and cite it.
  const cefazolin = brief.approvedDosingRules.find(
    (rule) => rule.rule_id === "dosing.cefazolin.prophylaxis"
  );
  assert.equal(cefazolin.dose, "2 г");
  assert.equal(cefazolin.route, "в/в");
  // Decision 1: the weight band is not granted as speech, though the source
  // line preserving it is still on the registry row.
  assert.deepEqual(cefazolin.adjustments, []);
  assert.match(
    DOSING_RULE_REGISTRY.find((rule) => rule.rule_id === "dosing.cefazolin.prophylaxis")
      .source_line_verbatim,
    /120 kg/
  );
});

test("a dosing rule teaches only after approval, and only teaches", () => {
  const draft = {
    rule_id: "dosing.test.adult",
    rule_type: "dosing_rule",
    agent: "тестовый препарат",
    indication: "фикстура",
    dose: "1 г",
    route: "IV",
    timing: "за 60 мин до разреза",
    adjustments: [],
    source_ids: ["WSES2025"],
    source_line_verbatim: "fixture line",
    license_note: "fixture",
    kp_rk_status: "КНФ?",
    review_status: "NEEDS_CLINICAL_REVIEW",
    allowed_runtime_effects: [],
  };
  assert.equal(validateDosingRule(draft).ok, true);
  assert.deepEqual(approvedDosingRules([draft]), []);

  // Approved but with one reviewer, or claiming an effect beyond teaching: no.
  assert.equal(
    validateDosingRule({
      ...draft,
      review_status: CLINICAL_RULE_STATUS.APPROVED,
      reviewed_by: ["one"],
      allowed_runtime_effects: ["mentor_teaching"],
    }).ok,
    false
  );
  assert.equal(
    validateDosingRule({
      ...draft,
      review_status: CLINICAL_RULE_STATUS.APPROVED,
      reviewed_by: ["a", "b"],
      allowed_runtime_effects: ["patient_truth"],
    }).ok,
    false
  );

  const approved = {
    ...draft,
    review_status: CLINICAL_RULE_STATUS.APPROVED,
    reviewed_by: ["a", "b"],
    allowed_runtime_effects: ["mentor_teaching"],
  };
  assert.equal(validateDosingRule(approved).ok, true);
  assert.deepEqual(approvedDosingRules([approved]), [approved]);

  // 3.3: an approved dose is a source of allowed numbers; a draft one is not.
  const caseData = replayCase();
  const base = {
    ...briefFor(caseData),
    candidateIssues: [{ issue_id: "current", safety_critical: false }],
    mentorPolicy: null,
  };
  const payload = {
    mode: "CLARIFY",
    issue_id: "current",
    mentor_text: "Профилактика — 1 г до разреза. Кто вводит?",
    factual_claims: [],
    question_domain: null,
  };
  assert.equal(
    validateMentorPayload(payload, { ...base, approvedDosingRules: [] }, caseData, []).reason,
    "uncited_numeric_fact"
  );
  assert.equal(
    validateMentorPayload(payload, { ...base, approvedDosingRules: [approved] }, caseData, []).ok,
    true
  );
});

// --- 3.2 legacy practices --------------------------------------------------

test("a legacy practice is recognised, carries no clinical claim, and reaches the mentor", () => {
  const detected = detectLegacyPractices("назначаю литическую смесь в/м");
  assert.deepEqual(
    detected.map((practice) => practice.practice_id),
    ["legacy.lytic-mixture"]
  );
  for (const practice of detected) {
    assert.equal(practice.review_status, "NEEDS_CLINICAL_REVIEW");
    assert.equal(practice.teaching_rule_id, null);
    assert.equal(practice.what_it_is, null);
    assert.equal(practice.why_alternatives_exist, null);
    assert.equal(practice.what_instead, null);
    assert.equal(practice.executes_on_patient, false);
  }
  assert.deepEqual(detectLegacyPractices("кеторолак 30 мг в/в"), []);

  const composed = composeCaseWithCore(createV25Case(), {});
  const brief = buildMentorBrief({
    caseData: composed.caseData,
    session: createV25Session({ caseData: composed.caseData, mode: "reference", seed: "legacy" }),
    plan: { input: "голод, холод и покой", parsed: {} },
    deterministicUpdate: {},
  });
  assert.ok(brief.moves.some((move) => move.type === "legacy_practice"));
  const prompt = buildMentorPrompt({ brief, learnerText: "голод, холод и покой" });
  assert.match(prompt.user, /legacy_practices_named/);
});

// --- 0.2 telemetry ---------------------------------------------------------

test("the execution profile records source, repairs and the policy shadow", async () => {
  const caseData = replayCase();
  const initial = createV25Session({ caseData, mode: "reference", seed: "telemetry" });
  const result = await advanceV25Session({
    caseData,
    // Turn two makes the post-examination analgesia standing risk current, so
    // the model has a deterministic candidate to choose rather than inventing
    // an issue merely to exercise telemetry.
    session: {
      ...initial,
      workingMemory: { ...initial.workingMemory, turnNumber: 1 },
    },
    input: "физикальный осмотр и анамнез",
    options: replayOptions({
      mentorLLM: async (prompt) => {
        const turn = JSON.parse(prompt.user);
        return JSON.stringify({
          mode: "CLARIFY",
          issue_id: turn.brief.candidate_issues[0].issue_id,
          mentor_text: "Что из осмотра меняет твой план?",
          factual_claims: [],
          question_domain: "management",
        });
      },
    }),
  });
  const profile = result.session.eventLog.findLast(
    (entry) => entry.event_type === "execution_profile"
  );
  assert.equal(profile.mentor_source, "llm");
  assert.equal(profile.repair_attempted, false);
  assert.deepEqual(profile.mentor_rejection_reasons, []);
  assert.ok(profile.regex_policy_shadow);
  assert.equal(profile.regex_policy_shadow.agreed_with_mentor, false);
  assert.equal(profile.mentor_telemetry_flags.includes("issue_not_in_brief"), false);
  assert.equal(profile.learner_address_form, "neutral");
});

test("the session may declare the address form, and the mentor follows it", () => {
  const caseData = replayCase();
  const declared = createV25Session({
    caseData,
    mode: "reference",
    seed: "address",
    learnerAddressForm: "feminine",
  });
  assert.equal(declared.learnerAddressForm, "feminine");
  const brief = buildMentorBrief({
    caseData,
    session: declared,
    plan: { parsed: {} },
    deterministicUpdate: {},
  });
  assert.equal(brief.learnerAddressForm, "feminine");
  assert.match(buildMentorPrompt({ brief, learnerText: "дальше?" }).system, /feminine forms/);

  // Nothing declared and nothing said: neutral, as before v2.
  assert.equal(
    createV25Session({ caseData, mode: "reference", seed: "address-2" }).learnerAddressForm,
    null
  );
});

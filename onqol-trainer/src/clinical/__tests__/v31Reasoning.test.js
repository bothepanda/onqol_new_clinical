import test from "node:test";
import assert from "node:assert/strict";
import { createV25Case } from "../v25/caseFactory.js";
import { createV3Case, selectV3Case } from "../v3/caseFactory.js";
import { advanceV25Session, createV25Session } from "../v25/engine.js";
import { validateRouterOutput } from "../semanticRouter.js";
import {
  createEmptyReasoningState,
  mergeReasoningState,
  normalizeReasoningDelta,
  reasoningFlags,
  REASONING_FLAGS,
} from "../core/reasoningState.js";
import { buildMentorBrief } from "../core/mentorBrief.js";
import { mentorHeuristics, selectHeuristics } from "../core/mentorHeuristics.js";
import { appendicitisMentorRules } from "../diseases/appendicitis/mentorRules.js";
import {
  ED_DISPOSITION_CHECKPOINT_MINUTES,
  createInitialTemporalState,
  projectTemporalState,
} from "../v25/temporalPatientModel.js";
import { getDiseaseModule } from "../v3/diseaseModules.js";

const v3Case = createV3Case();

// --- 12.1 reasoning extraction -------------------------------------------

const RICH_TURN = {
  intents: [
    { type: "request_test", concept_id: "pregnancy_test", confidence: 0.95 },
    { type: "diagnosis", concept_id: "diagnosis_acute_appendicitis", confidence: 0.9 },
  ],
  reasoning: {
    stability: { stated: true, learner_assessment: "stable" },
    problem_representation_stated: true,
    working_diagnosis: {
      stated: true,
      concept_id: "diagnosis_acute_appendicitis",
      uncertainty_stated: false,
    },
    differential: {
      stated: true,
      ranked: true,
      has_dangerous_alternative: true,
      concept_ids: ["differential_ectopic"],
    },
    test_reasoning: [
      { concept_id: "pregnancy_test", purpose_stated: true, management_consequence_stated: true },
    ],
    contingency_stated: true,
  },
};

test("a reasoning-rich turn is extracted without inventing actions or score", () => {
  // "Пациент пока гемодинамически стабилен. Рабочий диагноз — острый аппендицит,
  //  но внематочную беременность нельзя пропустить. ХГЧ нужен, чтобы исключить
  //  беременность. Если состояние ухудшится, пересмотрю тактику."
  const result = validateRouterOutput(RICH_TURN, v3Case, {});

  // Action extraction is untouched by the reasoning channel.
  assert.deepEqual(
    result.actions.map((action) => action.id).sort(),
    ["diagnosis_acute_appendicitis", "pregnancy_test"]
  );

  const flags = reasoningFlags(
    mergeReasoningState(null, result.reasoning, 1).state
  );
  assert.ok(flags.has("stability_stated"));
  assert.ok(flags.has("working_diagnosis_stated"));
  assert.ok(flags.has("dangerous_alternative_stated"));
  assert.ok(flags.has("differential_ranked"));
  assert.ok(flags.has("contingency_stated"));
  assert.ok(!flags.has("investigation_without_stated_purpose"));
});

test("reasoning fields never create a completed action", () => {
  // Reasoning talks about a CT; no intent requests one.
  const result = validateRouterOutput(
    {
      intents: [],
      reasoning: {
        working_diagnosis: { stated: true, concept_id: "diagnosis_acute_appendicitis" },
        test_reasoning: [{ concept_id: "ct_abdomen", purpose_stated: true }],
      },
    },
    v3Case,
    {}
  );

  assert.deepEqual(result.actions, []);
  assert.equal(result.reasoning.working_diagnosis.stated, true);
});

test("a malformed or hostile reasoning payload costs the signal, not the turn", () => {
  for (const payload of [undefined, null, "nonsense", 42, [], { stability: "yes" }]) {
    const result = validateRouterOutput(
      { intents: [{ type: "request_history", concept_id: "focused_history", confidence: 1 }], reasoning: payload },
      v3Case,
      {}
    );
    assert.deepEqual(result.actions.map((a) => a.id), ["focused_history"]);
  }

  // Unknown enum values and unknown concept ids are dropped, not trusted.
  const dirty = normalizeReasoningDelta({
    stability: { stated: true, learner_assessment: "probably_fine" },
    differential: { concept_ids: ["not_a_real_concept", "differential_ectopic"] },
    disposition: { stated: true, destination: "the_moon" },
    test_reasoning: [{ concept_id: "invented_test", purpose_stated: true }],
  }, { allowedConceptIds: new Set(["differential_ectopic"]) });

  assert.equal(dirty.stability.learner_assessment, null);
  assert.deepEqual(dirty.differential.concept_ids, ["differential_ectopic"]);
  assert.equal(dirty.disposition.destination, null);
  assert.deepEqual(dirty.investigations, []);
});

test("every declared reasoning flag is produced by the flattener", () => {
  // Guards the typo class of bug: a heuristic naming a flag nobody emits would
  // silently never match, which has cost this project once already.
  const everything = createEmptyReasoningState();
  everything.stability.stated = true;
  everything.problem_representation.stated = true;
  everything.working_diagnosis.stated = true;
  everything.working_diagnosis.uncertainty_stated = true;
  everything.differential.stated = true;
  everything.differential.ranked = true;
  everything.differential.has_dangerous_alternative = true;
  everything.management.plan_stated = true;
  everything.management.urgency_stated = true;
  everything.management.rationale_stated = true;
  everything.observation.active = true;
  everything.observation.goal_stated = true;
  everything.observation.reassessment_interval_stated = true;
  everything.observation.escalation_criteria_stated = true;
  everything.reassessment.stated = true;
  everything.contingency.stated = true;
  everything.disposition.stated = true;
  everything.consultation.own_assessment_stated = true;
  everything.consultation.consultation_question_stated = true;
  everything.investigations.items = [{ action_id: "cbc", purpose_stated: false }];

  const flags = reasoningFlags(everything);
  for (const flag of REASONING_FLAGS) {
    assert.ok(flags.has(flag), `${flag} is declared but never emitted`);
  }
});

test("heuristics only name reasoning flags that exist", () => {
  for (const heuristic of [...mentorHeuristics, ...appendicitisMentorRules]) {
    for (const flag of [...(heuristic.when.reasoning_all || []), ...(heuristic.when.reasoning_none || [])]) {
      assert.ok(REASONING_FLAGS.includes(flag), `${heuristic.id} names unknown reasoning flag "${flag}"`);
    }
  }
});

// --- 12.2 accumulation ----------------------------------------------------

test("observation becomes progressively complete across turns", () => {
  const turn1 = normalizeReasoningDelta({ observation: { active: true } });
  const afterTurn1 = mergeReasoningState(null, turn1, 1).state;
  assert.equal(afterTurn1.observation.active, true);
  assert.equal(afterTurn1.observation.reassessment_interval_stated, false);
  assert.ok(reasoningFlags(afterTurn1).has("observation_active"));
  assert.ok(!reasoningFlags(afterTurn1).has("observation_plan_complete"));

  // "Повторный осмотр через час; при ухудшении гемодинамики меняю план."
  const turn2 = normalizeReasoningDelta({
    observation: {
      goal_stated: true,
      reassessment_interval_stated: true,
      escalation_criteria_stated: true,
    },
  });
  const afterTurn2 = mergeReasoningState(afterTurn1, turn2, 2).state;

  assert.equal(afterTurn2.observation.active, true, "the earlier statement must survive");
  assert.ok(reasoningFlags(afterTurn2).has("observation_plan_complete"));
  assert.equal(afterTurn2.observation.updated_turn, 2);
});

test("a differential is not erased by a turn that does not repeat it", () => {
  const stated = mergeReasoningState(
    null,
    normalizeReasoningDelta({ differential: { stated: true, has_dangerous_alternative: true } }),
    1
  ).state;
  const later = mergeReasoningState(stated, normalizeReasoningDelta({ management: { plan_stated: true } }), 2).state;

  assert.equal(later.differential.stated, true);
  assert.equal(later.differential.has_dangerous_alternative, true);
  assert.equal(later.management.plan_stated, true);
});

test("a later explicit statement supersedes an earlier enum value", () => {
  const first = mergeReasoningState(
    null,
    normalizeReasoningDelta({ stability: { stated: true, learner_assessment: "uncertain" } }),
    1
  ).state;
  const second = mergeReasoningState(
    first,
    normalizeReasoningDelta({ stability: { stated: true, learner_assessment: "unstable" } }),
    3
  ).state;

  assert.equal(second.stability.learner_assessment, "unstable");
  assert.equal(second.stability.updated_turn, 3);
});

// --- 12.3 no-facts invariant ---------------------------------------------

test("reasoning state reaches the mentor without carrying a patient fact", () => {
  const session = {
    phase: "decision",
    locale: "ru",
    completedActions: ["focused_history", "abdominal_exam"],
    revealedFindings: [],
    temporalState: { clockMinutes: 60, status: "stable", flags: [] },
    workingMemory: {
      turnNumber: 5,
      reasoningState: mergeReasoningState(null, RICH_TURN.reasoning && normalizeReasoningDelta(RICH_TURN.reasoning), 1).state,
    },
  };
  const brief = buildMentorBrief({
    caseData: v3Case,
    session,
    plan: { prerequisiteWarnings: [], parsed: { recognizedButUndefined: [] }, plannerPrompt: "?" },
    deterministicUpdate: { scoringEvents: [], blockedOperations: [], neutralPrompt: "?" },
  });

  const serialized = JSON.stringify(brief);
  for (const group of [v3Case.hidden_findings || {}, v3Case.available_findings || {}]) {
    for (const [findingId, finding] of Object.entries(group)) {
      assert.ok(!serialized.includes(finding.text), `brief leaked ${findingId}`);
    }
  }
  assert.equal(brief.containsPatientFacts, false);
});

// --- 12.4 / 12.5 portability ---------------------------------------------

// A disease that shares no identifiers with appendicitis.
const syntheticCase = {
  case_id: "synthetic-001",
  disease_card_id: "synthetic_disease",
  expected_actions: [
    { id: "generic_history", intent_type: "request_history", concept: "history" },
    { id: "generic_exam", intent_type: "request_examination", concept: "examination" },
    { id: "generic_diagnosis", intent_type: "diagnosis", concept: "diagnosis" },
  ],
  acceptable_alternatives: [],
  unnecessary_actions: [],
  unsafe_actions: [],
  references: [],
};

function syntheticSession(reasoningState, overrides = {}) {
  return {
    phase: "decision",
    completedActions: ["generic_history", "generic_exam"],
    temporalState: { clockMinutes: 60, status: "stable", flags: [] },
    workingMemory: { turnNumber: 6, reasoningState },
    ...overrides,
  };
}

test("core reasoning rules fire on a case that has never heard of appendicitis", () => {
  const state = mergeReasoningState(
    null,
    normalizeReasoningDelta({ working_diagnosis: { stated: true } }),
    1
  ).state;

  const selected = selectHeuristics({
    caseData: syntheticCase,
    session: syntheticSession(state),
    attempted: new Set(),
    heuristics: mentorHeuristics,
  });

  const ids = selected.map((heuristic) => heuristic.id);
  assert.ok(
    ids.includes("hypothesis_without_stability") || ids.includes("hypothesis_without_management"),
    `expected a generic reasoning rule, got ${JSON.stringify(ids)}`
  );
  assert.equal(JSON.stringify(selected).includes("appendicitis"), false);
});

test("appendicitis rules do not fire on another disease", () => {
  const selected = selectHeuristics({
    caseData: syntheticCase, // carries no mentor_rules
    session: syntheticSession(createEmptyReasoningState()),
    attempted: new Set(["generic_diagnosis"]),
    heuristics: [...mentorHeuristics, ...appendicitisMentorRules],
  });

  for (const heuristic of selected) {
    assert.notEqual(heuristic.disease, "appendicitis", `${heuristic.id} leaked into another disease`);
  }
});

test("core heuristics name no disease-owned action id", () => {
  // The property that decides whether adding cholecystitis is a new file or a
  // rewrite. Core may name core-library actions; nothing else.
  const coreLibraryIds = new Set(
    (v3Case.acceptable_alternatives || []).filter((action) => action.core).map((action) => action.id)
  );
  assert.ok(coreLibraryIds.size > 0, "core library actions must be identifiable");

  for (const heuristic of mentorHeuristics) {
    const named = [
      ...(heuristic.when.attempted || []),
      ...(heuristic.when.completed || []),
      ...(heuristic.when.not_completed || []),
    ];
    for (const id of named) {
      assert.ok(coreLibraryIds.has(id), `core heuristic ${heuristic.id} names disease-owned action "${id}"`);
    }
  }
});

// --- 12.6 CT rule regression ---------------------------------------------

test("no core rule demands ultrasound before CT", () => {
  const serialized = JSON.stringify(mentorHeuristics);
  assert.ok(!serialized.includes("ct_before_ultrasound"));
  assert.ok(!/КТ — не первый шаг/.test(serialized));
  assert.ok(!serialized.includes("ct_abdomen"), "core must not name a specific imaging action");

  // The portable replacement exists and asks the question instead.
  const replacement = mentorHeuristics.find((h) => h.id === "investigation_without_purpose");
  assert.ok(replacement);
  assert.match(replacement.mentor_line, /вопрос|тактик/i);
});

// --- 12.7 ED clock separation --------------------------------------------

test("four hours reaches the flow checkpoint without touching physiology", () => {
  // A case with no configured progression rule must not deteriorate with time.
  const stableCase = { ...v3Case, temporal_progression_rules: [] };
  const initial = createInitialTemporalState(stableCase);
  let state = initial;
  // Push past the checkpoint using actions that consume time.
  for (const action of ["abdominal_ultrasound", "abdominal_exam"]) {
    state = projectTemporalState(stableCase, state, [action]);
  }

  assert.ok(state.clockMinutes >= ED_DISPOSITION_CHECKPOINT_MINUTES);
  assert.equal(state.flow.edDispositionCheckpointReached, true);
  assert.equal(state.heartRate, initial.heartRate, "heart rate must not move on the clock alone");
  assert.equal(state.temperatureC, initial.temperatureC, "temperature must not move on the clock alone");
  assert.ok(state.painScore <= initial.painScore, "pain must not rise on the clock alone");
  assert.ok(!state.flags.includes("delay_risk"), "delay_risk is a disease signal, not a clock signal");
  assert.notEqual(state.status, "delayed_source_control");
});

test("a configured disease rule is what deteriorates the patient", () => {
  const state = projectTemporalState(v3Case, createInitialTemporalState(v3Case), ["wait_for_ultrasound"]);
  assert.equal(state.status, "delayed_source_control");
  assert.ok(state.flags.includes("delay_risk"));

  const rule = (v3Case.temporal_progression_rules || [])[0];
  assert.ok(rule, "the appendicitis card must own its progression rule");
  assert.equal(rule.review_status, "NEEDS_CLINICAL_REVIEW");
});

test("the ED heuristic fires on the checkpoint, and stays quiet given a real plan", () => {
  const atCheckpoint = (reasoningState) => ({
    phase: "decision",
    completedActions: [],
    temporalState: {
      clockMinutes: 300,
      status: "stable",
      flags: [],
      flow: { edDispositionCheckpointReached: true, checkpointMinute: 240 },
    },
    workingMemory: { turnNumber: 7, reasoningState },
  });

  const noDisposition = selectHeuristics({
    caseData: syntheticCase,
    session: atCheckpoint(createEmptyReasoningState()),
    attempted: new Set(),
    heuristics: mentorHeuristics,
  });
  assert.ok(noDisposition.some((h) => h.id === "ed_clock_disposition"));

  const complete = mergeReasoningState(
    null,
    normalizeReasoningDelta({
      disposition: { stated: true, destination: "ward" },
      observation: {
        active: true,
        goal_stated: true,
        reassessment_interval_stated: true,
        escalation_criteria_stated: true,
      },
    }),
    1
  ).state;
  const withDisposition = selectHeuristics({
    caseData: syntheticCase,
    session: atCheckpoint(complete),
    attempted: new Set(),
    heuristics: mentorHeuristics,
  });
  assert.ok(!withDisposition.some((h) => h.id === "ed_clock_disposition"));
});

test("calling a senior is not a disposition", () => {
  const rule = mentorHeuristics.find((h) => h.id === "ed_clock_disposition");
  const named = [
    ...(rule.when.attempted || []),
    ...(rule.when.completed || []),
    ...(rule.when.not_completed || []),
  ];
  assert.ok(!named.includes("call_senior_surgeon"));
  assert.ok(!named.includes("open_appendectomy_here"));
});

// --- 12.8 antibiotic sequencing ------------------------------------------

const PREOP = [
  "анамнез",
  "осмотр живота",
  "оак",
  "это острый аппендицит",
  "информированное согласие",
  "предупредить анестезиолога",
  "оценка операционного риска",
  "чек-лист воз",
  "предупредить операционную",
];

async function playV3(inputs) {
  const caseData = createV3Case();
  let session = createV25Session({ caseData, mode: "reference", seed: "abx" });
  let result;
  for (const input of inputs) {
    result = await advanceV25Session({ caseData, session, input, options: { mentor: true } });
    session = result.session;
  }
  return { session, result, caseData };
}

test("prophylaxis does not require the operation to have happened", async () => {
  const { session } = await playV3(["анамнез", "антибиотикопрофилактика однократно"]);
  assert.ok(session.completedActions.includes("preop_single_antibiotic_prophylaxis"));
  assert.equal(session.temporalState.sourceControl, false);
});

test("appendectomy is blocked before the patient when prophylaxis is missing", async () => {
  const { session, result } = await playV3([
    ...PREOP,
    "открытая аппендэктомия по волковичу-дьяконову прямо сейчас",
  ]);

  assert.deepEqual(
    (result.blockedOperations || []).map((operation) => operation.action_id),
    ["open_appendectomy_here"]
  );
  assert.equal(session.temporalState.sourceControl, false);
  assert.ok(!session.revealedFindings.includes("operative_finding"), "a blocked operation reveals nothing");
  assert.match(result.reply, /профилактика/i, "the mentor must name the missing preoperative requirement");
});

test("prophylaxis and surgery in one turn are accepted", async () => {
  const { session } = await playV3([
    ...PREOP,
    "антибиотикопрофилактика однократно и открытая аппендэктомия по волковичу-дьяконову прямо сейчас",
  ]);

  assert.equal(session.temporalState.sourceControl, true);
  assert.ok(session.revealedFindings.includes("operative_finding"));
  assert.equal(session.temporalState.status, "controlled");
});

test("the normal V3 path never ends in the antibiotic-gap state", async () => {
  const { session } = await playV3([
    ...PREOP,
    "антибиотикопрофилактика однократно и открытая аппендэктомия по волковичу-дьяконову прямо сейчас",
  ]);
  assert.notEqual(session.temporalState.status, "controlled_with_antibiotic_gap");
});

// --- 12.9 version metadata ------------------------------------------------

test("a V3 session records 3.0 and a mentor-off session records 2.5", () => {
  const v3Session = createV25Session({ caseData: createV3Case(), mode: "reference", seed: "v" });
  assert.equal(v3Session.product_version, "3.0");

  const v25Session = createV25Session({ caseData: createV25Case(), mode: "reference", seed: "v" });
  assert.equal(v25Session.product_version, "2.5");
});

// --- 12.10 selection and content registry --------------------------------

test("the selected case decides its own data, router map, content and rules", () => {
  const selected = selectV3Case({ locale: "ru", seed: "registry" });

  assert.equal(selected.selection.case_id, "app-acute-basic-001");
  assert.equal(selected.caseData.product_version, "3.0");
  assert.ok(selected.caseData.v3_concept_map, "the merged router dictionary travels with the case");
  assert.equal(selected.caseData.mentor_rules, appendicitisMentorRules);

  // The disease card / retrieval package is named by the case, so the UI never
  // writes a case id literally. (The content registry itself imports YAML
  // through Vite and cannot be loaded here; the key is what the UI reads.)
  assert.equal(selected.caseData.browser_content_key, "app-acute-basic-001");
});

test("an unregistered disease fails loudly instead of borrowing appendicitis content", () => {
  assert.throws(
    () => getDiseaseModule({ disease_card_id: "acute_cholecystitis" }),
    /No V3 disease module registered/
  );
});

test("mentor-off V2.5 also carries a content key, so nothing is hard-coded", () => {
  assert.equal(createV25Case().browser_content_key, "app-acute-basic-001");
});

// --- scoring firewall -----------------------------------------------------

test("nothing produced by Reasoning State is eligible for scoring", () => {
  for (const heuristic of [...mentorHeuristics, ...appendicitisMentorRules]) {
    assert.equal(heuristic.eligible_for_scoring, false, `${heuristic.id} must not be scoreable`);
  }
});

test("reasoning is logged beside the turn, never inside scoring events", async () => {
  const { session } = await playV3(["анамнез", "осмотр живота"]);
  const turnEvents = session.eventLog.filter((entry) => entry.event_type === "clinical_turn");
  assert.ok(turnEvents.length > 0);

  for (const entry of turnEvents) {
    assert.ok("reasoning_state_after" in entry, "each turn logs the reasoning state");
    assert.ok("reasoning_delta" in entry);
    // Reasoning is metadata beside the turn, never mixed into the scored actions.
    assert.ok(!JSON.stringify(entry.parsed_actions).includes("reasoning"));
  }
});

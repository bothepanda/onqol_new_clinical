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
  reasoningTrajectory,
  REASONING_FLAGS,
} from "../core/reasoningState.js";
import { buildMentorBrief } from "../core/mentorBrief.js";
import { firedKey, mentorHeuristics, selectHeuristics } from "../core/mentorHeuristics.js";
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
  everything.working_diagnosis.concept_id = "diagnosis_acute_appendicitis";
  everything.differential.items = [
    {
      concept_id: "differential_ectopic",
      rank: 2,
      dangerous: true,
      evidence_for: ["женщина репродуктивного возраста"],
      evidence_against: ["хгч отрицательный"],
      updated_turn: 1,
    },
  ];
  everything.contingency.trigger_concept_ids = ["pregnancy_test"];
  everything.investigations.items[0].justification = "чтобы исключить беременность";

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

// --- 12.2b hypothesis records --------------------------------------------

test("a ranked differential records which hypothesis is dangerous, not just that one is", () => {
  // "Наиболее вероятен аппендицит; на втором месте внематочная — её пропустить
  //  нельзя."
  const delta = normalizeReasoningDelta(
    {
      working_diagnosis: { stated: true, concept_id: "diagnosis_acute_appendicitis" },
      differential: {
        stated: true,
        items: [
          { concept_id: "diagnosis_acute_appendicitis", rank: 1 },
          { concept_id: "differential_ectopic", rank: 2, dangerous: true },
        ],
      },
    },
    { allowedConceptIds: new Set(["diagnosis_acute_appendicitis", "differential_ectopic"]) }
  );

  // Ranking and danger are inferred from the items, without the router having to
  // set the summary flags as well.
  assert.equal(delta.differential.ranked, true);
  assert.equal(delta.differential.has_dangerous_alternative, true);

  const state = mergeReasoningState(null, delta, 1).state;
  const dangerous = state.differential.items.filter((item) => item.dangerous);
  assert.deepEqual(
    dangerous.map((item) => item.concept_id),
    ["differential_ectopic"],
    "the mentor must be able to ask about the specific alternative, not a boolean"
  );

  const flags = reasoningFlags(state);
  assert.ok(flags.has("leading_hypothesis_named"));
  assert.ok(flags.has("multiple_hypotheses_stated"));
  assert.ok(flags.has("dangerous_alternative_named"));
});

test("a reordered differential is a change of mind, and is not frozen at the first answer", () => {
  const allowed = { allowedConceptIds: new Set(["diagnosis_acute_appendicitis", "differential_ectopic"]) };
  const first = mergeReasoningState(
    null,
    normalizeReasoningDelta(
      { differential: { stated: true, items: [{ concept_id: "differential_ectopic", rank: 3 }] } },
      allowed
    ),
    1
  ).state;

  // Later the learner promotes it: "теперь внематочная для меня первая."
  const second = mergeReasoningState(
    first,
    normalizeReasoningDelta(
      { differential: { items: [{ concept_id: "differential_ectopic", rank: 1, dangerous: true }] } },
      allowed
    ),
    4
  ).state;

  const ectopic = second.differential.items.find((item) => item.concept_id === "differential_ectopic");
  assert.equal(ectopic.rank, 1, "rank supersedes: reordering is the reasoning change worth seeing");
  assert.equal(ectopic.dangerous, true, "danger latches once flagged");
  assert.equal(ectopic.updated_turn, 4);
  assert.equal(second.differential.items.length, 1, "the same hypothesis is not duplicated");
});

test("a contingency trigger records the investigation and never the imagined result", () => {
  const delta = normalizeReasoningDelta(
    {
      contingency: {
        stated: true,
        // A well-behaved router sends ids; a sloppy one may send prose or an
        // unknown concept. Neither may reach the state.
        trigger_concept_ids: ["pregnancy_test", "положительный", "invented_test"],
      },
    },
    { allowedConceptIds: new Set(["pregnancy_test"]) }
  );

  assert.deepEqual(delta.contingency.trigger_concept_ids, ["pregnancy_test"]);

  const state = mergeReasoningState(null, delta, 2).state;
  assert.equal(state.contingency.stated, true);
  assert.ok(reasoningFlags(state).has("contingency_trigger_named"));
  assert.ok(reasoningFlags(state).has("contingency_stated"));
});

test("the older flat reasoning payload still works", () => {
  // The router is a model. A payload shaped like the pre-checkpoint schema must
  // degrade to "named, unranked", never to nothing.
  const delta = normalizeReasoningDelta(
    {
      differential: { stated: true, concept_ids: ["differential_ectopic"] },
      contingency_stated: true,
    },
    { allowedConceptIds: new Set(["differential_ectopic"]) }
  );

  assert.deepEqual(delta.differential.concept_ids, ["differential_ectopic"]);
  assert.deepEqual(delta.differential.items, [
    {
      concept_id: "differential_ectopic",
      rank: null,
      dangerous: false,
      evidence_for: [],
      evidence_against: [],
    },
  ]);
  assert.equal(delta.differential.ranked, false);
  assert.equal(delta.contingency.stated, true);
  assert.deepEqual(delta.contingency.trigger_concept_ids, []);
});

test("a session saved before hypothesis records existed can still be resumed", () => {
  // Persistence is behind a repository interface; a state restored from an older
  // save has no `items` and no `trigger_concept_ids`.
  const legacy = createEmptyReasoningState();
  delete legacy.differential.items;
  delete legacy.contingency.trigger_concept_ids;
  legacy.differential.concept_ids = ["differential_ectopic"];
  legacy.differential.stated = true;

  const merged = mergeReasoningState(
    legacy,
    normalizeReasoningDelta({ management: { plan_stated: true } }),
    2
  ).state;

  assert.deepEqual(
    merged.differential.items.map((item) => item.concept_id),
    ["differential_ectopic"],
    "the older shape is rebuilt, not thrown away"
  );
  assert.deepEqual(merged.contingency.trigger_concept_ids, []);
});

// --- 12.2d the quote guard ------------------------------------------------

const LEARNER_MESSAGE =
  "Женщина репродуктивного возраста, 12 часов мигрирующей боли с локальным " +
  "перитонизмом справа внизу, гемодинамически стабильна. Наиболее вероятен " +
  "аппендицит: миграция боли и перитонизм за него. Против — беременность пока " +
  "не исключена, поэтому нужен ХГЧ. Если ХГЧ положительный, зову гинеколога.";

test("a quote is kept only when the learner actually wrote it", () => {
  const delta = normalizeReasoningDelta(
    {
      problem_representation_verbatim: "12 часов мигрирующей боли с локальным перитонизмом",
      differential: {
        stated: true,
        items: [
          {
            concept_id: "diagnosis_acute_appendicitis",
            rank: 1,
            evidence_for: ["миграция боли и перитонизм за него"],
            evidence_against: ["беременность пока не исключена"],
          },
        ],
      },
      test_reasoning: [{ concept_id: "pregnancy_test", justification: "нужен ХГЧ" }],
    },
    {
      allowedConceptIds: new Set(["diagnosis_acute_appendicitis", "pregnancy_test"]),
      learnerText: LEARNER_MESSAGE,
    }
  );

  assert.equal(
    delta.problem_representation.verbatim,
    "12 часов мигрирующей боли с локальным перитонизмом"
  );
  assert.equal(delta.problem_representation.stated, true, "a surviving quote proves the summary");
  assert.deepEqual(delta.differential.items[0].evidence_for, ["миграция боли и перитонизм за него"]);
  assert.deepEqual(delta.differential.items[0].evidence_against, ["беременность пока не исключена"]);
  assert.equal(delta.investigations[0].justification, "нужен ХГЧ");
  assert.ok(reasoningFlags(mergeReasoningState(null, delta, 1).state).has("investigation_justified"));
});

test("a paraphrase or an invented quote is discarded, not stored", () => {
  const delta = normalizeReasoningDelta(
    {
      // A summary of what the learner said, in the model's own words.
      problem_representation_verbatim:
        "The learner summarised a stable woman with migratory right lower quadrant pain",
      differential: {
        items: [
          {
            concept_id: "diagnosis_acute_appendicitis",
            // Plausible, clinically sensible, and never typed by the learner.
            evidence_for: ["лейкоцитоз 13,8 и температура 37,8"],
            evidence_against: ["беременность пока не исключена"],
          },
        ],
      },
      test_reasoning: [
        { concept_id: "pregnancy_test", justification: "чтобы исключить внематочную беременность" },
      ],
    },
    {
      allowedConceptIds: new Set(["diagnosis_acute_appendicitis", "pregnancy_test"]),
      learnerText: LEARNER_MESSAGE,
    }
  );

  assert.equal(delta.problem_representation.verbatim, null);
  assert.equal(delta.problem_representation.stated, false);
  assert.deepEqual(
    delta.differential.items[0].evidence_for,
    [],
    "a fabricated finding must never reach a field the mentor may quote"
  );
  // The one line that really was written survives, so the guard filters rather
  // than discarding the whole payload.
  assert.deepEqual(delta.differential.items[0].evidence_against, ["беременность пока не исключена"]);
  assert.equal(delta.investigations[0].justification, null);
});

test("quoting tolerates case and spacing but not rewriting", () => {
  const options = { allowedConceptIds: new Set(["pregnancy_test"]), learnerText: LEARNER_MESSAGE };

  const folded = normalizeReasoningDelta(
    { problem_representation_verbatim: "  ГЕМОДИНАМИЧЕСКИ   стабильна  " },
    options
  );
  assert.equal(folded.problem_representation.verbatim, "ГЕМОДИНАМИЧЕСКИ   стабильна");

  const reordered = normalizeReasoningDelta(
    { problem_representation_verbatim: "стабильна гемодинамически" },
    options
  );
  assert.equal(reordered.problem_representation.verbatim, null, "reordered words are not a quote");
});

test("a trigger the learner phrased without naming a test still survives as their words", () => {
  const text = "наблюдаю, но если появится напряжение всего живота — иду в операционную";
  const delta = normalizeReasoningDelta(
    { contingency: { trigger_verbatim: ["если появится напряжение всего живота"] } },
    { allowedConceptIds: new Set(["pregnancy_test"]), learnerText: text }
  );

  assert.deepEqual(delta.contingency.trigger_concept_ids, [], "no investigation was named");
  assert.deepEqual(delta.contingency.trigger_verbatim, ["если появится напряжение всего живота"]);
  assert.equal(delta.contingency.stated, true);
  assert.ok(reasoningFlags(mergeReasoningState(null, delta, 1).state).has("contingency_trigger_named"));
});

test("a re-summarised patient supersedes the earlier formulation", () => {
  const first = mergeReasoningState(
    null,
    normalizeReasoningDelta(
      { problem_representation_verbatim: "боль справа внизу" },
      { learnerText: "боль справа внизу" }
    ),
    1
  ).state;
  const second = mergeReasoningState(
    first,
    normalizeReasoningDelta(
      { problem_representation_verbatim: "стабильная пациентка с локальным перитонизмом" },
      { learnerText: "теперь скажу иначе: стабильная пациентка с локальным перитонизмом" }
    ),
    5
  ).state;

  assert.equal(second.problem_representation.verbatim, "стабильная пациентка с локальным перитонизмом");
  assert.equal(second.problem_representation.updated_turn, 5);
});

// --- 12.2c trajectory -----------------------------------------------------

test("the trajectory records when each piece of reasoning first appeared", async () => {
  const { session } = await playV3([
    "анамнез",
    "осмотр живота",
    "рабочий диагноз — острый аппендицит",
  ]);
  const trajectory = reasoningTrajectory(session.eventLog);

  assert.ok(trajectory instanceof Map);
  for (const turn of trajectory.values()) {
    assert.ok(Number.isFinite(turn) && turn >= 1, "every entry names the turn it first appeared");
  }
  // Never articulated is absent, and absence is the answer to "what did this
  // learner never say out loud".
  assert.equal(trajectory.has("disposition_stated"), false);
});

// --- 12.3 revealed-facts invariant ---------------------------------------

test("the mentor gets learner reasoning without unrevealed case findings", () => {
  const learnerText =
    "стабильная пациентка с локальным перитонизмом справа внизу, думаю на аппендицит";
  const state = mergeReasoningState(
    null,
    normalizeReasoningDelta(
      {
        problem_representation_verbatim: "стабильная пациентка с локальным перитонизмом",
        working_diagnosis: { stated: true, concept_id: "diagnosis_acute_appendicitis" },
        differential: {
          stated: true,
          items: [
            {
              concept_id: "diagnosis_acute_appendicitis",
              rank: 1,
              evidence_for: ["думаю на аппендицит"],
            },
          ],
        },
      },
      { allowedConceptIds: new Set(["diagnosis_acute_appendicitis"]), learnerText }
    ),
    1
  ).state;

  const brief = buildMentorBrief({
    caseData: v3Case,
    session: {
      phase: "decision",
      locale: "ru",
      completedActions: ["focused_history", "abdominal_exam"],
      revealedFindings: [],
      temporalState: { clockMinutes: 60, status: "stable", flags: [] },
      workingMemory: { turnNumber: 5, reasoningState: state },
    },
    plan: { prerequisiteWarnings: [], parsed: { recognizedButUndefined: [] }, plannerPrompt: "?" },
    deterministicUpdate: { scoringEvents: [], blockedOperations: [], neutralPrompt: "?" },
  });

  // The learner's sentence is there, and it is labelled as a claim.
  assert.equal(brief.learnerReasoning.patient_summary, "стабильная пациентка с локальным перитонизмом");
  assert.match(brief.learnerReasoning.note, /claims, not verified facts/i);

  // No finding the learner has not received is present. The opening handoff is
  // deliberately allowed because it is already on screen.
  // CONTRACT CHANGED, base rules v2: the case card travels with the brief, with
  // every unrevealed finding marked do_not_mention. What may still not carry an
  // unrevealed result is the fact ALLOWLIST - the set the mentor may assert from.
  const serialized = JSON.stringify({
    revealedFacts: brief.revealedFacts,
    learnerReasoning: brief.learnerReasoning,
    accumulatedReasoningState: brief.accumulatedReasoningState,
    moves: brief.moves,
  });
  for (const group of [v3Case.hidden_findings || {}, v3Case.available_findings || {}]) {
    for (const [findingId, finding] of Object.entries(group)) {
      assert.ok(!serialized.includes(finding.text), `allowlist leaked ${findingId}`);
    }
    for (const findingId of Object.keys(group)) {
      assert.ok(
        brief.caseCard.unrevealed_findings.some((entry) => entry.finding_id === findingId),
        `case card is missing ${findingId}`
      );
    }
  }
  assert.equal(brief.factsContract, "revealed_only");
  assert.deepEqual(
    brief.allowedFactSourceIds.filter((id) => id.startsWith("finding.")),
    []
  );
});

test("a learner who has articulated nothing gives the mentor nothing to quote", () => {
  const brief = buildMentorBrief({
    caseData: v3Case,
    session: {
      phase: "presentation",
      locale: "ru",
      completedActions: [],
      revealedFindings: [],
      temporalState: { clockMinutes: 0, status: "stable", flags: [] },
      workingMemory: { turnNumber: 1, reasoningState: createEmptyReasoningState() },
    },
    plan: { prerequisiteWarnings: [], parsed: { recognizedButUndefined: [] }, plannerPrompt: "?" },
    deterministicUpdate: { scoringEvents: [], blockedOperations: [], neutralPrompt: "?" },
  });

  // Null rather than an empty shell: a mentor handed empty arrays remarks on
  // the emptiness, which is the heuristics' job.
  assert.equal(brief.learnerReasoning, null);
});

test("reasoning state reaches the mentor without carrying an unrevealed result", () => {
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

  // CONTRACT CHANGED, base rules v2: the case card travels with the brief, with
  // every unrevealed finding marked do_not_mention. What may still not carry an
  // unrevealed result is the fact ALLOWLIST - the set the mentor may assert from.
  const serialized = JSON.stringify({
    revealedFacts: brief.revealedFacts,
    learnerReasoning: brief.learnerReasoning,
    accumulatedReasoningState: brief.accumulatedReasoningState,
    moves: brief.moves,
  });
  for (const group of [v3Case.hidden_findings || {}, v3Case.available_findings || {}]) {
    for (const [findingId, finding] of Object.entries(group)) {
      assert.ok(!serialized.includes(finding.text), `allowlist leaked ${findingId}`);
    }
    for (const findingId of Object.keys(group)) {
      assert.ok(
        brief.caseCard.unrevealed_findings.some((entry) => entry.finding_id === findingId),
        `case card is missing ${findingId}`
      );
    }
  }
  assert.equal(brief.factsContract, "revealed_only");
  assert.deepEqual(
    brief.allowedFactSourceIds.filter((id) => id.startsWith("finding.")),
    []
  );
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
    ["hypothesis_without_grounds", "hypothesis_without_stability", "hypothesis_without_management"]
      .some((id) => ids.includes(id)),
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

// --- 12.5b reasoning checkpoints -----------------------------------------

const CHECKPOINT_IDS = [
  "checkpoint_problem_representation",
  "checkpoint_hypotheses",
  "checkpoint_what_changes_the_plan",
];

test("checkpoints ask their question on a disease the core has never heard of", () => {
  const selected = selectHeuristics({
    caseData: syntheticCase,
    session: syntheticSession(createEmptyReasoningState()),
    attempted: new Set(),
    heuristics: mentorHeuristics,
  });

  // A learner six turns in who has articulated nothing gets asked, not scolded.
  assert.ok(
    selected.some((heuristic) => CHECKPOINT_IDS.includes(heuristic.id)) ||
      selected.length === 2,
    `expected a checkpoint or a full turn of higher-severity moves, got ${JSON.stringify(
      selected.map((h) => h.id)
    )}`
  );
  assert.equal(JSON.stringify(selected).includes("appendicit"), false);
});

test("a checkpoint stays quiet once the learner has done the thing it would ask for", () => {
  const articulated = mergeReasoningState(
    null,
    normalizeReasoningDelta(
      {
        problem_representation_stated: true,
        working_diagnosis: { stated: true, concept_id: "generic_diagnosis" },
        differential: {
          stated: true,
          items: [
            { concept_id: "generic_diagnosis", rank: 1 },
            { concept_id: "generic_alternative", rank: 2, dangerous: true },
          ],
        },
        contingency: { stated: true, trigger_concept_ids: ["generic_test"] },
      },
      {
        allowedConceptIds: new Set(["generic_diagnosis", "generic_alternative", "generic_test"]),
      }
    ),
    1
  ).state;

  // Late enough in the case that all three checkpoints are otherwise eligible.
  const selected = selectHeuristics({
    caseData: syntheticCase,
    session: syntheticSession(articulated, {
      temporalState: { clockMinutes: 180, status: "stable", flags: [] },
      workingMemory: { turnNumber: 9, reasoningState: articulated },
    }),
    attempted: new Set(),
    heuristics: mentorHeuristics,
  });

  for (const heuristic of selected) {
    assert.ok(
      !CHECKPOINT_IDS.includes(heuristic.id),
      `${heuristic.id} asked for something the learner already articulated`
    );
  }
});

test("a checkpoint does not break a silence caused by no work having happened", () => {
  // The mentor was deliberately allowed to stay silent in V3.1. A checkpoint
  // gated only on turn count would have reintroduced "always something to say"
  // through the back door: three messages of "не знаю" are not clinical work.
  const idle = selectHeuristics({
    caseData: syntheticCase,
    session: syntheticSession(createEmptyReasoningState(), {
      completedActions: [],
      temporalState: { clockMinutes: 0, status: "stable", flags: [] },
      workingMemory: { turnNumber: 9, reasoningState: createEmptyReasoningState() },
    }),
    attempted: new Set(),
    heuristics: mentorHeuristics,
  });

  assert.deepEqual(
    idle.filter((heuristic) => CHECKPOINT_IDS.includes(heuristic.id)).map((h) => h.id),
    []
  );
});

test("a checkpoint never outranks a real clinical finding", () => {
  // Severity orders the mentor's mouth. Nothing about a checkpoint may push a
  // safety or omission move out of the two available slots.
  const checkpoints = mentorHeuristics.filter((h) => CHECKPOINT_IDS.includes(h.id));
  assert.equal(checkpoints.length, CHECKPOINT_IDS.length);

  for (const checkpoint of checkpoints) {
    assert.equal(checkpoint.type, "checkpoint");
    assert.equal(checkpoint.severity, 1, "checkpoints sit at MINOR_GAP so real moves win");
    assert.equal(checkpoint.eligible_for_scoring, false);
    assert.deepEqual(checkpoint.when.attempted, undefined, "a checkpoint names no action id");
    assert.deepEqual(checkpoint.when.completed, undefined);
    assert.deepEqual(checkpoint.when.not_completed, undefined);
  }
});

test("each checkpoint speaks once per session", () => {
  const session = syntheticSession(createEmptyReasoningState());
  const first = selectHeuristics({
    caseData: syntheticCase,
    session,
    attempted: new Set(),
    heuristics: mentorHeuristics,
  });
  const firstCheckpoint = first.find((heuristic) => CHECKPOINT_IDS.includes(heuristic.id));
  if (!firstCheckpoint) return; // outranked this turn; nothing to assert

  const again = selectHeuristics({
    caseData: syntheticCase,
    session,
    attempted: new Set(),
    alreadyFired: [firedKey(firstCheckpoint, { status: "stable" })],
    heuristics: mentorHeuristics,
  });
  assert.ok(!again.some((heuristic) => heuristic.id === firstCheckpoint.id));
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
  const state = projectTemporalState(stableCase, initial, ["abdominal_exam"], {
    elapsedMinutes: ED_DISPOSITION_CHECKPOINT_MINUTES,
  });

  assert.ok(state.clockMinutes >= ED_DISPOSITION_CHECKPOINT_MINUTES);
  assert.equal(state.flow.edDispositionCheckpointReached, true);
  assert.equal(state.heartRate, initial.heartRate, "heart rate must not move on the clock alone");
  assert.equal(state.temperatureC, initial.temperatureC, "temperature must not move on the clock alone");
  assert.ok(state.painScore <= initial.painScore, "pain must not rise on the clock alone");
  assert.ok(!state.flags.includes("delay_risk"), "delay_risk is a disease signal, not a clock signal");
  assert.notEqual(state.status, "delayed_source_control");
});

test("an unreviewed disease rule remains faculty-only and cannot alter learner physiology", () => {
  const initial = createInitialTemporalState(v3Case);
  const state = projectTemporalState(v3Case, createInitialTemporalState(v3Case), ["wait_for_ultrasound"]);
  assert.equal(state.status, initial.status);
  assert.equal(state.heartRate, initial.heartRate);
  assert.equal(state.temperatureC, initial.temperatureC);
  assert.ok(!state.flags.includes("delay_risk"));

  const rule = (v3Case.temporal_progression_rules || [])[0];
  assert.ok(rule, "the appendicitis card must own its progression rule");
  assert.equal(rule.review_status, "NEEDS_CLINICAL_REVIEW");
  assert.equal(rule.runtime_status, "faculty_review_only");
  assert.equal(rule.eligible_for_scoring, false);
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
  "sign in перед наркозом",
  "time out перед разрезом",
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
    "выбираю открытую аппендэктомию",
    "начинаю операцию",
    "аппендэктомия выполнена",
  ]);

  assert.deepEqual(
    (result.blockedOperations || []).map((operation) => operation.action_id),
    ["appendectomy_here"]
  );
  assert.equal(session.temporalState.sourceControl, false);
  assert.ok(!session.revealedFindings.includes("operative_finding"), "a blocked operation reveals nothing");
  assert.match(result.reply, /профилактика/i, "the mentor must name the missing preoperative requirement");
});

test("prophylaxis and surgery in one turn are accepted", async () => {
  const { session } = await playV3([
    ...PREOP,
    "выбираю открытую аппендэктомию",
    "начинаю операцию",
    "антибиотикопрофилактика однократно и аппендэктомия выполнена",
  ]);

  assert.equal(session.temporalState.sourceControl, true);
  assert.ok(session.revealedFindings.includes("operative_finding"));
  assert.equal(session.temporalState.status, "controlled");
});

test("the normal V3 path never ends in the antibiotic-gap state", async () => {
  const { session } = await playV3([
    ...PREOP,
    "выбираю открытую аппендэктомию",
    "начинаю операцию",
    "антибиотикопрофилактика однократно и аппендэктомия выполнена",
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

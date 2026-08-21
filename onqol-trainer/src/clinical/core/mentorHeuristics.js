// Senior-surgeon heuristics: what a supervisor notices that no source states.
//
// SOURCE
//
// This file is the machine-readable half of SURGICAL_MENTOR_LOGIC.md, which sits
// next to it and is authored by the surgeon. That document defines how a mentor
// thinks; this file encodes the part a deterministic engine can actually detect.
// Every entry carries `spec_section` pointing back at it, so a reviewer can read
// the claim and its rationale in the author's own words.
//
// Rules here fire on Reasoning State (what the learner articulated), on intent
// types, on the clock, and on core-library action ids. They may NOT name an id
// owned by a disease card: a rule that reads `diagnosis_acute_appendicitis` is
// not a rule about reasoning, it is a rule about appendicitis, and it belongs in
// that disease's mentorRules.js. A test enforces this, because it is the one
// property that decides whether adding cholecystitis is a new file or a rewrite.
//
// WHY THIS FILE EXISTS
//
// Every mentor move before it was reactive. `prerequisite_stop` needs the learner
// to reach for the knife; `escalation_*` needs them to call for help. A learner
// who quietly drifts triggered nothing, and the mentor fell through to "Что
// делаешь дальше?" turn after turn. What separates a senior surgeon is noticing
// what is *not* happening - and the brief carried no channel for that, so no
// amount of "think like a senior surgeon" in the prompt could produce it.
//
// PROVENANCE DISCIPLINE
//
// Most of this is expert opinion. That is a legitimate source type and often the
// only place this knowledge lives, because it is transmitted at the operating
// table rather than written down. But it must be *labelled* as opinion, never
// laundered into looking like a guideline. Hence `provenance` on every entry and
// `eligible_for_scoring: false` throughout: the mentor may say these things, and
// they may not move a single point until a reviewer signs them off.
//
// EDITING THIS FILE
//
// Two rules only:
//   1. `mentor_line` is shown to the learner verbatim when no model is
//      configured. Write it the way you would say it out loud to a resident
//      standing next to you.
//   2. `debrief_line_ru` is the same gap stated after the case, in the past, for
//      the formative debrief. It is REQUIRED on every rule and a test enforces
//      that: the debrief used to look its labels up in a separate table, and the
//      twelve rules missing from that table were dropped from the resident's
//      debrief silently, evidence and all.
//   3. `mentor_line` may name actions and reasoning. It may NOT assert a patient
//      finding, a vital sign, a pain score or the diagnosis - even one the app
//      has already printed, because this file cannot know what was revealed.
//      "Обезболивание ещё не назначено" is fine. "Пациентка жалуется на сильную
//      боль" is not. A test enforces this.
//
// Russian past-tense verbs are gendered, so `mentor_line` must not use them about
// the learner ("ты назначил"/"ты назначила"). Present tense, infinitives or
// verbal nouns. A test enforces this too.

import { reasoningFlags, reasoningFlagsUpdatedOnTurn } from "./reasoningState.js";

const AUTHORED = "EXPERT_OPINION_UNREVIEWED";
const AUTHORED_WITH_SOURCE = "EXPERT_OPINION_NEEDS_SOURCE_VERIFICATION";

/**
 * Error severity, from SURGICAL_MENTOR_LOGIC.md section 17.
 *
 * This is what orders the mentor's mouth. Asked which of two remarks comes
 * first, the author's answer was "смотря что критичнее" - so priority is a
 * declared clinical property of each heuristic, not the order of lines in a
 * file.
 */
export const SEVERITY = {
  ACCEPTABLE_VARIATION: 0,
  MINOR_GAP: 1,
  REASONING_ERROR: 2,
  IMPORTANT_OMISSION: 3,
  SAFETY_CRITICAL: 4,
};

/**
 * Hint ladder, from SURGICAL_MENTOR_LOGIC.md section 18. Use the minimum help
 * that works: 1 open prompt, 2 directional, 3 focused clue, 4 explicit teaching.
 * Safety-critical situations may jump straight to 4.
 */
export const HINT = { OPEN: 1, DIRECTIONAL: 2, FOCUSED: 3, EXPLICIT: 4 };

/**
 * @typedef {Object} MentorHeuristic
 * @property {string} id
 * @property {string} type                    becomes the mentor move type
 * @property {number} severity                SEVERITY.*; orders what gets said
 * @property {number} hint_level              HINT.*
 * @property {"standing_risk"} [lifecycle]   remains live while its condition
 *                     remains open instead of ageing into debrief-only material
 * @property {string[]} [escalate_before]     action ids that make an open
 *                     standing risk immediately relevant again
 * @property {number} [escalation_hint_level] hint level at the irreversible gate
 * @property {number} [escalation_severity]   severity at the irreversible gate
 * @property {string} [escalation_mentor_line] direct wording at the gate
 * @property {string} spec_section            section of SURGICAL_MENTOR_LOGIC.md
 * @property {Object} when                    conjunctive; all present keys must hold
 * @property {string[]} [when.attempted]      learner went for any of these THIS turn
 * @property {string[]} [when.completed]      all of these are already done
 * @property {string[]} [when.not_completed]  none of these is done
 * @property {string[]} [when.phase]          engine phase is one of these
 * @property {string[]} [when.status]         temporal status is one of these
 * @property {string[]} [when.flags]          all of these temporal flags are set
 * @property {number}  [when.min_turn]        not before this turn number
 * @property {number}  [when.min_clock_minutes] not before this much simulated time
 * @property {boolean} [rearm_on_deterioration] may speak a second time if the
 *                     patient's status changes; see selectHeuristics
 * @property {string} mentor_line             shown verbatim without a model
 * @property {string} debrief_line_ru          the same gap stated after the fact,
 *                     for the formative debrief; required on every rule
 * @property {string} rationale_for_reviewer
 * @property {string} provenance
 * @property {boolean} eligible_for_scoring
 */

/**
 * Engine phases, from temporalPatientModel.js. Named here because the first
 * version of this file used the *case action* phase vocabulary ("diagnosis",
 * "management") by mistake, every unit test passed, and nothing ever fired in a
 * real session.
 */
export const ENGINE_PHASES = ["presentation", "diagnostic_workup", "decision", "post_source_control"];

/** @type {MentorHeuristic[]} */
export const mentorHeuristics = [
  // --- Безопасность: пациенту хуже, а план не меняется --------------------
  {
    // "Если пациенту становится хуже, но резидент ничего не делает пару шагов,
    // то надо напомнить." The only heuristic allowed to speak twice.
    //
    // Deterioration is a disease-configured signal now, not a side effect of the
    // ED clock: crossing four hours no longer worsens anybody by itself.
    id: "deterioration_unanswered",
    type: "deterioration_unanswered",
    severity: SEVERITY.SAFETY_CRITICAL,
    hint_level: HINT.EXPLICIT,
    spec_section: "3. Stability comes before diagnosis / 25. Time and consequences",
    when: {
      flags: ["delay_risk"],
      reasoning_none: ["management_plan_stated"],
    },
    rearm_on_deterioration: true,
    mentor_line:
      "Картина меняется, а план — нет. Что сейчас опаснее всего в ближайший час?",
    expected_answer_domains: ["contingency"],
    debrief_line_ru:
      "Состояние пациента менялось, а изменение плана не было сформулировано.",
    rationale_for_reviewer:
      "Ухудшение без изменения плана — единственная категория, где наставник обязан прервать сократический режим (спека, раздел 3: patient safety overrides Socratic teaching). Проверить: достаточно ли флага delay_risk как признака ухудшения, или нужен явный порог по витальным.",
    provenance: AUTHORED,
    eligible_for_scoring: false,
  },

  // --- Диагноз называется вместе с основаниями ----------------------------
  {
    // Placed first among the severity-3 rules on purpose. When a resident asserts
    // a diagnosis, the first thing a supervisor asks is what it rests on - before
    // the dangerous alternative and before stability, both of which stay in the
    // queue for the turns after. Replay c1b4c2d9: "о аппендицит определенно" on
    // turn 2, eight clinical minutes in, no investigations, and the trainer
    // answered "рабочий диагноз зафиксирован".
    //
    // Fires on the learner's own words only: `hypothesis_evidence_for_stated` is
    // set when they said what supports their version. A resident who names the
    // migration of pain and the McBurney tenderness has grounded the claim and is
    // not asked again.
    id: "hypothesis_without_grounds",
    type: "outstanding_priority",
    severity: SEVERITY.IMPORTANT_OMISSION,
    hint_level: HINT.DIRECTIONAL,
    spec_section: "5. Working diagnosis and dangerous alternatives / 20. Correct answer, poor reasoning",
    when: {
      reasoning_all: ["working_diagnosis_stated"],
      reasoning_none: ["hypothesis_evidence_for_stated"],
    },
    mentor_line: "Подожди. На основании каких данных ты ставишь этот диагноз?",
    expected_answer_domains: ["diagnosis_grounds"],
    debrief_line_ru: "Основания для рабочего диагноза не были названы.",
    rationale_for_reviewer:
      "Названный диагноз без оснований — не то же самое, что неучтённая опасная альтернатива (premature_closure) и не то же, что односторонние доводы (unchallenged_hypothesis): здесь резидент не привёл вообще ничего. Открывающее «Подожди» — остановка в разговоре; регистр «Стоп» в этом продукте занят тем, что движок реально не выполнил, а диагноз фиксируется и кейс продолжается. Проверить: не слишком ли рано правило звучит для резидента, который называет диагноз и тут же в следующей фразе его обосновывает.",
    provenance: AUTHORED,
    eligible_for_scoring: false,
  },

  // --- Стабильность раньше диагноза ---------------------------------------
  {
    // Was `diagnosis_without_severity`, gated on diagnosis_acute_appendicitis
    // plus recognize_sepsis. That demanded the learner say "сепсис" to prove
    // they had thought about severity, and it only worked for one disease.
    id: "hypothesis_without_stability",
    type: "outstanding_priority",
    severity: SEVERITY.IMPORTANT_OMISSION,
    hint_level: HINT.FOCUSED,
    spec_section: "3. Stability comes before diagnosis / 16. Drift 6",
    when: {
      reasoning_all: ["working_diagnosis_stated"],
      reasoning_none: ["stability_stated"],
    },
    mentor_line:
      "Название болезни уже есть. Мне сейчас важнее другое: пациент стабилен или нет, и по каким признакам?",
    expected_answer_domains: ["stability"],
    debrief_line_ru:
      "Оценка стабильности пациента не была сформулирована до рабочего диагноза.",
    rationale_for_reviewer:
      "Резидент называет заболевание и не оценивает физиологию. Срабатывает на том, что резидент сказал про стабильность, а не на том, произнёс ли он слово «сепсис».",
    provenance: AUTHORED,
    eligible_for_scoring: false,
  },
  {
    // Was `diagnosis_without_action`, gated on four appendicitis action ids.
    id: "hypothesis_without_management",
    type: "outstanding_priority",
    severity: SEVERITY.REASONING_ERROR,
    hint_level: HINT.OPEN,
    spec_section: "9. Management must follow diagnosis / 16. Drift 8",
    when: {
      reasoning_all: ["working_diagnosis_stated"],
      reasoning_none: ["management_plan_stated"],
      min_turn: 4,
    },
    mentor_line: "Хорошо, диагноз есть. И что ты теперь с этим пациентом делаешь?",
    expected_answer_domains: ["management"],
    debrief_line_ru:
      "Диагноз был назван, а переход к тактике не был сформулирован.",
    rationale_for_reviewer:
      "Рассуждение заканчивается диагнозом. Каждый диагноз должен переходить в решение. Порог min_turn даёт резиденту ход на то, чтобы дойти до тактики самому.",
    provenance: AUTHORED,
    eligible_for_scoring: false,
  },
  {
    // Was `premature_closure`, gated on differential_ectopic and
    // pelvic_gynecologic_screen. The universal half is "no dangerous
    // alternative was reasoned about"; the appendicitis-specific half (ectopic
    // pregnancy in this patient profile) lives in the disease module.
    id: "premature_closure",
    type: "outstanding_priority",
    severity: SEVERITY.IMPORTANT_OMISSION,
    hint_level: HINT.DIRECTIONAL,
    spec_section: "5. Working diagnosis and dangerous alternatives / 16. Drift 2",
    when: {
      reasoning_all: ["working_diagnosis_stated"],
      reasoning_none: ["dangerous_alternative_stated"],
    },
    mentor_line: "Диагноз назван быстро. Что здесь нельзя пропустить, даже если это менее вероятно?",
    debrief_line_ru:
      "Рабочий диагноз был назван без явного рассуждения об опасной альтернативе.",
    rationale_for_reviewer:
      "«Боль справа + лейкоцитоз = аппендицит» — самое типичное преждевременное закрытие. Теперь срабатывает на отсутствии рассуждения об опасной альтернативе, а не на невыполненном действии: резидент, назвавший альтернативу словами, больше не наказывается.",
    provenance: AUTHORED,
    eligible_for_scoring: false,
  },
  {
    id: "unranked_differential",
    type: "outstanding_priority",
    severity: SEVERITY.REASONING_ERROR,
    hint_level: HINT.DIRECTIONAL,
    spec_section: "16. Drift 3: unranked differential",
    when: {
      reasoning_all: ["differential_stated"],
      reasoning_none: ["differential_ranked"],
    },
    mentor_line: "Список есть. Что из этого первое по вероятности, а что — самое опасное?",
    debrief_line_ru:
      "Дифференциальный ряд не был ранжирован по вероятности и по опасности.",
    rationale_for_reviewer:
      "Проблема не в маленьком дифференциале, а в отсутствии приоритетов. Ранжирование — то, что отличает мышление от перечисления.",
    provenance: AUTHORED,
    eligible_for_scoring: false,
  },

  {
    // Only detectable since the learner's own arguments are recorded. Before
    // that the engine knew a differential existed and had no way to see that
    // every line of reasoning ran one way.
    id: "unchallenged_hypothesis",
    type: "outstanding_priority",
    severity: SEVERITY.REASONING_ERROR,
    hint_level: HINT.DIRECTIONAL,
    spec_section: "5. Working diagnosis and dangerous alternatives / 20. Correct answer, poor reasoning",
    when: {
      reasoning_all: ["hypothesis_evidence_for_stated"],
      reasoning_none: ["hypothesis_evidence_against_stated"],
    },
    mentor_line: "Аргументы за я услышал. А что в этой картине НЕ укладывается в твою версию?",
    expected_answer_domains: ["counter_evidence"],
    debrief_line_ru:
      "Доводы против ведущей гипотезы не были названы.",
    rationale_for_reviewer:
      "«What does not fit your diagnosis?» — прямой вопрос из спеки, раздел 5. Резидент, у которого все доводы указывают в одну сторону, обычно не взвешивал, а подтверждал уже принятое решение. Отличается от premature_closure: там альтернатива не названа вовсе, здесь она может быть названа, но ни одного довода против ведущей гипотезы не прозвучало.",
    provenance: AUTHORED,
    eligible_for_scoring: false,
  },

  // --- Исследования: каждый тест отвечает на вопрос ------------------------
  {
    // Replaces the universal `ct_before_ultrasound` rule, which asserted "УЗИ
    // ОБП и ОМТ всегда перед КТ" for every nosology and patient group. That is
    // a reviewed disease-level sequence at best; as a universal law it would
    // break the moment a second disease arrives. The portable rule is the one
    // that asks what question the scan answers.
    id: "investigation_without_purpose",
    type: "outstanding_priority",
    severity: SEVERITY.REASONING_ERROR,
    hint_level: HINT.OPEN,
    spec_section: "7. Every test needs a purpose / 16. Drift 4",
    when: {
      reasoning_all: ["investigation_without_stated_purpose"],
    },
    mentor_line:
      "Какой клинический вопрос ты хочешь закрыть этим исследованием и изменит ли результат тактику?",
    debrief_line_ru:
      "Цель исследования не была вербализована.",
    rationale_for_reviewer:
      "Исследование имеет смысл, если оно отвечает на конкретный вопрос или меняет тактику. Срабатывает на названном резидентом обосновании, а не на количестве назначенных тестов — считать тесты и звать это shotgun-диагностикой прямо запрещено планом V3.1.",
    provenance: AUTHORED,
    eligible_for_scoring: false,
  },
  {
    id: "imaging_before_examination",
    type: "sequence_inverted",
    severity: SEVERITY.REASONING_ERROR,
    hint_level: HINT.DIRECTIONAL,
    spec_section: "8. Do not let testing replace thinking",
    when: {
      attempted_intent: ["request_test"],
      not_completed_intent: ["request_examination"],
    },
    mentor_line: "До визуализации стоит назвать, что даст осмотр живота. Что именно ищем при пальпации?",
    debrief_line_ru:
      "Визуализация была запрошена до того, как был назван ожидаемый результат осмотра.",
    rationale_for_reviewer:
      "Автор: «мы всегда движемся от менее инвазивного теста к более. Иногда руки скажут тебе больше». Сформулировано через типы намерений, а не через id конкретных исследований, поэтому переносится на любую нозологию.",
    provenance: AUTHORED,
    eligible_for_scoring: false,
  },
  {
    id: "waiting_for_every_result",
    type: "outstanding_priority",
    severity: SEVERITY.REASONING_ERROR,
    hint_level: HINT.OPEN,
    spec_section: "16. Drift 5: waiting for every result",
    when: {
      reasoning_all: ["working_diagnosis_stated"],
      reasoning_none: ["management_plan_stated"],
      min_clock_minutes: 120,
    },
    mentor_line:
      "Что этому пациенту нужно уже сейчас, независимо от того, что покажет исследование?",
    debrief_line_ru:
      "Тактика откладывалась до получения всех результатов без сформулированного плана.",
    rationale_for_reviewer:
      "Резидент воспринимает диагностику и лечение как последовательные этапы. В неотложной хирургии они идут параллельно. Порог по часам, а не по действию ожидания, — чтобы правило не зависело от того, есть ли в кейсе действие «ждать УЗИ».",
    provenance: AUTHORED,
    eligible_for_scoring: false,
  },

  // --- Наблюдение, план Б, переоценка, маршрут ------------------------------
  {
    // Was gated on `active_observation` plus `serial_reexamination`. The plan is
    // explicit that serial re-examination alone does not prove an observation
    // has an endpoint.
    id: "observation_without_endpoint",
    type: "outstanding_priority",
    severity: SEVERITY.REASONING_ERROR,
    hint_level: HINT.FOCUSED,
    spec_section: "11. Observation is an active plan / 16. Drift 7",
    when: {
      reasoning_all: ["observation_active"],
      reasoning_none: ["observation_plan_complete"],
    },
    mentor_line: "Наблюдаем что, до какого момента, и что должно произойти, чтобы решение поменялось?",
    expected_answer_domains: ["observation", "contingency"],
    debrief_line_ru:
      "Критерии завершения наблюдения остались неполными.",
    rationale_for_reviewer:
      "«Оставим под наблюдением» без цели, интервала пересмотра и критерия эскалации — псевдотактика. Формулировка безличная намеренно: «чтобы ты поменяла» приписало бы резиденту пол.",
    provenance: AUTHORED,
    eligible_for_scoring: false,
  },
  {
    id: "no_contingency_plan",
    type: "outstanding_priority",
    severity: SEVERITY.REASONING_ERROR,
    hint_level: HINT.OPEN,
    spec_section: "13. Every plan needs an exit condition / 16. Drift 9",
    when: {
      reasoning_all: ["management_plan_stated"],
      reasoning_none: ["contingency_stated"],
    },
    mentor_line: "План есть. Что заставит тебя его поменять?",
    expected_answer_domains: ["contingency"],
    debrief_line_ru:
      "План на случай изменения ситуации не был сформулирован.",
    rationale_for_reviewer:
      "Один из самых частых вопросов наставника по спеке. У любого плана должны быть критерии отказа и эскалации.",
    provenance: AUTHORED,
    eligible_for_scoring: false,
  },
  {
    id: "consultation_replacing_reasoning",
    type: "outstanding_priority",
    severity: SEVERITY.MINOR_GAP,
    hint_level: HINT.EXPLICIT,
    spec_section: "22. Consultation and escalation / 16. Drift 10",
    when: {
      reasoning_none: ["consultation_own_assessment_stated"],
      attempted: ["call_senior_surgeon", "call_intensive_care"],
    },
    mentor_line:
      "Позови. Но сначала скажи мне: что ты сам думаешь, что уже сделано и какой вопрос ты задаёшь консультанту?",
    debrief_line_ru:
      "Собственная оценка перед консультацией осталась неявной.",
    rationale_for_reviewer:
      "Консультация используется вместо собственного клинического решения. Дополняет, а не заменяет ход escalation_premature: тот про момент вызова, этот про содержание доклада.",
    provenance: AUTHORED,
    eligible_for_scoring: false,
  },

  // --- Часы приёмного отделения --------------------------------------------
  {
    // Fires on the ED flow checkpoint, not on the absence of an appendectomy.
    // Calling a senior is not a disposition, and the plan says so explicitly.
    id: "ed_clock_disposition",
    type: "clock",
    severity: SEVERITY.IMPORTANT_OMISSION,
    hint_level: HINT.DIRECTIONAL,
    spec_section: "15. Emergency department clock / 14. Disposition",
    when: {
      flags: ["ed_disposition_checkpoint"],
      reasoning_none: ["disposition_stated", "observation_plan_complete"],
    },
    mentor_line:
      "Мы уже долго в приёмном. Каков конкретный план диспозиции, включая цель и срок пересмотра при продолжении наблюдения?",
    debrief_line_ru:
      "Решение о маршрутизации из приёмного отделения не было сформулировано ко времени контрольной точки.",
    rationale_for_reviewer:
      "NEEDS_SOURCE_VERIFICATION. Автор: стандарт приёмных отделений РК не устанавливает универсального правила «через 4 часа пациент обязан уйти»; для жёлтой зоны допускается наблюдение до 24 часов. Модель NHS England использует 0–4 часа как core ED care с целевым исходом admit/transfer/discharge у ≥95%. Сверить обе строки; порог 240 минут взят из второй. Наблюдение принимается как маршрут только с целью, интервалом и критерием выхода.",
    provenance: AUTHORED_WITH_SOURCE,
    eligible_for_scoring: false,
  },

  // --- Чекпоинты рассуждения ------------------------------------------------
  //
  // Everything above reacts to a defect: something is missing, inverted or
  // unsafe. These three do not. They are the mentor asking, two or three times
  // in a case, the questions that make reasoning visible - the same questions a
  // consultant asks on a ward round when nothing at all is wrong.
  //
  // WHY NOT A QUESTIONNAIRE. The obvious implementation is a form at the end of
  // the case. It measures what the learner can reconstruct afterwards, which is
  // a different skill from reasoning while the patient is in front of them, and
  // it interrupts the fiction the rest of the engine works to maintain. Asked in
  // dialogue, the answer is routed by the same extractor as everything else and
  // lands in Reasoning State without a second pipeline.
  //
  // SEVERITY 1 ON PURPOSE. A checkpoint must never outrank a real finding: if
  // the patient is deteriorating or the learner is reaching for the knife
  // without consent, that is what gets said. Checkpoints fill silence, they do
  // not compete for it.
  //
  // Each speaks once per session (the default in firedKey), and at most two
  // moves reach the learner per turn, so the ceiling is three checkpoints in a
  // case - which is what the author asked for.
  //
  // They gate on the CONTENT flags (`multiple_hypotheses_stated`), not the
  // presence flags (`differential_stated`), so a checkpoint stays quiet for a
  // learner who has already done the thing it would have asked for.
  //
  // GATED ON THE CLOCK, NOT ONLY ON TURNS. `min_turn` counts messages, and a
  // message can be "привет" or "не знаю". Simulated minutes only advance when an
  // action is actually performed, so the clock is the portable way to say "the
  // learner has done some work on this patient". Before that there is nothing to
  // summarise and no hypothesis to rank, and asking anyway would reintroduce
  // "the mentor always has something to say" - which the author deliberately
  // removed in V3.1. A checkpoint fills a silence in real work; it does not
  // break a silence that exists because no work has happened.
  {
    id: "checkpoint_problem_representation",
    type: "checkpoint",
    severity: SEVERITY.MINOR_GAP,
    hint_level: HINT.OPEN,
    spec_section: "4. Define the actual clinical problem / 1. Core mentor loop",
    when: {
      min_turn: 3,
      // Roughly a history and an examination. Enough collected to have something
      // to compress.
      min_clock_minutes: 15,
      reasoning_none: ["problem_representation_stated"],
    },
    mentor_line:
      "Останови на секунду. Сформулируй одной фразой, кто перед тобой и в чём проблема — без диагноза, только суть.",
    debrief_line_ru:
      "Представление проблемы явно не сформулировано.",
    rationale_for_reviewer:
      "Problem representation — первый из трёх навыков клинического мышления (Cuddy 2025, Deschênes 2025): сжать данные в смысловое резюме до того, как называть болезнь. Отличается от heuristic-а premature_closure тем, что не ждёт ошибки: резидент может не совершить ни одной, и всё равно ни разу не сформулировать пациента. Порог в три хода даёт время собрать хоть что-то, чтобы вопрос не пришёл на пустом месте.",
    provenance: AUTHORED,
    eligible_for_scoring: false,
  },
  {
    id: "checkpoint_hypotheses",
    type: "checkpoint",
    severity: SEVERITY.MINOR_GAP,
    hint_level: HINT.OPEN,
    spec_section: "5. Working diagnosis and dangerous alternatives / 6. Probability",
    when: {
      min_turn: 5,
      // First investigations are back. Ranking hypotheses before any data is a
      // guessing exercise, not reasoning.
      min_clock_minutes: 45,
      reasoning_none: ["multiple_hypotheses_stated"],
    },
    mentor_line:
      "Назови гипотезы, которые сейчас лидируют. И скажи, какая из них опаснее всего, даже если она не самая вероятная.",
    debrief_line_ru:
      "Гипотезы и опасная альтернатива явно не ранжированы.",
    rationale_for_reviewer:
      "Hypothesis generation с ранжированием — второй навык. Пересекается с unranked_differential и premature_closure, но те требуют, чтобы резидент уже что-то назвал: они молчат, если он не назвал ничего. Этот спрашивает. Ответ раскладывается в differential.items с rank и dangerous, то есть чекпоинт не только учит, но и наполняет измерение.",
    provenance: AUTHORED,
    eligible_for_scoring: false,
  },
  {
    id: "checkpoint_what_changes_the_plan",
    type: "checkpoint",
    severity: SEVERITY.MINOR_GAP,
    hint_level: HINT.OPEN,
    spec_section: "7. Every test needs a purpose / 13. Every plan needs an exit condition",
    when: {
      min_turn: 7,
      min_clock_minutes: 60,
      reasoning_all: ["leading_hypothesis_named"],
      reasoning_none: ["contingency_trigger_named"],
    },
    mentor_line:
      "Последний вопрос по ходу: какой результат заставит тебя поменять решение — и что ты делаешь, если он придёт именно таким?",
    expected_answer_domains: ["contingency"],
    debrief_line_ru:
      "Условие изменения плана осталось неявным.",
    rationale_for_reviewer:
      "Diagnostic justification — третий навык: не «зачем этот анализ», а «что изменится от ответа». Отличается от no_contingency_plan: тот срабатывает на полном отсутствии плана Б, этот — когда план Б назван общими словами («если станет хуже»), но ни разу не привязан к конкретному исследованию. Требует уже названной ведущей гипотезы: без неё вопрос преждевременный.",
    provenance: AUTHORED,
    eligible_for_scoring: false,
  },

];

export const mentorHeuristicsById = new Map(
  mentorHeuristics.map((heuristic) => [heuristic.id, heuristic])
);

/**
 * How many heuristics may speak in one turn.
 *
 * SURGICAL_MENTOR_LOGIC.md step 4 says "find the single highest-value teaching
 * point; do not correct everything at once". The remediation contract makes
 * that operational: one focused coaching move per mentor message.
 */
export const MAX_HEURISTICS_PER_TURN = 1;

/**
 * Select the heuristics for this turn, most severe first.
 *
 * @param {object} params
 * @param {object} params.caseData
 * @param {object} params.session          session state AFTER the deterministic update
 * @param {Set<string>} params.attempted   action ids the learner went for this turn
 * @param {string[]} params.alreadyFired   fired keys from working memory
 * @param {MentorHeuristic[]} [params.heuristics]
 * @returns {MentorHeuristic[]}
 */
export function selectHeuristics({
  caseData,
  session,
  attempted,
  alreadyFired = [],
  heuristics = null,
  currentTurn = null,
  limit = MAX_HEURISTICS_PER_TURN,
}) {
  // Core rules describe reasoning patterns and may name only core-library action
  // ids or intent types. Disease-specific coaching travels with the case in
  // `mentor_rules`, so adding cholecystitis never means editing this file.
  const active = heuristics || [...mentorHeuristics, ...(caseData.mentor_rules || [])];
  const temporal = session.temporalState || {};
  const context = {
    attempted,
    completed: new Set(session.completedActions || []),
    phase: session.phase,
    turnNumber: session.workingMemory?.turnNumber || 0,
    clockMinutes: temporal.clockMinutes || 0,
    status: temporal.status || "stable",
    flags: new Set([
      ...(temporal.flags || []),
      ...(temporal.flow?.edDispositionCheckpointReached ? ["ed_disposition_checkpoint"] : []),
    ]),
    reasoning: reasoningFlags(session.workingMemory?.reasoningState),
    reasoningUpdated: reasoningFlagsUpdatedOnTurn(
      session.workingMemory?.reasoningState,
      session.workingMemory?.turnNumber
    ),
    // Intent types let a core rule say "imaging was ordered before anyone
    // examined the patient" without naming ct_abdomen or abdominal_exam, which
    // are appendicitis ids. This is what makes the rule portable.
    attemptedIntents: intentsOf(caseData, attempted),
    completedIntents: intentsOf(caseData, new Set(session.completedActions || [])),
  };
  const fired = new Set(alreadyFired);
  const known = knownActionIds(caseData);

  const eligible = active.filter((heuristic) => {
    if (fired.has(firedKey(heuristic, context))) return false;
    // A heuristic naming an action this case does not carry would make
    // `not_completed` vacuously true and fire on every single turn of every
    // other nosology. Skip rather than nag.
    if (!referencesOnlyKnownActions(heuristic, known)) return false;
    if (!matches(heuristic.when, context)) return false;
    return isTimelyForLiveTurn(heuristic, context, currentTurn);
  }).map((heuristic) => projectStandingRisk(heuristic, context));

  // Current safety first, then an open risk at the point of no return, then
  // ordinary severity. A gate reminder must not disappear behind five parser
  // or content-gap notes on the very turn it exists to protect.
  eligible.sort((a, b) =>
    livePriority(b) - livePriority(a) || b.severity - a.severity
  );
  return eligible.slice(0, limit).map((heuristic) => ({
    ...heuristic,
    relevant_to_current_turn: currentTurn ? true : null,
    why_now: whyNow(heuristic, context, currentTurn),
    fired_key: firedKey(heuristic, context),
  }));
}

function standingRiskAtGate(heuristic, context) {
  if (heuristic.lifecycle !== "standing_risk") return false;
  const attempted = context.attempted || new Set();
  return (heuristic.escalate_before || []).some((id) => attempted.has(id));
}

function projectStandingRisk(heuristic, context) {
  if (heuristic.lifecycle !== "standing_risk") return heuristic;
  const atGate = standingRiskAtGate(heuristic, context);
  return {
    ...heuristic,
    standing_risk_stage: atGate ? "irreversible_gate" : "open",
    hint_level: atGate
      ? heuristic.escalation_hint_level || HINT.EXPLICIT
      : heuristic.hint_level,
    severity: atGate
      ? heuristic.escalation_severity || Math.max(heuristic.severity, SEVERITY.IMPORTANT_OMISSION)
      : heuristic.severity,
    mentor_line: atGate
      ? heuristic.escalation_mentor_line || heuristic.mentor_line
      : heuristic.mentor_line,
  };
}

function livePriority(heuristic) {
  if (heuristic.severity === SEVERITY.SAFETY_CRITICAL) return 300;
  if (heuristic.standing_risk_stage === "irreversible_gate") return 200;
  return heuristic.severity;
}

function whyNow(heuristic, context, currentTurn) {
  if (heuristic.severity === SEVERITY.SAFETY_CRITICAL) return "current_safety_signal";
  if (!currentTurn) return "legacy_selection_without_turn_context";
  if (heuristic.standing_risk_stage === "irreversible_gate") {
    return "standing_risk_at_irreversible_gate";
  }
  if (heuristic.lifecycle === "standing_risk") return "standing_risk_remains_open";
  if (currentTurn.previousIssueId === heuristic.id) return "answer_to_previous_mentor_question";
  if ((heuristic.when.attempted || []).some((id) => context.attempted.has(id))) {
    return "current_action_attempt";
  }
  if ((heuristic.when.attempted_intent || []).some((id) => context.attemptedIntents.has(id))) {
    return "current_action_intent";
  }
  if ((heuristic.when.reasoning_all || []).some((flag) => context.reasoningUpdated.has(flag))) {
    return "reasoning_changed_this_turn";
  }
  if (heuristic.type === "clock") return "current_flow_decision";
  return "current_decision_point";
}

/**
 * Rubric gaps remain measurable even when they are not useful interruptions.
 * Live selection gets this extra relevance gate; debrief/legacy callers may
 * inspect the complete accumulated state by omitting `currentTurn`.
 */
function isTimelyForLiveTurn(heuristic, context, currentTurn) {
  if (!currentTurn) return true;
  if (heuristic.severity === SEVERITY.SAFETY_CRITICAL) return true;
  if (heuristic.lifecycle === "standing_risk") return true;
  if (currentTurn.previousIssueId === heuristic.id) return true;
  if ((heuristic.when.attempted || []).some((id) => context.attempted.has(id))) return true;
  if (
    (heuristic.when.attempted_intent || []).some((intent) =>
      context.attemptedIntents.has(intent)
    )
  ) return true;
  if (
    (heuristic.when.reasoning_all || []).some((flag) =>
      context.reasoningUpdated.has(flag)
    )
  ) return true;

  const topic = currentTurn.topic || "unknown";
  if (heuristic.type === "clock" && context.attempted.size > 0) return true;
  if (
    topic === "management" &&
    ["no_contingency_plan", "observation_without_endpoint", "hypothesis_without_management"].includes(
      heuristic.id
    ) &&
    ["decision", "preop", "reassessment"].includes(currentTurn.pathState)
  ) return true;
  if (
    topic === "investigations" &&
    heuristic.id === "investigation_without_purpose" &&
    context.reasoningUpdated.has("investigation_without_stated_purpose")
  ) return true;

  // A checkpoint based only on an old false field is debrief material. It does
  // not become a live questionnaire just because enough turns have elapsed.
  return false;
}

/**
 * The key under which a fired heuristic is remembered.
 *
 * Normally the id, so each speaks once per session - a supervisor who repeats
 * the same remark every turn stops being heard. A heuristic marked
 * `rearm_on_deterioration` is keyed by id AND patient status, so when the
 * patient's state changes it is allowed to speak again. That is the author's
 * answer to "should it re-arm": yes, when the patient gets worse.
 */
export function firedKey(heuristic, context) {
  if (heuristic.lifecycle === "standing_risk") {
    const stage = standingRiskAtGate(heuristic, context) ? "irreversible_gate" : "open";
    return `${heuristic.id}@${stage}`;
  }
  return heuristic.rearm_on_deterioration ? `${heuristic.id}@${context.status}` : heuristic.id;
}

function matches(when = {}, context) {
  if (when.min_turn != null && context.turnNumber < when.min_turn) return false;
  if (when.min_clock_minutes != null && context.clockMinutes < when.min_clock_minutes) return false;
  if (when.phase && !when.phase.includes(context.phase)) return false;
  if (when.status && !when.status.includes(context.status)) return false;
  if (when.flags && !when.flags.every((flag) => context.flags.has(flag))) return false;
  if (when.attempted && !when.attempted.some((id) => context.attempted.has(id))) return false;
  if (when.completed && !when.completed.every((id) => context.completed.has(id))) return false;
  if (when.not_completed && when.not_completed.some((id) => context.completed.has(id))) return false;
  // Reasoning predicates. A closed flag vocabulary rather than dotted paths into
  // the state object, so a typo fails a test instead of quietly never matching.
  if (when.reasoning_all && !when.reasoning_all.every((flag) => context.reasoning.has(flag))) return false;
  if (when.reasoning_none && when.reasoning_none.some((flag) => context.reasoning.has(flag))) return false;
  if (when.attempted_intent && !when.attempted_intent.some((type) => context.attemptedIntents.has(type))) {
    return false;
  }
  if (when.not_completed_intent && when.not_completed_intent.some((type) => context.completedIntents.has(type))) {
    return false;
  }
  return true;
}

function intentsOf(caseData, actionIds) {
  const byId = actionIndex(caseData);
  const intents = new Set();
  for (const id of actionIds) {
    const intent = byId.get(id)?.intent_type;
    if (intent) intents.add(intent);
  }
  return intents;
}

function actionIndex(caseData) {
  const index = new Map();
  for (const action of [
    ...(caseData.expected_actions || []),
    ...(caseData.acceptable_alternatives || []),
    ...(caseData.unnecessary_actions || []),
    ...(caseData.unsafe_actions || []),
  ]) {
    index.set(action.id, action);
  }
  return index;
}

function knownActionIds(caseData) {
  return new Set(
    [
      ...(caseData.expected_actions || []),
      ...(caseData.acceptable_alternatives || []),
      ...(caseData.unnecessary_actions || []),
      ...(caseData.unsafe_actions || []),
    ].map((action) => action.id)
  );
}

function referencesOnlyKnownActions(heuristic, known) {
  const referenced = [
    ...(heuristic.when.attempted || []),
    ...(heuristic.when.completed || []),
    ...(heuristic.when.not_completed || []),
    ...(heuristic.escalate_before || []),
  ];
  return referenced.every((id) => known.has(id));
}

// --- WHAT REASONING STATE MADE DETECTABLE ---------------------------------
//
// Before Reasoning State this table could only see actions and the clock, so the
// drifts that are about *how* a resident reasons had no proxy at all and were
// listed here as absent. Most are now real rules above:
//
//   Drift 2  premature closure        -> premature_closure
//   Drift 3  unranked differential    -> unranked_differential
//   Drift 4  testing without purpose  -> investigation_without_purpose
//   Drift 5  waiting for everything   -> waiting_for_every_result
//   Drift 6  diagnosis without severity -> hypothesis_without_stability
//   Drift 7  observation without end  -> observation_without_endpoint
//   Drift 8  diagnosis without action -> hypothesis_without_management
//   Drift 9  no contingency plan      -> no_contingency_plan
//   Drift 10 consultation replacing   -> consultation_replacing_reasoning
//            reasoning                   (complements escalation_premature:
//                                        that one judges the moment, this one
//                                        the content of the hand-over)
//
// --- STILL NOT DETECTABLE --------------------------------------------------
//
//   Drift 1  endless data gathering   - needs "enough data to decide" as a
//                                       declared, reviewed bar. Counting tests
//                                       is not it, and guessing a threshold is
//                                       exactly the unreviewed clinical content
//                                       this project refuses to ship.
//
// Reasoning State records that a claim was made; it never validates it. A
// resident who states a purpose for every test satisfies
// investigation_without_purpose whether or not the purpose was a good one. These
// rules coach; they do not grade, which is why every one of them is
// `eligible_for_scoring: false`.
//
// The four core questions (spec section 1) are not heuristics at all: they are
// what the mentor falls back to when reasoning is unclear. That is a matter for
// the mentor prompt, not for this table.

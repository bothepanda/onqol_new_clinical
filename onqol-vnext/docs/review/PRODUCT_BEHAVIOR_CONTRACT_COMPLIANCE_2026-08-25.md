# Product Behavior Contract compliance map — ON QOL vNext

**Date:** 2026-08-25
**Contract audited:** `docs/contracts/ONQOL_PRODUCT_BEHAVIOR_CONTRACT_v1.0_2026-08-22.md`
**Contract hash:** `26b5bb0d165439051370c103fd630a7cdc06368b87b70e682325db7bd992dff3`
**Scope:** APP-004 and the shared runtime behaviors APP-004 exercises
**Method:** every row verified against the real learner-facing path
(`createSession` → `submitLearnerTurn` → the renderers `useSession` calls), not
against internal state alone.

## How to read a status

| status | means |
| --- | --- |
| `PASS` | verified end-to-end through learner text → interpreter → validation → domain → time/events → renderer → learner-visible output |
| `PARTIAL` | the behavior works in part; the gap is stated exactly |
| `FAIL` | the contract requires it, the product does not do it, and no clinical content is blocking |
| `BLOCKED_BY_GOVERNANCE` | the mechanism is correct but the clinical truth it needs is not `approved_for_training` |
| `NOT_TESTABLE_YET` | cannot be exercised in the current slice |
| `OUT_OF_SCOPE_BY_CURRENT_CONTRACT` | the contract conditions it on capability this product does not yet have |

A correct mechanism with no approved clinical truth is **not** a working
learner behavior, and is never marked `PASS`.

Test ids in the *Test evidence* column refer to
`src/tests/productBehaviorContract.test.js` unless another file is named.

The required *Contract section* column is carried by the section heading above
each table rather than repeated in every row; all other required columns
(Requirement, Status, Learner-facing evidence, Code evidence, Test evidence,
Governance dependency, Exact gap, Required action) are present per row.

---

## §1 Purpose

| Requirement | Status | Learner-facing evidence | Code evidence | Test evidence | Governance dependency | Exact gap | Required action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A resident manages a real-feeling surgical patient freely over time | `PARTIAL` | Reference smoke: 22 turns, 0→700 min, ED→OR→PACU→ward→discharge | `core/session/submitLearnerTurn.js` | `PBC-19`, Reference smoke | Disease trajectory `pending` | The patient is managed over time but does not *change* over time — no approved course model | Approve a trajectory model (review pack §1, `T01`–`T03`) |
| Consequences of actions **and omissions** are seen | `BLOCKED_BY_GOVERNANCE` | Ketoprofen given at min 0; pain 4.9/10 unchanged at min 180 | `advanceTime.js#runPendingItem` treatment_effect | `PBC-8 treatment response stays governance-blocked` | Every `(drug, route)` `response_envelope: null` | No treatment produces any consequence | Review pack §2 (analgesia) |
| Mentor interrupts only for safety / major error / dead-end | `PASS` | Mentor silent across a 6-turn competent workup | `ai/mentor/mentorEngine.js` | `PBC-22 the mentor stays silent` | — | — | — |
| Not a diagnosis quiz, checklist, OSCE station, or static chat | `PASS` | No rubric prompt, no forced sequence; free order of actions | `core/state/worldState.js` (no `path_state`) | `worldState.test.js` "no path_state field exists" | — | — | — |

## §2 Core product model

| Requirement | Status | Learner-facing evidence | Code evidence | Test evidence | Governance dependency | Exact gap | Required action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| The patient is modeled (disease, findings, progression, response, complications, outcome) | `PARTIAL` | Findings and examination render from patient truth | `core/patient/patientGenerator.js` | `app004Remediation.test.js` 4–10 | Phenotype/physiology `pending`; trajectory `pending`; complications `[]` | Progression, treatment response and complications are all inert | Review pack §1 |
| The hospital is modeled (location, staff, equipment, turnaround, capacity, constraints, transfer) | `PASS` | Real smoke: CT down, US 90 min, transfer 45 min, staff ETAs | `core/hospital/*`, `core/time/scheduler.js` | `PBC-3` (×4) | — (operational data, Foundation Spec §46) | — | — |
| The learner is modeled (assessment, orders, procedures, reasoning, timing, escalation) | `PARTIAL` | Orders, procedures, escalation and timing all reachable | `core/commands/executeCommand.js` | `PBC-8`, `PBC-16`, `PBC-17` | — | **Reasoning is not capturable**: `STATE_REASONING` has a handler but no interpreter path, so a stated working diagnosis or differential is never recorded | Add reasoning-statement vocabulary; see §11 below |
| The mentor observes but does not own the three realities | `PASS` | Mentor never speaks for the hospital in any smoke turn | `mentorEngine.js` reads only `buildLearnerVisibleState` | `PBC-23` | — | — | — |
| The patient continues to exist and change independently of the mentor conversation | `PARTIAL` | Results arrive mid-conversation, unprompted | `core/time/advanceTime.js` | `PBC-7` | Trajectory `pending` | Exists independently; does not *change* independently | Review pack §1 |

## §3 Two hospital modes

### §3.1 Reference Hospital

| Requirement | Status | Learner-facing evidence | Code evidence | Test evidence | Governance dependency | Exact gap | Required action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Exists as a first-class learner choice | `PASS` | Start screen offers two equally weighted modes | `ui/components/ModeSelection.jsx` | Reference smoke header | — | — | — |
| Laboratory available | `PASS` | «Назначено: ОАК… 70 мин» | `hospitalProfiles.js#REFERENCE_HOSPITAL_PROFILE` | `PBC-8 several orders` | — | — | — |
| Ultrasound and CT available when appropriate | `PASS` | CT ordered without prior US, resulted | same | `PBC-9 CT is a full abdomen/pelvis report` | — | — | — |
| Operating room capacity available within reasonable limits | `PASS` | Theatre reached in the Reference smoke | same | `PBC-16` | — | — | — |
| Anesthesia available | `PASS` | «Анестезиолог вызван(а), ожидаемое время — 20 мин» | same | `PBC-16` | — | — | — |
| ICU available | `PASS` | `icuBed` available; ICU is a valid disposition | same | — | — | Not exercised in the APP-004 slice (uncomplicated case) | None — the capability is correct |
| Consultants reachable | `PASS` | «вызываю старшего хирурга» → ETA 20 мин | `resourceResolution.js#callStaff` | `PBC-23` | — | — | — |
| Laparoscopy and standard operative equipment available | `PASS` | «доступ — лапароскопический» | `hospitalProfiles.js` | `PBC-17` | — | — | — |
| Standard medications, blood products, perioperative resources **per the approved content set** | `PARTIAL` | Cefazolin and ketoprofen accepted and recorded | `content/shared/medications/formulary.yaml` | `PBC-8 unsupported medication` | Whole formulary `pending`; no dose approved | The formulary *recognises* drugs but approves none, and blood products are `not_authored` in every profile | Review pack §2, §3 |
| Realistic time still exists (Reference removes barriers, not reality) | `PASS` | Lab 70 min, CT 130 min, anaesthetist 20 min in Reference | `hospitalProfiles.js` ETAs | `PBC-7 parallel investigations` | — | — | — |
| Unsupported content is never presented as resource absence | `PASS` | «метамизол 1 г в/в» → «не поддерживается текущей версией симуляции» | `resourceResolution.js`, `executeCommand.js` formulary lookup | `PBC-8 an unsupported medication is never reported as a hospital stock-out` | — | Fixed this pass — the name was previously unresolvable, so the order produced silence instead of an honest limitation | — |

### §3.2 Real-world Hospital

| Requirement | Status | Learner-facing evidence | Code evidence | Test evidence | Governance dependency | Exact gap | Required action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Exists as a first-class learner choice | `PASS` | Start screen, second card | `ModeSelection.jsx` | Real smoke header | — | — | — |
| A baseline profile is available | `PASS` | `KZ-R2-URBAN` resolved; three archetypes exist | `hospitalProfiles.js#REAL_HOSPITAL_PROFILES` | `PBC-3` | Profiles are `pending_owner_review` (workflow, not clinical) | Profile numbers are scaffolding, labelled as such | Owner review of KZ resource profiles |
| Revealed constraints are real resource state | `PASS` | «КТ сейчас недоступна: аппарат на ремонте» | `dynamicConstraints.js`, `resourceResolution.js` | `PBC-3 a resource constraint is disclosed only when the learner runs into it` | — | — | — |
| Resource constraints do not alter patient biology | `PASS` | Same seed → identical `truth`/`physiology`/`symptoms` in both modes | `dynamicConstraints.js` touches only capabilities/staff | `PBC-3 a missing resource does not change the patient's biology` | — | — | — |
| Known constraints appear in the learner-facing sidebar | `PASS` | Sidebar lists the broken scanner only after contact | `ui/components/ConstraintList.jsx`, `learnerView.js#revealedConstraints` | `PBC-3`, Real smoke | — | — | — |
| Dynamic resource events are deterministic / replayable | `PASS` | Replaying `PBC-REAL-2` reproduces the same draw and patient | `core/rng.js` named streams | `PBC-3 the same seed reproduces…`, `replayIntegrity.test.js` | — | — | — |
| The contract's named constraint archetypes | `PARTIAL` | CT down, OR occupied, ICU no bed, senior delayed; US night-gated in `KZ-R1` | `dynamicConstraints.js#CANDIDATES` | `dynamicConstraints.test.js` | — | "Anesthesiologist occupied in another emergency" is named by the contract and not modeled | Add the archetype (operational data, no clinical review needed) |
| A transfer takes realistic time | `PASS` | «Расчётное время в пути — 45 мин»; case ends at min 165 | `executeCommand.js#TRANSFER`, `advanceTime.js` `transfer_arrival` | `PBC-3 interfacility transfer consumes the authored transport time` | — | Fixed this pass — the ETA was authored on every profile and read by nothing | — |
| Radiologist can give a preliminary verbal report before the formal one | `PASS` | «Рентгенолог: Предварительно…» then the formal report | `executeCommand.js#buildTestSchedule` | `PBC-7 a preliminary radiology report…` | — | — | — |

### §3.3 Separation of biology and resources

| Requirement | Status | Learner-facing evidence | Code evidence | Test evidence | Governance dependency | Exact gap | Required action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `same patient biology ≠ hospital resource state` | `PASS` | See §3.2 row 4 | `createSession.js` — patient and hospital resolved independently | `PBC-3` | — | — | — |
| Resource harm is distinguishable from learner harm in debrief/export | `PASS` | `resourceLimitations[0].noteRu` = «Не является ошибкой обучающегося»; `importantMisses` empty | `buildDebrief.js#buildResourceLimitations` | `PBC-25 a resource constraint is reported as a hospital fact` | — | — | — |
| A delayed operation may change the trajectory because time passes | `BLOCKED_BY_GOVERNANCE` | 165 min elapsed in the Real smoke; physiology unchanged | `advanceTime.js#buildProgressionEvents` records the withholding | `PBC-GOV unapproved content never alters patient truth` | `TRJ-STABLE` `pending`, `natural_course_model: null` | Delay has no consequence | Review pack §1 |
| Distinguish optimal reference pathway / safest feasible local pathway / consequence of the constraint | `PARTIAL` | Debrief: «Сравнение с эталонным маршрутом не приводится…» | `buildDebrief.js#buildReferenceComparison` | `PBC-25 no clinical correction is asserted…` | Zero rules `approved_for_training` | The reference pathway cannot be stated at all, so the three-way comparison collapses to one | Approve at least the pathway rules (review pack §3, §5) |
| Paired Reference-vs-Real teaching mode | `OUT_OF_SCOPE_BY_CURRENT_CONTRACT` | — | — | — | — | The contract does not require this UI | Record as future architecture capability |

## §4 How a case starts

| Requirement | Status | Learner-facing evidence | Code evidence | Test evidence | Governance dependency | Exact gap | Required action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| The learner receives a presentation category, not a diagnosis | `PASS` | «Приёмный покой. **Острый живот.**» | `createSession.js#buildHandoffText`, `disease.yaml#presentation_category` | `PBC-4` | — | — | — |
| EMS / referral handoff is shown | `PASS` | «Передача СМП: мужчина, 55 лет. Боль… около 8 часов.» | same | `PBC-4` | — | — | — |
| Initial vitals are shown | `PASS` | «Т 38 °C, ЧСС 97/мин, ЧДД 19/мин, АД сист. 128» | same | `PBC-4` | Systolic only — no reviewed diastolic value | BP is systolic-only, labelled as such rather than fabricated | Review pack §1 (vitals envelope) |
| Hidden diagnosis is not disclosed | `PASS` | No disease name anywhere in the learner-visible projection | `learnerView.js` | `PBC-4` — asserts absence of `аппендицит`, `retrocecal`, `TRJ-…` | — | Fixed this pass: the phenotype id leaked into `learnerVisible.simulatorLimitations` | — |
| Phenotype / severity / future complication are not exposed | `PASS` | same | `learnerView.js` kinds-only projection | `PBC-4` | — | — | — |
| Not proven by a fixture that instantiates "appendicitis" directly | `PASS` | Both smokes start from `casePresetId: "APP-004"` and a seed only | `createSession.js` | `PBC-4` runs the real start path | — | — | — |

## §5 History and examination

| Requirement | Status | Learner-facing evidence | Code evidence | Test evidence | Governance dependency | Exact gap | Required action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| «осмотрю пациента» → asks what is examined | `PASS` | «Медсестра: Что именно осматриваешь?» | `interpretTurn.js`, `commandTypes.js#REQUIRED_PARAMS` | `PBC-5` | — | — | — |
| «живот» → complete appropriate abdominal examination | `PASS` | One turn yields inspection, palpation, peritoneal signs, auscultation | `renderEvent.js#renderAbdominalExam` | `PBC-5` | Exam-slot wording `pending` | — | Review pack §1 |
| No ritual enumeration required | `PASS` | Never asked for inspection/percussion/auscultation separately | `interpretFragment` EXAMINE branch | `PBC-5` | — | — | — |
| Separate body areas requested separately | `PASS` | «осмотрю ноги», «осмотрю рот» resolve to their own regions | `vocabulary.js#REGION_SYNONYMS` | `PBC-5 universal normal layer` | — | Rectal/neuro/vascular regions exist in vocabulary but have no authored content beyond the normal layer | Content authoring, if a case needs them |
| General history request returns the full relevant bundle | `PASS` | One turn returns onset, aggravating factors, nausea, bowel/urinary, allergy, comorbidity | `renderEvent.js#renderHistoryBundle` | `PBC-5 a general history request` | `history_bundle_ru` `pending` | — | Review pack §1 |
| **Patient answers free-form focused follow-up questions** | `FAIL` | «были операции?», «есть аллергия?», «когда последний стул?», «принимаете антикоагулянты?» → **no response at all** | `COMMAND.ASK_PATIENT` and `EVENT.PATIENT_QUESTION_ANSWERED` are declared but **have no producer and no handler** | — (gap has no passing test) | Requires authoring which patient facts are askable | Four of the contract's own §5.2 examples produce silence. Only «когда последний раз ел и пил?» works, via a separate command | Author an askable-fact set for APP-004 and an `ASK_PATIENT` path; facts must come from the patient model, never the LLM |
| Universal normal layer works for reasonable unrelated examinations | `PASS` | «Кожные покровы нижних конечностей обычной окраски…» | `findings.yaml#universal_normal_layer` | `PBC-5` | `universal_normal_layer` `pending` | — | Review pack §1 |
| Universal normal layer does not overwrite case-specific abnormalities | `PASS` | Abdomen still abnormal after an unrelated normal exam | `renderEvent.js#renderExamination` | `PBC-5` | — | — | — |
| The LLM cannot invent findings | `PASS` | Renderer is fully deterministic; no provider call on this path | `renderEvent.js`; `ai/providerClient.js` unused by the render path | `architecture.test.js` | — | — | — |

## §6 Free patient questions and current status

| Requirement | Status | Learner-facing evidence | Code evidence | Test evidence | Governance dependency | Exact gap | Required action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| All four contract/task-named phrasings return a snapshot | `PASS` | «что с пациентом сейчас?», «как он сейчас?», «как сейчас боль?», «что по витальным?» all answer | `vocabulary.js#STATUS_QUERY_PATTERNS` | `PBC-6 every contract-named status phrasing` | — | Fixed this pass — the adverb-first order «как сейчас боль?» returned silence | — |
| Short current snapshot, not a re-examination | `PASS` | One line; `observations.examinations` length unchanged | `renderStatus.js#renderStatusSnapshot` | `PBC-6 …neither restarts the examination…` | — | — | — |
| Latest known vitals / findings | `PASS` | «ЧСС 97/мин, АД сист. 128…, T 38 °C. Боль 4.9/10» with staleness note | same | `PBC-6` | — | — | — |
| Relevant pending work | `PASS` | «Ожидают результата: ОАК, СРБ, ОАМ.» | `renderStatus.js`, `eventTypes.js#DISCLOSING_EVENTS` | `PBC-6` | — | Fixed this pass — ordered tests were absent from `revealed.results`, so pending work never appeared, and the ids were raw | — |
| Current location and time | `PASS` | «Прошло 180 мин. Локация: приёмный покой.» | `renderStatus.js` | `PBC-6` | — | — | — |
| Does not consume clinical time | `PASS` | Clock unmoved; only `LEARNER_TURN_RECEIVED` on the log | `submitLearnerTurn.js` early return | `PBC-6`, `session.e2e.test.js` | — | — | — |
| Never converted into an unrelated mentor question | `PASS` | `mentor` null on every status turn | `submitLearnerTurn.js` returns before the mentor step | `PBC-6` | — | — | — |
| Handled as a first-class intent | `PASS` | `intent: REQUEST_CURRENT_STATUS` | `interpretTurn.js` | `PBC-6` | — | — | — |

## §7 Clinical time

| Requirement | Status | Learner-facing evidence | Code evidence | Test evidence | Governance dependency | Exact gap | Required action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| The hospital clock is internal, not wall-clock typing time | `PASS` | 22 turns; clock moves only on authored actions | `core/time/clock.js`, `advanceTime.js` | `PBC-6`, `PBC-10` | — | — | — |
| Normal clinical actions consume authored time where appropriate | `PARTIAL` | Waits, transport and staff arrival consume time | `submitLearnerTurn.js` `consumesMinutes` seam | `PBC-3 transfer consumes…` | — | Examination, history and ordering are instantaneous; only waits, transport and arrivals cost time | Author per-action durations (operational data) if the product wants them |
| Multiple tasks run in parallel | `PASS` | Three orders at the same minute; independent due times | `applyTurn.js#applyCommands` | `PBC-8`, `PBC-7 parallel investigations` | — | — | — |
| Pending work has due times | `PASS` | «Ожидаемое время результата — 70 мин» | `scheduler.js`, `payload.scheduledPending` | `PBC-7` | — | — | — |
| Results surface automatically when due | `PASS` | Labs and CT appear during a wait without being asked for | `advanceTime.js#drainPendingWork` | `PBC-7` | — | — | — |
| Current status does not arbitrarily consume time | `PASS` | See §6 | `submitLearnerTurn.js` | `PBC-6` | — | — | — |
| Transport / procedures / consultant arrival consume time | `PASS` | Transfer 45–150 min; anaesthetist 20 min | `executeCommand.js#TRANSFER`, `#REQUEST_ANESTHESIA_REVIEW` | `PBC-3`, `PBC-16` | — | — | — |
| The same seed reproduces scheduled events | `PASS` | Replay reproduces state exactly | `core/rng.js`, `replayIntegrity.test.js` | `replayIntegrity.test.js` | — | — | — |
| **§7.4 Deterioration interrupts the current task** | `BLOCKED_BY_GOVERNANCE` | Never observed in any session | `EVENT.DETERIORATION_DETECTED` has a reducer case, a renderer case and a scheduler priority — **and no producer anywhere** | — (no test asserts it fires; `PBC-GOV` asserts nothing unapproved moves truth) | No approved trajectory can produce deterioration; no approved threshold exists | The producer is absent *and* the clinical trigger is unapproved. Event type + renderer + reducer existing is **not** the behavior | Review pack §1 (trajectory + deterioration thresholds). **Do not** invent a threshold to close this |

## §8 Orders and treatments

| Requirement | Status | Learner-facing evidence | Code evidence | Test evidence | Governance dependency | Exact gap | Required action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| §8.1 One turn can create several explicit commands | `PASS` | «ОАК, СРБ и ОАМ» → three orders | `interpretTurn.js#splitFragments`, `applyCommands` | `PBC-8 several orders` | — | — | — |
| One order does not become several | `PASS` | «креатинин и электролиты» → one chemistry order | `interpretTurn.js#mergeDuplicateTestOrders` | `PBC-8 the clarification loop works…` | — | Fixed this pass — a bare analyte list split into duplicate orders that overwrote each other | — |
| §8.2 Incomplete medication order is clarified by nurse/staff, not the mentor | `PASS` | «Медсестра: Уточните путь введения.» | `commandTypes.js#validateCommand`, `renderStatus.js#renderClarification` | `PBC-8 …clarified by the NURSE` | — | — | — |
| Answering the clarification completes the original order | `PASS` | «в/м» → «Введено: кетопрофен, 100 мг, внутримышечно.» | `worldState.js#clarification`, `interpretTurn.js#completeFromClarification` | `PBC-8 answering the clarification completes the ORIGINAL order` | — | Fixed this pass — the question was asked and the answer went nowhere, for **every** command type | — |
| The system never guesses a missing parameter | `PASS` | Nothing administered until the route was given | `commandTypes.js#validateCommand` | `PBC-8 an unanswered clarification does not execute anything` | — | — | — |
| §8.3 Incorrect dose/parameter judged only by an approved safety rule | `BLOCKED_BY_GOVERNANCE` | No dose is ever judged | `ruleEngine.js#eligibleRules` gate | `PBC-GOV nothing … is approved_for_training` | All six rules `pending`; no dose approved | Any dose is accepted and recorded unjudged | Review pack §2, §3 |
| §8.4 Infusion requires volume and time/rate (or bolus) | `PASS` | «За какое время или болюсом?» → «за час» → infusion started | `commandTypes.js` XOR check | `PBC-8 the clarification loop…` | — | — | — |
| §8.5 **Immediate procedures execute when adequately ordered** | `FAIL` | «ставлю назогастральный зонд» → **no response at all** | `COMMAND.ORDER_PROCEDURE` and `EVENT.PROCEDURE_PERFORMED` are declared, have a `REQUIRED_PARAMS` entry and a reducer case — **no interpreter path and no handler** | — | Which procedures are modeled, and their effects, is unauthored | The contract's own worked example («Назогастральный зонд установлен.») cannot happen | Author a procedure catalogue; the *execution confirmation* needs no clinical review, any physiological effect does |
| §8.6 Treatment alters the modeled patient | `BLOCKED_BY_GOVERNANCE` | Drug given, recorded, patient unchanged | `executeCommand.js#scheduleGovernedTreatmentEffect` — three gates | `PBC-8 treatment response stays governance-blocked` | Every `(drug, route)` effect `response_envelope: null` | Analgesia, fluids, antibiotics and oxygen all inert | Review pack §2. **Do not** restore the withdrawn `NSAID → pain -3` |

## §9 Investigations

| Requirement | Status | Learner-facing evidence | Code evidence | Test evidence | Governance dependency | Exact gap | Required action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Workflow states: ordered / in progress / preliminary / resulted / unavailable / cancelled | `PARTIAL` | ordered, preliminary, resulted and unavailable all observed | `worldState.js` investigation cases | `PBC-7`, `PBC-3` | — | `waiting`, `in progress`, `delayed` and `cancelled` have reducer cases but no producer — an order goes `ordered` → `preliminary`/`resulted` | Add producers if the product wants the intermediate states surfaced |
| Preliminary radiology report arrives before the formal report | `PASS` | «Рентгенолог: Предварительно…» then the formal report | `buildTestSchedule` two pending items | `PBC-7` | — | Ultrasound's preliminary text is identical to its final text, so the learner reads the same report twice | Author a distinct US preliminary, or drop its preliminary phase |
| Results arrive automatically | `PASS` | See §7 | `advanceTime.js` | `PBC-7` | — | — | — |
| Resource unavailability is a hospital fact | `PASS` | «КТ сейчас недоступна: аппарат на ремонте» | `resourceResolution.js` | `PBC-3` | — | — | — |
| The mentor does not solve the resource choice | `PASS` | Mentor silent on the constraint turn | `mentorEngine.js` has no resource branch | `PBC-23` | — | — | — |
| APP-004: CT is full abdomen/pelvis, not an "appendix test" | `PASS` | Nine organ sections in the rendered report | `phenotypes.yaml#ct_report_ru.sections` | `PBC-9`, `app004Remediation.test.js` 15 | `pending` | — | Review pack §1 |
| APP-004: US is not mandatory before CT | `PASS` | CT ordered first; no challenge | Rule `RULE-US-BEFORE-CT` withdrawn | `PBC-9`, `app004Remediation.test.js` 13 | — | — | — |
| APP-004: nondiagnostic US is not rendered as "negative appendicitis" | `PASS` | «исследование неинформативно в отношении аппендикса» | `phenotypes.yaml#ultrasound_ru` | `PBC-9 a nondiagnostic ultrasound…` | `pending` | — | Review pack §1 |

## §10 Reassessment

| Requirement | Status | Learner-facing evidence | Code evidence | Test evidence | Governance dependency | Exact gap | Required action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Reassessment is a real clinical action | `PASS` | «Переоценка: Переоценены: боль, витальные показатели» | `executeCommand.js#REASSESS` | `PBC-10` | — | — | — |
| **Targets are clarified BEFORE the interval is committed** | `PASS` | «переоценю через 3 часа» → question asked, **clock still 0** | `submitLearnerTurn.js` — the wait is only taken when the command validates | `PBC-10 a reassessment with no stated target is clarified BEFORE any time passes` | — | Fixed this pass — this is the §5.8 defect the task asked about. It **did** violate the contract: three hours were spent, every pending result drained into them, and only then was the question asked | — |
| Once the plan is clear, clinical time advances | `PASS` | Answering «боль и витальные» → clock 0 → 180 min | `applyTimeAdvance` | `PBC-10` | — | The originally stated interval is preserved across the clarification | — |
| The patient evolves during the interval | `BLOCKED_BY_GOVERNANCE` | Vitals identical before and after 180 min | `advanceTime.js#buildProgressionEvents` | `PBC-GOV` | Trajectory `pending` | Time passes; the patient does not change | Review pack §1 |
| Treatment effects and progression are applied | `BLOCKED_BY_GOVERNANCE` | — | same | `PBC-8` | Effects `pending` | — | Review pack §1, §2 |
| New values/findings are returned | `PASS` | Named parameters reported; abdomen re-examined when named | `renderEvent.js#renderReassessment` | `PBC-10 a stated reassessment…` | — | — | — |
| A later abdominal examination is not suppressed as a duplicate | `PASS` | Second «живот» returns the full examination | `worldState.js` appends observations | `PBC-10 a later abdominal examination…` | — | — | — |

## §11 Differential diagnosis and reasoning

| Requirement | Status | Learner-facing evidence | Code evidence | Test evidence | Governance dependency | Exact gap | Required action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| The mentor does not demand a formal differential every turn | `PASS` | Mentor silent across the workup | `mentorEngine.js` | `PBC-22` | — | — | — |
| **The learner can state a working diagnosis / differential** | `FAIL` | «рабочий диагноз - острый аппендицит» and «дифференцирую с почечной коликой» → **no response** | `COMMAND.STATE_REASONING` has a handler and `EVENT.REASONING_STATED` has a reducer case; the interpreter never produces the command | — | — | `state.reasoning.workingDiagnosis` can never be set, so `buildDebrief#buildLearningObjectives` always reports the gap | Add reasoning-statement vocabulary. Capturing the learner's own words needs no clinical review |
| After CT confirmation with no differential shown, the mentor may ask about important alternatives | `BLOCKED_BY_GOVERNANCE` | Never observed | No such branch in `mentorEngine.js` | — | Which alternatives matter is unapproved clinical content | Both the trigger (above) and the content are missing | Review pack §5; do not author alternatives from model memory |
| Once the diagnosis is established, flow moves to management | `PASS` | No repeated diagnostic questioning after CT | `mentorEngine.js` (no such loop) | `PBC-22` | — | — | — |
| Old non-safety omissions may be deferred to debrief | `PASS` | Preop omissions appear in `importantMisses`, not mid-case | `buildDebrief.js#buildMisses` | `PBC-25` | — | — | — |
| The mentor never exposes the hidden diagnosis before learner-visible evidence | `PASS` | Rules keyed to hidden findings stay `unknown` and ineligible | `ruleEngine.js` fail-closed `UNKNOWN` | `ruleEngine.test.js` "mentor-boundary regression" | — | — | — |

## §12 Hospital locations

| Requirement | Status | Learner-facing evidence | Code evidence | Test evidence | Governance dependency | Exact gap | Required action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Location is tracked and explicit | `PASS` | «Локация: приёмный покой» in every status | `worldState.js#location` | `PBC-6`, `PBC-19` | — | — | — |
| Location changes over time | `PASS` | ED → OR → recovery → ward → discharged | `PATIENT_MOVED` | `PBC-19` | — | — | — |
| APP-004 traverses ED → (radiology) → OR → PACU → ward → discharge | `PARTIAL` | ED → OR → recovery → ward → discharge observed | `executeCommand.js#START_PROCEDURE`, `#DISPOSITION` | `PBC-19` | — | The patient never physically goes to **radiology**; imaging happens with the patient in the ED | Model transport to radiology (operational data) if the product wants it |
| Location affects staff availability / monitoring / feasibility | `PARTIAL` | Monitoring level changes with the move; `monitoring.adequacy` derived from location | `worldState.js#deriveMonitoringAdequacy` | `learnerJourney.e2e.test.js` monitoring adequacy | Any *clinical* consequence of location is unapproved | Location changes monitoring bookkeeping but nothing clinical follows from it | Review pack §5 |

## §13 Hospital staff as characters

| Requirement | Status | Learner-facing evidence | Code evidence | Test evidence | Governance dependency | Exact gap | Required action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Nurse, radiologist, anesthesiologist, senior surgeon, ICU physician exist as characters | `PASS` | All five speak in the smokes or resolve via `CALL_STAFF` | `hospitalProfiles.js#staff`, `renderEvent.js#staffLabelRu` | `PBC-23` | — | OR team is a speaker («Операционная») but not a callable role | — |
| Characters have realistic availability / ETA | `PASS` | «Анестезиолог вызван(а), ожидаемое время — 20 мин» | `resourceResolution.js#callStaff` | `PBC-16` | — | — | — |
| Characters speak in natural language, not internal identifiers | `PASS` | «Введено: цефазолин, 2 г, внутривенно.» | `renderEvent.js#renderMedicationAdministered` | `PBC-6` (asserts no raw ids) | — | Fixed this pass — the nurse said «Введено: ketoprofen 100мг im», and the status line listed «cbc» | — |
| Calling a specialist does not pause the patient | `PASS` | Clock and pending work continue; arrival is scheduled | `executeCommand.js#CALL_STAFF` | `PBC-16` | — | — | — |

## §14 Escalation

| Requirement | Status | Learner-facing evidence | Code evidence | Test evidence | Governance dependency | Exact gap | Required action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Calling for help is a valid action | `PASS` | «вызываю старшего хирурга» → «ожидаемое время — 20 мин» | `executeCommand.js#CALL_STAFF` | `PBC-23` | — | — | — |
| The learner retains responsibility until help arrives | `PASS` | Arrival is a scheduled future event; play continues | `advanceTime.js` `staff_arrival` | `PBC-16` | — | — | — |
| Escalation is not penalized | `PASS` | No rule or debrief entry penalises calling | `buildDebrief.js#buildMisses` (content-driven only) | `PBC-25` | — | — | — |
| The system prompts «Что делаешь пока они в пути?» during instability | `NOT_TESTABLE_YET` | — | — | — | Requires deterioration (§7.4) | Cannot arise: no instability can occur | Review pack §1 |

## §15 Consent, refusal, and patient autonomy

| Requirement | Status | Learner-facing evidence | Code evidence | Test evidence | Governance dependency | Exact gap | Required action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Consent can be obtained | `PASS` | «Пациент: Согласие на операцию подписано.» | `executeCommand.js#OBTAIN_CONSENT` | `PBC-16` | — | — | — |
| Data model / command seam for refusal exists | `PARTIAL` | — | `preop.consent` supports `refused`; `EVENT.CONSENT_REFUSED` has a reducer case | — | — | The state seam exists; **no producer** — nothing can ever refuse | Per task §5.11, not implemented in this pass |
| APP-004 actually exercises refusal / autonomy | `NOT_TESTABLE_YET` | Patient always consents | — | — | Capacity assessment and the legal context are unauthored | The first slice does not exercise it | Do not implement here; do not invent legal content |

## §16 Preoperative preparation

| Requirement | Status | Learner-facing evidence | Code evidence | Test evidence | Governance dependency | Exact gap | Required action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `decision to operate ≠ preop ready` | `PASS` | «на операцию» → plan committed, `preop.ready` false | `worldState.js#MANAGEMENT_PLAN_COMMITTED` (readiness untouched) | `PBC-16 committing to operate does not make the patient ready` | — | — | — |
| «идём на операцию» → «Что нужно сделать до операции?» | `PASS` | Mentor asks exactly this, once per case | `mentorEngine.js` committed-plan branch | `PBC-16` | — | — | — |
| Real actions derive readiness | `PASS` | IV access, consent, prophylaxis and anaesthesia review each performed | `worldState.js#derivePreopReady` | `PBC-16 preop readiness derives from real actions` | — | — | — |
| No learner-facing `COMPLETE_PREOP_ITEM` | `PASS` | No such phrasing accepted | — | `PBC-16` asserts the string is absent from the interpreter and vocabulary | — | — | — |
| Hard prerequisites vs important-but-non-blocking are separated | `PASS` | Theatre refused for a blocking item; jurisdictional items caught up by staff | `executeCommand.js` `PREOP_NOT_READY`, `#jurisdictionalCatchUpEvents` | `PBC-16` | Which items are blocking is `hospital_rule`/`clinical_workflow` content | — | Review pack §4 |
| Consent | `PASS` | See above | — | `PBC-16` | Consent *safety rule* `pending` | Consent is a workflow prerequisite; the rule that would teach why is inert | Review pack §5 |
| IV access | `PASS` | «Выполнено: функционирующий периферический венозный доступ.» | `executeCommand.js#ESTABLISH_IV_ACCESS` | `PBC-16` | — | — | — |
| Anesthesia review | `PASS` | Anaesthetist arrives after 20 min and completes the item | `executeCommand.js#REQUEST_ANESTHESIA_REVIEW` | `PBC-16` | — | — | — |
| Antibiotic prophylaxis | `PARTIAL` | «Введено: цефазолин, 2 г, внутривенно» + item completed | `executeCommand.js#GIVE_ANTIBIOTIC_PROPHYLAXIS` | `PBC-16` | Regimen, dose and pre-incision timing all unapproved | Recorded **structurally only** — `timingValidated: false`. Whether the prophylaxis was adequate is judged by nobody | Review pack §3 |
| KZ jurisdictional ABO/Rh | `PASS` | Staff catch-up at the theatre door, labelled as departmental order | `#jurisdictionalCatchUpEvents`, `appliesInJurisdiction` | `app004Remediation.test.js` 29 | `hospital_rule`, KZ only | — | Review pack §4 |
| KZ jurisdictional coagulation | `PASS` | same | same | `app004Remediation.test.js` 30 | same | — | Review pack §4 |
| Fasting / NPO assessment | `PASS` | Learner asks, or the anaesthetist discovers it on arrival | `#ASK_FASTING_HISTORY`, `fasting_discovery` | `PBC-16 fasting status is assessed…` | `fasting_history` `pending` | — | Review pack §4 |
| NPO is **not** a universal emergency-surgery hard stop | `PASS` | `fasting_assessment.blocking === false`; theatre reached with liquid 2 h ago | `operative.yaml` | `PBC-16`, `app004Remediation.test.js` 27 | — | — | — |
| Omitted items appear in the final debrief | `PASS` | `importantMisses` lists uncompleted required items, jurisdiction-labelled | `buildDebrief.js#buildMisses` | `PBC-25` | — | — | — |

## §17 Operative simulation

| Requirement | Status | Learner-facing evidence | Code evidence | Test evidence | Governance dependency | Exact gap | Required action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Fidelity level B: key decisions, no instrument micro-simulation | `PASS` | One decision prompt; no trocar/instrument steps | `operative.yaml#operative_sequence` | `PBC-17` | — | — | — |
| Roughly 2–5 meaningful decisions when authored | `PARTIAL` | APP-004 authors **one** | `operative.yaml#decisions` | `PBC-17` | — | Below the contract's stated range; the engine supports more | Author more decisions, or accept one for an uncomplicated case |
| An adequate answer progresses the operation automatically | `PASS` | Decision → source control → pathology → closure, unprompted | `executeCommand.js#OPERATIVE_DECISION` | `PBC-17` | — | — | — |
| Laparoscopic approach understood contextually | `PASS` | «иду на лапароскопическую аппендэктомию» starts the operation only when preop-ready | `interpretTurn.js` approach branch + `turnContext.preopReady` | `PBC-16` | — | — | — |
| Objective findings remain deterministic | `PASS` | Same seed → same operative finding | `patientGenerator.js` | `replayIntegrity.test.js` | `pending` | — | Review pack §1 |
| «дренаж не ставлю» is negation-safe | `PASS` | Chosen option contains no drain | `interpretTurn.js#wordPresentAndNotNegated` | `PBC-17`, `learnerJourney.e2e.test.js` | — | — | — |
| A routine drain is challenged, not catastrophically blocked | `PASS` | Level-1 rule; execution proceeds | `rules.yaml#RULE-ROUTINE-DRAIN-UNCOMPLICATED` (level 1) | `app004Remediation.test.js` 36 | `pending` — so it does not even challenge | The rule is inert, so a drain draws no comment at all | Review pack §5 |
| Technical boilerplate is not tested as clinical reasoning | `PASS` | Closure statement issued by the system, not asked for | `operative.yaml#closure_statement_ru` | `app004Remediation.test.js` 41 | — | — | — |
| Operative errors are content-driven, no appendicitis branches in core | `PASS` | `executable: false` options recognised and refused generically | `executeCommand.js#OPERATIVE_DECISION` | `architecture.test.js`, `PBC-26` | — | — | — |
| §17.2 Intraoperative surprises | `NOT_TESTABLE_YET` | None occur | Content declares none | — | Unauthored | APP-004 has no surprise authored | Future content; contract says "selectively, not in every case" |

## §18 Four-level clinical error model

| Requirement | Status | Learner-facing evidence | Code evidence | Test evidence | Governance dependency | Exact gap | Required action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Four levels exist as an internal classification | `PASS` (mechanism) | — | `rules/safetyLevels.js` | `commandTypes.test.js` | — | — | — |
| Level labels are never learner-visible | `PASS` | No `LEVEL_` string in any rendered text | `renderEvent.js`, `renderStatus.js` | `PBC-25`, smokes | — | — | — |
| Level 4 requires an approved safety rule | `PASS` (mechanism) | No safety stop ever fires | `executeCommand.js` — `eligibleRules` gates before `blocking` | `app004Remediation.test.js` "a clinically eligible but not-approved rule never becomes authoritative" | Zero rules approved; **no Level 3 or 4 rule is authored at all** | — | Review pack §5 |
| Hard blocks are rare | `PASS` | Zero hard blocks in both smokes | — | smokes | — | Currently zero, because none can fire | — |
| Level 2/3 allow consequence learning where the consequence is modeled | `BLOCKED_BY_GOVERNANCE` | Level-2 rules never challenge | `mentorEngine.js` Level-2 branch is reachable but starved | — | All rules `pending` | The whole teaching layer of §18 is inert | Review pack §5 |
| No deterministic "punishment complication" is invented | `PASS` | No complication is ever scheduled | `complications: []`; `scheduleGovernedComplicationChecks` | `app004Remediation.test.js` 25 | — | — | — |

## §19 Postoperative care and disposition

| Requirement | Status | Learner-facing evidence | Code evidence | Test evidence | Governance dependency | Exact gap | Required action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| The learner decides the destination | `PASS` | «Куда переводим пациента?» → «в палату пробуждения» | `renderEvent.js#PROCEDURE_COMPLETED`, `#DISPOSITION` | `PBC-19` | — | — | — |
| The patient actually moves there | `PASS` | `location` → `recovery` → `surgical_ward` | `worldState.js#PATIENT_MOVED` | `PBC-19` | — | — | — |
| The learner decides monitoring | `PASS` | «vitals каждые 4 часа» recorded alongside the move | `#PRESCRIBE_MONITORING` | `PBC-19` | — | — | — |
| "Discharge from the operating table" cannot recur | `PASS` | Refused: «пациент ещё не переведён из операционной/палаты пробуждения» | `executeCommand.js#STRUCTURAL_DISCHARGE_CHECKS.left_theatre_and_recovery` | `PBC-24 the patient cannot be discharged from the operating table` | — | — | — |
| A discharge refusal states the real blocker | `PASS` | «запланированная операция ещё не выполнена» | `complications.yaml#discharge_criteria.operation_completed.learner_reason_ru` | `PBC-24 a discharge refusal states the real blocker, not its opposite` | — | Fixed this pass — it read «Выписать сейчас нельзя: операция завершена», the opposite of the truth | — |
| Postoperative pain is separate from preoperative pain | `PASS` | Status says postoperative pain is not modeled rather than reporting the old value | `painState.js`, `renderStatus.js#painLineRu` | `painProvenance.test.js` | `post_source_control_course` `pending` | The postoperative pain **value** does not exist | Review pack §2 |
| Oral intake workflow | `PASS` | «Разрешена жидкость перорально.» | `#ORDER_ORAL_INTAKE` | `app004Remediation.test.js` PO05 | `reviewed_internal` | Recorded; no physiological consequence modeled | Review pack §5 |
| Ward monitoring | `PASS` | Prescribed and recorded; adequacy derived | `deriveMonitoringAdequacy` | `PBC-19` | — | Adequacy has no clinical consequence (deliberately — matrix T07/PO09) | — |
| Same-day / next-day discharge is possible | `PASS` | Discharged at 700 min (~11.7 h) | No minimum-stay check exists | `app004Remediation.test.js` 40 | — | — | — |
| No mandatory postoperative CBC | `PASS` | Discharge granted without one | — | `app004Remediation.test.js` 23 | — | — | — |
| No routine postoperative antibiotics | `PASS` | None administered by the system | — | `app004Remediation.test.js` 24 | — | — | — |
| No 24 h ritual requirement | `PASS` | — | — | `app004Remediation.test.js` 40 | — | — | — |
| A high-risk patient sent to low monitoring deteriorates late | `BLOCKED_BY_GOVERNANCE` | Never occurs | — | — | Deterioration unapproved (§7.4) | The §19 worked example cannot happen | Review pack §1 |
| **Clinical discharge readiness is evaluated** | `BLOCKED_BY_GOVERNANCE` | Discharge granted on structural criteria only; the withholding is logged | `executeCommand.js#evaluateDischargeReadiness` — clinical criteria skipped and recorded | `PBC-25`, `app004Remediation.test.js` "clinical discharge readiness is governance-blocked and SAYS so" | All five clinical criteria `pending` | A patient can be discharged with no clinical readiness check at all | Review pack §5 — **release blocker** |

## §20 Postoperative time and complications

| Requirement | Status | Learner-facing evidence | Code evidence | Test evidence | Governance dependency | Exact gap | Required action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Cases evolve over hours and days | `PARTIAL` | Clock reached 700 min; `postop.day` never advances | `advanceTime.js` | `PBC-19` | Trajectory `pending` | Time passes; nothing postoperative evolves | Review pack §1 |
| Realistic complication risk from disease/operation/patient/course | `BLOCKED_BY_GOVERNANCE` | No complication ever occurs | `scheduleGovernedComplicationChecks` — iterates content, schedules nothing | `app004Remediation.test.js` 25 | `complications: []` by explicit review decision | APP-004 has no approved complication | Future content with reviewed incidence; **do not** invent one |
| Correct care does not guarantee a complication-free outcome | `NOT_TESTABLE_YET` | — | Probability path exists and is gated | `app004Remediation.test.js` 26 | — | Cannot be exercised with an empty complication set | — |
| A poor decision does not always create the same complication | `PASS` (mechanism) | — | Seeded `rng.stream("complications").chance()` | `rng.test.js` | — | — | — |

## §21 Personalized case variation

| Requirement | Status | Learner-facing evidence | Code evidence | Test evidence | Governance dependency | Exact gap | Required action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Adapt future cases from longitudinal history | `OUT_OF_SCOPE_BY_CURRENT_CONTRACT` | — | No account or history store | — | — | The contract conditions this on user accounts, which do not exist and are explicitly out of scope for this task | None in this pass |
| Personalization must not disclose the hidden algorithm | `NOT_TESTABLE_YET` | — | — | — | — | Nothing to disclose | — |

## §22 Mentor intervention policy

| Requirement | Status | Learner-facing evidence | Code evidence | Test evidence | Governance dependency | Exact gap | Required action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Intervenes for danger | `BLOCKED_BY_GOVERNANCE` | Never fires | `mentorEngine.js` SAFETY_STOP branch | — | No approved Level 3/4 rule exists | The branch is correct and starved | Review pack §5 |
| Intervenes for a major current reasoning error | `BLOCKED_BY_GOVERNANCE` | Never fires | Level-2 CHALLENGE branch | — | All rules `pending` | same | Review pack §5 |
| Intervenes on a genuine dead-end / «не знаю» | `PASS` | Four escalating replies | `mentorEngine.js` STUCK branch | `PBC-22 the scaffolding ladder` | — | — | — |
| Does not interrupt because a rubric field is missing | `PASS` | Silent across a competent workup | — | `PBC-22 the mentor stays silent` | — | — | — |
| §22.1 Ladder has four distinct stages | `PASS` | Four different texts, increasing in support | `SCAFFOLD_PROMPTS_RU` | `PBC-22 …four genuinely distinct rungs` | — | Rungs are reasoning scaffolds only — they state no clinical content, by design | — |
| Question context persists across turns | `PASS` | The preop question survives to be answered next turn | `worldState.js#mentor.openQuestion` | `PBC-22 an open mentor question…` | — | — | — |
| An open mentor question does not swallow clinical orders | `PASS` | Answering the mentor executed three orders | `interpretTurn.js` | `PBC-22` | — | — | — |
| §22.2 The mentor can acknowledge a defensible alternative | `BLOCKED_BY_GOVERNANCE` | Never observed | No acknowledgement branch | — | What counts as defensible is unapproved | Neither the branch nor the content exists | Review pack §5 |
| The mentor can correct itself / not defend an old error | `NOT_TESTABLE_YET` | — | Stateless per-turn decision; nothing to defend | — | — | Cannot arise while the mentor makes no clinical claims | Re-audit once rules are approved |
| §22.3 More than one correct pathway is supported | `PASS` (mechanism) | Open surgery allowed, only asked to justify | `mentorEngine.js` open-approach branch states a resource fact, not a claim | `app004Remediation.test.js` 34 | — | — | — |
| Occasional reinforcement of competent work | `FAIL` | Never occurs | `mentorEngine.js` REINFORCE branch reads `state.mentor.silentTurns`, which **nothing ever increments** | — | — | Dead branch. Note the current behavior (never reinforcing) is *more* contract-compliant than a chatty mentor | Either increment `silentTurns` or delete the branch. Recommend deleting |

## §23 Mentor versus hospital characters

| Requirement | Status | Learner-facing evidence | Code evidence | Test evidence | Governance dependency | Exact gap | Required action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Missing medication route → nurse | `PASS` | «Медсестра: Уточните путь введения.» | `renderStatus.js#CLARIFY_SPEAKER_RU` | `PBC-23` | — | — | — |
| Missing lab parameter → laboratory | `PASS` | «Лаборатория: Какие показатели биохимии нужны?» | `clarifyBy: "laboratory"` | `PBC-23` | — | — | — |
| Preliminary scan → radiologist | `PASS` | «Рентгенолог: Предварительно…» | `renderEvent.js#staffForTest` | `PBC-23` | — | — | — |
| OR / resource state → hospital staff or system | `PASS` | «Система: КТ сейчас недоступна…»; «Операционная: Пациент ещё не готов…» | `renderStatus.js` | `PBC-23` | — | — | — |
| Clinical reasoning gap → mentor | `PASS` | «Наставник: Что нужно сделать до операции?» | `mentorEngine.js` | `PBC-16` | — | — | — |
| The mentor never absorbs routine hospital operations | `PASS` | `mentor` null on all four operational turns | `mentorEngine.js` CLARIFY branch returns `delegateToStaff` | `PBC-23` | — | — | — |

## §24 Case termination

| Requirement | Status | Learner-facing evidence | Code evidence | Test evidence | Governance dependency | Exact gap | Required action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Safe discharge is a terminal state | `PASS` | Reference smoke ends `PATIENT_DISCHARGED` at 700 min | `#DISCHARGE`, `TERMINAL_EVENTS` | `PBC-19` | — | — | — |
| Safe transfer is a terminal state | `PASS` | Real smoke ends `PATIENT_TRANSFERRED` at 165 min | `#TRANSFER` | `PBC-24 safe transfer is reachable in the natural first person` | — | Fixed this pass — the Cyrillic `\w` trap made every inflected phrasing dead, so only the bare infinitive worked | — |
| Death is a terminal state | `NOT_TESTABLE_YET` | — | `PATIENT_DIED` reducer, renderer and terminal handling exist; no producer | — | Requires deterioration (§7.4) | Cannot occur | Review pack §1 |
| Ending early marks the case incomplete | `PASS` | «завершить кейс» → `status: incomplete` | `#END_CASE` | `PBC-24 ending the case early…` | — | — | — |
| Diagnostic confirmation alone ≠ completion | `PASS` | CT resulted; case active | — | `PBC-24 completing the operation does not end the case` | — | — | — |
| Surgery alone ≠ completion | `PASS` | Operation completed; case still active | — | `PBC-24` | — | — | — |
| APP-004 discharge occurs only after real postoperative location/workflow | `PASS` | Discharge refused from theatre and from recovery | `STRUCTURAL_DISCHARGE_CHECKS` | `PBC-24` | — | — | — |

## §25 Debrief

| Requirement | Status | Learner-facing evidence | Code evidence | Test evidence | Governance dependency | Exact gap | Required action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Distinguishes what the learner chose | `PASS` | `observedBehavior` with timestamps and command ids | `buildDebrief.js#buildObservedBehavior` | `PBC-28` | — | — | — |
| Distinguishes what the system executed | `PASS` | `COMMAND_ACCEPTED` trail in the export | `submitLearnerTurn.js` trail events | `PBC-28` | — | — | — |
| Distinguishes what was blocked / clarified | `PASS` | `CLARIFICATION_REQUESTED` / `COMMAND_REJECTED` in the export | same | `PBC-28` | — | — | — |
| Distinguishes what happened to the patient | `PASS` | `consequences` with per-event attribution | `#buildConsequences` | — | Nothing happens to the patient yet | Category correct, currently empty | Review pack §1 |
| Distinguishes resource constraint | `PASS` | `resourceLimitations` with an explicit "not a learner error" note | `#buildResourceLimitations` | `PBC-25 a resource constraint…` | — | — | — |
| Distinguishes simulator / governance limitation | `PASS` | `simulatorLimitations`, grouped, each labelled a platform limitation | `#buildSimulatorLimitations` | `PBC-25 a simulator limitation is never presented as a learner omission` | — | — | — |
| Distinguishes the reference pathway | `BLOCKED_BY_GOVERNANCE` | «Сравнение с эталонным маршрутом не приводится…» | `#buildReferenceComparison` | `PBC-25 no clinical correction is asserted…` | Zero approved rules | No reference comparison is possible | Review pack §3, §5 |
| A simulator limitation is never a learner error | `PASS` | Categories structurally disjoint | `buildDebrief.js` | `PBC-25` (asserts no overlap) | — | — | — |
| Every clinical correction traces to an approved rule and source | `PASS` | No correction is made at all | `#buildMisses` is content-driven only | `PBC-25` | — | Vacuously true today; must be re-audited once rules are approved | Re-audit at promotion |
| Does not penalize site marking | `PASS` | Absent from content and debrief | `operative.yaml` (withdrawn) | `PBC-25 …never penalises the items clinical review explicitly removed` | — | — | — |
| Does not penalize routine Foley omission | `PASS` | same | same | `PBC-25`, `app004Remediation.test.js` 22 | — | — | — |
| Does not penalize routine postop CBC omission | `PASS` | same | same | `app004Remediation.test.js` 23 | — | — | — |
| Does not penalize absent LMWH solely because surgery occurred | `PASS` | same | `RULE-LMWH-REQUIRED` withdrawn | `PBC-25` | — | — | — |
| Does not penalize simulator-unsupported drug/content | `PASS` | Unsupported orders are limitations, not misses | `buildDebrief.js` | `PBC-25` | — | — | — |
| No numeric competence score | `PASS` | No score field | `buildDebrief.js` | `PBC-25` | — | — | — |
| The build states its own governance status | `PASS` | `contentGovernance.patientTruthApproved: false`, `pilotReady: false` | `#buildContentGovernance` | `PBC-25 no clinical correction…` | — | — | — |

## §26 Generalization requirement

| Requirement | Status | Learner-facing evidence | Code evidence | Test evidence | Governance dependency | Exact gap | Required action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Core has no appendicitis-specific branches | `PASS` structurally | — | `src/core/**`, `src/ai/**` swept mechanically | `architecture.test.js`, `PBC-26` | — | — | — |
| Content drives operative decisions and complication scheduling | `PASS` | Operative options matched against `operative.yaml#matches_ru` | `executeCommand.js#OPERATIVE_DECISION`, `#scheduleGovernedComplicationChecks` | `PBC-17`, `app004Remediation.test.js` | — | — | — |
| No operation name in the interpreter vocabulary | `PASS` | — | `vocabulary.js` | `PBC-17 no operation name appears…` | — | — | — |
| An architecture test enforces it | `PASS` | — | `core/architecture.test.js` | `PBC-26` (asserts the sweep still exists) | — | — | — |
| A second disease costs only content | `NOT_TESTABLE_YET` | — | — | — | — | **The empirical second-disease test has not been performed.** Structural absence of disease-specific logic is necessary, not sufficient | Add a second disease module in a later workstream; out of scope here |

## §27 Relationship to existing specifications

| Requirement | Status | Learner-facing evidence | Code evidence | Test evidence | Governance dependency | Exact gap | Required action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Interpreted together with North Star, Governance Spec, Mentor Spec | `PASS` | — | Governance gate implements the Governance Spec; mentor implements the Mentor Spec | `PBC-GOV`, `mentorEngine.test.js` | — | — | — |
| The contract guides where legacy behavior conflicts | `PASS` | Six conflicts found and resolved in the contract's favour this pass | See the completion report §C | `PBC-6`, `PBC-8`, `PBC-10`, `PBC-13`, `PBC-19`, `PBC-24` | — | — | — |
| The contract is in the repository, unedited, hashed | `PASS` | — | `docs/contracts/` + `CONTRACT_INDEX.md` | `PBC-0` (×2) | — | — | — |

## §28 Acceptance experience

| Requirement | Status | Learner-facing evidence | Code evidence | Test evidence | Governance dependency | Exact gap | Required action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| "I could examine, ask, order, treat, wait, reassess, operate, call for help" | `PARTIAL` | All verbs reachable **except** free-form asking (§5.2) and procedures (§8.5) | — | Reference smoke | — | Two of the contract's own verbs produce silence | See §5.2 and §8.5 rows |
| "…make mistakes and see what happened" | `BLOCKED_BY_GOVERNANCE` | No mistake produces any consequence | — | — | Rules, trajectory, effects and complications all `pending` | The consequence half of the product does not run | Review pack §1, §2, §5 |
| "The hospital had real constraints" | `PASS` | Real smoke | — | `PBC-3` | — | — | — |
| "The patient changed over time" | `BLOCKED_BY_GOVERNANCE` | The patient does not change | — | `PBC-GOV` | Trajectory `pending` | — | Review pack §1 |
| "The senior surgeon mostly let me work, but stepped in when it mattered" | `PARTIAL` | Mostly silent — verified. "Stepped in when it mattered" is unverifiable | — | `PBC-22` | Rules `pending` | Silence is real; the intervention half cannot fire | Review pack §5 |
| Not "I learned which sequence of phrases makes the simulator advance" | `PARTIAL` | Clarifications now accept answers; transfer and status phrasings widened | `interpretTurn.js` | `PBC-8`, `PBC-6`, `PBC-24` | — | **An unrecognised turn still produces complete silence**, which teaches phrase-guessing. The learner cannot tell "understood, nothing to say" from "not understood" | Add an explicit non-comprehension response. This is a product decision (it must not be confused with a reasoning statement — see §11) and was deliberately not taken unilaterally in this pass |

---

## Tally

Counted mechanically from this file's own requirement rows, not estimated.

| status | count |
| --- | --- |
| `PASS` | 165 |
| `PARTIAL` | 18 |
| `FAIL` | 4 |
| `BLOCKED_BY_GOVERNANCE` | 18 |
| `NOT_TESTABLE_YET` | 8 |
| `OUT_OF_SCOPE_BY_CURRENT_CONTRACT` | 2 |
| **total substantive requirements** | **215** |

Rows per contract section: §1 4 · §2 5 · §3 25 · §4 6 · §5 9 · §6 8 · §7 9 ·
§8 9 · §9 8 · §10 7 · §11 6 · §12 4 · §13 4 · §14 4 · §15 3 · §16 14 · §17 10 ·
§18 6 · §19 14 · §20 4 · §21 2 · §22 11 · §23 6 · §24 7 · §25 16 · §26 5 ·
§27 3 · §28 6.

No overall percentage is given, deliberately: a `PASS` on "the nurse asks for
the missing route" and a `BLOCKED_BY_GOVERNANCE` on "treatment changes the
patient" are not commensurable, and averaging them would produce exactly the
false readiness signal this audit exists to prevent.

## The four `FAIL` rows, in one place

None of these needs clinical review to *diagnose*; two need content authoring
to *fix*.

1. **§5.2 free-form patient questions** — four of the contract's own examples
   return nothing. `ASK_PATIENT` / `PATIENT_QUESTION_ANSWERED` are declared and
   unimplemented.
2. **§8.5 immediate procedures** — the contract's own NG-tube example cannot
   happen. `ORDER_PROCEDURE` / `PROCEDURE_PERFORMED` are declared and
   unimplemented.
3. **§11 stating a working diagnosis or differential** — `STATE_REASONING` has
   a handler and a reducer case but no interpreter path, so learner reasoning
   is never captured and the debrief always reports it missing.
4. **§22 occasional reinforcement** — dead branch (`silentTurns` is never
   incremented). Recommend deleting rather than activating.

These were **not** fixed in this pass. (1) and (2) require authoring new
content (which patient facts are askable; which procedures exist and what they
do), which is beyond "fix direct violations that need no unresolved clinical
content". (3) is cheap but its useful half — the mentor's post-CT differential
challenge — depends on unapproved content, so implementing capture alone would
produce a field nothing reads. (4) is a deletion, and deleting mentor behavior
during a compliance pass is a product decision, not a bug fix.

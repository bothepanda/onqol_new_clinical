# Product Behavior Contract — test coverage map

**Date:** 2026-08-25
**Contract:** `docs/contracts/ONQOL_PRODUCT_BEHAVIOR_CONTRACT_v1.0_2026-08-22.md`
**Suite:** `src/tests/productBehaviorContract.test.js` (50 tests)
**Whole repository:** 219 tests, all passing

## The distinction this document exists to make

The audit's evidence standard (task §4) is that a unit-tested internal
mechanism is **not** proof of a learner behavior. This map therefore records,
per requirement, whether the test drives the **real learner path**
(`submitLearnerTurn` with ordinary Russian, assertions on rendered text) or
only an internal mechanism.

| column value | meaning |
| --- | --- |
| `learner path` | Russian text in → interpreter → validation → domain → time/events → renderer → assertion on what the learner reads |
| `learner path (state)` | Russian text in through the same pipeline, but the assertion is on world state rather than rendered prose |
| `mechanism` | the function is tested directly; no learner path is exercised |
| `content` | asserts a property of the compiled content bundle |
| `architecture` | asserts a structural property of the source tree |

Where a row says `mechanism` or nothing at all, that is the honest limit of
what the suite proves.

---

## §0 Contract sync

| contract requirement | test name | learner path exercised | status | remaining gap |
| --- | --- | --- | --- | --- |
| Contract file present at the canonical path, unedited | `PBC-0 the Product Behavior Contract is in the repo…` | `content` — hash + all 28 section headings | covered | — |
| Contract hash recorded in the index | `PBC-0 the contract index records the canonical path and the same hash` | `content` | covered | — |

## §3 Two hospital modes

| contract requirement | test name | learner path exercised | status | remaining gap |
| --- | --- | --- | --- | --- |
| Constraint disclosed only on contact; sidebar updates | `PBC-3 a resource constraint is disclosed only when the learner runs into it` | `learner path` — «КТ ОБП» → rendered refusal, then sidebar | covered | — |
| Resources do not alter biology | `PBC-3 a missing resource does not change the patient's biology` | `mechanism` — two sessions, same seed, deep-equal truth | covered | Deliberately mechanism: the point is that nothing observable *should* differ |
| Transfer consumes authored transport time | `PBC-3 interfacility transfer consumes the authored transport time` | `learner path` — two profiles, rendered ETA and arrival | covered | — |
| Dynamic events deterministic / replayable | `PBC-3 the same seed reproduces the same constraint draw and the same patient`; `replayIntegrity.test.js` (8) | `mechanism` + full-log replay | covered | — |
| Mentor does not solve the resource problem | `PBC-3`, `PBC-23` | `learner path` | covered | — |
| Reference mode capability set | — | — | **mechanism only** | No test asserts each Reference capability individually; they are exercised incidentally by the Reference smoke |
| "Anesthesiologist occupied" constraint archetype | — | — | **not covered** | Archetype not implemented (see compliance map §3.2) |

## §4 How a case starts

| contract requirement | test name | learner path exercised | status | remaining gap |
| --- | --- | --- | --- | --- |
| Presentation category + EMS handoff + initial vitals | `PBC-4 the case opens as a presentation category…` | `learner path` — asserts the rendered handoff | covered | — |
| Hidden diagnosis / phenotype / severity not disclosed | `PBC-4` | `learner path` — asserts absence of `аппендицит`, `retrocecal`, `TRJ-…` in handoff **and** the learner-visible projection | covered | — |
| Not proven by a fixture that instantiates the disease | `PBC-4` starts from a seed and `casePresetId` only | `learner path` | covered | — |

## §5 History and examination

| contract requirement | test name | learner path exercised | status | remaining gap |
| --- | --- | --- | --- | --- |
| «осмотрю пациента» → clarify → «живот» → complete exam, no ritual | `PBC-5 «осмотрю пациента» asks what is examined…` | `learner path` — asserts inspection, palpation, peritoneal signs and auscultation in one rendered turn | covered | — |
| Universal normal layer; does not overwrite abnormalities | `PBC-5 the universal normal layer…` | `learner path` | covered | — |
| General history returns the relevant bundle | `PBC-5 a general history request…` | `learner path` | covered | — |
| Male patient never carries LMP/pregnancy content | `app004Remediation.test.js` 9 | `content` + generator | covered | — |
| **Free-form focused patient questions** | — | — | **not covered** | `FAIL` in the compliance map — the behavior does not exist, so there is nothing to test. No test was written to assert the failure, deliberately: the gap belongs in the audit, not as a pinned-in expectation |

## §6 Current status

| contract requirement | test name | learner path exercised | status | remaining gap |
| --- | --- | --- | --- | --- |
| All four named phrasings return a snapshot | `PBC-6 every contract-named status phrasing returns a current snapshot` | `learner path` — loops all four, asserts rendered snapshot each time | covered | — |
| Snapshot carries vitals, location, pending work | `PBC-6` | `learner path` — asserts Russian test labels and no raw ids | covered | — |
| Does not restart the examination | `PBC-6 a status request neither restarts…` | `learner path (state)` | covered | — |
| Does not consume clinical time | `PBC-6`; `session.e2e.test.js` "REQUEST_STATUS never mutates state" | `learner path (state)` + `mechanism` | covered | — |
| Never converted into a mentor question | `PBC-6` | `learner path` | covered | — |

## §7 Clinical time

| contract requirement | test name | learner path exercised | status | remaining gap |
| --- | --- | --- | --- | --- |
| Results arrive automatically when due | `PBC-7 ordered results arrive on their own when due…` | `learner path` — asserts the result text appears unprompted | covered | — |
| Parallel investigations complete at their own times | `PBC-7`; `learnerJourney.e2e.test.js` | `learner path (state)` | covered | — |
| Preliminary before formal | `PBC-7 a preliminary radiology report…` | `learner path` — asserts «Рентгенолог: Предварительно» and event ordering | covered | — |
| Clock is internal, not wall-clock | `PBC-6`, `PBC-10` | `learner path (state)` | covered | — |
| Transport / arrival consume time | `PBC-3`, `PBC-16` | `learner path` | covered | — |
| Same seed reproduces scheduled events | `replayIntegrity.test.js` | `mechanism` | covered | — |
| **§7.4 Deterioration interrupts the current task** | — | — | **not covered** | `BLOCKED_BY_GOVERNANCE`. No test asserts deterioration fires, because it cannot, and writing one would require inventing a threshold (task §7 forbids this) |

## §8 Orders and treatments

| contract requirement | test name | learner path exercised | status | remaining gap |
| --- | --- | --- | --- | --- |
| Several orders in one message | `PBC-8 several orders in one message all execute` | `learner path` | covered | — |
| One order does not become several | `PBC-8 the clarification loop works for every clarifying character` | `learner path` — asserts one command from «креатинин и электролиты» | covered | — |
| Incomplete medication order → nurse | `PBC-8 an incomplete medication order is clarified by the NURSE` | `learner path` — asserts the speaker | covered | — |
| Answering the clarification completes the original order | `PBC-8 answering the clarification completes the ORIGINAL order` | `learner path` — asserts dose from turn 1 survived | covered | — |
| Clarification loop across command types and speakers | `PBC-8 the clarification loop works for every clarifying character` | `learner path` — infusion + laboratory | covered | — |
| Nothing executes on an unanswered clarification | `PBC-8 an unanswered clarification does not execute anything` | `learner path (state)` | covered | — |
| Infusion volume + duration/bolus required | `PBC-8`; `commandTypes.test.js` | `learner path` + `mechanism` | covered | — |
| Unsupported ≠ unavailable | `PBC-8 an unsupported medication is never reported as a hospital stock-out` | `learner path` — asserts the rendered wording contains no stock-out language | covered | — |
| §8.6 Treatment alters the patient | `PBC-8 treatment response stays governance-blocked rather than invented` | `learner path (state)` — asserts the drug **was** given and the patient **did not** move | covered as a **guard**, not as a working behavior | The behavior is `BLOCKED_BY_GOVERNANCE`; this test exists to fail if someone fills the gap without a review |
| §8.3 Unsafe dose judged by an approved rule | — | — | **not covered** | No approved rule exists |
| **§8.5 Immediate procedures** | — | — | **not covered** | `FAIL` — not implemented |

## §9 Investigations

| contract requirement | test name | learner path exercised | status | remaining gap |
| --- | --- | --- | --- | --- |
| CT is a full abdomen/pelvis report | `PBC-9 CT is a full abdomen/pelvis report…` | `learner path` — asserts six organ sections in the rendered report | covered | — |
| No prior ultrasound required | `PBC-9`; `app004Remediation.test.js` 13 | `learner path` | covered | — |
| Nondiagnostic US is not a negative study | `PBC-9 a nondiagnostic ultrasound…` | `learner path` | covered | — |
| No invented appendix diameter / appendicolith | `app004Remediation.test.js` 16, 17 | `content` + `learner path` | covered | — |
| Resource unavailability is a hospital fact | `PBC-3` | `learner path` | covered | — |
| Workflow states `waiting` / `in progress` / `delayed` / `cancelled` | — | — | **not covered** | Reducer cases exist with no producer (compliance map §9) |

## §10 Reassessment

| contract requirement | test name | learner path exercised | status | remaining gap |
| --- | --- | --- | --- | --- |
| **Targets clarified before the interval is committed** | `PBC-10 a reassessment with no stated target is clarified BEFORE any time passes` | `learner path` — asserts clock still 0 **and** the pending result was not drained | covered | Primary regression for the §5.8 defect |
| Stated interval preserved across the clarification | `PBC-10` (second half) | `learner path` | covered | — |
| Reassessment advances time and reports named parameters | `PBC-10 a stated reassessment advances time…` | `learner path` — asserts the abdomen is re-examined, not the generic normal layer | covered | — |
| A later abdominal exam is not deduplicated | `PBC-10 a later abdominal examination…`; `worldState.test.js` | `learner path` | covered | — |
| The patient evolves during the interval | — | — | **not covered** | `BLOCKED_BY_GOVERNANCE`; `PBC-GOV` asserts the opposite as a guard |

## §11 Reasoning

| contract requirement | test name | learner path exercised | status | remaining gap |
| --- | --- | --- | --- | --- |
| Mentor does not demand a differential every turn | `PBC-22 the mentor stays silent across competent turns` | `learner path` | covered | — |
| Mentor never exposes the hidden diagnosis early | `ruleEngine.test.js` "mentor-boundary regression" | `mechanism` — fail-closed `UNKNOWN` | covered | **Mechanism only.** No learner-path test drives a rule keyed to a hidden finding, because no rule is approved |
| **Learner can state a working diagnosis / differential** | — | — | **not covered** | `FAIL` — no interpreter path |
| Post-CT differential challenge | — | — | **not covered** | `BLOCKED_BY_GOVERNANCE` |

## §12 / §13 / §14 Location, staff, escalation

| contract requirement | test name | learner path exercised | status | remaining gap |
| --- | --- | --- | --- | --- |
| Location progresses OR → recovery → ward before discharge | `PBC-19 the patient physically traverses theatre, recovery and ward` | `learner path (state)` + rendered moves | covered | Radiology is never entered (compliance map §12) |
| Each problem answered by the right character | `PBC-23 each kind of problem is answered by the right character` | `learner path` — asserts four speakers and mentor silence on all four | covered | — |
| Characters speak natural language, not internal ids | `PBC-6` (asserts no `cbc`/`ct_abdomen` reaches the learner) | `learner path` | covered | No test asserts the *drug* label directly; `PBC-8 answering the clarification` asserts the state, and the smokes show «Введено: кетопрофен, 100 мг, внутримышечно» |
| Calling a specialist does not pause the patient | `PBC-16` (anaesthetist ETA then arrival) | `learner path` | covered | — |
| Escalation is not penalized | `PBC-25 …never penalises…` | `learner path (state)` | partial | No test calls a senior and then checks the debrief specifically |
| §14 "Что делаешь пока они в пути?" during instability | — | — | **not covered** | Requires deterioration |

## §15 Patient autonomy

| contract requirement | test name | learner path exercised | status | remaining gap |
| --- | --- | --- | --- | --- |
| Consent obtainable | `PBC-16` | `learner path` | covered | — |
| Refusal / autonomy | — | — | **not covered** | `NOT_TESTABLE_YET` — state seam exists, no producer. Deliberately not implemented (task §5.11) |

## §16 Preoperative preparation

| contract requirement | test name | learner path exercised | status | remaining gap |
| --- | --- | --- | --- | --- |
| Operative commitment ≠ preop readiness | `PBC-16 committing to operate does not make the patient ready for theatre` | `learner path` — asserts the theatre refuses, in the theatre's voice | covered | — |
| Readiness derives from real actions | `PBC-16 preop readiness derives from real actions…` | `learner path` | covered | — |
| No learner-facing `COMPLETE_PREOP_ITEM` | `PBC-16` | `architecture` — asserts the string is absent from interpreter and vocabulary | covered | — |
| Mentor asks "Что нужно сделать до операции?" | `PBC-16` | `learner path` | covered | — |
| Fasting assessed; NPO is not a hard stop | `PBC-16 fasting status is assessed…`; `app004Remediation.test.js` 27 | `learner path` + `content` | covered | — |
| KZ ABO/Rh and coagulation are jurisdictional | `app004Remediation.test.js` 29, 30 | `learner path (state)` + `content` | covered | — |
| Prophylaxis timing validity | — | — | **not covered** | `PARTIAL` — recorded with `timingValidated: false`; no approved timing content |

## §17 Operative simulation

| contract requirement | test name | learner path exercised | status | remaining gap |
| --- | --- | --- | --- | --- |
| Level-B decision, content-matched, negation-safe | `PBC-17 an operative decision is matched from content's own phrasings, negation included` | `learner path` — asserts the recorded choice contains no drain | covered | — |
| Adequate answer progresses the operation automatically | `PBC-17` | `learner path` | covered | — |
| No operation name in core / AI | `PBC-17 no operation name appears…`; `architecture.test.js` | `architecture` | covered | — |
| Routine drain challenged, not blocked | `app004Remediation.test.js` 36 | `learner path (state)` | covered | The rule is inert, so no challenge actually appears |
| 2–5 meaningful decisions | — | — | **not covered** | APP-004 authors one (compliance map §17) |
| Intraoperative surprises | — | — | **not covered** | None authored |

## §18 Four-level safety model

| contract requirement | test name | learner path exercised | status | remaining gap |
| --- | --- | --- | --- | --- |
| Unapproved rule never becomes authoritative | `app004Remediation.test.js` "a clinically eligible but not-approved rule never becomes authoritative" | `mechanism` | covered | — |
| Blocked rules are recorded, not dropped | `app004Remediation.test.js` "governance-blocked rules are recorded as simulator limitations" | `mechanism` | covered | — |
| Level labels never learner-visible | `PBC-25`, both smokes | `learner path` | covered | — |
| No invented punishment complication | `app004Remediation.test.js` 25, 26 | `content` + `mechanism` | covered | — |
| Level 2/3 consequence learning | — | — | **not covered** | `BLOCKED_BY_GOVERNANCE` — all rules `pending` |

## §19 / §24 Postoperative disposition and termination

| contract requirement | test name | learner path exercised | status | remaining gap |
| --- | --- | --- | --- | --- |
| Learner chooses destination; patient moves there | `PBC-19` | `learner path` | covered | — |
| Discharge impossible from the operating table | `PBC-24 the patient cannot be discharged from the operating table` | `learner path` — asserts the rendered refusal | covered | — |
| Discharge refusal states the real blocker | `PBC-24 a discharge refusal states the real blocker, not its opposite` | `learner path` — asserts the inverted wording is gone | covered | — |
| Surgery alone does not end the case | `PBC-24 completing the operation does not end the case` | `learner path (state)` | covered | — |
| Safe discharge terminal state | `PBC-19` | `learner path` | covered | — |
| Safe transfer terminal state, natural phrasings | `PBC-24 safe transfer is reachable in the natural first person` | `learner path` — four phrasings | covered | — |
| Early end marks the case incomplete | `PBC-24 ending the case early marks it incomplete` | `learner path (state)` | covered | — |
| No mandatory postop CBC / antibiotics / 24 h | `app004Remediation.test.js` 23, 24, 40 | `learner path (state)` + `content` | covered | — |
| Death as a terminal state | — | — | **not covered** | Requires deterioration |
| Clinical discharge readiness evaluated | `app004Remediation.test.js` "clinical discharge readiness is governance-blocked and SAYS so" | `learner path (state)` | covered as a **guard** | `BLOCKED_BY_GOVERNANCE` — release blocker |

## §22 / §23 Mentor

| contract requirement | test name | learner path exercised | status | remaining gap |
| --- | --- | --- | --- | --- |
| Mentor may remain silent across competent turns | `PBC-22 the mentor stays silent across competent turns` | `learner path` — six consecutive turns | covered | — |
| Scaffolding rungs are distinct | `PBC-22 the scaffolding ladder has four genuinely distinct rungs` | `learner path` — four «не знаю» turns, all texts distinct | covered | — |
| Open mentor question does not swallow orders | `PBC-22 an open mentor question does not swallow real clinical orders` | `learner path` | covered | — |
| Question context persists across turns | `PBC-22` (the preop question survives to the next turn) | `learner path (state)` | covered | — |
| Operational clarification not routed to the mentor | `PBC-23` | `learner path` | covered | — |
| Mentor acknowledges a defensible alternative | — | — | **not covered** | `BLOCKED_BY_GOVERNANCE` |
| Mentor can correct itself | — | — | **not covered** | `NOT_TESTABLE_YET` |

## §25 Debrief

| contract requirement | test name | learner path exercised | status | remaining gap |
| --- | --- | --- | --- | --- |
| Simulator limitation never presented as learner omission | `PBC-25 a simulator limitation is never presented as a learner omission` | `learner path` — full journey to discharge, then asserts the categories are disjoint | covered | — |
| Resource constraint never presented as learner error | `PBC-25 a resource constraint is reported as a hospital fact…` | `learner path` — Real Hospital journey | covered | — |
| No clinical correction without an approved rule | `PBC-25 no clinical correction is asserted without an approved rule behind it` | `learner path` | covered | — |
| Withdrawn items never penalised (site marking, Foley, LMWH…) | `PBC-25 the debrief never penalises the items clinical review explicitly removed` | `learner path` — asserts seven forbidden strings absent | covered | — |
| No numeric competence score | `PBC-25` | `learner path` | covered | — |
| The build reports its own governance status | `PBC-25` | `learner path` | covered | — |

## §11 governance surfacing (task §11)

| contract requirement | test name | learner path exercised | status | remaining gap |
| --- | --- | --- | --- | --- |
| No governance spam at case start | `PBC-GOV the learner is not flooded with governance messages at case start` | `learner path` — asserts all 11 limitation events render as `null` | covered | — |
| Sidebar exposes only allowed state | `PBC-GOV` | `architecture` — comment-stripped source sweep | covered | — |
| Unapproved content never alters patient truth | `PBC-GOV unapproved content never alters patient truth…` | `learner path (state)` — 8 h wait, physiology unchanged, withholding logged | covered | — |
| Nothing is `approved_for_training` | `PBC-GOV nothing in the shipped content is approved_for_training` | `content` | covered | **Guard against accidental promotion** |

## §26 / §28 Generalization and export

| contract requirement | test name | learner path exercised | status | remaining gap |
| --- | --- | --- | --- | --- |
| No disease-specific product logic in core/AI | `PBC-26`; `architecture.test.js` | `architecture` | covered | — |
| Full causal interaction in the export | `PBC-28 the export carries the full causal interaction…` | `learner path` — asserts turn text, clarification and acceptance events | covered | — |
| Export carries no hidden truth | `replayIntegrity.test.js` "the export contains no hidden patient truth" | `mechanism` | covered | — |
| **Empirical second-disease test** | — | — | **not covered** | Structural absence of disease coupling is proven; a second module has never been built. This remains future work |

---

## Task §24 required-coverage checklist

| # | required test | where | learner path |
| --- | --- | --- | --- |
| 1 | Contract file exists at the canonical path | `PBC-0` | content |
| 2 | Contract hash / index entry verified | `PBC-0` (×2) | content |
| 3 | Current-status queries do not restart examination | `PBC-6` | ✅ |
| 4 | Current-status queries do not consume time | `PBC-6` | ✅ |
| 5 | Multiple orders execute independently | `PBC-8` | ✅ |
| 6 | Incomplete medication order clarified by nurse | `PBC-8` | ✅ |
| 7 | Clinical time advances through authored actions | `PBC-10`, `PBC-3` | ✅ |
| 8 | Results auto-arrive when due | `PBC-7` | ✅ |
| 9 | Reassessment is not deduplicated | `PBC-10` | ✅ |
| 10 | Reassessment target clarified before scheduling the interval | `PBC-10` | ✅ |
| 11 | Diagnosis commitment ≠ case completion | `PBC-24` | ✅ |
| 12 | Operative commitment ≠ preop readiness | `PBC-16` | ✅ |
| 13 | Preop readiness derives from actual events | `PBC-16` | ✅ |
| 14 | Routine clarification routed to staff, not mentor | `PBC-8`, `PBC-23` | ✅ |
| 15 | Mentor open question does not swallow commands | `PBC-22` | ✅ |
| 16 | Mentor may remain silent | `PBC-22` | ✅ |
| 17 | Scaffolding levels are distinct | `PBC-22` | ✅ |
| 18 | Location progresses OR → PACU → ward before discharge | `PBC-19` | ✅ |
| 19 | Discharge cannot occur from the OR table | `PBC-24` | ✅ |
| 20 | Simulator limitation is not learner error in debrief | `PBC-25` | ✅ |
| 21 | Resource constraint is not learner error | `PBC-25` | ✅ |
| 22 | Unsupported medication ≠ unavailable medication | `PBC-8` | ✅ |
| 23 | Same seed reproduces resource events and patient seed | `PBC-3`, `replayIntegrity.test.js` | mechanism |
| 24 | Learner sidebar exposes only allowed state | `PBC-GOV` | architecture |
| 25 | No disease-specific runtime branching in core/AI | `PBC-26`, `architecture.test.js` | architecture |
| 26 | No unapproved patient-truth effect bypasses governance | `PBC-GOV` | ✅ |
| 27 | No learner-facing governance spam at case start | `PBC-GOV` | ✅ |
| 28 | Full causal interaction present in JSON export | `PBC-28` | ✅ |

All 28 required coverage items have a test. Items 1, 2, 23, 24 and 25 are
structural or content assertions by nature and are marked as such rather than
claimed as learner-path coverage.

## Honest summary

- **Learner-path coverage is real** for §4, §5 (except free-form questions),
  §6, §7 (except deterioration), §8 (except unsafe dose and procedures), §9,
  §10, §16, §17, §19, §22, §23, §24, §25 and the governance-surfacing rules.
- **Mechanism-only coverage** remains for the hidden-truth boundary under an
  approved rule (§11), biology/resource separation (§3.3) and replay
  determinism — in each case because the learner-visible behavior is either
  an absence or unreachable while content is unapproved.
- **Not covered at all**, and honestly so: deterioration (§7.4), free-form
  patient questions (§5.2), immediate procedures (§8.5), reasoning capture
  (§11), patient refusal (§15), the empirical second-disease test (§26).

No test in this suite asserts a clinical fact. Several assert that a clinical
effect **does not** happen; those are governance guards, and they are expected
to be rewritten — not deleted — when the corresponding content is approved.

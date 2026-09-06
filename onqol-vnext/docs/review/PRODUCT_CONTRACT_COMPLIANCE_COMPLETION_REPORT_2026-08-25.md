# Product Behavior Contract compliance — completion report

**Date:** 2026-08-25
**Task:** `CLAUDE_CODE_TASK_ONQOL_PRODUCT_CONTRACT_AUDIT_AND_CLINICAL_REVIEW_PACK_2026-08-25`
**Repository:** `onqol-vnext/`
**Scope:** APP-004 + the shared runtime behaviors APP-004 exercises

---

## A. Contract sync

| | |
| --- | --- |
| Canonical repository path | `docs/contracts/ONQOL_PRODUCT_BEHAVIOR_CONTRACT_v1.0_2026-08-22.md` |
| SHA-256 | `26b5bb0d165439051370c103fd630a7cdc06368b87b70e682325db7bd992dff3` |
| Size | 842 lines, 25 816 bytes |
| Source | `~/Downloads/onqol v4/ONQOL_PRODUCT_BEHAVIOR_CONTRACT_v1.0_2026-08-22.md` |
| Edits made to the contract text | **none** — `diff` against the source is clean |
| Index | `docs/contracts/CONTRACT_INDEX.md` (document, version, date, status, path, hash) |
| Enforcement | `PBC-0` asserts the hash **and** the presence of all 28 section headings on every test run |

The §1.2 stop condition was cleared before any audit or code change: all eight
required source files were located and read. No prior copy of the contract
existed in the repository, so there was no equivalence check to perform.

## B. Compliance summary

Counted mechanically from
[`PRODUCT_BEHAVIOR_CONTRACT_COMPLIANCE_2026-08-25.md`](PRODUCT_BEHAVIOR_CONTRACT_COMPLIANCE_2026-08-25.md),
which audits all 28 sections, one row per substantive requirement.

| status | count |
| --- | --- |
| `PASS` | 165 |
| `PARTIAL` | 18 |
| `FAIL` | 4 |
| `BLOCKED_BY_GOVERNANCE` | 18 |
| `NOT_TESTABLE_YET` | 8 |
| `OUT_OF_SCOPE_BY_CURRENT_CONTRACT` | 2 |
| **total substantive requirements** | **215** |

These are **not** collapsed into a readiness percentage, deliberately. A `PASS`
on "the nurse asks which route" and a `BLOCKED_BY_GOVERNANCE` on "treatment
changes the patient" are not commensurable, and averaging them would
manufacture exactly the false readiness signal this audit exists to prevent.

Every `PASS` was verified through the real learner-facing path — Russian text
in, rendered output asserted — not from the existence of an internal
mechanism. Where only a mechanism could be verified, the row says so.

## C. Direct violations found and fixed

Thirteen direct product-contract violations were found. All thirteen were
fixable without any new clinical judgment, and all thirteen are fixed and
regression-tested. C1–C9 were found by the audit; C10 and C11 surfaced while
fixing C2 and while writing the regression suite; **C12 and C13 were found
only by opening the application in a browser**, which is itself the strongest
argument for the audit's evidence standard — a 219-test suite was green while
the app could not start at all for nearly half of real sessions.

### C1 — Reassessment consumed clinical time before the clarification

| | |
| --- | --- |
| **Requirement** | §10: "ON QOL should ask what parameters will be reassessed if they are not clear. **Once the reassessment plan is clear:** 1. clinical time advances" |
| **Defect** | «переоценю через 3 часа» with no named target advanced the clock **three hours**, drained every pending result into that window, and only then had the nurse ask «Что именно переоцениваешь?». The learner was charged three irreversible hours for a reassessment that never happened, and their answer then applied at a time they never chose. |
| **Root cause** | `submitLearnerTurn.js` selected the wait-bearing command by `params.afterMinutes != null` and advanced time **before** `applyCommands` validated it. `REASSESS` requires `targets`, so validation returned CLARIFY only after the clock had moved. |
| **Exact fix** | The wait is taken only for a command that already passes `validateCommand`. An incomplete reassessment now clarifies at the current minute; answering it preserves the originally stated interval and then advances. |
| **Regression test** | `PBC-10 a reassessment with no stated target is clarified BEFORE any time passes` — asserts the clock is still 0 **and** the pending CBC was not drained, then that answering advances to exactly 180 min. |

This is the behavior the task's §5.8 asked us to adjudicate. **It did violate
the contract**, and §10 settles the ordering explicitly.

### C2 — Answering a hospital character's clarification did nothing

| | |
| --- | --- |
| **Requirement** | §8.2 (the nurse requests the missing components), §28 (the anti-goal: "I learned which sequence of phrases makes the simulator advance") |
| **Defect** | The nurse asked «Уточните путь введения», the learner typed «в/м», and **nothing happened**. The only way to make the order execute was to retype it in full. This affected **every** clarification in the product — medication route, infusion duration, reassessment targets, biochemistry analytes. |
| **Root cause** | The clarification was rendered as a chat message and never persisted, so the next turn had no way to know a question was open. `mentor.openQuestion` had this treatment; staff clarifications did not. |
| **Exact fix** | `CLARIFICATION_REQUESTED` now carries the original command's parameters and is reduced into `state.clarification` (same lifetime as `mentor.openQuestion` — discharged by the next learner turn). The interpreter fills only the missing keys from the answer, preserving everything already supplied, and re-issues the command. A general seam keyed on parameter name, not a per-command patch. |
| **Regression test** | `PBC-8 answering the clarification completes the ORIGINAL order` (asserts the dose from turn 1 survived) and `PBC-8 the clarification loop works for every clarifying character`. |

### C3 — Safe transfer was unreachable in natural Russian

| | |
| --- | --- |
| **Requirement** | §24 (safe transfer is one of only three natural terminal states), §3.2 ("available only after transfer") |
| **Defect** | «перевожу в другой стационар», «переводим в другую больницу» and «транспортирую в областную больницу» all produced **total silence**. Only the bare infinitive «перевести в другой…» worked. This bit hardest exactly where transfer is the correct answer — a district hospital with no CT and no laparoscopy stack. |
| **Root cause** | The Cyrillic `\w` trap, for the fourth time in this codebase: `/перевод\w* в друг/` and `/транспортиров\w* в /` can never match, because `\w` is `[A-Za-z0-9_]` in a non-unicode JS regex. The file's own header warns about this for `PREOP_PATTERNS`; the terminal-state patterns were written before that lesson. |
| **Exact fix** | All inflectional tails rewritten as `[а-яё]*`, plus the first-person and imperative stems. |
| **Regression test** | `PBC-24 safe transfer is reachable in the natural first person` — four phrasings, each asserted to reach `PATIENT_TRANSFERRED`. |

### C4 — Interfacility transfer consumed no clinical time

| | |
| --- | --- |
| **Requirement** | §3.2 ("a transfer takes 60 to 90 minutes"), §7.1 (clinical time advances for transport) |
| **Defect** | The ambulance arrived at the receiving hospital in **zero minutes**; the case closed on the same clock tick as the decision. |
| **Root cause** | `transferEtaMinutes` was authored on all three real profiles (150 / 45 / 20) and **read by nothing**. |
| **Exact fix** | A general `consumesMinutes` seam: a command may declare that it takes clinical time, and `submitLearnerTurn` advances the clock after execution, draining pending work en route. `TRANSFER` emits departure, schedules a `transfer_arrival`, and the arrival lands after the journey. This is operational hospital data (Foundation Spec §46), not clinical content, so it is not governance-gated. |
| **Regression test** | `PBC-3 interfacility transfer consumes the authored transport time` — two profiles, asserting 150 and 45 minutes and the rendered departure/arrival pair. |

### C5 — «как сейчас боль?» returned nothing

| | |
| --- | --- |
| **Requirement** | §6 (a request for current status returns a snapshot); the task's §5.4 names this exact variant |
| **Defect** | The adverb-first word order fell through to `CLINICAL_REASONING` and the learner got silence in reply to a direct question about their patient. |
| **Root cause** | `STATUS_QUERY_PATTERNS` covered only «какая боль сейчас», not the equally ordinary «как сейчас боль». |
| **Exact fix** | Both Russian word orders listed. |
| **Regression test** | `PBC-6 every contract-named status phrasing returns a current snapshot` — loops all four contract/task-named variants. |

### C6 — The status snapshot omitted pending work, and named tests by internal id

| | |
| --- | --- |
| **Requirement** | §6, whose worked example ends "CBC is ready; **CT formal report is pending**" |
| **Defect** | Pending investigations never appeared in the snapshot at all, and the code path that would have printed them used raw ids (`cbc`, `ct_abdomen`). |
| **Root cause** | `TEST_ORDERED` was absent from `DISCLOSING_EVENTS`, so an ordered-but-unresulted test never entered `revealed.results`. The renderer mapped `r.id` directly. |
| **Exact fix** | `TEST_ORDERED` discloses the **order** (never the result — it carries no `findingIds`, and the value stays hidden until the preliminary or final report). The snapshot prints Russian labels and now also reports a preliminary-received-but-formal-pending state. |
| **Regression test** | `PBC-6` asserts «Ожидают результата: ОАК» **and** that no internal id reaches the learner. |

### C7 — The nurse spoke internal identifiers

| | |
| --- | --- |
| **Requirement** | §13 (staff are functional characters), §8.2 |
| **Defect** | «Введено: ketoprofen 100мг im» — a Latin internal identifier and a route code, from a Russian-speaking nurse. |
| **Root cause** | `renderEvent.js` interpolated `payload.drugId` and `payload.route` raw, although `formulary.yaml` already carried `label_ru` for every drug. |
| **Exact fix** | The nurse says «Введено: кетопрофен, 100 мг, внутримышечно.» — the drug name from reviewed content, the route from a fixed table, and the **dose passed through exactly as the learner stated it**. Nothing normalises or judges the dose; dose validity is unreviewed clinical content. |
| **Regression test** | Covered by `PBC-6`'s no-raw-ids assertion and visible in both smoke transcripts. |

### C8 — A discharge refusal stated the opposite of the real blocker

| | |
| --- | --- |
| **Requirement** | §19/§24; §25's honesty requirement |
| **Defect** | Refusing discharge before the operation told the learner «Выписать сейчас нельзя: **операция завершена**» — that the operation *had* been completed, which is the inverse of the actual blocker. |
| **Root cause** | `renderDischargeNotReady` falls back to `criterion.label_ru` when no failure wording exists, and `operation_completed` was the only criterion with no `learner_reason_ru`. `label_ru` names the criterion in its **satisfied** form. |
| **Exact fix** | Added `learner_reason_ru: "запланированная операция ещё не выполнена"`. Workflow wording only — the criterion asserts no clinical claim and stays `not_a_clinical_rule`. |
| **Regression test** | `PBC-24 a discharge refusal states the real blocker, not its opposite`. |

### C9 — Hidden patient truth leaked into the learner-visible projection

| | |
| --- | --- |
| **Requirement** | §4 (phenotype and severity are not exposed); Foundation Spec §51-52 |
| **Defect** | `buildLearnerVisibleState().simulatorLimitations` carried the withheld content **ids**, including the phenotype `retrocecal` and the morphology `uncomplicated_inflammation` — from minute 0. |
| **Root cause** | The projection spread `state.simulatorLimitations` wholesale. Nothing rendered it, but this projection is what the mentor envelope and the rule engine receive, so a rule could have conditioned on the diagnosis before any learner-visible evidence existed. |
| **Exact fix** | The projection now carries **kinds only** (`["patient_truth", "trajectory"]`). The debrief and export read `state.simulatorLimitations` directly and keep full detail. |
| **Regression test** | `PBC-4` asserts the absence of `аппендицит`, `retrocecal`, `uncomplicated_inflammation` and `TRJ-` from the handoff **and** the learner-visible projection. |

### C10 — One order became two

`«креатинин и электролиты»` split on «и» into two chemistry orders that
overwrote each other in `state.investigations`, so the learner saw two identical
confirmations and got back one analyte. Fixed by merging duplicate
`ORDER_TEST` commands for the same `testId` after fragment splitting (union of
analytes), rather than widening the pre-split shortcut — which would have
risked swallowing a co-ordered drug. Covered by `PBC-8 the clarification loop
works for every clarifying character`.

### C11 — A deliberately-excluded drug produced silence, not an honest limitation

`formulary.yaml` lists metamizole under `not_in_reference_set` **specifically
so** that ordering it "resolves as `unsupported_content`". But the interpreter
had no synonym for it, so the order never became a command and the learner got
nothing. The excluded names are now resolvable, and the formulary lookup — not
the vocabulary — refuses them. Covered by `PBC-8 an unsupported medication is
never reported as a hospital stock-out`.

### C12 — The app crashed on start for ~44% of sessions

| | |
| --- | --- |
| **Requirement** | §4: the learner receives an EMS handoff and initial vitals. Before anything else, the case has to start. |
| **Defect** | Clicking a hospital mode threw `Clock start "2026-08-23T12:-16:00+05:00" is not a parsable instant` and the app rendered **nothing at all**. Measured rate over 2 000 generated seeds: **876 (43.8%)**. |
| **Root cause** | `seededStartIso` derives the scenario start time from the seed. `hash` is forced unsigned with `>>> 0`, but the minute used the **signed** shift `hash >> 5`. Any hash at or above 2^31 — a little under half of them — went negative, `% 60` stayed negative, and the ISO string carried a negative minute. |
| **Exact fix** | `hash >>> 5`. The helper was also moved to its own module `src/app/session/seededStart.js`: `useSession.js` imports the compiled content bundles as JSON without Node's `with { type: "json" }` attribute (Vite supplies it), so nothing in that file could be imported from a `node --test` file — which is precisely how this survived. |
| **Regression test** | `PBC-4 a case starts for every seed the app can generate` — 3 000 generated seeds asserted parsable, plus a session built from a formerly-broken seed reaching `PATIENT_ARRIVED`. |

**Why no test caught it:** every other test in the repository supplies an
explicit `startIso`. This function runs only when a human clicks a hospital
mode. It is the clearest possible illustration of task §4's rule that a
green internal suite is not evidence of learner-facing behavior.

### C13 — Laboratory results named by internal English field names

| | |
| --- | --- |
| **Requirement** | §13 (staff are characters speaking to a Russian-speaking resident), §9 |
| **Defect** | «ОАК — wbc: 15.6, neutrophilPercent: 81» — the physiology object's own field names, printed verbatim. The same leak as C7, in the lab renderer rather than the nurse's line. |
| **Root cause** | `formatResult` fell through to `Object.entries(result).map(([key, value]) => ...)` for any structured lab result. |
| **Exact fix** | A Russian label table for lab fields. **Only the name is translated** — the value is passed through untouched, and the single unit appended (`%` on `neutrophilPercent`) is one the field name already carries, never a new clinical assertion. A single-field result whose field is the test itself no longer stutters («СРБ — СРБ: 44» → «СРБ: 44»). |
| **Regression test** | `PBC-6` and `PBC-7` both assert that no `wbc` / `neutrophilPercent` reaches the learner. |
| **Verified live** | «ОАК — лейкоциты: 13.8, нейтрофилы: 80 %» |

## D. Clinical-content-dependent gaps

Separate from §C. **None of these was fixed, and none should be** — each
requires clinical content that is not `approved_for_training`.

| gap | contract | current runtime behavior | blocking content |
| --- | --- | --- | --- |
| Treatment response | §8.6 | Drug given and recorded; patient unchanged | every `(drug, route)` `response_envelope: null` |
| Disease progression over time | §7, §10, §20 | Time passes; physiology frozen; withholding logged per advance | `TRJ-STABLE` `pending`, `natural_course_model: null` |
| Deterioration | §7.4, §14, §24 | Cannot occur — **no producer exists in code** and no threshold is approved | trajectory + deterioration thresholds (matrix T08) |
| Complication probability | §20 | No complication is ever scheduled | `complications: []` by explicit review decision |
| Medication safety judgment | §8.3, §18 | Any dose accepted and recorded, judged by nobody | all six rules `pending`; **no Level 3 or 4 rule authored at all** |
| Clinical discharge readiness | §19 | Discharge granted on structural criteria only; withholding logged | five clinical criteria `pending` |
| Reference-pathway comparison in debrief | §25 | «Сравнение с эталонным маршрутом не приводится…» | zero rules `approved_for_training` |
| Mentor clinical intervention | §18, §22 | Mentor cannot make any clinical claim; scaffolding and workflow questions only | rules `pending` |
| Antibiotic prophylaxis adequacy | §16 | Recorded structurally; `timingValidated: false` | drug-specific timing/redosing content |
| Postoperative pain value | §19 | Status says it is not modelled rather than reporting a stale or invented value | `post_source_control_course` `pending` |

Four **product** gaps are recorded as `FAIL` and were also not fixed, for
reasons stated in the compliance map: free-form patient questions (§5.2),
immediate procedures (§8.5), reasoning capture (§11), and the dead mentor
reinforcement branch (§22). The first two need new content authoring; the
third's useful half depends on unapproved content; the fourth is a deletion,
which is a product decision rather than a bug fix.

## E. Learner-facing smoke results

Both sessions were driven through the exact code path the application uses.

### Reference Hospital — [`PBC_REFERENCE_SMOKE_2026-08-25.md`](../evidence/PBC_REFERENCE_SMOKE_2026-08-25.md)

Seed `PBC-REF-2026-08-25`, 22 turns, 0 → 700 min, ED → OR → PACU → ward →
discharged. All 20 items on the task's §10.1 checklist observed. Replay JSON
stored beside the notes.

**Explicitly not claimed as working:** treatment response. Ketoprofen was given
at minute 0 and the pain score read 4.9/10 at minute 0 and 4.9/10 at minute
180.

### Real Hospital — [`PBC_REAL_HOSPITAL_SMOKE_2026-08-25.md`](../evidence/PBC_REAL_HOSPITAL_SMOKE_2026-08-25.md)

Seed `PBC-REAL-2`, profile `KZ-R2-URBAN`, constraint `ct_scanner_down` drawn
from the seed. Verified: the constraint is invisible until the learner runs
into it; the sidebar then shows it; the same seed in Reference mode produces a
byte-identical patient; the mentor never touches the resource problem; the
debrief files it as a hospital fact with `importantMisses` empty. The learner
fell back to ultrasound (nondiagnostic, correctly not rendered as negative)
and transferred out at minute 165 after a 45-minute journey.

**Explicitly not claimed as working:** the delay has no clinical consequence.

## F. Review pack

[`APP004_FINAL_CLINICAL_REVIEW_PACK_2026-08-25.md`](APP004_FINAL_CLINICAL_REVIEW_PACK_2026-08-25.md)
— one pack, linking to exactly the five required tables. No sixth
"miscellaneous" table was created.

| table | open decisions |
| --- | --- |
| Vitals / labs / disease course | 22 |
| Analgesia and fluids | 20 |
| Antibiotic prophylaxis | 12 |
| Anaesthesia, fasting, consent | 11 |
| Discharge readiness | 12 |
| **total requiring a human decision** | **77** |
| of which second review required | 44 |
| of which `PATIENT_TRUTH` | 19 |

Every row carries an Item ID, the current proposed content, the current runtime
status, authority layer, source and jurisdiction, risk class, **the exact
runtime effect if approved**, and a blank `Decision` field. No human approval
is pre-filled anywhere.

## G. Test / build verification

Run in order, from a clean install.

| command | result |
| --- | --- |
| `npm ci` | ✅ 137 packages added, 138 audited, **0 vulnerabilities** |
| `npm test` | ✅ **220 tests, 220 pass, 0 fail** (was 169 before this pass; +51 from the new contract suite) |
| `npm run lint` | ✅ clean, no errors, no warnings |
| `npm run build` | ✅ 59 modules transformed; `index` 218.60 kB, `clinical-core` 91.91 kB, `clinical-content` 66.68 kB, CSS 7.07 kB |
| `npm run pack:safe` | ✅ 185 entries, 0.51 MB, **0 forbidden paths** |
| `npm run verify` | ✅ `content:check` + `test` + `lint` + `build` all pass |

### Test-suite changes

- **Added** `src/tests/productBehaviorContract.test.js` — 51 tests named
  `PBC-<contract section>`, so a failure names the product promise that broke.
- **Modified** three existing test files: 10 call sites used a targetless
  «переоценю через N» (or «переоценю утром») purely as a clock-advance device. That device only worked
  *because of* the C1 defect, so each now names a reassessment target, exactly
  as a learner must. The one test that asserts the targetless case asks for
  clarification (`interpretTurn.test.js`) was left unchanged — it was already
  correct, and the runtime is now consistent with it.
- No test was weakened or deleted to make this pass green.

## H. Code freeze

Confirmed. After the compliance audit, the ten §C fixes, the regression suite
and the two smoke sessions, **no further clinical or runtime feature work was
started**.

Specifically **not** begun: deterioration, a second disease, new medications,
new phenotypes, complications, or advanced Real Hospital behavior. Nothing was
promoted to `approved_for_training` — `PBC-GOV nothing in the shipped content
is approved_for_training` now fails the build if anything is.

The four `FAIL` product gaps in §D were left open rather than fixed, because
closing them means authoring content or making a product decision, both of
which belong after this freeze.

## I. Pilot readiness

# NO-GO

APP-004 is mechanically playable end to end in both hospital modes and is not
clinically fit for residents. Measured against the Clinical Evidence Governance
release gate (task §23):

| gate condition | status |
| --- | --- |
| All patient truth used in the pilot is reviewed | ❌ **0 of 11** generating content objects approved; every session stamped `patientTruthApproved: false` |
| Safety-critical rules reviewed | ❌ 0 of 6 rules approved; **no Level 3 or 4 rule exists at all** |
| Learner-facing doses and thresholds reviewed | ❌ no dose, onset, duration or response magnitude approved |
| Critical pathway transitions reviewed | ❌ no disease course, no deterioration, no complication model |
| Simulator limitations isolated from learner assessment | ✅ debrief keeps the categories structurally disjoint; regression-tested |
| No unapproved content silently alters the patient | ✅ three-gate check at scheduling; every withholding logged |
| Replay determinism tested | ✅ same seed reproduces state, constraint draw and patient exactly |

### Exact release blockers

1. **No approved patient truth.** Vitals envelopes, inflammatory profiles,
   phenotype, history, fasting windows and urinalysis are all `pending`
   (`APP004-LAB-01`–`19`, `APP004-ANES-01`).
2. **No disease course.** The patient does not change over time
   (`APP004-LAB-20`). This alone keeps eleven contract behaviors dark.
3. **No treatment response.** No drug does anything (`APP004-ANLG-11`–`13`).
4. **No clinical discharge readiness.** A post-appendectomy patient can be
   discharged as soon as they leave recovery, with no clinical check
   (`APP004-DISCH-01`–`07`). The previous build's 38.0 °C fever blocker was
   removed as an unreviewed threshold living in code — a deliberate loss of
   behavior in exchange for honesty.
5. **No approved prophylaxis regimen**, and the previously-signed cefazolin
   monotherapy rule stands withdrawn pending `APP004-ABX-05`.
6. **No safety net.** With no approved Level 3/4 rule, the mentor cannot stop
   or challenge any clinical decision. A resident could do something dangerous
   and the simulator would execute it silently.
7. **Aspiration risk is unmanaged** (`APP004-ANES-02`–`04`), pending
   anaesthesia review.

### What is genuinely ready

The product mechanics. Two hospital modes with real, seeded, replayable
resource constraints; an internal clinical clock with parallel work and
automatic result arrival; free examination and reassessment without ritual;
correct character separation; preoperative readiness derived from real actions;
a level-B operative decision; postoperative disposition with location tracking;
three terminal states with the two reachable ones verified; a debrief that
keeps learner choice, system execution, resource limits and simulator limits
apart; and a governance gate that has now been demonstrated to withhold rather
than fabricate under every path tested.

> The honest one-line summary: **we know exactly which ON QOL product behaviors
> work, which are blocked only because medicine still needs approval, and
> exactly what the clinical reviewer must approve next.** The engine is ready
> for the medicine. The medicine is not ready for the resident.

---

## Deliverables index

| document | purpose |
| --- | --- |
| [`docs/contracts/ONQOL_PRODUCT_BEHAVIOR_CONTRACT_v1.0_2026-08-22.md`](../contracts/ONQOL_PRODUCT_BEHAVIOR_CONTRACT_v1.0_2026-08-22.md) | the contract, verbatim |
| [`docs/contracts/CONTRACT_INDEX.md`](../contracts/CONTRACT_INDEX.md) | hash + provenance index |
| [`PRODUCT_BEHAVIOR_CONTRACT_COMPLIANCE_2026-08-25.md`](PRODUCT_BEHAVIOR_CONTRACT_COMPLIANCE_2026-08-25.md) | all 28 sections, 215 requirements |
| [`PRODUCT_BEHAVIOR_TEST_COVERAGE_2026-08-25.md`](PRODUCT_BEHAVIOR_TEST_COVERAGE_2026-08-25.md) | which behaviors have learner-path vs mechanism-only tests |
| [`APP004_FINAL_CLINICAL_REVIEW_PACK_2026-08-25.md`](APP004_FINAL_CLINICAL_REVIEW_PACK_2026-08-25.md) | 77 clinical decisions across the five tables |
| [`docs/evidence/PBC_REFERENCE_SMOKE_2026-08-25.md`](../evidence/PBC_REFERENCE_SMOKE_2026-08-25.md) (+ replay JSON) | Reference Hospital session |
| [`docs/evidence/PBC_REAL_HOSPITAL_SMOKE_2026-08-25.md`](../evidence/PBC_REAL_HOSPITAL_SMOKE_2026-08-25.md) (+ replay JSON) | Real Hospital session |
| `src/tests/productBehaviorContract.test.js` | 50-test contract regression suite |

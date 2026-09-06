# APP-004 discharge review table

**Date:** 2026-08-25
**Requested by:** `APP004_CLINICAL_REVIEW_MATRIX_v1.0_2026-08-25` PO10–PO21; remediation task §19
**Status:** the structural half is implemented; **every clinical readiness criterion is a PROPOSAL and is currently inert.**
**Reviewer required:** clinical, plus second review on the final wording (matrix PO15)

---

## 1. The finding this replaces

The smoke session discharged a patient 12 h after admission with pain 7.6/10, because the discharge gate checked only structural flags. Matrix PO14 is **REVISE / NOT READY**:

> Discharge handler must evaluate approved clinical readiness, not only structural flags.

The mechanism for that now exists. The content it would evaluate does not. **This is reported as a release blocker rather than closed with an invented threshold** — inventing "pain ≤ 3" or "24 h afebrile" to make the gate feel real is precisely what matrix PO11/PO12/PO13 removed.

---

## 2. Two layers, kept apart

`core/commands/executeCommand.js#evaluateDischargeReadiness` selects criteria by `authority_layer`, never by promoting anything.

### Structural — active (architecture-owned, no clinical claim, no threshold)

| id | asserts | learner-visible reason when unmet |
|---|---|---|
| `operation_completed` | an operative plan was committed and the operation finished | — |
| `no_active_unresolved_complication` | no complication is active | "есть признаки активного осложнения, которое не разрешено" |
| `left_theatre_and_recovery` | the patient is not still in theatre or recovery | "пациент ещё не переведён из операционной/палаты пробуждения" |

These carry `review_status: not_a_clinical_rule` and are deliberately **not** promoted to `approved_for_training`: they are workflow facts, and dressing them as approved clinical content would blur exactly the line this pass exists to draw.

### Clinical readiness — proposed, INERT

Each is skipped by the governed evaluator and recorded at the moment of discharge as `SIMULATOR_LIMITATION_NOTED { kind: "discharge_criterion" }`, so the log states that clinical readiness was not evaluated.

| id | criterion | learner-visible reason when unmet | threshold | source | review status | reviewer decision |
|---|---|---|---|---|---|---|
| `haemodynamically_stable` | гемодинамика стабильна | "гемодинамика нестабильна" | `NEEDS_CLINICAL_REVIEW` | matrix PO15 | `pending` | |
| `pain_controlled_on_oral_regimen` | боль контролируется пероральной схемой, без повторных парентеральных доз | "боль требует повторных парентеральных доз" | **no numeric cutoff** (PO12) | matrix PO12, PO15 | `pending` | |
| `tolerating_oral_intake` | переносит пероральный приём | "пациент не переносит пероральный приём" | — | matrix PO15 | `pending` | |
| `no_significant_persistent_vomiting` | нет значимой сохраняющейся рвоты | "пациента продолжает рвать" | `NEEDS_CLINICAL_REVIEW` (what counts as "significant") | matrix PO15 | `pending` | |
| `mobile` | пациент активизирован | "пациент ещё не активизирован" | — | matrix PO15 | `pending` | |
| `urinary_function_acceptable` | мочеиспускание восстановлено, когда клинически значимо | "не восстановлено самостоятельное мочеиспускание" | `NEEDS_CLINICAL_REVIEW` (when is it relevant?) | matrix PO15 | `pending` | |

`CLINICAL_DISCHARGE_CHECKS` in the code is an empty table on purpose: implementing any entry would mean choosing a threshold. Approving a criterion becomes a content edit plus one entry, not a redesign.

---

## 3. Explicitly removed — recorded so they cannot return quietly

Held in `complications.yaml#discharge_criteria_explicitly_removed` and asserted absent by tests 39 and 40.

| id | why removed |
|---|---|
| `flatus_or_stool` | matrix PO16 — not required for uncomplicated laparoscopic appendectomy |
| `minimum_24h_admission` | matrix PO13 — same-day/next-day discharge is acceptable for selected patients (SRC-SDD-2021); PO21 makes keeping a ready patient overnight at most a resource note |
| `afebrile_24h` | matrix PO11/PO13 — an isolated low-grade early temperature is not a complication |
| `routine_next_day_cbc` | matrix PO10 — not mandatory after uncomplicated stable laparoscopic appendectomy |
| `pain_score_at_or_below_3` | matrix PO12 — function and control matter, not an arbitrary threshold |

The previous build's fever blocker (`temperatureC ≥ 38.0`) is also gone. It was an unreviewed numeric threshold living in code; it is now a `pending` clinical criterion (`haemodynamically_stable` / a future fever criterion), which means it does not fire. That is a deliberate loss of behaviour in exchange for honesty, and it is listed as a blocker in the completion report.

---

## 4. What happens at discharge today

| step | behaviour | matrix |
|---|---|---|
| structural criteria fail | refused, with the CONTENT's own learner-facing reason; no internal id is ever spoken | PO14, task §19.3 |
| clinical criteria | skipped; recorded as simulator limitations | PO14/PO15 gate |
| specimen to pathology | already sent automatically at source control | PO17 |
| discharge bundle | system emits follow-up + return precautions after a valid discharge | PO18, PO20 |
| suture-removal instructions | **absent** — they depend on the closure material, which is not modelled | PO19 |
| keeping a ready patient overnight | no penalty, not a miss | PO21 |

### The bundle wording (authored, `reviewed_internal`, needs reviewer identity)

- follow-up: "Контроль у хирурга по месту жительства."
- histopathology: "Результат гистологического исследования — по месту жительства."
- return precautions: усиление боли в животе · лихорадка · повторная рвота или невозможность пить · покраснение, отделяемое или расхождение краёв раны · отсутствие стула и газов с нарастающим вздутием

---

## 5. Honest statement of the current gap

> In this build, a learner can discharge a post-appendectomy patient as soon as the patient has left theatre. No clinical readiness criterion is evaluated, because none is approved. The refusal that does exist is structural.

That is a **NO-GO item for the resident pilot**, not a resolved one.

---

## Concrete questions for the clinical reviewer

1. Is the six-criterion functional set above the right one, and is the wording of each learner-facing reason acceptable?
2. What makes vomiting "significant" enough to block discharge?
3. When is urinary function "clinically relevant" for this operation?
4. What haemodynamic condition would you actually accept as "unstable" here — expressed however you would say it to a resident?
5. Should the system also warn (not block) when a patient is discharged very early, or is that already covered by PO21's "at most a resource-efficiency note"?

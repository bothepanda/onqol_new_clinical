# APP-004 vitals and laboratory review table

**Date:** 2026-08-25
**Requested by:** `APP004_CLINICAL_REVIEW_MATRIX_v1.0_2026-08-25` V01–V08, T01–T08; remediation task §6
**Status:** PROPOSAL — no cell below is active content.

---

## What changed in code before this table was written

| Change | Matrix | Effect |
|---|---|---|
| Removed the onset-duration bias from physiology generation | V04 **REMOVE** | Later presentation no longer pushes every value toward the top of its range. `generatePhysiology` now draws each parameter from the envelope with no coupling to `onsetHours`. |
| Authored `inflammatory_profiles: minimal / moderate / marked` as a scaffold with **null** ranges | V03 **REVISE**, V05 **NEEDS SOURCE** | The structure the reviewer asked for exists; the numbers do not, because inventing them is exactly what the task forbids. |
| Kept the legacy union envelope as `development_only: true` | V01 **REVISE**, gate NOT READY | A patient can still be instantiated for internal development, and the envelope is inventoried as non-approved patient truth on every session. |
| Deleted `pre_source_control_drift_per_hour` and `post_source_control_recovery_per_hour` | T01/T02/T05 | Not gated — **deleted**. Promoting `TRJ-STABLE` by hand cannot resurrect the arithmetic. |

---

## 1. The envelope currently in use (development only)

This is what a generated APP-004 patient is drawn from **today**. The reviewer's V01 objection stands against it: HR up to 112, RR up to 24 and T up to 38.5 are high for an "ordinary stable" uncomplicated base phenotype.

| parameter | current range | source | reviewer decision |
|---|---|---|---|
| heart rate | 72–112 /min | NEEDS_SOURCE (union of legacy authored ranges) | ☐ accept ☐ narrow to ______ ☐ replace with profiles |
| temperature | 36.7–38.5 °C | NEEDS_SOURCE | ☐ accept ☐ narrow to ______ ☐ replace with profiles |
| systolic BP | 100–140 mmHg | NEEDS_SOURCE | ☐ accept ☐ narrow to ______ |
| respiratory rate | 14–24 /min | NEEDS_SOURCE | ☐ accept ☐ narrow to ______ |
| WBC | 8–18 ×10⁹/L | NEEDS_SOURCE | ☐ accept ☐ narrow to ______ |
| neutrophils | 65–90 % | NEEDS_SOURCE | ☐ accept ☐ narrow to ______ |
| CRP | 2–140 mg/L | NEEDS_SOURCE | ☐ accept ☐ narrow to ______ |

> No diastolic blood pressure is modelled, and none is rendered. The EMS handoff and the status snapshot both say "АД сист." explicitly.

---

## 2. Proposed linked inflammatory profiles (matrix V03)

The requirement is COHERENCE across the row, not independent ranges per parameter: a patient in the `minimal` profile should read as one patient, not as seven independent draws that happen to co-occur.

| profile | parameter | proposed range | source | rationale | current status | reviewer decision |
|---|---|---|---|---|---|---|
| minimal | heart rate | `NEEDS_CLINICAL_REVIEW` | — | early/low inflammatory burden | inactive (`generation_enabled: false`) | |
| minimal | temperature | `NEEDS_CLINICAL_REVIEW` | — | | inactive | |
| minimal | respiratory rate | `NEEDS_CLINICAL_REVIEW` | — | | inactive | |
| minimal | WBC | `NEEDS_CLINICAL_REVIEW` | — | | inactive | |
| minimal | neutrophils | `NEEDS_CLINICAL_REVIEW` | — | | inactive | |
| minimal | CRP | `NEEDS_CLINICAL_REVIEW` | — | | inactive | |
| moderate | heart rate | `NEEDS_CLINICAL_REVIEW` | — | typical presenting burden | inactive | |
| moderate | temperature | `NEEDS_CLINICAL_REVIEW` | — | | inactive | |
| moderate | respiratory rate | `NEEDS_CLINICAL_REVIEW` | — | | inactive | |
| moderate | WBC | `NEEDS_CLINICAL_REVIEW` | — | | inactive | |
| moderate | neutrophils | `NEEDS_CLINICAL_REVIEW` | — | | inactive | |
| moderate | CRP | `NEEDS_CLINICAL_REVIEW` | — | | inactive | |
| marked | heart rate | `NEEDS_CLINICAL_REVIEW` | — | high burden, still uncomplicated | inactive | |
| marked | temperature | `NEEDS_CLINICAL_REVIEW` | — | | inactive | |
| marked | respiratory rate | `NEEDS_CLINICAL_REVIEW` | — | | inactive | |
| marked | WBC | `NEEDS_CLINICAL_REVIEW` | — | | inactive | |
| marked | neutrophils | `NEEDS_CLINICAL_REVIEW` | — | | inactive | |
| marked | CRP | `NEEDS_CLINICAL_REVIEW` | — | | inactive | |

**Also needed, and deliberately not guessed:**

| item | status | note |
|---|---|---|
| relative frequency of the three profiles in base APP-004 | `NEEDS_CLINICAL_REVIEW` | e.g. "mostly moderate, marked uncommon" — a distribution, not an assertion about any one patient |
| whether symptom duration should shift the profile DISTRIBUTION | `NEEDS_CLINICAL_REVIEW` | matrix V04 allows influence on probability, forbids deterministic per-value drift |
| pain score coupling to profile | `NEEDS_CLINICAL_REVIEW` | currently drawn independently, `pain_score: [4, 8]` |

---

## 3. Pain-driven HR/RR (matrix V02, M05)

| item | proposal | source | current status | reviewer decision |
|---|---|---|---|---|
| a seeded "pain-driven component" of HR and RR | architecture may support it; magnitude unspecified | expert opinion only | **not implemented** — no universal fixed delta exists | |
| HR/RR fall after effective analgesia | permitted only when a pain-driven component was seeded | `NEEDS_CLINICAL_REVIEW` | not implemented | |

Matrix V02 is **APPROVE concept / NEEDS SOURCE for calibration**. This pass implemented neither the component nor the response, because either would require a number.

---

## 4. Urinalysis (matrix V06)

Implemented qualitatively; the reviewer approved the concept, so only frequency is open.

| variant | wording (authored, `pending`) | reviewer decision |
|---|---|---|
| normal | "Общий анализ мочи без значимых отклонений." | ☐ accept ☐ reword |
| trace leucocytes | "В общем анализе мочи единичные лейкоциты; нитриты отрицательные, бактериурии нет." | ☐ accept ☐ reword |
| trace erythrocytes | "В общем анализе мочи единичные эритроциты; нитриты отрицательные, бактериурии нет." | ☐ accept ☐ reword |
| relative frequency of the three | `NEEDS_CLINICAL_REVIEW` — currently uniform | ______ |

No count, no per-field figure, and never presented as evidence of UTI, stone or pyelonephritis.

---

## 5. Biochemistry (matrix V07, V08) — implemented, wording open

"БХАК" alone no longer returns a panel: the lab asks "Какие показатели биохимии нужны?" and only the named analytes are reported. CRP is a separate order and is not a biochemistry analyte.

| analyte | result wording (qualitative, `pending`) | reviewer decision |
|---|---|---|
| creatinine | "креатинин в пределах референсных значений" | |
| urea | "мочевина в пределах референсных значений" | |
| electrolytes | "натрий и калий в пределах референсных значений" | |
| glucose | "глюкоза в пределах референсных значений" | |
| bilirubin | "общий и прямой билирубин в пределах референсных значений" | |
| ALT/AST | "АЛТ и АСТ в пределах референсных значений" | |
| amylase | "амилаза в пределах референсных значений" | |
| total protein | "общий белок в пределах референсных значений" | |
| **should any analyte ever be abnormal in base APP-004?** | `NEEDS_CLINICAL_REVIEW` | |

---

## 6. Natural course over time (matrix T01–T03, T08) — NO-GO

| item | status | note |
|---|---|---|
| bounded state-transition model for `TRJ-STABLE` | `NEEDS_CLINICAL_REVIEW` | must permit stable intervals, gradual worsening, or probabilistic transition to a complicated course (T02) |
| perforation probability | `NEEDS_SOURCE` | no deterministic threshold (T03); influenced by duration + phenotype + modifiers once calibrated |
| deterioration thresholds | `NEEDS_CLINICAL_REVIEW` | deferred entirely (T08); nothing implemented |
| post-source-control recovery (physiology and postoperative pain) | `NEEDS_CLINICAL_REVIEW` | separate state, not the preoperative pain decremented (T05, PO01) |

Until a model exists, every clock advance records `SIMULATOR_LIMITATION_NOTED { kind: "trajectory", id: "TRJ-STABLE" }` and patient truth does not move.

---

## Concrete questions for the clinical reviewer

1. What WBC and CRP ranges define the `moderate` profile for an uncomplicated retrocecal appendicitis presenting at ~12–24 h?
2. What is the highest HR / temperature / RR you would accept as still describing an *ordinary stable* uncomplicated patient (i.e. the ceiling of `marked`)?
3. Roughly what share of base APP-004 patients should fall into each of minimal / moderate / marked?
4. Should any of the eight biochemistry analytes ever return abnormal in base APP-004, or are they all normal by design?
5. How often is the urinalysis abnormal at all in retrocecal appendicitis — occasionally, or in a minority you would put a number on?

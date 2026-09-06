# APP-004 Numeric Calibration Review

**Date:** 2026-08-31
**Compiled content version:** `20b1c6fc188564c9`
**Prepared as:** analysis / review preparation only — no clinical content, YAML, `review_status`, gate, or eligibility was changed.
**Authoritative specs:** `docs/contracts/ONQOL_NORTH_STAR_v1.1_2026-08-30.md`, `ONQOL_CORE_RUNTIME_SPEC_v2.0_2026-08-30.md`, `ONQOL_CLINICAL_GOVERNANCE_SPEC_v1.1_2026-08-30.md`, `ONQOL_MENTOR_SPEC_v1.1_2026-08-30.md`, `ONQOL_SPECS_README.md`.

---

## Why this review exists

APP-004 engineering and runtime work is already functional: the case runs end to end, 292/292 Node tests and 4/4 E2E pass, and 45 clinical objects are approved with named reviewers and dates. The resident pilot is still **NO-GO** because six patient-truth / calibration objects that APP-004 actively depends on are still `review_status: pending`, and the Clinical Governance spec treats simulation calibration as a clinical artifact that cannot be promoted to `approved_for_training` just to pass the release gate. This document lists **only the values that already exist in the repository** — it does not propose replacements and nothing here is medically endorsed. Nothing in this document becomes approved merely by being listed. The Clinical Lead must explicitly record **APPROVE / REVISE / REMOVE / DEFER** for each item in the checklist at the end.

One caveat found during preparation and reported in full in §"Verification": of the six blockers, only three currently carry stored numbers (`ENV-UNCOMPLICATED-INFLAMMATION`, `PHENOTYPE-RETROCECAL-APP004`, `FINDINGS-FASTING-HISTORY`). The other three are `pending` with **no numeric content at all** — `CAL-NAUSEA-VOMITING-SELECTION-APP004` stores only a sampling method, `TRJ-POSTOP-RECOVERY` is `model: null`, and `LAB-CHEMISTRY-ANALYTES-APP004` stores only qualitative "within reference range" phrasing. They block the gate as pending inventory entries and need a qualitative / structural decision rather than a numeric one.

---

## Clinical Lead decision legend

| Decision | Meaning |
| --- | --- |
| **APPROVE** | current values (or the current qualitative behaviour) may be promoted to `approved_for_training` as they stand. |
| **REVISE** | the concept stays, but one or more values must change before approval; approval remains closed until the revised values are re-reviewed. |
| **REMOVE** | this numeric parameterization is unnecessary for the pilot and should not influence patient truth; the object is made inert without deleting its audit history. |
| **DEFER** | exclude from the resident pilot until separately calibrated; the case may still run in `internal_development` / `faculty_preview`. |

---

## How these values reach the learner (shared mechanism)

Patient generation is deterministic from the session seed (`core/patient/patientGenerator.js`). Each field below is drawn once at generation from one of two primitives:

- **uniform** — `stream.range(min, max)`: every value in the range equally likely.
- **centred** — `stream.centred(min, max)`: mean of three uniform draws, biased toward the middle of the range; the extremes are possible but uncommon.

Physiology fields use **centred**; durations, pain score and fasting intervals use **uniform**; categorical variants use an unweighted `stream.pick` (equal probability per option). There is currently **no cross-field correlation** anywhere in APP-004 patient generation — every field is an independent draw.

---

## 1. ENV-UNCOMPLICATED-INFLAMMATION

**Source file:** `src/content/diseases/appendicitis/disease.yaml` lines **116–144** (block `physiology_envelopes.uncomplicated_inflammation`; provenance lines 126–144)
**Current review status:** `pending` · `second_review_required: true` · `source: null` · `evidence_strength: NEEDS_SOURCE` · `development_only: true`
**Runtime role:** supplies the baseline vital-sign and inflammatory-marker ranges from which every generated APP-004 patient's initial physiology is drawn.
**Why pilot-blocking:** it is the only physiology envelope APP-004 can use, it is unsourced ("union of legacy authored ranges"), and `patientTruthGovernance.js` records it as non-approved patient truth on every session.
**Learner-visible effect:** the EMS handoff line (e.g. "Т 37.8 °C, ЧСС 106/мин, ЧДД 19/мин, АД сист. 120 мм рт.ст."), every status snapshot, and the numeric lab results the learner reads back (e.g. "ОАК — лейкоциты 12.4, нейтрофилы 82 %", "СРБ 59").
**Existing provenance:** none — `source: null`, `evidence_strength: NEEDS_SOURCE`. Notes field points to `docs/review/APP004_VITALS_LABS_REVIEW_TABLE.md` and states matrix V01/V03/V05 "NOT READY".
**What is already clinically approved:** nothing numeric here. The related qualitative decisions that ARE approved live elsewhere (`FINDINGS-UNIVERSAL-NORMAL-LAYER`, `TRJ-STABLE`) and are not reopened by this review. The reviewer's matrix V01 objection already on record: the top of the HR, RR and temperature ranges reads high for an "ordinary stable" uncomplicated base phenotype.

| Field | Current value / range | Units | What it controls in simulation | Learner-visible consequence | Existing source/provenance | Clinical Lead decision |
| --- | --- | --- | --- | --- | --- | --- |
| `heart_rate` | 72 – 112 | /min | initial `heartRate`, drawn centred, independent of all other fields | shown in EMS handoff and every status snapshot | none (`NEEDS_SOURCE`) | APPROVE / REVISE / REMOVE / DEFER |
| `temperature_c` | 36.7 – 38.5 | °C | initial `temperatureC`, centred, independent | shown in EMS handoff and status snapshots | none | APPROVE / REVISE / REMOVE / DEFER |
| `systolic_bp` | 100 – 140 | mmHg | initial `systolicBp`, centred, independent (no diastolic is modelled or shown) | shown as "АД сист. …" in handoff and snapshots | none | APPROVE / REVISE / REMOVE / DEFER |
| `respiratory_rate` | 14 – 24 | /min | initial `respiratoryRate`, centred, independent | shown in EMS handoff and status snapshots | none | APPROVE / REVISE / REMOVE / DEFER |
| `wbc` | 8 – 18 | ×10⁹/L | initial `wbc`, centred, independent | reported when the learner reads the CBC result | none | APPROVE / REVISE / REMOVE / DEFER |
| `neutrophil_percent` | 65 – 90 | % | initial `neutrophilPercent`, centred, independent | reported with the CBC result | none | APPROVE / REVISE / REMOVE / DEFER |
| `crp` | 2 – 140 | mg/L | initial `crp`, centred, independent | reported when the learner reads the CRP result | none | APPROVE / REVISE / REMOVE / DEFER |

**Object-specific answers (task §4A):**

- **Sampled independently or coherently:** independently. `generatePhysiology` draws each of the seven fields with its own `centred` call from one seed sub-stream; there is no joint distribution and no shared latent "severity" variable.
- **Constraints / correlations:** none. The previous onset-duration coupling ("later presentation → every value higher", matrix V04) was deleted and deliberately not replaced.
- **Appendicitis-specific or generic:** generic. The provenance note calls it a "union of legacy authored ranges", not an appendicitis-specific envelope. The authored replacement structure — linked `minimal` / `moderate` / `marked` inflammatory profiles (`disease.yaml` lines 176+) — exists but ships with `null` ranges and `generation_enabled: false`.
- **Can it generate clinically discordant combinations:** yes. Because the draws are independent, a patient can be generated with, for example, CRP 140 mg/L alongside WBC 8 ×10⁹/L and temperature 36.7 °C, or HR 112 /min with an otherwise unremarkable profile. Nothing prevents an incoherent row.

*No replacement values are proposed here.*

---

## 2. PHENOTYPE-RETROCECAL-APP004

**Source file:** `src/content/diseases/appendicitis/phenotypes.yaml` lines **267–411** (phenotype `retrocecal`; `presentation` 272–327; `imaging` 328–390; provenance 391–411)
**Current review status:** `pending` · `second_review_required: true` · `source: APP004_CLINICAL_REVIEW_MATRIX_v1.0_2026-08-25 §3,§5` · `evidence_strength: expert_consensus`
**Runtime role:** defines the retrocecal APP-004 presenting picture — symptom duration, pain, examination, urinalysis and imaging truth — from which the base pilot patient is generated.
**Why pilot-blocking:** the enclosing phenotype object still generates unreviewed durations, a pain-score range and several unweighted variant selections, so it stays `pending` even though its qualitative wording has been split out and approved.
**Learner-visible effect:** onset hours appear in the history ("боль … 14 часов назад"); pain score appears in status snapshots ("Боль 5.1/10"); the urinalysis line, the ultrasound and CT report text, and the psoas sign are all read back to the learner.
**Existing provenance:** matrix decisions P01–P10 / I01–I09 / V06; `evidence_strength: expert_consensus`; provenance note explicitly states "NO numeric envelope (vitals, labs, appendix diameter, symptom durations beyond the ≤24 h bound) is claimed as reviewed".
**What is already clinically approved:** `PHENOTYPE-RETROCECAL-APP004-QUALITATIVE` (`phenotypes.yaml` lines 412–431) is `approved_for_training` — Clinical Lead + Sarina T.T., 2026-08-31. That approval covers the **wording** of the retrocecal history, examination, imaging and operative truth only. It does **not** cover any number or any variant frequency. This review must not reopen that qualitative approval.

| Field | Current value / range | Units | What it controls in simulation | Learner-visible consequence | Existing source/provenance | Clinical Lead decision |
| --- | --- | --- | --- | --- | --- | --- |
| `hours_from_onset` | 6 – 24 | hours | `onsetHours`, drawn uniform | stated in the history narrative | matrix P04 (≤24 h bound is reviewed; the 6 h floor and uniform shape are not) | APPROVE / REVISE / REMOVE / DEFER |
| `hours_from_onset_extended` | 30 – 36 | hours | authored extended window; **not generated** (`_enabled: false`) | none currently | matrix P04 permits "limited extension"; the window itself unreviewed | APPROVE / REVISE / REMOVE / DEFER |
| `hours_from_onset_extended_share` | `null` | fraction 0–1 | proportion of patients drawn from the extended window if enabled | none currently | `NEEDS_CLINICAL_REVIEW` | APPROVE / REVISE / REMOVE / DEFER |
| `pain_score` | 4 – 8 | 0–10 scale | `preSourceControlPainScore`, drawn uniform | shown in status snapshots as "Боль X/10" | none — no reviewed pain-intensity range | APPROVE / REVISE / REMOVE / DEFER |
| `pain_sites_uncommon_share` | `null` | fraction 0–1 | proportion routed to the two "less often" pain sites (RUQ, right flank); **not generated** (`_enabled: false`) | none currently | `NEEDS_CLINICAL_REVIEW` (matrix P05) | APPROVE / REVISE / REMOVE / DEFER |
| `urinalysis_variants_ru` frequencies | 3 variants, **uniform ~33 % each** | — | which urinalysis line the patient gets: "no significant abnormality" / "single leukocytes" / "single erythrocytes" | the urinalysis result text | matrix V06 (qualitative wording reviewed; relative frequency not) | APPROVE / REVISE / REMOVE / DEFER |
| `self_treatment_variants_ru` frequencies | 3 variants incl. "none", **uniform ~33 % each** | — | whether the history mentions prior self-medication | one clause of the history narrative | matrix P07 (wording reviewed; frequency not) | APPROVE / REVISE / REMOVE / DEFER |
| `imaging.free_fluid_variants` frequencies | 3 variants: none / small RLQ / small pelvic, **uniform ~33 % each** | — | the CT free-fluid sentence | one line of the CT report | matrix I07 (options reviewed; split not) | APPROVE / REVISE / REMOVE / DEFER |
| `imaging.ultrasound_visualized_share` | `null` | fraction 0–1 | proportion where US partially visualizes the appendix; **not generated** (`_enabled: false`) | none currently | `NEEDS_CLINICAL_REVIEW` (matrix I02) | APPROVE / REVISE / REMOVE / DEFER |
| `examination_slot_choices.psoas` | `[положительный, отрицательный]`, **uniform 50 / 50** | — | whether the psoas sign is positive | the examination read-back | matrix P08 (psoas retained as optional; split not reviewed) | APPROVE / REVISE / REMOVE / DEFER |

**Object-specific answers (task §4B):**

- **Already-approved qualitative facts vs still-unapproved numeric calibration:** the *wording* of history, examination, ultrasound report, CT report and operative truth is approved (`…-QUALITATIVE`). Still unapproved: `hours_from_onset` range and shape, `pain_score` range and shape, all four `*_share` values (`null`), and the relative frequencies of the urinalysis / self-treatment / free-fluid / psoas variant lists (currently uniform).
- **Numeric US parameters:** none. `ultrasound_ru` is a fixed qualitative "not reliably visualized" narrative; the one optional visualized variant is disabled and contains no measurement.
- **Numeric CT parameters:** none. **No appendix diameter exists anywhere** in the object — matrix I05 left the diameter range `NEEDS_SOURCE`, and the renderer is explicitly forbidden (with a regression test) from inventing one. The CT report is entirely qualitative section text plus the free-fluid variant sentence.
- **Probabilities:** the four `*_share` fields are all `null` (their variants are disabled). The urinalysis, self-treatment, free-fluid and psoas selections are unweighted — effectively uniform — and are **not** presented anywhere as epidemiological frequencies.
- **Other quantitative phenotype fields:** none beyond `hours_from_onset` and `pain_score`.
- **Which numeric imaging fields are shown / internal / decision-relevant:** none — there are no numeric imaging fields at all. The qualitative imaging text alone determines the report and any downstream runtime decision.
- **Fields that look unnecessary if qualitative truth already suffices (flag only, do not delete):** the four disabled `*_share` fields and their authored-but-unused variant strings add pseudo-precision that the pilot does not currently use; if the Clinical Lead does not intend to enable atypical pain sites, extended durations or partial-US visualization for the first pilot, these can be `REMOVE`d without any runtime change. The uniform variant selections (urinalysis / self-treatment / free-fluid / psoas) are functionally "pick one of these approved sentences" — they need a frequency decision only if the Clinical Lead wants a non-uniform mix.

---

## 3. CAL-NAUSEA-VOMITING-SELECTION-APP004

**Source file:** `src/content/diseases/appendicitis/phenotypes.yaml` lines **78–91** (block `nausea_vomiting_selection_calibration`)
**Current review status:** `pending` · `second_review_required: true` · `source: null` · `evidence_strength: NEEDS_SOURCE`
**Runtime role:** governs how often each of the four coherent nausea/vomiting states is chosen for a generated patient.
**Why pilot-blocking:** it is a `pending` patient-truth calibration entry; the signed review approved the coherent categories but supplied no relative frequencies, so the current uniform development draw remains unapproved.
**Learner-visible effect:** one clause of the history narrative — "тошноты и рвоты нет" / "беспокоит тошнота, рвоты не было" / "была тошнота, рвота однократно" / "была тошнота, рвота дважды".
**Existing provenance:** none — `source: null`. The object stores only `method: uniform_development_only`.
**What is already clinically approved:** the four states and the coherence constraint (no vomiting without nausea) are approved as `SYMPTOM-NAUSEA-VOMITING-COHERENCE` (Clinical Lead, 2026-08-31), whose own note says "Only the coherence constraint is approved. Selection frequency remains a separate blocked calibration."

| Field | Current value / range | Units | What it controls in simulation | Learner-visible consequence | Existing source/provenance | Clinical Lead decision |
| --- | --- | --- | --- | --- | --- | --- |
| `none` weight | ~25 % (uniform 1 of 4) | probability | patient generated with no nausea and no vomiting | history says "тошноты и рвоты нет" | none | APPROVE / REVISE / REMOVE / DEFER |
| `nausea_only` weight | ~25 % (uniform 1 of 4) | probability | nausea, 0 vomiting episodes | history says "беспокоит тошнота, рвоты не было" | none | APPROVE / REVISE / REMOVE / DEFER |
| `nausea_with_single_vomit` weight | ~25 % (uniform 1 of 4) | probability | nausea, 1 vomiting episode | history says "рвота однократно" | none | APPROVE / REVISE / REMOVE / DEFER |
| `nausea_with_repeat_vomit` weight | ~25 % (uniform 1 of 4) | probability | nausea, 2 vomiting episodes | history says "рвота дважды" | none | APPROVE / REVISE / REMOVE / DEFER |

Weights sum to 100 % (uniform over four options). **This is a simulation sampling decision, not a claimed real-world prevalence estimate** — the object stores no epidemiological source and the code comment states the draw "is NOT presented as a reviewed distribution".

---

## 4. FINDINGS-FASTING-HISTORY

**Source file:** `src/content/diseases/appendicitis/findings.yaml` lines **172–195** (block `fasting_history`; provenance 178–195)
**Current review status:** `pending` · `second_review_required: true` · `source: APP004_CLINICAL_REVIEW_MATRIX_v1.0_2026-08-25 PR02, PR03; SRC-ASA-FASTING-2023` · `evidence_strength: expert_consensus`
**Runtime role:** seeds the patient's "when did you last eat / drink" history so the value exists whether or not the learner asks.
**Why pilot-blocking:** the two hour-ranges are simulation seeding of a history fact and are unreviewed; the object is a `pending` patient-truth entry.
**Learner-visible effect:** the patient's spoken answer ("Последний раз ел(а) 10 часов назад, пил(а) воду 2 часов назад") and, if the learner never asks, the anesthesiologist's discovery line.
**Existing provenance:** matrix PR02/PR03 and the 2023 ASA fasting guideline are cited as the *reason the history is collected*, not as a source for the specific hour ranges. Provenance note: "The HOURS RANGES above are simulation seeding of a history fact, not a clinical claim; the consequence of a short fasting interval before emergency surgery is NOT modeled in this pass."
**What is already clinically approved:** the workflow item `PREOP-FASTING-ASSESSMENT-APP004` is `approved_for_training` and **non-blocking** (`blocking: false`), under the Clinical-Lead resident-pilot authorization. The approved decision is that fasting is assessed and recorded and is never a hard stop. The generated interval numbers are not covered by that approval.

| Field | Current value / range | Units | What it controls in simulation | Learner-visible consequence | Existing source/provenance | Clinical Lead decision |
| --- | --- | --- | --- | --- | --- | --- |
| `last_solid_food_hours_ago` | 4 – 10 | hours | `fastingHistory.lastSolidFoodHoursAgo`, drawn uniform (1 decimal) | the "last ate X hours ago" figure in the patient's answer | none for the range itself | APPROVE / REVISE / REMOVE / DEFER |
| `last_clear_liquid_hours_ago` | 1 – 4 | hours | `fastingHistory.lastClearLiquidHoursAgo`, drawn uniform (1 decimal) | the "last drank X hours ago" figure in the patient's answer | none for the range itself | APPROVE / REVISE / REMOVE / DEFER |
| relationship between the two | **none enforced** | — | the two intervals are independent draws | the answer can state a solid-food interval shorter than the clear-liquid interval | not addressed in content | APPROVE / REVISE / REMOVE / DEFER |

**Object-specific answers (task §4D):**

- **Generated categories / probabilities:** none — both fields are plain uniform ranges, no category buckets.
- **Relationships:** none. The generator does not require `last_clear_liquid_hours_ago ≤ last_solid_food_hours_ago`, so a physiologically unusual ordering (drank longer ago than ate) is possible.
- **Generated patient history vs anesthesia/aspiration thresholds vs operative-delay logic — kept separate:**
  1. *Generated patient history* = the two ranges above. This is all this object does.
  2. *Anesthesia / aspiration clinical thresholds* = **not modelled anywhere** in this build. No "wait 6 h / 8 h" rule exists.
  3. *Operative-delay logic* = driven only by the approved route/readiness state machine (consent, IV, anesthesia review, prophylaxis). Fasting is not one of its blockers.
- **Do the generated values themselves trigger any automatic cancellation or delay?** **No.** Grep confirms the values are only stored in `worldState` and rendered as text (`renderEvent.js`); no code path reads them for a threshold, and `fasting_assessment.blocking = false`. A separate approved clinical/anesthesia rule would have to be authored to give them any consequence — and none is authored. *No fasting rule is inferred here from these ranges.*

---

## 5. TRJ-POSTOP-RECOVERY

**Source file:** `src/content/diseases/appendicitis/trajectories.yaml` lines **116–137** (block `post_source_control_course`; provenance 118–137)
**Current review status:** `pending` · `second_review_required: true` · `source: null` · `evidence_strength: NEEDS_SOURCE`
**Runtime role:** *intended* to hold the postoperative recovery trajectory (postoperative pain and bounded physiologic recovery) that begins after source control.
**Why pilot-blocking:** it is a `pending` patient-truth entry, and its content is `model: null` — there is no postoperative recovery model at all, so postoperative patient truth cannot be evaluated.
**Learner-visible effect (of its absence):** after the operation the learner sees "Послеоперационная боль в этой сборке не моделируется: контент послеоперационного восстановления на клиническом рецензировании"; the five clinical discharge-readiness criteria are surfaced as `discharge_runtime_fact` simulator limitations rather than being evaluated.
**Existing provenance:** none — `source: null`. Provenance note: "Matrix T05 NOT READY. Requires a separate postoperative recovery state with postoperative pain and bounded physiologic recovery." The previous per-hour recovery arithmetic (`post_source_control_recovery_per_hour`: pain −0.6, HR −1.5, T −0.05, CRP −3 per hour) was **deleted** in the 2026-08-25 pass and explicitly "replaced by nothing".
**What is already clinically approved:** the *structural* post-source-control state transition happens (`worldState.js` `SOURCE_CONTROL_COMPLETED`), and `TRJ-STABLE` (the pre-operative no-drift course) is approved. The postoperative *trajectory* is not.

| Field | Current value / range | Units | What it controls in simulation | Learner-visible consequence | Existing source/provenance | Clinical Lead decision |
| --- | --- | --- | --- | --- | --- | --- |
| `model` | `null` | — | there is no postoperative recovery model; no milestone, timing, variant, pain curve or vital-sign normalization exists | postoperative pain unmodelled; discharge readiness not clinically evaluated (surfaced honestly as a simulator limitation) | none | APPROVE (accept that no postoperative trajectory is modelled for the first pilot) / REVISE (author a bounded model — see below) / DEFER |

**Object-specific answers (task §4E):**

- **Postoperative timing milestones:** none exist. There is no wake/recovery time, no oral-liquids time, no feeding time, no mobilization time, no urination milestone, no pain trajectory, no vital-sign normalization curve, no discharge-readiness timing and no discharge time in content.
- **Multiple recovery variants / profiles:** none. The original activation task §17 asked for 2–3 seeded uncomplicated recovery variants (quicker-than-typical / typical / slower-but-still-normal); they were not authored.
- **For each milestone — clock start, interval, truth vs narrative, learner-alterable:** not applicable — no milestones are defined.
- **What a REVISE would require:** authoring a new bounded postoperative recovery state with (a) an event that starts the clock (source control complete), (b) functional milestones preferred over per-hour vital-sign arithmetic (§17), (c) explicit statement of which milestones are patient truth vs narrative, and (d) whether learner actions can move them. This is content authoring with clinical input, not a numeric sign-off on existing values.

---

## 6. LAB-CHEMISTRY-ANALYTES-APP004

**Source file:** `src/content/diseases/appendicitis/trajectories.yaml` lines **314–354** (block `chemistry_analytes`; provenance `provenance_chemistry_analytes` 339–354)
**Current review status:** `pending` · `second_review_required: **false**` · `source: Clinical reviewer decision, matrix V07/V08` · `evidence_strength: expert_consensus`
**Runtime role:** defines the biochemistry analytes the learner may name individually (so "БХАК" never auto-populates a full panel) and the qualitative result text each returns.
**Why pilot-blocking:** it is a `pending` patient-truth entry. It asserts, for every analyte, that the APP-004 base patient's result is normal — a claim that has not been signed off.
**Learner-visible effect:** when the learner orders named analytes (e.g. "БХАК: креатинин, электролиты"), the patient's chart returns the qualitative result strings below.
**Existing provenance:** matrix V07/V08 (the decision that "БХАК" must not auto-expand). Provenance note: "Qualitative only. No numeric value or reference range is asserted."
**What is already clinically approved:** the *ordering behaviour* (analytes are individually named, CRP is separately orderable and never auto-added) follows matrix V07/V08. The *result claim* — that each analyte is within reference range for this patient — is the pending part.

| Analyte | Current value / result | Units | Abnormal value possible? | Affects clinical decisions or panel-only? | Sex/age/phenotype influence? | Existing source/provenance | Clinical Lead decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `creatinine` | "в пределах референсных значений" (qualitative) | none stored | no | may inform the (hospital-policy) creatinine-before-contrast-CT consideration, but only as "within range" | none | matrix V07/V08 | APPROVE / REVISE / REMOVE / DEFER |
| `urea` | "в пределах референсных значений" | none | no | panel-only | none | matrix V07/V08 | APPROVE / REVISE / REMOVE / DEFER |
| `electrolytes` (Na, K) | "натрий и калий в пределах референсных значений" | none | no | panel-only | none | matrix V07/V08 | APPROVE / REVISE / REMOVE / DEFER |
| `glucose` | "в пределах референсных значений" | none | no | panel-only | none | matrix V07/V08 | APPROVE / REVISE / REMOVE / DEFER |
| `bilirubin` (total, direct) | "общий и прямой билирубин в пределах референсных значений" | none | no | panel-only | none | matrix V07/V08 | APPROVE / REVISE / REMOVE / DEFER |
| `alt_ast` (ALT, AST) | "АЛТ и АСТ в пределах референсных значений" | none | no | panel-only | none | matrix V07/V08 | APPROVE / REVISE / REMOVE / DEFER |
| `amylase` | "в пределах референсных значений" | none | no | panel-only (differential reassurance) | none | matrix V07/V08 | APPROVE / REVISE / REMOVE / DEFER |
| `total_protein` | "в пределах референсных значений" | none | no | panel-only | none | matrix V07/V08 | APPROVE / REVISE / REMOVE / DEFER |

**Object-specific answers (task §4F):**

- **Every analyte generated:** the eight listed above. `betahcg` has an ETA entry for ordering but is not part of this analyte set (APP-004 excludes pregnancy).
- **Numeric range / value:** none for any analyte — the object stores only a `label_ru` and a qualitative `result_ru`.
- **Abnormal values possible:** no. Every analyte always returns "within reference range"; there is no variant, no draw, no phenotype branch.
- **Affects clinical decisions or only appears in a panel:** all eight are panel-only reassurance. `creatinine` is the only one with any downstream link (contrast-CT policy), and even that consumes the qualitative "within range", not a number.
- **Sex/age/phenotype influence:** none.
- **Note:** a familiar-looking laboratory "normal range" is not proposed here and should not be assumed acceptable merely because it is conventional — the decision is whether the APP-004 base patient's chemistry is *claimed normal* at all, and if so on what authority.

---

## Are all six numeric calibrations actually necessary for the pilot?

This is an engineering / content-dependency assessment, not a clinical decision.

| Object | Required for APP-004 pilot patient coherence? | Could be simplified without losing the educational objective? | Could be excluded from active patient truth for the pilot? | Why |
| --- | --- | --- | --- | --- |
| `ENV-UNCOMPLICATED-INFLAMMATION` | **Technically required.** Every generated patient needs vitals and CBC/CRP values; there is no other physiology source. | Yes — the authored `minimal/moderate/marked` profile structure could replace the seven independent ranges with a smaller coherent set. | No — a patient cannot be instantiated without it. | Physiology is read out at triage, in every status snapshot and in lab results. |
| `PHENOTYPE-RETROCECAL-APP004` (numeric remainder) | **Partly.** `hours_from_onset` and `pain_score` are required (history and status snapshot need them). The four `*_share` fields and the variant frequencies are **currently used but redundant** — disabled or uniform. | Yes — the disabled `*_share` variants can be removed; the uniform variant lists can stay as "pick one approved sentence" without a frequency decision. | The numeric ranges: no. The disabled/optional variant machinery: yes. | Onset and pain drive learner-visible narrative; the rest is unused pseudo-precision. |
| `CAL-NAUSEA-VOMITING-SELECTION-APP004` | **Technically optional.** The four states are approved; only their mix is unreviewed. A uniform draw is functional. | Yes — accepting the uniform draw as a stated simulation choice removes the blocker without new numbers. | Yes — the coherence constraint (approved) is what matters clinically; the frequency is diversity-only. | It changes only how often each history sentence appears. |
| `FINDINGS-FASTING-HISTORY` | **Technically required** (the history fact must exist) **but the specific ranges are optional.** | Yes — could collapse to one or two fixed representative values, or a narrower range. | The ranges: yes (fixed values would work). The fact: no. | Fasting history must be answerable; the exact hours have no runtime consequence. |
| `TRJ-POSTOP-RECOVERY` | **Cannot determine / technically optional for the current slice.** The case already completes to discharge with the recovery trajectory absent and the gap surfaced honestly. | Not applicable — nothing to simplify; it is empty. | Yes — it can stay excluded (DEFER) and the pilot still runs, with postoperative recovery declared unmodelled. | Journey A reaches `PATIENT_DISCHARGED` today without it. |
| `LAB-CHEMISTRY-ANALYTES-APP004` | **Technically optional.** The learner can be told an analyte result is unavailable/unmodelled instead of "normal". | Yes — either accept the qualitative "normal" claim, or return "not modelled" for analytes the Clinical Lead does not want claimed. | Yes — the case does not depend on any chemistry value. | Chemistry is reassurance text; no runtime decision needs a number. |

Purpose of this table: identify unnecessary pseudo-precision. It does not decide clinical removal.

---

## What happens after Clinical Lead review?

*No action below is executed now.*

### APPROVE
- The object's `provenance.review_status` moves `pending → approved_for_training` (edited in the YAML file named in each section, inside the `provenance:` block only).
- These provenance fields must be filled in the same block: `reviewed_by: ["Botagoz Kaukenova — Clinical Lead"]`, `reviewed_at: "<date>"`, `source` and `evidence_strength` set to the real basis, and — where `second_review_required: true` — `second_reviewed_by` / `second_reviewed_at`, or an explicit recorded authorization if a second review is genuinely not obtained.
- If a single object mixes approved and still-unapproved values, the object is split (as `PHENOTYPE-RETROCECAL-APP004-QUALITATIVE` already was) rather than promoted whole.
- Reruns: `npm run content:check`, `npm test` (the governance allow-list and provenance tests), the patient-truth inventory, and the session-purpose gate. When the last pending APP-004 patient-truth object is approved, `inventoryPatientTruth(...).approved` becomes `true` and `patientTruthApproved` flips to `true`.

### REVISE
- Revised values are entered in the same YAML block, replacing the current range/value; `review_status` **stays** `pending` until the revised values are explicitly re-reviewed.
- Regression tests affected: `patientGenerator.test.js` (range assertions), `app004Remediation.test.js` (age/phenotype bounds, "no fixed pain −3", vitals-not-invented), `coreRuntimeContract.test.js` (status snapshot wording), and the smoke replay `docs/evidence/APP004_POST_REVIEW_SMOKE_REPLAY.json` (byte-identical replay for the same seed will change and must be regenerated).
- Approval remains closed; the gate stays NO-GO.

### REMOVE
- The object is made inert without deleting it: for a range, delete the numeric fields and the code path that draws them, leaving the qualitative behaviour; for a disabled variant (`*_enabled: false`, `*_share: null`), delete the authored variant strings and the branch in `patientGenerator.js` that would use them.
- Dependencies to clean up: the corresponding `draw*` call in `core/patient/patientGenerator.js`, any assertion in `patientGenerator.test.js`, and the inventory entry in `core/patient/patientTruthGovernance.js` if the whole object goes away.
- Audit history is preserved — the provenance block and a `removed_because` note stay in the file (same pattern as `discharge_criteria_explicitly_removed`, `removed_preop_requirements`).

### DEFER
- The object stays `pending` and the APP-004 `case_presets` entry keeps a non-pilot `runtime_status`, so `evaluateSessionAudience` continues to refuse a `learner_pilot` session.
- The build remains usable in `internal_development` / `faculty_preview`.
- The deferred object is listed in the completion report and manifest as an explicit remaining blocker.

### Separate lock (not part of this numeric review)
Even if all six objects are approved, `src/content/diseases/appendicitis/phenotypes.yaml` `case_presets[APP-004].runtime_status` is currently `development_only`. The gate refuses `learner_pilot` at the preset level first (`preset_not_learner_enabled`) before it checks patient truth. Promoting that `runtime_status` to `learner_enabled` / `approved_for_training` is a deliberate, separate Clinical-Lead governance action.

---

## Clinical Lead sign-off checklist — DECISIONS RECORDED 2026-08-31

Marked by Botagoz Kaukenova — Clinical Lead. Instruction: **targeted remediation, not 30 independent promotions.** Applied to the repository on 2026-08-31 (see "Decisions applied" below). Items marked REVISE, and every item whose object carries an outstanding `second_review_required`, are **held at `review_status: pending`** — the revised/authored values are in the YAML and covered by regression tests, but promotion to `approved_for_training` waits on the recorded re-review / second review. `patient_truth_approved` stays `false`; the pilot gate stays **NO-GO**.

### ENV-UNCOMPLICATED-INFLAMMATION  (`disease.yaml`)
- [x] **REVISE** — switch from seven independent centred ranges to the linked `minimal` / `moderate` / `marked_but_stable` inflammatory profiles. **The Clinical Lead supplied the verbatim calibration ranges and selection weights** (`minimal` HR 72–90 · T 36.6–37.5 · sBP 105–140 · RR 14–18 · WBC 8.0–11.5 · neut 65–78 · CRP 2–25; `moderate` HR 80–98 · T 37.0–38.0 · sBP 105–140 · RR 14–20 · WBC 10.5–14.5 · neut 72–85 · CRP 10–60; `marked_but_stable` HR 90–104 · T 37.5–38.2 · sBP 100–135 · RR 16–21 · WBC 13.0–16.5 · neut 80–90 · CRP 40–100). Selection weights **0.30 / 0.50 / 0.20** — labelled simulation-diversity only, not prevalence. Every physiology/lab field is drawn from ONE selected profile (centred), never mixed. Systolic BP is now per-profile. The generator selection mechanism (`inflammatory_profiles.selection` + `selectInflammatoryProfile`) is in place with `generation_enabled: false`, so it stays **dormant** and generation still uses the development-only union envelope. ENV + the three PROFILE objects stay `pending` pending independent second clinical review. Guardrail added: once `generation_enabled` is flipped, an APP-004 `learner_pilot` / `production` session **fails** (`inflammatory_calibration_*`) rather than falling back to the union envelope, and `selectInflammatoryProfile` throws on any missing / unapproved / invalid profile.

### PHENOTYPE-RETROCECAL-APP004  (`phenotypes.yaml`) — held `pending` (2nd review outstanding)
- [x] Symptom duration 6–24 h, uniform : **APPROVE**
- [x] Pain score 4–8 /10, uniform : **APPROVE**
- [x] Extended duration window 30–36 h + share : **REMOVE** (deleted from content and generator; audit note kept)
- [x] Uncommon pain sites (RUQ / right flank) + share : **REMOVE**
- [x] Ultrasound partial-visualization variant + share : **REMOVE**
- [x] Urinalysis variant mix : **REVISE → weights 60 / 20 / 20** (no abnormality / single leukocytes / single erythrocytes)
- [x] Self-treatment variant mix : **APPROVE (uniform)**
- [x] CT free-fluid variant mix : **REVISE → weights 70 / 15 / 15** (none / small RLQ / small pelvic)
- [x] Psoas sign positive/negative : **REVISE → 25 / 75** (positive is the less common finding)

### CAL-NAUSEA-VOMITING-SELECTION-APP004  (`phenotypes.yaml`) — held `pending` (2nd review outstanding)
- [x] Four-state mix : **APPROVE (uniform)** as a non-epidemiological simulation-sampling draw (`method: uniform_simulation_sampling`, `is_epidemiological_estimate: false`). Not a prevalence claim.

### FINDINGS-FASTING-HISTORY  (`findings.yaml`) — held `pending` (2nd / anaesthesia review outstanding)
- [x] Last solid food 4–10 h, uniform : **APPROVE**
- [x] Last clear liquid 1–4 h, uniform : **APPROVE**
- [x] Ordering constraint : **REVISE → require clear-liquid-hours ≤ solid-food-hours** (generator invariant + regression test `clear-liquid-hours ≤ solid-food-hours`). No anaesthesia threshold and no automatic operative delay are modelled from these values.

### TRJ-POSTOP-RECOVERY  (`trajectories.yaml`) — held `pending` (re-review of authored model outstanding)
- [x] **REVISE** — author a bounded, criteria-based uncomplicated postoperative recovery model: two seeded windows `early_recovery` 6–12 h and `overnight_recovery` 12–24 h, 50 / 50 (simulation diversity, **not** prevalence, **not** guideline LOS); functional milestones across the eight named recovery domains; postoperative pain as qualitative bounded states `significant → improving → controlled_on_oral_analgesia` (no numeric pain-decay curve); **no** per-hour HR/T/CRP arithmetic; **no** automatic discharge at 6/12/24 h; discharge criteria evaluated individually from current patient state — window end is an expectation, never an override of an unmet criterion. The model is authored to this brief but **ships dormant** (`review_status: pending`), so `advanceTime.js` keeps recording the simulator limitation until a clinical re-review.

### LAB-CHEMISTRY-ANALYTES-APP004  (`trajectories.yaml`) — **PROMOTED to `approved_for_training`**
- [x] All eight analytes claimed "within reference range" for the base APP-004 patient : **APPROVE**. Base-case reassurance claim, no phenotype/sex/age variant, no numeric consumer. `second_review_required: false` (a qualitative all-normal base-case claim of this scope does not require an independent second review). `reviewed_by: ["Botagoz Kaukenova — Clinical Lead"]`, `reviewed_at: "2026-08-31"`.

### Separate governance action
- [x] Promote `case_presets[APP-004].runtime_status` from `development_only` : **NO — not done.** Held at `development_only` pending remediation, second-review requirements and release tests, per Clinical Lead instruction.

---

## Verification

### 1. Files inspected (read-only)

| File | Purpose |
| --- | --- |
| `src/content/diseases/appendicitis/disease.yaml` | ENV-UNCOMPLICATED-INFLAMMATION, inflammatory_profiles scaffold |
| `src/content/diseases/appendicitis/phenotypes.yaml` | PHENOTYPE-RETROCECAL-APP004 (+ QUALITATIVE), CAL-NAUSEA-VOMITING-SELECTION-APP004, demographics, nausea/vomiting states, APP-004 case preset |
| `src/content/diseases/appendicitis/findings.yaml` | FINDINGS-FASTING-HISTORY |
| `src/content/diseases/appendicitis/trajectories.yaml` | TRJ-POSTOP-RECOVERY, LAB-CHEMISTRY-ANALYTES-APP004, treatment_effects |
| `src/content/generated/appendicitis.json`, `shared.json` | compiled bundle used for the inventory / gate check |
| `src/core/patient/patientGenerator.js` | how each field is drawn (centred vs uniform, independence) |
| `src/core/patient/patientTruthGovernance.js` | which objects the release gate inventories for APP-004 |
| `src/core/session/sessionPurpose.js`, `createSession.js` | the two-lock release gate |
| `src/ai/renderer/renderEvent.js` | fasting-history rendering; confirms values are display-only |
| `src/core/state/worldState.js` | fasting-history storage; confirms no threshold consumer |
| `docs/review/APP004_CLINICAL_APPROVAL_MANIFEST_2026-08-31.md` + `.json`, `APP004_CLINICAL_ACTIVATION_DELTA_2026-08-30.md`, `APP004_SOURCE_CONFLICT_MAP_2026-08-30.md`, `APP004_VITALS_LABS_REVIEW_TABLE.md`, `docs/APP004_CLINICAL_ACTIVATION_COMPLETION_REPORT_2026-08-31.md` | cross-check of the blocker set |

Read-only validation run: `inventoryPatientTruth({ bundle, casePresetId: "APP-004" })` and `evaluateSessionAudience(... sessionPurpose: "learner_pilot" ...)`. No test suite, build, or content command was needed and none modified state.

### 2. Six objects found

| # | Object ID | File | Lines | Status | Holds numbers today? |
| --- | --- | --- | --- | --- | --- |
| 1 | `ENV-UNCOMPLICATED-INFLAMMATION` | `disease.yaml` | 116–144 | pending | yes — 7 ranges |
| 2 | `PHENOTYPE-RETROCECAL-APP004` | `phenotypes.yaml` | 267–411 | pending | partly — 2 ranges + 4 null shares + uniform variant lists |
| 3 | `CAL-NAUSEA-VOMITING-SELECTION-APP004` | `phenotypes.yaml` | 78–91 | pending | no — stores only `method: uniform_development_only` |
| 4 | `FINDINGS-FASTING-HISTORY` | `findings.yaml` | 172–195 | pending | yes — 2 ranges |
| 5 | `TRJ-POSTOP-RECOVERY` | `trajectories.yaml` | 116–137 | pending | no — `model: null` |
| 6 | `LAB-CHEMISTRY-ANALYTES-APP004` | `trajectories.yaml` | 314–354 | pending | no — qualitative result strings only |

### 3. Individual decisions the Clinical Lead must make

**30 item decisions** in the checklist — ENV 8 · PHENOTYPE-RETROCECAL 9 · CAL-NAUSEA 1 · FINDINGS-FASTING 3 · TRJ-POSTOP-RECOVERY 1 · LAB-CHEMISTRY 8 — plus **1 separate governance action** (`runtime_status` promotion), for 31 checkboxes total. Of the 30, **11 are true numeric-range decisions** (the 7 ENV ranges + `hours_from_onset` + `pain_score` + the 2 fasting ranges); the remaining 19 are sampling-frequency, enable/disable, qualitative-claim, or structural-authoring decisions.

### 4. Numeric fields that appear technically unnecessary

- `PHENOTYPE-RETROCECAL-APP004`: `hours_from_onset_extended` + `hours_from_onset_extended_share`, `pain_sites_uncommon_share`, `ultrasound_visualized_share` — all disabled (`*_enabled: false`, share `null`), unused by the pilot, safe to `REMOVE` if the Clinical Lead does not intend to enable atypical presentations for the first pilot.
- `PHENOTYPE-RETROCECAL-APP004`: the urinalysis / self-treatment / free-fluid / psoas variant selections are functionally "pick one approved sentence" and need a frequency decision only if a non-uniform mix is wanted.
- `LAB-CHEMISTRY-ANALYTES-APP004`: no numeric field exists; the case has no dependency on any chemistry value.
- `TRJ-POSTOP-RECOVERY`: no numeric field exists; Journey A reaches discharge without it.

### 5. Provenance gaps

- `ENV-UNCOMPLICATED-INFLAMMATION`, `CAL-NAUSEA-VOMITING-SELECTION-APP004`, `TRJ-POSTOP-RECOVERY`: `source: null`, `evidence_strength: NEEDS_SOURCE` — no citation of any kind.
- `PHENOTYPE-RETROCECAL-APP004`, `FINDINGS-FASTING-HISTORY`, `LAB-CHEMISTRY-ANALYTES-APP004`: cite a review-matrix decision and (for fasting) a guideline as the *reason the field exists*, but no source for the specific numeric ranges or the "normal" claim.
- `LAB-CHEMISTRY-ANALYTES-APP004` has `second_review_required: false` while the other five have `true` — the Clinical Lead should confirm whether a chemistry "all normal" claim needs a second review.

### 6. Confirmation of no modification

No source file, generated content, `review_status`, provenance field, `patientTruthApproved` value, release-gate logic, or `runtime_status` was changed by this task. The only file created is this document. `git status` shows one new untracked file: `docs/review/APP004_NUMERIC_CALIBRATION_REVIEW_2026-08-31.md`.

### 7. Cross-check against existing review artifacts

- **Exactly these six objects are the remaining APP-004 patient-truth blockers** — confirmed against `inventoryPatientTruth` (6 blocked entries), the manifest JSON `app004_active_pending_blockers` (identical six), the completion report §16, and the activation delta `STILL_BLOCKED` rows.
- **No seventh numeric/patient-truth object is silently active and pending** — the inventory returns 12 entries (6 approved, 6 blocked); all other `pending` content in the bundle (other phenotypes, V35 envelopes, `EFFECT-ANALGESIA-*`, `MED-KETOROLAC-PENDING`, file-level rollups) is not on the APP-004 generation path.
- **Already-approved qualitative decisions are not reopened** — `DEMOGRAPHICS-APP-BASE-ADULT`, `SYMPTOM-NAUSEA-VOMITING-COHERENCE`, `PHENOTYPE-RETROCECAL-APP004-QUALITATIVE`, `FINDINGS-HISTORY-BUNDLE`, `FINDINGS-UNIVERSAL-NORMAL-LAYER`, `TRJ-STABLE` remain `approved_for_training`; this document touches none of them.
- **No pending object affects resident-facing scoring or safety authority** — there is no numeric competence score in the build; all six blockers are `authority_layer: patient_truth` and runtime-inert (`isRuntimeAuthoritative` is false for `pending`); none is a rule or a Level-4 safety object.

**Reported discrepancies (not repository inconsistencies):**
1. The task frames all six as "numeric calibration"; in fact only three carry stored numbers. The other three block as pending inventory entries and need qualitative/structural decisions. The repo, manifest, delta and inventory are mutually consistent on the six-object set, so this is a framing nuance, not an inconsistency.
2. The release gate has a second, independent lock: `case_presets[APP-004].runtime_status = development_only` causes `preset_not_learner_enabled` before patient truth is even checked. Promoting it is a separate Clinical-Lead action. This is consistent with the Clinical Governance spec (content status is never self-promoted).

---

## Decisions applied 2026-08-31 (targeted remediation)

| Object | Decision | Repository change | `review_status` after |
| --- | --- | --- | --- |
| `LAB-CHEMISTRY-ANALYTES-APP004` | APPROVE (all 8 qualitative) | provenance promoted, `reviewed_by` / `reviewed_at` set | **`approved_for_training`** |
| `PHENOTYPE-RETROCECAL-APP004` | APPROVE 6–24 h + pain 4–8; REMOVE 3 disabled branches; REVISE urinalysis 60/20/20, CT fluid 70/15/15, psoas 25/75; self-treatment uniform | `phenotypes.yaml` presentation/imaging rewritten; `patientGenerator.js` dead branches removed; new `drawWeightedVariant` helper + `*_weights` arrays | `pending` (2nd review outstanding) |
| `CAL-NAUSEA-VOMITING-SELECTION-APP004` | APPROVE uniform as non-epidemiological sampling | `method: uniform_simulation_sampling`, `is_epidemiological_estimate: false`, provenance records Clinical Lead | `pending` (2nd review outstanding) |
| `FINDINGS-FASTING-HISTORY` | APPROVE 4–10 / 1–4; add invariant liquid ≤ solid; no threshold/delay | `findings.yaml` flag `enforce_clear_liquid_not_after_solid_food`; generator clamp; new regression test | `pending` (2nd / anaesthesia review outstanding) |
| `TRJ-POSTOP-RECOVERY` | REVISE — author bounded criteria-based model | `trajectories.yaml` `post_source_control_course` model authored (2 windows 6–12 / 12–24 h @ 50/50, qualitative pain states, no per-hour arithmetic); `patientGenerator.js` seeds `truth.postopRecoveryVariantId` | `pending` — **model ships dormant** |
| `ENV-UNCOMPLICATED-INFLAMMATION` | REVISE — linked 3-profile calibration | `disease.yaml` `inflammatory_profiles` populated with the Clinical Lead's verbatim `minimal` / `moderate` / `marked_but_stable` ranges + weights `0.30/0.50/0.20`; `patientGenerator.js` `selectInflammatoryProfile` (single profile, centred, no cross-profile mixing, throws instead of union fallback when enabled); `createSession.js` `evaluateInflammatoryCalibrationForPilot` guardrail. Mechanism **dormant** (`generation_enabled: false`) — generation still uses the union envelope | `pending` |

**Verification after the changes:** `npm run content:check` OK · `npm test` 298/298 · `npx playwright test` 4/4 · `eslint` clean · `node scripts/smokeApp004.mjs` completes Journey A to discharge with all five remaining blockers reported as `pending` simulator limitations and `TRJ-POSTOP-RECOVERY` recorded as `postoperative_recovery … (pending)`.

**Still open before GO:**
1. Independent second clinical review of `ENV-UNCOMPLICATED-INFLAMMATION` + `PROFILE-INFLAMMATORY-MINIMAL` / `-MODERATE` / `-MARKED`. On approval: promote all four, set `inflammatory_profiles.selection.generation_enabled: true`, and confirm the guardrail (APP-004 `learner_pilot` must draw from the profiles, never the union envelope).
2. Clinical re-review of the authored `TRJ-POSTOP-RECOVERY` model.
3. Independent second review of `PHENOTYPE-RETROCECAL-APP004` (numeric), `CAL-NAUSEA-VOMITING-SELECTION-APP004`, `FINDINGS-FASTING-HISTORY`.
4. Only after 1–3 and the release tests pass: promote `case_presets[APP-004].runtime_status`.

## FINAL STATUS

**REMEDIATION_APPLIED — STILL NO-GO FOR RESIDENT PILOT**

Targeted remediation of the six blockers is in the repository. One object (`LAB-CHEMISTRY-ANALYTES-APP004`) is promoted; the other five carry recorded Clinical Lead decisions but are held at `review_status: pending` pending re-review / second review. `patient_truth_approved` is still `false` and `case_presets[APP-004].runtime_status` is still `development_only`. This document does not and cannot return `GO_FOR_RESIDENT_PILOT`.

**Document path:** `docs/review/APP004_NUMERIC_CALIBRATION_REVIEW_2026-08-31.md`

---

## UPDATE — 2026-09-01: "still open before GO" items 1 and 3 closed; item 2 partly closed

This section records what changed after the "Still open before GO" list above; the body
above is left as the 2026-08-31 historical record. Full detail: `docs/review/APP004_FINAL_SECOND_REVIEW_PACKET_2026-09-01.md`,
`docs/review/APP004_POSTOP_CLOCK_ANCHOR_REREVIEW_2026-09-01.md`, `docs/review/APP004_CLINICAL_APPROVAL_MANIFEST_2026-08-31.md` §F.

- **Item 1 (ENV + 3 profiles), closed:** independent second review received (`Second Clinical
  Reviewer Decision.md`, Sarina T.T., 2026-09-01) — APPROVED. All four promoted to
  `approved_for_training`, `inflammatory_profiles.selection.generation_enabled: true`. The union
  envelope's own `review_status` stays `pending` (never itself Clinical-Lead first-reviewed).
- **Item 3 (RETROCECAL, CAL-NAUSEA, FASTING), closed:** same second review — all three APPROVED
  and promoted to `approved_for_training` with recorded `second_reviewed_by`/`second_reviewed_at`.
- **Item 2 (`TRJ-POSTOP-RECOVERY`), partly closed:** the second reviewer REVISED — the recovery-clock
  anchor (`SOURCE_CONTROL_COMPLETED`) was clinically incorrect. Fixed in code to `PROCEDURE_COMPLETED`
  (`core/state/worldState.js`, `core/time/advanceTime.js`). The object stays `review_status: pending`
  awaiting a focused re-review of the fix alone; no other part of the model changed.
- **Item 4 (`runtime_status` promotion):** still **NOT DONE**. `patient_truth_approved` stays `false`
  (two objects still block it: the union envelope, `TRJ-POSTOP-RECOVERY`). Pilot gate stays
  `NO_GO_FOR_RESIDENT_PILOT`.

**Verification 2026-09-01:** `npm run content:check` / `content:build` OK · `npm test` 307/307 ·
`npx playwright test` 4/4 · `eslint` clean · `node scripts/smokeApp004.mjs` completes Journey A to
discharge, simulator limitations reduced to exactly the two still-pending objects plus the five
governed discharge criteria.

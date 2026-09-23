# Wave B — Fluids Migration Map (draft)

Source: `onqol-trainer/cases/2026-09-25-fluids-01.md` v1.2 (see [`WAVE_B_FLUIDS_SOURCE_MANIFEST.md`](./WAVE_B_FLUIDS_SOURCE_MANIFEST.md)).

**Status: DRAFT.** `review_status` and `runtime authority` columns marked `OPEN` below are blocked on the governance question in the accompanying chat message — nothing in this table has been promoted to `approved_for_training`, and nothing will be until that question is answered. This map is the skeleton the user asked to argue with, not a finished decision record.

## A. Patient truth (hidden, `state.truth` — mentor/interpreter never see it directly)

| Source location | Content | Destination | Notes |
|---|---|---|---|
| Часть B, "Пациент" | 61M, 82kg, sigmoid resection POD1, EBL 300mL, intraop 2.5L NS, HTN on metoprolol succinate 100mg (long-acting, taken 21:00 previous day), baseline BP 140/85 | `patient.truth.demographics/history/operative` | Fixed, not generated — see open question 2 |
| Часть B, "Устройства" | NG tube (reason: distension/vomiting, explicit deviation from ERAS routine), pelvic drain (reason: difficult dissection), Foley | `patient.truth.devices[]` with `reason` field | Reasons matter pedagogically (residents must know *why* a device exists, not just that it exists) |
| Часть B, "Баланс" table | I/O since end of op (10h): in ≈1500mL, out ≈1200mL, visible balance +300mL; explicit note that insensible losses + third-spacing are NOT in this balance | `patient.truth.fluidBalance` (structured, not prose) | The case explicitly warns the balance is misleading — this must survive as structured data the mentor can reference without editorializing |
| Часть B, "Жизненные показатели" / "Осмотр" / labs table | Baseline vitals, exam findings, full labs (Na/K/Cl/urea/Cr/Hb/lactate/glucose/ABG/urine SG/ECG/troponin) | `patient.truth.vitals`, `.examFindings`, `.labs` (each keyed for the disclosure-gate) | Lab result explicitly has a 20-minute turnaround in the source — real timing, see §C below |
| "Как формулировать ОПП" | AKI staging reasoning (creatinine criterion met, urine-output criterion explicitly NOT yet met at 6h) | `patient.truth.physiology.akiStage` computed, not asserted | The source is explicit that a premature "AKI by urine output" claim is a *known resident error to avoid asserting* — this is a constraint on the mentor, not just a fact |

## B. Learner-visible disclosure gating

| Source rule (tutor.js COMMON block) | vNext mechanism |
|---|---|
| "Выдавай ровно то, что резидент запросил... не больше" (dosed disclosure, no over-answering) | `learnerView.js` / exam-command handlers already gate by requested slot for appendicitis; same pattern applies — no new mechanism needed, new *content* (which labs/exam findings exist to be gated) |
| "Общая просьба слишком широка: попроси уточнить" (broad request → clarify) | Existing `CLARIFICATION_REQUESTED` path; per ТЗ §11 broad-but-clinically-clear actions (e.g. "оценю перфузию") should still resolve broadly where vNext's own philosophy allows it — this is the one place donor behavior (always ask to narrow) and vNext's stated §11 intent (don't demand micro-step enumeration) diverge; flagged as open question 3 |
| Lab result available 20 minutes after order | vNext's `core/time/` + pending-result mechanism (already exists for appendicitis workup) — reuse, not new content |

## C. Treatment effects (runtime-owned, not mentor-owned)

Source: Часть B, "Ответы на действия резидента (ветвления)" — a literal deterministic table.

| Learner action | Response (verbatim from source) |
|---|---|
| Bolus 500mL balanced crystalloid <15min | HR 104, BP 112/68, CRT 2.5s, next-hour UOP 35mL, clear lungs |
| Repeat bolus 250–500mL | HR 96, BP 122/74, CRT 2s, UOP 55mL/h, clearer sensorium |
| 0.9% NaCl instead of balanced | Same hemodynamic effect; repeat ABG shows Cl 114, HCO₃⁻ 16 |
| >2.5L boluses total, unreassessed | RR 26, SpO₂ 92%, crackles (overload) |
| Furosemide | UOP 80mL/h, BP 92/54, HR 122, lactate 3.4 (worsening) — this is also **C1 critical-flag territory** |
| No intervention | 1h later: BP 94/58, HR 124, UOP 5mL/h, lactate 3.4 |
| Bleeding/leak workup | No overt bleeding signs (serous drain, no peritonism, stable Hb) but explicitly **does not rule it out** if resuscitation response is poor |
| Call senior | Senior accepts handoff, tells resident to continue resuscitating |

Fluid-choice sub-table (Стерофундин/Рингер-лактат/Хартмана = balanced; "Рингера" without lactate = NOT balanced, a realistic name-confusion trap; NS = acceptable-but-not-preferred; colloid/albumin/dextrose/bicarbonate/blood = each has an explicit "no indication, ask for justification" response) migrates the same way.

**This is already the reviewed physiology** — it is not something Wave B needs to invent (ТЗ §14/§60 STOP-condition-4 concern does not apply here). It needs to become `patient.responseEnvelope`/treatment-effect data in the same shape `appendicitis`'s reviewed rules use, gated behind whatever `review_status` the governance question below resolves to.

## D. Clinical claims → candidate cards

Extracted from Часть A ("Карточка темы") and the Часть B footnotes. Each becomes one atomic card candidate. Representative sample (full set is ~20-25 cards once split to the "one claim per card" grain the ТЗ §19 requires):

| Claim | Source citation (as the case states it) | Candidate `risk_class` |
|---|---|---|
| Resuscitation bolus: 500mL crystalloid <15min, reassess, repeat 250–500mL if needed | NICE CG174 §1.3.1 (checked PDF) | high (dosing) |
| Repeat-bolus / "2000mL → call senior" threshold | Source explicitly flags this as **not found** in the NICE PDF it checked, attributed to an algorithm not included in that PDF | **pending_review — provenance gap acknowledged by the source itself, do not upgrade this one silently** |
| Maintenance 25–30 mL/kg/day + ~1 mmol/kg/day Na/K/Cl; reduce to 20–25 mL/kg/day in renal/cardiac failure | NICE CG174 §1.4.1, §1.4.3 (checked PDF) | high (dosing) |
| Potassium must never go in infusion bags; use premixed solutions | NICE CG174 §1.4.1 (checked PDF) | high (safety) |
| Balanced crystalloid preferred for bolus + maintenance | ASCRS/SAGES ERAS 2023 rec. 14 (strong, 1B, checked PDF) | medium |
| No routine colloid benefit for boluses | ASCRS/SAGES ERAS 2023 rec. 14 (checked PDF) | medium |
| Starches contraindicated | SSC 2026 (strong) | high (safety) |
| Crystalloid without added albumin (exceptions: large volumes, cirrhosis) | SSC 2026 (conditional) | medium |
| CRT >2s / other NICE hypoperfusion signs; textbook's 1.5s threshold explicitly rejected in favor of NICE's 2s | NICE §1.2.1 (checked PDF) vs. textbook (rejected) | medium |
| Diuretic-for-oliguria is the #1 resident error (C1 critical flag) | Case's own pedagogical synthesis, not a guideline citation | medium — this is a *teaching claim*, not a dosing claim; see open question 4 on how non-guideline pedagogical synthesis should be classed |
| AKI staged by creatinine criterion only here; 6h urine-output criterion not yet met, cannot claim "AKI by output" | KDIGO 2012 | high (diagnostic-claim safety — a premature/incorrect stage claim is exactly the kind of unsupported clinical claim §37 verification must block) |

Four items the source explicitly marks as "учебник неправ, в кейс не перенесены" (textbook errors deliberately excluded — 0.5mg/kg/h units bug, BUN/Cr>12 threshold, outdated glucose/KCl regimen, burns) are **not migrated as cards at all** — they exist only as documentation of what was deliberately rejected, so a future author doesn't reintroduce them.

## E. Teaching objectives (non-linear, per ТЗ §22)

From "Что должен уметь резидент" — 4 objectives (2-minute perfusion/volume assessment; distinguish resuscitation/maintenance/replacement; bolus→reassess→decide loop; avoid overload and the diuretic-for-oliguria error) plus rubric items 1–14. These become teaching-candidate *domains*, not a checklist sequence — matches existing `mentorEngine.js` issue-detection shape, no new mechanism, new content only.

## F. Hint ladder → scaffolding

Source's 3-level ladder (naводящий/прямой вопрос/прямой ответ, tagged `<<HINT item=N level=L>>`) maps onto vNext's existing 4-level scaffold (`Level 0: none` added on top). Hint *intent* (which rubric item, what kind of nudge) migrates; the donor's literal Russian hint sentences are pedagogical reference only, per ТЗ §28 — wording stays with the grounded mentor.

## G. Rubric (14 items, weight 27) → assessment domains

Maps to ТЗ §44's split: `observations` / `teaching objectives` / `critical safety events` (C1, C2) / `formative debrief domains`. No numeric score, no weight arithmetic carried into vNext (ТЗ §45 forbids it) — the weights inform *relative debrief emphasis*, nothing else.

## H. Excluded from Wave B

- Часть E ("Близнец") — CHF/pancreatitis twin case: explicitly a sketch, not written. Not migrated (ТЗ §61 non-goal scope also excludes new-case authoring beyond this one slice).
- Donor's offline async grading pipeline (`grader.js`, export/import flow) — process infrastructure for the donor's own study-session product, not clinical content; not migrated. vNext's debrief is event-history-based per ТЗ §46, a different mechanism entirely.
- Consent-form draft — donor-product-specific, not applicable to vNext.

## Open questions

See the chat message accompanying this commit for the numbered questions this map is blocked on (governance status of the frozen source; fixed-patient vs. generated-phenotype patient engine shape; dosed-disclosure vs. broad-action handling; classification of non-guideline pedagogical synthesis claims).

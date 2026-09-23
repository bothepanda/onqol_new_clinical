# Wave B — Fluids Clinical Review Gaps

What is deliberately NOT modeled this wave, and why, so a future author doesn't rediscover these by surprise.

## 1. One rule stays `pending_review` on purpose

`RULE-FLUIDS-REPEAT-BOLUS-THRESHOLD` (the repeat-bolus / "~2000mL → call senior" escalation threshold) is the one clinical claim the source document v1.2 itself flags as unconfirmed: it states the threshold was **not found** in the NICE CG174 PDF it checked (attributed to NICE's algorithm 2, not included in that PDF). Per this project's standing governance rule, that gap is not silently promoted alongside the rest of the case. [`fluids01.behavioral.test.js`](../src/content/diseases/fluids_01/fluids01.behavioral.test.js)'s F-ARCH-09 proves the runtime actually withholds it (governance-blocked, never eligible, never reaches a learner).

## 2. Fluid-choice ABG divergence not modeled

The source states that repeating the ABG after an unbalanced (0.9% NaCl) bolus shows Cl 114 / HCO₃⁻ 16, versus the balanced-crystalloid path. This wave's `investigation_timing` is empty (no chemistry/ABG panel is orderable at all this wave — see gap 3), so there is nothing for this divergence to attach to yet. When lab ordering is built, this should become a `truth`-tracked "fluid choice so far" flag that the ABG result reads, not a hardcoded number.

## 3. No individually-orderable chemistry/ABG/CBC panel

`trajectories.yaml#investigation_timing` is deliberately `{}`. Ordering any of the source's chemistry panel (Na/K/Cl/urea/creatinine), Hb, glucose, ABG, urine specific gravity, ECG, or troponin currently returns an honest `SIMULATOR_LIMITATION_NOTED` (F-ARCH-10 proves this), not invented data. All of these values ARE authored in `phenotypes.yaml#fixed_patient.laboratory` — they are not lost, just not yet wired to `ORDER_TEST`. This is real, scoped, separable follow-up work (author `investigation_timing` entries + result templates for ~10 tests), not a design gap.

## 4. Mental status ("сознание яснее") not modeled

The source's row-2 bolus response includes "сознание яснее" (clearer sensorium). No discrete mental-status field exists in `physiology`/`symptoms` this wave, and the treatment-effect/bounded-transition mechanisms only write to `physiology`/`symptoms`/`truth`/`postop` domains — a qualitative consciousness state would need its own field and its own derived-exam-style rendering. Deferred; not safety-critical (the vitals/perfusion trend already carries the clinical signal).

## 5. Operational clarification vs. teaching split (ТЗ §17) not built

The source's tutor distinguishes "the resident gave an incomplete technical order → nurse asks for the missing parameter" from "the resident's clinical reasoning is the problem → mentor speaks." vNext's existing `validateCommand`/CLARIFY path already does the first half generically (a missing `durationMinutes`/`bolus` on `ORDER_INFUSION` becomes a nurse CLARIFY, not a mentor intervention) — this is not a gap, it already works, inherited free from the existing command vocabulary. What is NOT built is teaching-candidate generation deciding *when a technically-complete order still has a reasoning problem* — that lives in the mentor/card-retrieval layer (gap 6).

## 6. Stateful grounded mentor / clinical-card retrieval not wired for fluids-01

This is the largest deferred item. `src/ai/mentor/cardRetrieval.js` (Wave A) is hand-keyed to appendicitis's issue ids and Russian keyword patterns (`ISSUE_CARD_MAP`, `KEYWORD_CARDS`) against a single hardcoded `content/mentor/app004-library.json`. Extending this to be disease-driven (reading a per-bundle card library and issue map, the way `bundle.rules`/`bundle.trajectories` already are) plus authoring the actual fluids-01 card library (the ~20-25 candidate cards catalogued in [`WAVE_B_FLUIDS_MIGRATION_MAP.md`](./WAVE_B_FLUIDS_MIGRATION_MAP.md) §D) is real, well-scoped follow-up work this session did not reach. Until it exists, `mentorEngine.js`'s deterministic issue-detection and the two wired safety rules (C1/C2) work for fluids-01, but the grounded/LLM-phrased teaching layer does not yet have fluids-01 content to draw on.

## 7. Teaching objectives / debrief mapping authored as a map, not wired

The migration map's §E-G (teaching objectives, hint ladder, rubric→debrief mapping) is a categorization, not runtime code. `buildDebrief.js`'s event-history-based debrief (ТЗ §46) has not been extended to read fluids-01-shaped events specifically. It will render *something* generically (the debrief mechanism is disease-agnostic per its own design), but has not been checked against a real fluids-01 session transcript.

## 8. Twin case excluded (by design, not a gap)

Часть E of the source ("Близнец" — a CHF + pancreatitis patient) is an explicit sketch in the source document itself ("Распишу после утверждения основного кейса"), not a written case. Correctly out of scope per ТЗ §61.

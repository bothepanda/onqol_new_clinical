# Wave B — fluids_01 clinical review gaps

What is deliberately not modeled or still needs the Clinical Lead's judgement. Updated after the Mentor + Evidence Integration step.

## Governance state
- Case promoted to `approved_for_training` by the owner's explicit decision (frozen v1.2, 2026-09-21; 2026-09-23 decision) — case-specific, not a standing rule.
- Cards: 33 approved (verbatim source quotes, faithfulness proof in `docs/evidence/WAVE_B_FLUIDS_CARD_FAITHFULNESS.json`), 1 `pending_review`.
- `RULE-FLUIDS-REPEAT-BOLUS-THRESHOLD` and card `FLU-RESUS-002` (repeat bolus 250–500 mL / "2000 mL → call senior") stay `pending_review`: the source itself says the threshold was not found in the NICE CG174 PDF it checked. They are inert at runtime (proved by governance tests) and no learner text can cite them.
- Live grounded library scope: `fluids01-library.json` is scoped to `casePresetId: FLUIDS-01`, `sessionPurpose: internal_development`, `locale: ru`. As with appendicitis (Wave A.1 note), a `pilot` session never sees grounded text until the owner widens that scope; it is explicitly "not resident-pilot approval".

## Items for clinical review
1. **Scaffold-4 wording.** The last rung quotes approved cards verbatim, including «критическая ошибка кейса» and «подозреваемой гиповолемии» (FLU-OLIGURIA-001). Decide whether the evaluative label / naming the interpretation is acceptable in a resident-facing mentor or should be paraphrased in the card (`statement` vs `source_quotes`).
2. **"Hypothesis" statements** («похоже гиповолемия») are currently answered with an "unrecognised" system notice. Clinically harmless; UX to decide.
3. **Overload trigger** is the case's cumulative `bolusMl >= 2500` with RR 26 / SpO₂ 92 — source table values; confirm it is the intended clinical threshold rather than an author's illustration.
4. **Bounded improvement** (`bounds`) saturates the response to further boluses at the source row-2 values; confirm.
5. **Oxygen / senior escalation content**: oxygen is not modeled (a resident ordering it gets a drug-clarification nurse message); consult is modeled as a call with a 20-minute ETA.

## Not modeled (scoped, separable)
- Mental status («сознание яснее»), ECG, urine specific gravity as orderable results (values exist in content; only chemistry/ABG/CBC/lactate/urinalysis/troponin are wired).
- Ask-patient urinary topic; oxygen therapy; "reassess later" plans as executable intent.
- Fluid-choice ABG divergence: **now modeled** (result variants keyed to fluid class; NS vs Ringer ABG).
- Twin case (Часть E of the source) — sketch only in the source; out of scope.
- Third disease, full RAG, scoring, UI redesign, APP-004 migration — out of scope by the ТЗ.

## Verification obligations before any pilot use
- Independent clinical review of the 33 approved cards against the source (quotes are verified mechanically; *meaning* is not).
- A live session review by someone other than the author (the 4 sessions here were driven by the author in three styles).
- Grounded acceptance rate must be measured again after the verifier decision (currently 0/9).

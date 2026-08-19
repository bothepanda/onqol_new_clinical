# Clinical Review Needed

The V2 MVP intentionally avoids inventing clinical rules where the reviewed source material is incomplete.

## Appendicitis MVP

The detailed v0.2 appendicitis review queue is stored with the source package:

- `src/clinical/diseases/appendicitis/CLINICAL_REVIEW_NEEDED.md`

1. Ectopic pregnancy distractor
   - Current status: included as a safety-critical differential for a 34-year-old woman with right iliac fossa pain.
   - Gap: the appendicitis corpus notes ectopic pregnancy is not in the Kazakhstan appendicitis protocol differential table and needs its own source.
   - Required review: add a source-backed mini-row for ectopic pregnancy exclusion criteria and minimum safe screening.
   - Current in-product marker: `NEEDS_CLINICAL_REVIEW`.

2. Numeric thresholds for adult risk scores (AIR, AAS)
   - Current status: V2 accepts risk-stratification language and risk level, but does not calculate a numeric score.
   - Gap: corpus states WSES 2025 names tools but does not provide cutoff tables.
   - Required review: add primary-source thresholds for any scale the product will score numerically.
   - Adult and paediatric tools are separated: the adult vertical slice names AIR or AAS only. PAS is paediatric and is not offered to adult learners.

3. Local antibiotic molecules and doses
   - Current status: V2 teaches the decision boundary: single preoperative prophylaxis, no observation course for uncomplicated appendicitis selected for surgery.
   - Gap: WSES does not name molecules. КП МЗ РК 2018 names options, but MVP does not yet model formulary-specific choices.
   - Required review: decide which Kazakhstan protocol agents and doses should be surfaced in case feedback.

4. Open appendectomy operative details on basic resource level
   - Current status: V2 accepts "open appendectomy here" as the resource-appropriate path.
   - Gap: operative technique details are intentionally not scored in this junior diagnostic/management case.
   - Required review: decide whether the next version should score incision, stump handling, lavage/drainage and postoperative plan.

5. Kazakhstan legal defensibility
   - Current status: evidence layer stores WSES versus КП РК disagreement markers.
   - Gap: product text is educational, not legal guidance.
   - Required review: healthcare lawyer review before public release, especially for `КП!` teaching points.

6. v0.2 source package production gate
   - Current status: `review.release_gate.production_allowed: false`.
   - Gap: independent clinical review, Kazakh clinical-language review, ICD-10 subcode confirmation, local formulary layer and direct source-line verification for NOM recurrence remain unresolved.
   - Required review: do not open production gate until the package-level blockers are closed.

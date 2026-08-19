# Next Sprint

## Priority 1 - Clinical content hardening

1. Add source-backed ectopic pregnancy distractor criteria.
2. Add primary-source AIR/AAS cutoff data or explicitly decide the product never computes a numeric score. PAS stays out of the adult slice as a paediatric tool.
3. Decide how Kazakhstan protocol antibiotic agents/doses should appear in feedback.
4. Clinician-review `acuteAppendicitis.js` weights and criticality flags.
5. Close the appendicitis v0.2 source package production gate: independent clinical review, Kazakh clinical-language review, ICD-10 subcodes, local formulary layer, and NOM recurrence source-line verification.

## Priority 2 - Parser and engine

1. Replace temporary JS case duplication with runtime/generator use of `clinical/diseases/appendicitis/appendicitis.core.yaml` plus locale text.
2. Move the semantic router from browser-direct Anthropic calls to a controlled backend endpoint before external pilot.
3. Add a deterministic router acceptance harness that runs the YAML `router_tests.ru_kk.yaml` against the live LLM router and tracks the required >=95% threshold.
4. Add confidence thresholds and a user-facing clarification path for ambiguous routed intents.
5. Add phase-aware action handling so premature management decisions can be scored separately from correct final decisions.
6. Implement `recognized_but_undefined` audit visibility for educators without revealing unsupported patient findings to learners.

## Priority 3 - Product experience

1. Add a compact structured action audit panel for educators.
2. Add export/copy for the full Clinical Reasoning Report.
3. Add a resource-level setup screen using the corpus checklist.
4. Add a clinician-editable JSON import path for case files.

## Priority 4 - Case expansion

1. Add a second appendicitis branch: periappendicular abscess in patient age 35 or older.
2. Add a "not appendicitis" outcome only after distractor sources are complete.
3. Only then start a second nosology, likely acute cholecystitis/cholangitis or biliary pancreatitis, depending on reviewed source completeness.
4. Build emergency corpus chunking only for `ingest_fulltext: true` sources and keep JAMA 2025 appendicitis as citation metadata until product-use rights are confirmed.

## Priority 5 - Deployment and review

1. Decide whether V2 demo should use browser-direct API keys or a controlled semantic-router endpoint.
2. Add CI for `npm test`, `npm run lint`, and `npm run build`.
3. Run healthcare legal review for Kazakhstan protocol disagreement handling.

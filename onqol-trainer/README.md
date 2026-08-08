# ON QOL Clinical Trainer

ON QOL now contains two product paths.

## V1 baseline

`src/ONQOLTrainer.jsx` is the preserved conversational baseline. It keeps the original flow:

- user selects a broad surgical category;
- the browser calls Anthropic directly with the saved API key;
- the model generates the case, findings, coaching and summary;
- `/api/history.js` stores prior case labels in Vercel Blob.

V1 is still reachable from the V2 header via `Открыть V1`.

## V2 evidence-grounded MVP

V2 is the default app entry. It implements one complete case end-to-end:

- Case: `app-acute-basic-001`, right iliac fossa pain with high-probability uncomplicated acute appendicitis.
- Resource context: `basic` district hospital; no CT, no laparoscopy, delayed ultrasound operator, 2.5-hour transfer.
- Source of truth: structured case data and evidence references, not model judgment.

Core files:

- `src/V2Trainer.jsx` - V2 interaction UI.
- `src/clinical/diseases/appendicitis/appendicitis.core.yaml` - v0.2 language-neutral source of truth for appendicitis.
- `src/clinical/diseases/appendicitis/locales/ru.yaml` and `kk.yaml` - language text only; no clinical numbers or scoring rules.
- `src/clinical/diseases/appendicitis/router/appendicitis.concepts.yaml` - RU/KZ/EN semantic vocabulary for router concept recognition only.
- `src/clinical/diseases/appendicitis/router/conceptMap.js` - explicit mapping from router dictionary concepts into this Case Card's allowed action ids.
- `src/clinical/diseases/appendicitis/sourceValidation.js` - build/test validation for source package and locales.
- `src/clinical/cases/acuteAppendicitis.js` - clinician-editable case data, expected actions, scoring weights, feedback, resource context.
- `src/clinical/corpus/emergency/corpus_manifest.yaml` - emergency surgery retrieval registry; not an active case source of truth.
- `src/clinical/corpus/emergency/RETRIEVAL_POLICY.md` - guardrails for future retrieval/RAG use.
- `src/clinical/evidence/appendicitisEvidence.js` - evidence layer with source, year, recommendation, provenance tier and Kazakhstan protocol delta.
- `src/clinical/semanticRouter.js` - LLM semantic router prompt, strict JSON validation, hallucinated concept rejection and Anthropic browser client.
- `src/clinical/caseEngine.js` - state transitions and findings reveal logic.
- `src/clinical/scoring.js` - deterministic domain and overall scoring.
- `src/clinical/report.js` - final Clinical Reasoning Report built only from scoring and approved feedback fields.
- `src/clinical/schemas/caseSchema.js` - lightweight schema consistency checks.
- `src/clinical/__tests__/clinicalEngine.test.js` - deterministic MVP test coverage.

## Medical integrity rule

The language model is not the clinical source of truth in V2. Free text is routed through an LLM semantic router that must output strict JSON intents. The router may interpret what the learner means, but it may not create findings, scores, guideline rules, state transitions, or new concept ids. Unknown or hallucinated concepts are rejected instead of invented.

The appendicitis router dictionary is a vocabulary layer, not a disease card. Dictionary concepts must pass through `conceptMap.js`; concepts recognized by the dictionary but absent from the current Case Card are reported internally as `recognized_but_undefined` and must not generate findings.

The emergency corpus is a retrieval registry for terminology, relationships and author review. Its authority order is `Case Card > Disease Card > current disease-specific guideline > Kazakhstan overlay > general corpus`. It must not override case facts, score learner actions, or surface guideline teaching during simulation.

Every major teaching point links to an evidence id. Kazakhstan protocol disagreements are stored explicitly. v0.2 keeps `KZDELTA-2` as `direct_conflict_or_scope_mismatch` until clinical review confirms whether the compared populations are aligned.

Operationalized transfer/source-control rules are not scoreable before clinical review. They may appear as discussion points, but `eligible_for_scoring: false` keeps them out of deterministic scoring.

During the simulation the trainer should be less helpful than ChatGPT, but more faithful to reality:

- reveal data only when explicitly requested, automatically visible, triggered by a performed action, or required by a defined transition;
- do not confirm or reject diagnostic hypotheses before debrief;
- do not interpret requested findings for the learner;
- end mid-case responses with neutral reasoning prompts.

## Run locally

```bash
npm install
npm run dev
```

## Verify

```bash
npm test
npm run build
```

The tests cover ideal pathway, acceptable alternatives, missed critical action, unsafe action, excessive investigations, semantic routing, invalid concept rejection and final-score reproducibility.

They also validate the appendicitis v0.2 source package:

- every `text_key` exists in RU and KK;
- locale files do not carry clinical rules or numbers;
- conditional recommendations are not encoded as absolute bans;
- periappendicular abscess keeps the guideline-defined NOM branch;
- operationalized rules remain non-scoreable;
- production gate remains closed pending independent review.

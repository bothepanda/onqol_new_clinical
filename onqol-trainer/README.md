# ON QOL Clinical Trainer

## Sharing this project

Never put `.env.local` in an archive you send to anyone. `.gitignore` keeps it
out of commits and does nothing about a zip made from the working directory —
which is how a live OpenAI key has already left this project once.

Use the packaging command, which excludes every env file, `.git`, `node_modules`
and build output, then re-opens the archive to verify nothing env-shaped
survived:

```bash
npm run pack:safe
```

If a key has ever been inside a shared archive, rotate it with the provider.
Nothing in this repository can do that for you.

---

## V3.5 patient generator — what it does and what it may not be used for

The default app builds each session's patient from the V3.5 content manifest
(`src/clinical/v35/`) rather than replaying one fixed card. Four case presets are
learner-selectable; the patient is composed from layers and reproducible from a
seed.

### Constraints that hold today

**Nothing generated here may move a score.** Every physiology envelope, every
morphology prior and every physiologic-reserve parameter carries
`clinical_review_status: pending` and `eligible_for_scoring: false`. The weights
in `v35/scoringContract.js` are `reviewed_provisional`: a surgeon has signed the
numbers, and scoring stays off until pilot calibration. Reviewed is not live.

**Physiology belongs to the morphology, not to the phenotype.** Heart rate,
temperature, pressure, white count and CRP come from morphology, absolute disease
time, inflammatory burden, trajectory, modifiers and physiologic reserve. The
phenotype owns localisation only: where the pain is, the history, the
examination, the psoas sign, the urinalysis, whether the appendix is visible on
ultrasound, and where it is found on CT and at operation.

At matched hidden inputs and a matched physiology sub-seed, every physiological
delta between phenotypes is zero. Marginally a retrocecal case does run a higher
CRP — because it presents later, and lateness drives physiology through the
shared time term, once.

**Physiologic reserve is drawn, not computed from age.** Age shifts the prior;
the distributions overlap, so a fit older patient can have more reserve than a
frail younger one. Reserve is stored as its own hidden field in the version
snapshot and modifies the physiological RESPONSE only — never the morphology and
never the inflammatory burden. The disease is what it is; reserve decides how
loudly the patient shows it.

**A woman of 18-50 always gets the pregnancy branch.** In every learner preset,
whether or not the preset declared the modifier, and it is present in the frozen
snapshot even when the short handoff text does not mention it. Enforced by an
invariant test over the whole learner surface, not a sample.

Conversely, a patient without that modifier does not have `pregnancy_test`
scored at zero — the action, the pelvic screen, the pelvic ultrasound and the
ectopic alternative are removed from the case entirely, including from
`critical_omissions`. A male patient owes nobody a beta-hCG.

### Open clinical questions, deliberately not fixed by hand

`early_subtle` carries `review_flag: early_crp_gradient_not_validated`. Measured
over 100 000 seeds of the learner presets, uncomplicated morphology:

| часы от начала | n | p5 | p50 | p95 |
|---|---:|---:|---:|---:|
| 0-6 | 19053 | 4 | 39 | 76 |
| 7-12 | 36464 | 6 | 42 | 78 |
| 13-24 | 37594 | 10 | 47 | 84 |
| 25+ | 6889 | 16 | 52 | 88 |

A median CRP of 39 mg/L in the first six hours, rising only to 52 by the second
day, is not validated. If the early value should be lower and the climb steeper,
the fix is a reviewed time-response curve — not a narrower envelope for this
phenotype, which would put physiology back inside the phenotype.

Pulse-pressure ranges for the haemodynamic states are provisional: the mechanism
was reviewed, the numbers were not. They never reach scoring or learner feedback.

### Reproducing a session

One seed reproduces the patient, the facility and the shift. The session event
log carries `v35_composition`, which holds the preset, phenotype, morphology,
modifiers actually applied, trajectory, resource profile, inflammatory burden,
organ dysfunction, physiologic reserve, and both the requested and effective
seeds.

```bash
node -e 'import("./src/clinical/v35/createCase.js").then(m=>console.log(m.buildV35Case({seed:"your-seed"}).caseData.initial_presentation.text))'
```

`APP-005` and the eight alternative-disease stubs are faculty preview only and
are never reachable from the learner selector.

---

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

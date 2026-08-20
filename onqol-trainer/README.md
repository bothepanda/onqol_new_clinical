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

Numeric assessment is disabled at the case, scoring and debrief layers. V3.5
returns formative observations only; it cannot emit an overall or domain score.

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

ON QOL has one learner-facing product entry point. The historical V1 prototype
is kept as an independently built application under `legacy-v1/`; it is not
imported by the main bundle and has no query-string route from the product.

## V1 historical prototype

`legacy-v1/` preserves the original conversational experiment for controlled
qualitative comparison:

- user selects a broad surgical category;
- the model generates the case, findings, coaching and summary;
- a separate same-origin server gateway holds the provider key;
- a separate internal access code and hosting protection gate the stand;
- only short synthetic case labels are stored locally in that browser.

V1 remains model-as-source-of-truth and is explicitly marked as unsuitable for
clinical assessment or validated scoring. Build, deploy and verify it from
`legacy-v1/README.md`; never deploy that directory as part of the main product.

## North Star evidence-grounded product

The root app entry mounts the current structured trainer only. Its architectural
boundary is the opposite of V1: authored, versioned clinical data and the
deterministic engine own patient facts, actions, state and scoring eligibility;
the model may interpret or phrase but cannot become the clinical source of
truth.

The current implementation includes one appendicitis-centered vertical slice
with four learner presets. The stable learner path runs through the V3.5 state
contract to discharge; complication states and alternative diseases remain
faculty-preview/inactive until their clinical packages exist.

- Case: `app-acute-basic-001`, right iliac fossa pain with high-probability uncomplicated acute appendicitis.
- Resource context: `basic` district hospital; no CT, no laparoscopy, delayed ultrasound operator, 2.5-hour transfer.
- Source of truth: structured case data and evidence references, not model judgment.

Core files:

- `src/V25Trainer.jsx` - current learner UI; the historical component name is retained internally.
- `src/clinical/v35/runtimePath.js` - stable runtime path and state-specific reasoning snapshots.
- `src/clinical/v35/releaseGate.js` - machine-readable GO/NO-GO release decision.
- `src/clinical/diseases/appendicitis/appendicitis.core.yaml` - v0.2 language-neutral source of truth for appendicitis.
- `src/clinical/diseases/appendicitis/locales/ru.yaml` and `kk.yaml` - language text only; no clinical numbers or scoring rules.
- `src/clinical/diseases/appendicitis/router/appendicitis.concepts.yaml` - RU/KZ/EN semantic vocabulary for router concept recognition only.
- `src/clinical/diseases/appendicitis/router/conceptMap.js` - explicit mapping from router dictionary concepts into this Case Card's allowed action ids.
- `src/clinical/diseases/appendicitis/sourceValidation.js` - build/test validation for source package and locales.
- `src/clinical/cases/acuteAppendicitis.js` - clinician-editable case data, expected actions, scoring weights, feedback, resource context.
- `src/clinical/corpus/emergency/corpus_manifest.yaml` - emergency surgery retrieval registry; not an active case source of truth.
- `src/clinical/corpus/emergency/RETRIEVAL_POLICY.md` - guardrails for future retrieval/RAG use.
- `src/clinical/evidence/appendicitisEvidence.js` - evidence layer with source, year, recommendation, provenance tier and Kazakhstan protocol delta.
- `src/clinical/semanticRouter.js` - semantic router prompt, strict JSON validation and hallucinated concept rejection.
- `src/clinical/caseEngine.js` - state transitions and findings reveal logic.
- `src/clinical/v25/scoring.js` - V3.5 formative-only evaluation and retained V2.5 regression scoring.
- `src/clinical/v25/replayExport.js` - redacted deterministic replay/audit package.
- `ARCHITECTURE.md` - executable boundaries between engine, router, simulator, mentor and server.
- `VERSION_MAP.md` - application, engine, content, schema and policy versions.
- `CLINICAL_DECISIONS_REQUIRED.md` - decisions that code must not invent.
- `CLINICAL_VALIDATION_MATRIX.md` - separate source, clinical, Kazakhstan and language review states.
- `REMEDIATION_STATUS.md` - audit-priority traceability and GO/NO-GO decisions.
- `src/clinical/schemas/caseSchema.js` - lightweight schema consistency checks.
- `src/clinical/__tests__/clinicalEngine.test.js` - deterministic MVP test coverage.

## Medical integrity rule

The model is not the clinical source of truth in V3.5. Free text is routed
through a strict semantic contract. The router may interpret what the learner
means, but it may not create findings, scores, guideline rules, state
transitions or new concept ids. Unknown or hallucinated concepts are rejected.
The patient channel sees only turn-authorized facts; the mentor sees only facts
already visible to the learner, each with an allowed source id.

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

## Main production API

The main V3.5 bundle calls the same-origin `/api/v25/openai` gateway; the
provider credential remains server-side. Vercel handlers are included for the
POST endpoint and `/api/v25/openai/status`.

Production fails closed unless all three runtime variables are valid:

- `OPENAI_API_KEY` — project-scoped provider credential;
- `ONQOL_MAIN_ACCESS_TOKEN` — separate internal pilot code;
- `ONQOL_MAIN_ALLOWED_ORIGIN` — exact protected deployment origin.

The start screen performs an authenticated status preflight. A blank or wrong
pilot code, an unavailable backend, or missing participant consent keeps the
case-start button disabled. The limited local matcher is development-only and
requires `VITE_ONQOL_ALLOW_LOCAL_FALLBACK=confirmed`; production ignores that
flag.

The gateway checks the exact browser origin, validates the pilot code with a
timing-safe comparison, requires a valid session id, limits request size, allows
only router/simulator/mentor tasks, sets `store: false`, and applies per-client
and per-session in-process minute/day quotas. Its status endpoint reports the
active provider, gateway version, authenticated access state and strict schema
versions without returning credentials. Each provider call records sanitized
latency and token-usage telemetry in the replay export.
The in-process quota is only a last line of defence: hosting-level authentication,
durable rate limiting and project spend limits still have to be enabled for the
pilot. Use `.env.example` as the variable inventory; never commit real values.

Kazakh learner mode is disabled until all V3.5 learner-facing text receives an
independent language review. Router vocabulary support is not treated as proof
that the clinical learner experience is localized.

## Production release gate

The limited pilot is fixed at **N=8 residents**, RU, `REFERENCE-FULL`,
APP-001–004 and `formative_only`.

Vercel runs `npm run release:check` before the bundle build. The gate remains
`NO-GO` until credential rotation, hosting protection, matching deployment
bindings for the approved clinical/resource records, complete Russian
runtime-copy review and privacy-owner approval are recorded. The pilot-wide
clinical sign-off and `REFERENCE-FULL` are already approved only for this exact
scope; KZ-R1/R2/R3 remain unreviewed,
learner-inactive and non-blocking. Every approved
record needs an id, reviewer, date, evidence and exact scope; the corresponding
deployment variable in `.env.example` must match its id. An arbitrary env string
cannot manufacture approval. Enabling Kazakh adds a separate completeness gate
and currently fails by design; enabling the full-test/real-facility path is
forbidden by the pilot gate.

The scoped pilot stores structured browser artifacts and clinical reports for
seven days and rotates the browser pseudonym on the same interval. A downloaded
JSON includes a redacted transcript and same-session clinical reports and is
outside automatic deletion. Participant copy discloses provider processing and
the provider's default abuse-log retention boundary before consent.

## Verify

```bash
npm test
npm run lint
npm run build
npm run release:check
npm audit
```

`release:check` is expected to exit non-zero while the external owner gates are
open. Local build and test remain available; production deployment does not.
After a real deployment reaches GO, run `npm run smoke:cohort` with
`ONQOL_SMOKE_URL` and `ONQOL_MAIN_ACCESS_TOKEN`, then complete
`PILOT_SMOKE_TEST.md` on desktop and mobile. The smoke result is reported as
`8/8 technical router requests`; it is not eight completed resident sessions.

For a local single-reviewer build with the separate faculty corpus surface:

```bash
VITE_ONQOL_INTERNAL_FULL_TEST=confirmed npm run build
npm run start:v25
```

The learner simulator remains at `/`; the internal corpus review surface is
emitted separately at `/faculty.html`. The flag grants inspection access only:
it does not promote faculty-preview rules into learner runtime or scoring.

For a local full-clinical test of every currently implemented learner branch:

```bash
VITE_ONQOL_INTERNAL_FULL_TEST=confirmed \
VITE_ONQOL_FULL_CLINICAL_TEST=confirmed npm run build
npm run start:v25
```

This profile exposes APP-005, bypasses parameter, prerequisite and stable-path
application gates, and emits unvalidated numeric scoring. Every session and
action log records the bypass. It is intentionally compile-time, visibly
labelled, and must never be used for pilot or production assessment. Alternative
disease stubs and the postoperative deterioration path remain unavailable where
their clinical state transitions have not been implemented; a flag cannot make
missing clinical behavior testable.

The tests cover ideal pathway, acceptable alternatives, missed critical action, unsafe action, excessive investigations, semantic routing, invalid concept rejection and final-score reproducibility.

They also validate the appendicitis v0.2 source package:

- every `text_key` exists in RU and KK;
- locale files do not carry clinical rules or numbers;
- conditional recommendations are not encoded as absolute bans;
- periappendicular abscess keeps the guideline-defined NOM branch;
- operationalized rules remain non-scoreable;
- production gate remains closed pending independent review.

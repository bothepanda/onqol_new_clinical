# ON QOL architecture

## Permanent product contracts

- [`ONQOL_MENTOR_BEHAVIOR_SPEC.md`](./ONQOL_MENTOR_BEHAVIOR_SPEC.md) defines adaptive teaching behavior. It is pedagogical policy, never a clinical source.
- [`ONQOL_CLINICAL_EVIDENCE_GOVERNANCE.md`](./ONQOL_CLINICAL_EVIDENCE_GOVERNANCE.md) defines source, review, lifecycle and runtime-effect authority for clinical content.

If legacy mentor wording or checklist behavior conflicts with these contracts,
the contracts win. The North Star remains a separate product-direction document.

## Product boundary

The main learner build mounts only `V25Trainer.jsx`, which now hosts the North
Star V3.5 vertical slice. The prompt-driven prototype is a separately installed
and built application under `legacy-v1/`; it has its own identity, gateway,
access token and storage namespace and is not reachable from the main UI.

## Runtime boundary

1. The deterministic engine owns state transitions, time, resources, authored
   findings, lifecycle and formative output.
2. The semantic router may map free text to declared concepts, but schema and
   Case Card validation decide what can execute.
3. The simulator receives only the current handoff and findings unlocked for
   that turn. It never receives hidden truth, answer keys, scoring rules or the
   retrieval corpus.
4. The deterministic mentor policy classifies turn adequacy, selects one mode
   and sets scaffolding. The renderer receives learner reasoning, an allowlist
   of revealed facts and only `approved_for_training` clinical teaching rules;
   it cannot change the selected policy.
5. V3.5 numeric scoring is disabled. Reasoning snapshots and mentor output are
   non-scoreable by construction.

Clinical authority is split into patient truth, clinical-rule truth and learner
assessment truth. The source registry records provenance; the rule registry
alone grants named runtime effects. Experimental V1 material is prohibited from
both registries.

## Server and data boundary

All provider calls use the same-origin server gateway. Provider credentials are
server-only; production additionally requires an exact origin and a separate
pilot access token. Browser persistence excludes transcripts, plans and
verbatim reasoning by default. Replay contains frozen deterministic inputs and
redacted transcript text, while raw event and reasoning-verbatim fields are
removed.

## Release boundary

`v35Readiness()` validates technical runtime readiness. `release:check` combines
that result with locale status, production configuration and named external
approvals. Vercel runs this gate before building, so missing clinical, privacy,
credential or hosting confirmation is a deliberate production failure.

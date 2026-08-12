# ON QOL architecture

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
4. The mentor receives learner reasoning plus an allowlist of already revealed
   facts with exact source IDs. Its output is validated and falls back to
   authored text on any policy failure.
5. V3.5 numeric scoring is disabled. Reasoning snapshots and mentor output are
   non-scoreable by construction.

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


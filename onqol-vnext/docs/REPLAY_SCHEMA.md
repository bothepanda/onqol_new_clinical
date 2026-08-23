# Replay / Export Schema

`core/replay/exportSession.js#exportSession` produces the versioned export. Current `export_schema_version`: `1.0.0`.

```json
{
  "export_schema_version": "1.0.0",
  "generated_at": "ISO instant, wall-clock, when the export was produced",
  "session": { "id": "...", "mode": "reference | real", "locale": "ru", "status": "active | complete | incomplete", "endpoint": null },
  "initial_patient_seed": "the seed string passed to createSession",
  "hospital_profile": { "profileId": "...", "capabilities": { ... } },
  "content_versions": { "acute_appendicitis": "sha256-derived content hash, 16 hex chars" },
  "current_state": { "...": "the full world state, see core/state/worldState.js" },
  "events": [ "...", "the complete, ordered event log, see core/events/eventTypes.js" ],
  "learner_turns": [],
  "ai_telemetry": []
}
```

## Guarantees

- **`current_state` is redundant, not authoritative.** `events` is the source of truth. `events.reduce(applyEvent, createInitialState(seed))` must reproduce `current_state` exactly — this is a real test (`core/state/worldState.test.js`), not an aspiration.
- **`content_versions`** is a hash of every YAML file in the disease's content bundle, computed by `scripts/buildContentIndex.mjs`. Two sessions with the same `content_versions` value ran against byte-identical clinical content.
- **Every event carries `cause`**: `{ actor, commandId, ruleIds, source }`. `actor` is `"learner"` or `"system"`. A `SOURCE_CONTROL_COMPLETED` fired from an `OPERATIVE_DECISION` command carries that command's id; a `COMPLICATION_OCCURRED` fired from a probabilistic check carries the complication rule's id in `ruleIds`. This is what makes the debrief's causal claims checkable rather than asserted.

## `learner_turns` (populated since 2026-08-23)

Derived from the event log rather than tracked separately, so the two cannot disagree. One entry per learner turn:

```json
{
  "seq": 2, "atMinutes": 0, "atIso": "...",
  "rawText": "осмотрю пациента",
  "intent": "CLINICAL_ACTION",
  "mentorSignal": null,
  "interpretedCommands": [{ "id": "t0-c0", "type": "EXAMINE", "params": {} }],
  "commandOutcomes": [{
    "eventType": "CLARIFICATION_REQUESTED", "outcome": "CLARIFY",
    "commandId": "t0-c0", "commandType": "EXAMINE",
    "missing": ["region"], "reasonKey": null, "capabilityKey": null,
    "ruleIds": [], "governanceBlocked": []
  }],
  "mentor": null
}
```

This is what makes the export answer the audit questions in Governance Spec §24: what the learner wrote, what the interpreter thought it meant, what the system executed, what it refused and why, which rule fired, and what the runtime governance gate withheld.

`governanceBlocked` appears on **every** command outcome, empty or not, so the trail can always answer "was anything withheld here" rather than only when something happened to be.

## Known gaps in this version of the schema

- **`ai_telemetry`** is present in the shape but still empty — no live provider call happens in this build, so there is no provider metadata to record. See `docs/KNOWN_GAPS.md` §3.
- **No JSON Schema file** (`.schema.json`) exists yet to validate exports mechanically outside the `verifyReplay` test helper. Worth adding once the shape has had a second disease exercise it.
- Raw learner text **is** now included, because the export is the audit artifact Governance Spec §24 requires ("what the learner wrote"). The export is a download the learner initiates, not a server-side store; retention of the downloaded file remains governed by the project's privacy/retention policy, which has not yet been migrated into vNext.

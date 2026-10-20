# Reviewed simulation calibration — V2 extension, 2026-09-25

This documents runtime structures, not approval of medical content. Existing `trajectories.yaml` / `response_envelope` / `bounded_state_transitions` remain the single content system. No APP-004 numerical calibration is added by this wave.

## Authority and identity

Parent clinical objects use existing `provenance.review_status`, reviewers, dates, source/version, scope and second-review requirements. Only `approved_for_training` schedules new biological effects. Draft, reviewed, pending and deprecated objects are inert. Build-time provenance and cross-reference checks remain active. `calibration_id`/`version` can identify a separately versioned calibration; otherwise provenance.id and the compiled disease content hash identify it. Clinical authors must supply evidence role, population/scope, assumptions and uncertainty in the existing provenance/notes or additional descriptive metadata; the runtime does not invent them. Such metadata is evidence, not a substitute for review.

## Existing envelopes

Existing reviewed scalar / range deltas remain supported, including their authored saturation bounds. `onset_minutes` must be explicitly finite and nonnegative; no default zero onset exists. `<field>_delta` and `<field>_delta_range` map to existing physiology fields; `pain_score_delta[_range]` operates only on the active pain state. A malformed range or missing envelope schedules an explicit simulation limitation instead of a physiological effect. Existing legacy numeric precision is retained for replay compatibility. Repeated additive legacy deltas are historical authored behavior (including existing source notes), not a new universally approved stacking rule.

## V2 envelope (structural example, not clinical values)

```text
schema_version: 2
onset_minutes: <reviewed simulated minutes>
interaction:
  stacking: additive | once | no_overlap
  window_minutes: <required for no_overlap; measured from application>
effects:
  - domain: physiology | symptoms
    field: <existing numeric field>
    delta: <reviewed fixed delta>           # XOR delta_range
    delta_range: [<reviewed min>, <reviewed max>]
    distribution: uniform | centred
    decimals: <explicit integer 0..6>
    units: <canonical authored unit; no implicit conversion>
    constraints:
      min: <optional saturation limit>
      max: <optional saturation limit>
      cannot_cross: [<forbidden interval low>, <forbidden interval high>]
dependencies:
  - path: <candidate-state path>
    operator: <existing content condition operator>
    value: <authored comparison value>     # or value_path: <other state path>
```

`cannot_cross` rejects movement into or across the entire authored forbidden interval, including a forbidden normalization interval. No normal ranges are built into this mechanism. Direction comes from the signed authored delta. Range draws are clamped to the authored range after declared precision rounding. Min/max saturation cannot reverse the delta. All variables are materialized atomically; a missing numeric input, forbidden crossing or failed postcondition withholds the complete effect and logs the limitation. Units document the field's canonical unit; conversion and automatic dose-response extrapolation are not supported.

Applicability uses existing drug/fluid IDs and routes, optional `requires_patient_state`, and generic `conditions` over patient/world state. Conditions can include phase, resource context and existing treatment state. Unknown/malformed conditions fail closed. Effects sharing one action are each scheduled with their own ID and provenance. Pending effects apply chronologically and see preceding effects, including effects at the same minute (stable insertion order). Competing effects are therefore explicit sequential effects subject to reviewed bounds/dependencies. No implicit pharmacological interaction model exists.

`once` suppresses any further application for that effect ID in the session; `no_overlap` suppresses while pending or inside the authored post-application window; `additive` permits each ordered application subject to constraints. Suppression concerns the modeled response, never silently cancels an administered medication. More elaborate replacement/decay/tolerance models require separately reviewed content and implementation; unsupported policies fail validation. `duration_minutes` is retained historical metadata, not an automatic reversal or elimination half-life.

## Natural course, recovery and probabilities

Reviewed `bounded_state_transitions` keeps its current state/entry time/conditions. Eligibility is explicit; no default eligibility is introduced. Explicit `probability` must be in [0,1] and uses a named seeded stream. Existing reviewed condition-only transitions are deterministic rules, not stochastic rates inferred from missing data; their audit records `mode: authored_condition_only`, `probability: null`. No arbitrary probability is substituted.

Numeric transition effects support fixed values, set/delta/range/delta_range, declared precision/distribution, optional min/max/cannot_cross constraints and candidate-state dependencies. APP-004's existing postoperative effects are qualitative; this implementation does not add numeric recovery. Stochastic complication checks require authored finite onset and an approved finite probability in [0,1]. APP-004's active complication list remains empty.

## Causal record, replay, disclosure

Existing effect/progression/recovery events carry `payload.calibration`: identity/version, source IDs, seed/algorithm, stream/sample metadata, changed-field before/effect/after patches and a disclosure marker. Event type/time/cause.commandId/ruleIds provide action/time/rule links. Full before/after state reconstructs from the preceding reducer state plus these patches. Observation events and their corresponding renderer audits identify what became visible; biological changes do not automatically disclose new measurements.

The scheduler now folds each due event before resolving the next, so two simultaneous effects cannot both overwrite changes from the same stale snapshot. Application history needed for repeat policy is derived in the existing reducer from these same events, not an independent causal log.

Historical events can be folded without evaluating today's approval status, including content now deprecated. New actions never activate deprecated effects. Resume requires matching content versions and reproduced clinical events. Pre-V2 persistence may gain only additive calibration audit metadata after all existing clinical fields match; altered clinical data still fails. Original saved artifacts are not rewritten during loading. A changed clinical implementation/content version may prevent continuation while the original event artifact remains replayable; retain the original compiled bundle for independent seed regeneration.

## Verification scope

Synthetic fixture ranges are labelled TEST ONLY in `treatmentCalibration.test.js`; 100 seeds test bounded variation, reproducibility and forbidden normalization. These values are not exported into production content. The new schema cannot itself establish medical validity, dose appropriateness, population applicability or educational safety.

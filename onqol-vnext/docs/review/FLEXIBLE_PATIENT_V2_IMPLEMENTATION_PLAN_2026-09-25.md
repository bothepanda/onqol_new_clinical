# Flexible Patient V2 — implementation plan (2026-09-25)

Authority read before changes: North Star 1.1, Core Runtime 2.0, Clinical Governance 1.1, Mentor 1.1 and ONQOL_SPECS_README. The owner's explicit V2 task supersedes the 2026-09-24 scoped exception; the four specifications are unchanged. Baseline: 755/755 tests.

1. Keep opt-in chat UI, server-side provider/budget controls and private persistence. Reuse useSession -> interpreter -> submitLearnerTurn and existing event reducer/scheduler. Remove model-created fact registry, model clock, model action execution, model clinical replay and patient-as-mentor.
2. Formalize existing response_envelope / bounded_state_transitions rather than add a patient engine. Gate approvals; require authored timings/probabilities; support authored constraints and interactions. Attach calibration identity/version, RNG provenance and before/after patches to existing causal events. No production clinical content is added/promoted.
3. Render downstream of existing disclosure rendering. Give the renderer only the current authorized speech blocks and limited visible dialogue context. Protect complete clinical clauses/numbers with slots; allow audited linguistic variants and conversational framing. Free unsupported prose is rejected independently of model review. Bounded retry, then exact existing text. Verifier may veto, never grant truth.
4. Persist clinical execution through existing replay; store renderer attempts as nonclinical review telemetry, separate from truth events. Learner export contains shown transcript only; reviewer tooling includes attempts. V1 records are preserved, never imported as V2 patient truth.
5. Add authority/numeric/unsupported/renderer failure, seeded constraint, stacking/multieffect, replay/restore and APP-004 integration tests. Run 100 deterministic synthetic fixture seeds, all tests/content/lint/build and browser coverage without paid APIs.
6. Publish migration report and proposed clinical validation plan, with exact results and remaining content/linguistic limitations. No claim of clinical validation.

## Behavior classification
- KEEP: opt-in UI, patient/staff speakers, free input, server credentials/budget, raw review telemetry.
- MOVE TO PATIENT ENGINE: execution, clock, state changes, scheduling, repeat actions, replay.
- MOVE TO RULE/CALIBRATION CONTENT: response magnitude/timing, applicability, distributions, constraints, complications.
- KEEP AS LLM RENDERING: selection/composition of grounded language; no clinical write result.
- KEEP AS VERIFIER: anomaly veto of language only.
- REMOVE AS UNSAFE AUTHORITY: new model facts, model inferred doses/actions, plausible-proposal approval, patient-generated mentor advice, hidden dossier prompt, model proposal replay.

APP-004 audit: stable preoperative trajectory and qualitative postoperative course are approved. Seven medication/fluid response envelopes remain pending/null. No invented numerical improvement will fill those gaps. flexiblePatient.json does not exist in this checkout.

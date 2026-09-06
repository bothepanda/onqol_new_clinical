# APP-004 Postoperative Recovery — Clock-Anchor Focused Re-Review

**Date prepared:** 2026-09-01
**Prepared by:** Claude Code, at the request of Botagoz Kaukenova — Clinical Lead
**Scope:** this packet covers **only** the single defect the second reviewer identified in
`TRJ-POSTOP-RECOVERY` (`Second Clinical Reviewer Decision.md`, Sarina T.T., 2026-09-01): the
recovery-clock anchor event. It does not reopen anything else in the model.

---

## Previous rejected anchor

`SOURCE_CONTROL_COMPLETED` — the moment the operative source-control step (e.g. appendectomy)
is recorded. Rejected because source control can be completed **before**:

- completion of the operation itself,
- completion of surgical closure,
- completion of anaesthetic maintenance,
- emergence from anaesthesia,
- transfer to PACU / recovery.

## New authoritative anchor

`PROCEDURE_COMPLETED` — the operation-complete event.

**Exact runtime event semantics:** `PROCEDURE_COMPLETED` is emitted by the operative-decision
handler (`src/core/commands/executeCommand.js`) immediately after `SOURCE_CONTROL_COMPLETED` and
the case's automatic postoperative workflow events, and immediately before the patient is moved
to `"recovery"`. Its payload carries `closureStatementRu` — the closure statement — so it is not
merely "source control plus a rename": it represents the surgeon's own statement that closure is
complete. Its reducer effect (`src/core/state/worldState.js`) sets `operative.completed = true`,
which is the same flag the `operation_completed` discharge criterion and the `left_theatre_and_
recovery` route logic already treat as "the operation is over." No event named `SURGERY_COMPLETED`
or `PACU_ADMISSION` exists in this codebase's event vocabulary (`src/core/events/eventTypes.js`);
`PROCEDURE_COMPLETED` is the existing event that unambiguously matches the decision order's first
preference ("operation-complete event ... that unambiguously represents completion of surgery and
transition toward anaesthetic emergence").

**Why this matches the second-review decision:** the reviewer's own alternative wording —
"commencement of anaesthetic emergence" — is exactly what `PROCEDURE_COMPLETED` is immediately
followed by in the event stream (`PATIENT_MOVED` to `"recovery"`, `monitoringLevel: "recovery"`).
The anchor now means what the reviewer asked it to mean: the operation has finished and
postoperative/anaesthetic recovery has actually begun.

**What changed in code (nothing in clinical content):**

- `src/core/state/worldState.js` — `postop.recovery.enteredAtMinutes` is no longer set by the
  `SOURCE_CONTROL_COMPLETED` case; it is now set by the `PROCEDURE_COMPLETED` case, to that
  event's own `atMinutes`. (The `SOURCE_CONTROL_COMPLETED` case still performs its own,
  unrelated, already-approved-design job: setting `operative.sourceControl`, `truth.
  sourceControlled`/`stage`, and the structural pre-→post-source-control pain-state transition —
  matrix PO01. That transition is untouched.)
- `src/core/time/advanceTime.js` — the gate that decides whether a clock advance evaluates the
  (dormant) postoperative recovery course now reads `operative.completed` instead of `operative.
  sourceControl`.

## Confirmation: 6–12 h / 12–24 h windows are unchanged

`recovery_variants` (`early_recovery`: 6–12 h, `overnight_recovery`: 12–24 h) and
`recovery_variant_weights` (`[50, 50]`) in `trajectories.yaml#post_source_control_course` were not
touched. They are still simulation-diversity configuration, not epidemiology or a length-of-stay
guideline.

## Confirmation: discharge logic is unchanged

`discharge_readiness_contract` (`window_end_effect: expectation_only_never_override`,
`evaluated_from: current_patient_state_per_criterion`, the six `blocks_if_any_true` conditions) is
unchanged. The model's transitions still only ever set `symptoms.postopPainStage` and `truth.
recoveryPhase` — never a discharge-readiness field — so moving the clock anchor cannot make
elapsed time satisfy a discharge criterion; that remains governed entirely by each criterion's own
`review_status` / `runtime_evaluation`, independent of the recovery clock.

## Confirmation: no other trajectory content changed

The two recovery variants, their windows and weights, the eight `recovery_domains`, the three
`postop_pain_states`, the `bounded_state_transitions` model's states, transitions, `eligible_after_
minutes` thresholds and effects, and the discharge-readiness contract are byte-for-byte the
Clinical Lead's authored design brief. Only the clock-anchor wiring (above) and the object's own
`notes` (recording this second-review pass) changed. `review_status` stays `pending`;
`model_status` stays `authored_awaiting_clinical_re_review`; the object stays runtime-dormant
(`advanceTime.js` still gates on `isRuntimeAuthoritative(reviewStatusOf(course))`, which is
`false`).

## Regression tests added

`src/core/session/session.e2e.test.js`:

- **A** — `SOURCE_CONTROL_COMPLETED` alone does not start the postoperative recovery clock.
- **B** — the recovery clock begins only at `PROCEDURE_COMPLETED`, anchored to its own timestamp
  (proven with a synthetic 25-minute gap between the two events).
- **C** — advancing time between `SOURCE_CONTROL_COMPLETED` and `PROCEDURE_COMPLETED` does not
  advance postoperative recovery (the gate does not even attempt the postoperative course while
  the operation is not yet complete).
- **D** — the model's transitions only ever touch `symptoms.postopPainStage` / `truth.
  recoveryPhase` — the windows carry no discharge effect, by content shape.
- **E** — with the model temporarily approved in a test fixture only (never in shipped content),
  even after both windows fully elapse, clinical discharge criteria are still recorded as withheld
  simulator limitations, never silently satisfied by elapsed time.

---

## Reviewer decision:

- [x] APPROVE
- [ ] REVISE
- [ ] REJECT

**Reviewer comment:** `PROCEDURE_COMPLETED`, as defined in the current packet, is an
appropriate postoperative recovery anchor because it represents completion of the
operative procedure, including closure, sets the operative state to completed, and is
immediately followed by transfer to the recovery phase. This correctly separates
intraoperative source-control completion from the start of postoperative/anaesthetic
recovery. The previous `SOURCE_CONTROL_COMPLETED` anchor was clinically inappropriate
because source control may occur before completion of surgical closure, completion of
the procedure, and transition toward anaesthetic emergence. Not re-reviewed (unchanged
in this remediation): the 6–12 h and 12–24 h recovery windows, 50/50 variant weights,
postoperative pain states, recovery domains, bounded transition model, and
discharge-readiness logic.

**Reviewer name / specialty / date:** Sarina T.T. — General Surgery / Surgical Oncology,
NROC — 2026-09-01

---

## Governance action taken on this decision (2026-09-01)

Per the reviewer's governance condition ("until this focused re-review is formally
recorded as approved, `TRJ-POSTOP-RECOVERY` should remain `pending`, `runtime_status`
should remain `development_only`, and the APP-004 pilot should remain NO-GO") — now that
the re-review is recorded as **APPROVE**:

- `TRJ-POSTOP-RECOVERY` (`src/content/diseases/appendicitis/trajectories.yaml`,
  `post_source_control_course.provenance`) promoted `pending → approved_for_training`,
  with `second_reviewed_by: ["Sarina T.T. — General Surgery / Surgical Oncology, NROC"]`,
  `second_reviewed_at: "2026-09-01"`. It is the **only** object promoted.
- No other clinical content, value, window, weight, pain state, discharge criterion, or
  the `PROCEDURE_COMPLETED` anchor was altered.
- `case_presets[APP-004].runtime_status` is **not** changed by this step (see the
  separate runtime-status proposal / verification record).

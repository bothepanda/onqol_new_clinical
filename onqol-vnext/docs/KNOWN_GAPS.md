# Known Gaps

This document exists so incomplete functionality is never silently hidden. Rewritten 2026-08-23 after the vertical-slice completion pass, and updated 2026-08-25 after the APP-004 clinical-content remediation pass. Every claim below was verified against the code and against a real play session on the stated date.

> **2026-08-25 update.** The clinical review (`APP004_CLINICAL_REVIEW_MATRIX_v1.0_2026-08-25`) withdrew a substantial amount of previously-authored content — the hourly disease drift, the universal NSAID pain effect, the fixed crystalloid vital-sign delta, the first-slice SSI complication and its monitoring multiplier, site marking, and several discharge criteria. Those items are now **deleted**, not merely gated, and several gaps below therefore have a different cause than they did on 2026-08-23: the content does not exist rather than awaiting promotion. The authoritative current picture is
> [`review/APP004_CLINICAL_REMEDIATION_REPORT_2026-08-25.md`](./review/APP004_CLINICAL_REMEDIATION_REPORT_2026-08-25.md).

**A "solid" claim in this document may only refer to behavior verified in the learner-facing runtime — not to a mechanism that merely has a unit test.** The previous version violated that rule (it claimed "the full EMS-to-discharge appendicitis journey" was solid when no learner could actually complete preparation without an internal command the UI cannot produce), which is why the rule is now stated explicitly.

---

## 1. The dominant gap: almost no clinical content is approved for runtime

This is now the single biggest limitation of the build, and it is deliberate.

As of 2026-08-23 the runtime enforces `review_status === "approved_for_training"` before any clinical content may alter patient truth, create a safety stop, or become authoritative teaching (`src/core/rules/governance.js`). **Nothing in the appendicitis bundle currently meets that bar.** The consequences a learner actually experiences:

- analgesia does not change pain;
- fluids do not change hemodynamics;
- the disease does not progress or recover over time;
- no postoperative complication is ever rolled;
- the only Level-4 safety rule (consent before operative access) cannot fire as a clinical safety stop.

None of this is silent. Each withheld item emits `SIMULATOR_LIMITATION_NOTED`, lands in `state.simulatorLimitations`, and appears in the debrief explicitly labelled as a platform limitation rather than a learner omission.

The full item-by-item blocker list is in [`IMPLEMENTATION_GAP_AUDIT_2026-08-23.md`](./IMPLEMENTATION_GAP_AUDIT_2026-08-23.md) §3.

**Corrected 2026-08-25:** "each begins working with no code change the moment its content item is promoted" is no longer true of everything on that list, and saying so was part of what made the build look closer to ready than it was. Where clinical review WITHDREW the content (the hourly trajectory drift, the `pain −3` NSAID effect, the 500 mL crystalloid delta, `superficial_ssi`), promotion alone would resurrect nothing: the numbers are gone, and `advanceTime` now requires a reviewed `natural_course_model` / `response_envelope` in addition to an approved status. Those items need new authored content, not a status change. Items whose content still exists and is merely `pending` — the clinical rules, the discharge criteria — do still start working on promotion alone.

## 2. Patient-generation content is in use without being approved

Still true, but the JUSTIFICATION was rejected. The 2026-08-23 version of this section argued that phenotype/physiology/history content sits in the Patient Engine rather than the Clinical Rule Layer, so gating it would mean no patient at all. The clinical review (matrix §G1) rejected that: patient generation is explicitly Patient Truth and cannot be a permanent exception.

What changed on 2026-08-25:

- `core/patient/patientTruthGovernance.js` inventories **every** content object that generates a patient fact (11 of them for APP-004) and reports each one's review status;
- every non-approved object emits `SIMULATOR_LIMITATION_NOTED { kind: "patient_truth" }` at minute 0 of every session;
- `session.patientTruthApproved` is `false`, travels in the export, and the debrief says in plain Russian that this is a development build not intended for a resident pilot;
- `scripts/buildContentIndex.mjs` fails the build if a generating object is missing a provenance field.

The exception still exists — a development build needs a patient. It is no longer invisible, and it can no longer be represented as pilot-ready. Item-by-item: [`review/APP004_PATIENT_TRUTH_INVENTORY_2026-08-25.md`](./review/APP004_PATIENT_TRUTH_INVENTORY_2026-08-25.md).

## 3. Interpreter: deterministic authority, model shadow only

`src/ai/interpreter/interpretTurn.js` remains the public entrypoint and delegates all authoritative work to the deterministic vocabulary interpreter. The 2026-08-28 Wave 2 path can additionally call a model in shadow mode when `AI_INTERACTION_V2` is enabled, but model output is schema/concept/invention-validated, stored only as AI telemetry and never executed or folded into reasoning/domain state.

The app-to-gateway shadow path is wired, but **no live-provider measurement was available in this environment**. The 56-case report uses labeled offline outputs to prove schemas, telemetry and isolation; it is not evidence of live model quality. Wave 3 remains NO-GO until a real provider replay shows acceptable command agreement and zero high-risk invention.

**A class of bug worth knowing about, because it bit three separate times in this pass:** `\w` and `\b` in a non-unicode JavaScript regex are defined against `[A-Za-z0-9_]` and therefore **do not match Cyrillic**. Such a pattern fails by silently never matching — not by erroring. It previously killed the "и" conjunction splitter, then the medication route matcher (`в/м` stated by the learner came back as "please specify the route"), then the anesthesia-review patterns. All are fixed and commented; if you write a new Russian pattern, use an explicit `[а-яё]` class.

A related trap, also now fixed: naive substring synonym matching read `"аппендэктомию"` as containing `"кт"` and ordered a CT scan the learner never requested. Synonym matching is now whole-word, with stem matching only for entries of five characters or more.

## 4. Mentor: deterministic decisions, no phrasing variation

All four scaffolding rungs are now genuinely distinct (levels 3 and 4 previously fell back to level 2's cue). Mentor decisions now persist as `MENTOR_INTERVENED` events and the open-question contract is honored and cleared correctly.

Still true: the mentor and renderer are template-driven, so the same situation produces byte-identical text every time. The natural variation the legacy runs had is absent. This is architecturally correct (the model must not own clinical truth) but a provider-backed *phrasing-only* pass on already-decided structured facts does not exist yet.

## 5. Deterioration still never fires

`EVENT.DETERIORATION_DETECTED` exists, the reducer handles it, the renderer renders it, and `crossesInterruptingEvent` classifies it — but **nothing in this build ever produces one.** There is no watcher on physiology drift or on an inadequate disposition that raises an acute deterioration event.

Contract §7.4 / §19 ("deterioration interrupts the current conversation") is therefore still not demonstrable. This is unchanged from the previous build and remains the largest *functional* gap relative to the Core Runtime Spec, distinct from the governance gap above. It is also partly downstream of it: with no approved trajectory, there is no drift to cross a threshold in the first place.

## 6. Monitoring adequacy is derived but its consequences are not modeled

`monitoring.adequacy` is now genuinely derived (`worldState.js#deriveMonitoringAdequacy`) rather than being an unreachable constant, and a postoperative ward patient with no monitoring orders correctly derives as `inadequate`.

What it does *not* yet do is change **detection latency** — task brief §13.2's actual requirement. It currently only selects which authored complication-probability branch applies, and that branch is itself governance-blocked, so today it changes nothing observable. Deliberately conservative: the brief explicitly warns against making inadequate monitoring raise the biological incidence of unrelated complications without approved evidence.

## 7. Real Hospital dynamic constraints are minimal

Implemented in this pass: a seeded roll (~50% of Real-mode sessions) of at most one constraint from four authored candidates (CT down, OR occupied, no ICU bed, senior surgeon delayed), folded into capabilities/staff at session creation, hidden until the learner runs into it, then disclosed via `RESOURCE_CONSTRAINT_REVEALED` and surfaced in the sidebar. Deterministic by seed.

What is missing: constraints never *resolve* during a case (`RESOURCE_BECAME_AVAILABLE` is handled by the reducer but never emitted), there is no transfer-delay modeling beyond a static `transferEtaMinutes`, and the hospital profiles themselves are `pending_owner_review` — they use a project-local review vocabulary (`approved_for_pilot`, `pending_owner_review`) that is not one of the Governance Spec's four states.

## 8. Postoperative course is thin

Disposition, monitoring prescription, postoperative time advance and discharge all work. But `postoperative_course.baseline_recovery` milestones are not surfaced to the learner, there is no day-by-day postoperative narrative, and discharge is gated only on structural facts (fever, an active unresolved complication) because `discharge_criteria` content is `pending`. A learner can currently discharge a patient roughly 12 hours postoperatively with pain 7.6/10 — see the smoke notes.

## 9. Second-disease scale test still not run empirically

This pass made the claim much stronger than it was: `executeCommand.js` no longer branches on operation names or complication ids (both are now content-driven via `source_control: true` and the complications list), the interpreter contains no operation vocabulary at all (operative choices match content's own `matches_ru`), and `src/core/architecture.test.js` now enforces mechanically that no disease-specific string appears in `src/core/**` or `src/ai/**` product logic.

It is still true that **no second disease module has actually been built**, so the claim is "enforced by test" rather than "demonstrated by a real second module". The previous version of this document claimed no core file branched on disease — that was technically true of `diseaseId` and false in substance, since core branched on `"appendectomy_plus_aspiration"` and `"superficial_ssi"` literals.

## 10. Content build still does not validate cross-file references

`scripts/buildContentIndex.mjs` validates rule provenance and now embeds the content hash into each bundle, but still does not check that `phenotypes.yaml`'s `examination_slots` keys exist in `findings.yaml`, or that `operative_sequence[].decision_id` resolves to a real decision. A typo still fails silently at render time rather than at build time.

## 11. Patient realism features not implemented

Explicitly out of scope per task brief §19, unchanged: preference/refusal modifiers, rare inaccurate history and its later correction, incidental findings, intraoperative surprises (`operative.yaml` still has exactly one operative step), and distinct per-role voices for hospital characters (the anesthesiologist, senior surgeon and ICU physician all still say "Я на месте. Что уже сделано?").

## 12. No dev diagnostics panel

Still not built. The learner UI correctly excludes all internal state (enforced by a test on the sidebar's props), but there is no separate development-only panel to inspect hidden truth, the event stream, active rules or the seed. `console.log(session.state)` or the JSON export remain the only ways.

---

## What is actually solid (verified in the learner-facing runtime)

Each of these was exercised by typing Russian into the real UI in a browser on 2026-08-23, not merely unit-tested — see [`evidence/APP004_VNEXT_MANUAL_SMOKE_NOTES.md`](./evidence/APP004_VNEXT_MANUAL_SMOKE_NOTES.md):

- the complete APP-004 journey from EMS handoff to discharge, in ordinary clinical Russian, with **no internal command the UI cannot produce** (`COMPLETE_PREOP_ITEM` has been deleted from the codebase entirely, and a test enforces its absence);
- compound orders executing in parallel without forced sequencing;
- nurse clarification for incomplete orders, from the nurse rather than the mentor;
- clinical time advancing only through clinical action, and results arriving automatically at their own separate times;
- preliminary-then-formal imaging reports as two real arrivals;
- preoperative readiness derived from real learner actions, including a consultant who must physically arrive;
- an irreversible step refused when prerequisites are genuinely unmet;
- content-driven operative decisions with negation handled correctly;
- the resource three-way distinction (available / unavailable here / unsupported by content);
- the mentor hidden-truth boundary, enforced at `learnerView.js` and fail-closed at `ruleEngine.js`;
- seeded reproducibility, including command ids, verified by replaying one seed twice in one process;
- event-log replay reproducing exported state exactly;
- a causal export containing what the learner said, what the interpreter read, what executed, what was refused, and what governance withheld;
- a debrief generated from event history that separates simulator limitation from learner omission and carries no numeric score.

**241 tests pass** as of 2026-08-28, including the audience/release gate, migrated-provenance checks, Wave 1 reasoning-state coverage, the reported learner-session regression and the five-variant appendicitis migration checks; the learner-journey suites drive the runtime through free text only.

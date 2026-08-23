# Known Gaps

This document exists so incomplete functionality is never silently hidden. Rewritten 2026-08-23 after the vertical-slice completion pass; the previous version was honest but too optimistic in several places, and this version corrects it. Every claim below was verified against the code and against a real manual play session on this date.

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

The full item-by-item blocker list is in [`IMPLEMENTATION_GAP_AUDIT_2026-08-23.md`](./IMPLEMENTATION_GAP_AUDIT_2026-08-23.md) §3. Every one of these mechanisms is built and tested; each begins working with **no code change** the moment its content item is promoted through clinical review.

## 2. Patient-generation content is in use without being approved

`physiology_envelopes` (`disease.yaml`), both phenotypes (`phenotypes.yaml`), and `history_bundle_ru` (`findings.yaml`) are `pending` / `clinical_review_status: pending` and are nevertheless used to generate the patient. This is a deliberate, documented judgment call, not an oversight: these are Patient Engine generation content (Foundation Spec §45), not Clinical Rule Layer content (§47), and gating them would mean no patient can be generated at all. It was already true before this pass. It is called out here rather than buried — a stricter future reading of the governance spec may well want these gated too.

## 3. Interpreter: deterministic, no live LLM

`src/ai/interpreter/interpretTurn.js` is a deterministic vocabulary-driven interpreter, substantially broadened in this pass (preoperative actions, disposition, monitoring, transfer/discharge, content-driven operative decisions, whole-word and stem matching, negation handling). It still does not tolerate arbitrary typos or genuinely novel phrasing outside its vocabulary.

The provider-neutral seam exists (`src/ai/providerClient.js`, `server/aiGateway.mjs`), but **the live LLM interpreter path is not wired through the app and is unverified** — no provider credentials were available in this environment. Task brief §4.3 asks that this not be marked complete unless actually wired; it is not, and it is not marked complete.

**A class of bug worth knowing about, because it bit three separate times in this pass:** `\w` and `\b` in a non-unicode JavaScript regex are defined against `[A-Za-z0-9_]` and therefore **do not match Cyrillic**. Such a pattern fails by silently never matching — not by erroring. It previously killed the "и" conjunction splitter, then the medication route matcher (`в/м` stated by the learner came back as "please specify the route"), then the anesthesia-review patterns. All are fixed and commented; if you write a new Russian pattern, use an explicit `[а-яё]` class.

A related trap, also now fixed: naive substring synonym matching read `"аппендэктомию"` as containing `"кт"` and ordered a CT scan the learner never requested. Synonym matching is now whole-word, with stem matching only for entries of five characters or more.

## 4. Mentor: deterministic decisions, no phrasing variation

All four scaffolding rungs are now genuinely distinct (levels 3 and 4 previously fell back to level 2's cue). Mentor decisions now persist as `MENTOR_INTERVENED` events and the open-question contract is honored and cleared correctly.

Still true: the mentor and renderer are template-driven, so the same situation produces byte-identical text every time. The natural variation the legacy runs had is absent. This is architecturally correct (the model must not own clinical truth) but a provider-backed *phrasing-only* pass on already-decided structured facts does not exist yet.

## 5. Deterioration still never fires

`EVENT.DETERIORATION_DETECTED` exists, the reducer handles it, the renderer renders it, and `crossesInterruptingEvent` classifies it — but **nothing in this build ever produces one.** There is no watcher on physiology drift or on an inadequate disposition that raises an acute deterioration event.

Contract §7.4 / §19 ("deterioration interrupts the current conversation") is therefore still not demonstrable. This is unchanged from the previous build and remains the largest *functional* gap relative to the Product Behavior Contract, distinct from the governance gap above. It is also partly downstream of it: with no approved trajectory, there is no drift to cross a threshold in the first place.

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

**111 tests pass**, of which the learner-journey suite drives everything through free text only.

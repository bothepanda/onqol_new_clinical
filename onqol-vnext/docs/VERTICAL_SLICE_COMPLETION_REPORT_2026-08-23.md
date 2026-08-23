# Vertical Slice Completion Report — 2026-08-23

Against `CLAUDE_CODE_TASK_ONQOL_VNEXT_VERTICAL_SLICE_COMPLETION_v2_2026-08-23.md` §22.

---

## A. Summary

The build went from *an architecture with a demo path* to *a case a resident can actually play in Russian, end to end, with a complete audit trail* — and, deliberately, with most clinical consequences switched **off** pending your review.

What changed:

- **`COMPLETE_PREOP_ITEM` was deleted from the codebase.** Preoperative readiness is now derived from five real learner actions (NPO, IV access, antibiotic prophylaxis, anesthesia review that waits for the anesthesiologist to physically arrive, consent). A test enforces the command's continued absence, so it cannot come back as a shortcut.
- **A runtime governance gate now exists** (`src/core/rules/governance.js`). Clinical content below `approved_for_training` cannot alter patient truth, create a safety stop, or become authoritative teaching — per your instruction, with no bulk-promotion. Everything withheld emits `SIMULATOR_LIMITATION_NOTED` and surfaces in the debrief as a platform limitation, never as a learner omission.
- **Core no longer knows it is simulating appendicitis.** `executeCommand.js` previously branched on the literal strings `"appendectomy_plus_aspiration"` and `"superficial_ssi"`. Source control and complication scheduling are now content-driven; a mechanical test scans `src/core/**` and `src/ai/**` for disease-specific terms.
- **The causal event log is complete.** `LEARNER_TURN_RECEIVED` → `COMMAND_ACCEPTED`/`CLARIFICATION_REQUESTED` → domain events → `MENTOR_INTERVENED`, with `learner_turns` populated in the export.
- **The interpreter roughly doubled in coverage** (preop actions, disposition, monitoring, transfer, discharge, content-driven operative decisions, negation handling, whole-word matching).
- **A manual smoke session found eight real bugs** that 111 green tests had not, all fixed and now covered.

Tests went 52 → 111. `npm ci`, test, lint, build and `pack:safe` all pass from a clean install.

---

## B. P0 status

| P0 | Status | Evidence |
|---|---|---|
| **P0-1** learner-facing command coverage | **DONE** | `COMPLETE_PREOP_ITEM` deleted; `SET_NPO`, `ESTABLISH_IV_ACCESS`, `GIVE_ANTIBIOTIC_PROPHYLAXIS`, `REQUEST_ANESTHESIA_REVIEW`, `TRANSFER` added. `learnerJourney.e2e.test.js` (33 tests) drives the entire case through free text only. Live LLM path: **PARTIAL** — seam exists, not wired, marked unverified (§4.3 explicitly permits this only if declared; it is declared). |
| **P0-2** clinical time and pending events | **DONE** | Clock advances only on clinical action; parallel orders complete at different times; results arrive unprompted. Verified in play: 0 → 730 case-minutes. |
| **P0-3** treatment effects | **BLOCKED (mechanism DONE)** | Effect scheduling, onset timing, and post-source-control recovery are built and tested. **Zero effects apply at runtime** because every `treatment_effects` entry and `TRJ-STABLE` are `review_status: pending`. See §D. |
| **P0-4** real preoperative workflow | **DONE** | `preop.ready` derived from real actions; `derivePreopReady` additionally requires an operative plan to exist, so an empty requirement list can no longer be vacuously "ready". Anesthesia review completes only on arrival. |
| **P0-5** governance lifecycle | **DONE** | `governance.js` + `ruleEngine.js` gate; four dedicated tests including "an unapproved complication probability is never rolled, **and never reported as cleared**". |
| **P0-6** no disease-specific core logic | **DONE** | Zero disease-specific strings in product logic (§E). Enforced by `architecture.test.js`, not by inspection. |
| **P0-7** persistent mentor state | **DONE** | `MENTOR_INTERVENED` now actually dispatched; open-question contract honored and cleared; all four scaffolding rungs distinct. |
| **P0-8** complete causal log | **DONE** | Full pipeline in the export; smoke replay carries 20 learner turns / 23 accepted commands / 95 events. |

P1: **P1-1** dynamic constraints DONE (minimal), **P1-2** postop PARTIAL (thin), **P1-3** sidebar DONE, **P1-4** debrief DONE, **P1-5** packaging DONE.

---

## C. Learner E2E

**Yes — the natural-language APP-004 journey succeeds**, from EMS handoff to discharge, using ordinary resident Russian, with no internal command the UI cannot produce.

Evidence: [`docs/evidence/APP004_VNEXT_MANUAL_SMOKE_REPLAY.json`](./evidence/APP004_VNEXT_MANUAL_SMOKE_REPLAY.json) (seed `mt4u3m6s-k0gena`, content `66f7ea5dce1fac0b`, 95 events, `PATIENT_DISCHARGED`) and [`APP004_VNEXT_MANUAL_SMOKE_NOTES.md`](./evidence/APP004_VNEXT_MANUAL_SMOKE_NOTES.md).

The important caveat: it succeeds **mechanically**. The patient does not yet change in response to treatment, because that content is unapproved.

---

## D. Clinical governance

**Active approved rules: none.** Nothing in the appendicitis bundle is `approved_for_training`.

**Withheld from runtime pending your review** (full table in [`IMPLEMENTATION_GAP_AUDIT_2026-08-23.md`](./IMPLEMENTATION_GAP_AUDIT_2026-08-23.md) §3):

| Item | File | Status | What the learner loses |
|---|---|---|---|
| `TRJ-STABLE` drift + recovery | `trajectories.yaml` | `pending` | Disease neither progresses nor recovers |
| `analgesia_iv_nsaid` | `trajectories.yaml` | `pending` | **Pain does not fall after analgesia** |
| `crystalloid_bolus_500_1000ml` | `trajectories.yaml` | `pending` | Fluids do not change hemodynamics |
| `antibiotic_prophylaxis` | `trajectories.yaml` | `pending` | No modeled infection effect |
| `superficial_ssi` | `complications.yaml` | `pending` | No complication is ever rolled |
| `discharge_criteria` | `complications.yaml` | `pending` | Discharge gated only on structural facts |
| `RULE-CONSENT-BEFORE-PROCEDURE` | `rules.yaml` | `reviewed_internal` | **The only Level-4 safety stop is inert** |
| `RULE-DELAY-OVER-24H`, `RULE-CEFAZOLIN-DOSE`, `RULE-ROUTINE-DRAIN` | `rules.yaml` | `reviewed_internal` | No teaching challenges fire |
| antibiotic timing gate | `operative.yaml` | no per-item status | Timing window not authoritative |

**Two judgment calls made transparent rather than silently:**

1. **Patient-generation content is in use unapproved.** Phenotypes, physiology envelopes and the history template are `pending`, and gating them would mean no patient can be generated at all. Treated as Patient Engine content (Foundation Spec §45) rather than Clinical Rule Layer content (§47). This was already true before this pass. If you want it gated too, say so — it is a one-line change and a much larger conversation.
2. **Consent before operative access is still enforced**, but by the *structural* preop-readiness gate, not by the clinical rule — which appears in the export's `governanceBlocked` trail instead. The architecture requires readiness to be real regardless of any content's review status.

**Clinical blockers:** the nine rows above. Each mechanism begins working with **no code change** the moment its item is promoted through real review. Nothing was filled in from model memory.

---

## E. Core scale audit

Scanned `src/core/**` and `src/ai/**`, comments stripped, for `appendectomy`, `appendicitis`, `appendix`, `аппендэктом`, `аппендикс`, `superficial_ssi`, `retrocecal`, `cholecyst`:

**Result: none in product logic.** Expected result achieved.

Disease terms appear only in (a) explanatory comments, (b) `*.test.js` fixtures, (c) `src/content/**`, all of which are legitimate. `architecture.test.js` enforces this on every run, so the claim cannot silently rot — and it was genuinely **false** when the test was written.

---

## F. Test results

```
npm ci             clean install, 0 vulnerabilities
npm test           tests 111 | pass 111 | fail 0
npm run lint       clean, exit 0
npm run build      ✓ built in 576ms — 5 assets, 213 kB main bundle
npm run pack:safe  OK — 156 entries, 0.26 MB, forbidden paths: 0
```

Breakdown: `learnerJourney.e2e` 33 · `session.e2e` 15 · `interpretTurn` 12 · `replayIntegrity` 8 · `dynamicConstraints` 6 · `renderEvent` 6 · `architecture` 5 · `commandTypes` 5 · `mentorEngine` 5 · `patientGenerator` 5 · `ruleEngine` 4 · `worldState` 4 · `rng` 3.

Of the 30 required regression tests (§17), the substantive gaps are: **#12** (deterioration interrupts mentor) — untestable, deterioration never fires; **#23** (monitoring changes detection latency) — adequacy is derived but latency is not modeled; **#26** partially — seeded determinism verified, but stochastic complication outcomes cannot be exercised while complications are governance-blocked.

---

## G. Manual smoke

Run in Chrome against the real dev server, Reference mode, resident-style Russian. **All fifteen §20 checks passed except "treatment response", which is governance-blocked.**

The session found **eight bugs the green test suite had missed** — the strongest argument for why §20 requires playing rather than testing. Three were serious:

- **`«дренаж не ставлю»` was recorded as a decision to place a drain.** Matching ignored the negation. The simulator recorded the *opposite* of what the surgeon said — the worst possible interpreter failure.
- **An open mentor question swallowed real clinical orders.** Answering «NPO, венозный доступ, антибиотикопрофилактика» executed nothing at all.
- **Reassessing the abdomen replied «Клинически значимых изменений нет.»** Every reassessment fell through to the universal-normal layer. Every prior test asserted on state, none on prose, which is exactly how it survived.

Also: the EMS handoff was **inventing a diastolic blood pressure** no content models. Removed — Governance Spec §2 forbids precisely that.

Full list, plus three awkward-but-correct behaviors, in the smoke notes.

---

## H. Remaining gaps

[`KNOWN_GAPS.md`](./KNOWN_GAPS.md) fully rewritten. It now states a rule the old version violated: **"solid" may only describe behavior verified in the learner-facing runtime, not a mechanism with a unit test.**

The largest remaining *functional* gap (distinct from the governance gap): **deterioration never fires.** The event, reducer, renderer and classifier all exist; nothing produces one. Contract §7.4/§19 is not demonstrable — and is partly downstream of governance, since with no approved trajectory there is no drift to cross a threshold.

Also open: no live LLM path; monitoring adequacy derived but consequences unmodeled; constraints never resolve mid-case; thin postoperative course; no second disease module; no dev diagnostics panel; content build still does not validate cross-file references.

---

## I. Packaging verification

```
ZIP path:             dist-pack/onqol-vnext-source.zip
ZIP size:             0.26 MB
Total entries:        156
Forbidden-path count: 0
```

Excludes `node_modules`, `dist`, `.env*`, `.git`, `__MACOSX`, `.DS_Store`, `coverage` and prior export ZIPs; the script **fails** rather than warns on a forbidden path. Includes source, tests, content, specs and docs — verified installable via the clean `npm ci` chain in §F.

**Legacy `onqol-trainer/` was not modified by this pass.** (Its working tree shows pre-existing modifications from before this session, untouched here.)

---

## What I need from you

The single highest-value thing: **clinical review of the nine items in §D.** Until then a resident can complete the case but cannot see that their treatment worked — which is most of the point.

If it helps prioritize, the three that would restore the most learning value per unit of review effort are `analgesia_iv_nsaid`, `TRJ-STABLE`, and `RULE-CONSENT-BEFORE-PROCEDURE`.

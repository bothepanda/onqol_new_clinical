# APP-004 pain causal trace

**Date:** 2026-08-25
**Requested by:** `APP004_CLINICAL_REVIEW_MATRIX_v1.0_2026-08-25` §G2; remediation task §2
**Question asked:** how did pain rise from 4.3 to 7.6 in the manual smoke session while both the disease trajectory and the analgesia effect were governance-blocked? Any hidden producer bypassing governance is a P0 release blocker.

---

## 1. Answer

**There was no hidden producer, and there was no 4.3 → 7.6 transition.**

In the recorded replay (`docs/evidence/APP004_VNEXT_MANUAL_SMOKE_REPLAY.json`, seed `mt4u3m6s-k0gena`), pain is **7.6 at every observation from minute 0 to minute 730** — the seeded initial value, never changed by anything. The string `4.3` does not occur anywhere in that file.

| # | Vitals snapshot at (case minutes) | `painScore` |
|---|---|---|
| 1 | 0 (`PATIENT_ARRIVED`) | 7.6 |
| 2 | 0 (`VITALS_OBSERVED`) | 7.6 |
| 3 | 30 | 7.6 |
| 4 | 210 | 7.6 |
| 5 | 250 | 7.6 |
| 6 | 730 | 7.6 |

`current_state.symptoms` at the end of the session: `{ "painScore": 7.6, "painSiteRu": "в правом подреберье" }`.

The **smoke NOTE was wrong, not the runtime.** `APP004_VNEXT_MANUAL_SMOKE_NOTES.md` §"Unresolved clinical / content gaps" states "Pain in fact *rose* over the case (4.3 → 7.6)". The note itself records that the replay JSON was *regenerated deterministically* from a seed captured out of the browser session; 4.3 is a plausible initial pain for the retrocecal phenotype's authored `pain_score: [4, 8]` range, so the most likely explanation is that the live browser session drew a different patient (initial pain 4.3) from the regenerated one (initial pain 7.6), and the note compared one session's start with the other's end.

The governance gate was not bypassed. It was working, and it was reported as broken.

**Classification: not a P0 governance bypass.** It is a P1 evidence-integrity defect in how the smoke session was recorded — a report that contradicts its own attached replay. Remediated: `scripts/smokeApp004.mjs` now produces the transcript and the replay from a single execution, so the narrative and the artifact cannot disagree.

---

## 2. Every code path that could mutate pain, before this pass

Searched for `pain`, `painScore`, `symptoms.pain`, `symptoms.painScore`, `postoperativePain` across `src/`, `scripts/`, `server/`.

| # | Path | Kind | Gated by | Verdict |
|---|---|---|---|---|
| 1 | `core/patient/patientGenerator.js` → `initialSymptoms.painScore` | initial seeding | not gated (patient generation was exempt) | the ONLY writer that actually ran |
| 2 | `core/time/advanceTime.js#buildProgressionEvents` → `DISEASE_PROGRESSED.payload.symptoms.painScore` | trajectory drift | `isRuntimeAuthoritative(TRJ-STABLE.review_status)` — `pending` | never fired; emitted `SIMULATOR_LIMITATION_NOTED` (4× in the replay) |
| 3 | `core/time/advanceTime.js#runPendingItem` `treatment_effect` → `TREATMENT_EFFECT_APPLIED.payload.symptoms.painScore` | analgesia | `scheduleGovernedTreatmentEffect` refuses to schedule unapproved effects — `analgesia_iv_nsaid` was `pending` | never scheduled, never fired |
| 4 | `core/state/worldState.js` `TIME_ADVANCED` branch → `next.symptoms = {...payload.symptoms}` | **ungoverned seam** | nothing | never fired (no producer), but see §3 |
| 5 | `core/state/learnerView.js`, `ai/renderer/renderStatus.js`, `ui/components/VitalsStrip.jsx` | reads only | n/a | no writes |

So the reachable set was {1}, and {1} is the seeded initial value. The recorded numbers are consistent with that and with nothing else.

---

## 3. Two genuine defects found while proving this

Both were found by tracing the question rather than by any test, and both are fixed.

### D1 — `DISEASE_PROGRESSED` carried a pain value the reducer discarded (correctness)

`advanceTime` emitted `payload: { physiology, symptoms: { painScore }, stage }`, but the reducer's `DISEASE_PROGRESSED` branch applied `payload.physiology` and `payload.stage` only. Consequences:

- the event log recorded a pain value the world never had — a replay/audit inconsistency;
- an approved trajectory still could not have moved pain, so promoting `TRJ-STABLE` would have silently produced a half-working natural course.

**Fixed** in `core/state/worldState.js`; pinned by `core/state/painProvenance.test.js` ("a DISEASE_PROGRESSED event's symptoms payload actually reaches state").

### D2 — `TIME_ADVANCED` was an ungoverned write path into patient truth (governance)

The reducer applied `payload.physiology` and `payload.symptoms` from a clock tick. Nothing produced such a payload, so nothing was wrong in play — but any future producer would have bypassed the governance gate entirely just by attaching values to time passing. The clock advancing is not a clinical event.

**Fixed:** `TIME_ADVANCED` now carries no patient truth at all. Pinned by "TIME_ADVANCED carries no patient truth, whatever is attached to it".

---

## 4. The trace after this pass

Pain is no longer one number. Pre-source-control pain and post-source-control pain are separate states (`core/state/painState.js`, review matrix PO01), so the trace has two halves.

```
seed
  └─ patientGenerator.drawRange(rng.stream("pain"), phenotype.presentation.pain_score)
       → symptoms.preSourceControlPainScore          [content: PHENOTYPE-RETROCECAL-APP004, review_status: pending]
       → symptoms.painState = "pre_source_control"

  ── while painState = pre_source_control ────────────────────────────────────
  ├─ DISEASE_PROGRESSED.payload.symptoms
  │     produced by advanceTime#buildProgressionEvents
  │     gate 1: isRuntimeAuthoritative(reviewStatusOf(trajectory))   → false (pending)
  │     gate 2: trajectory.natural_course_model != null              → false (null; arithmetic withdrawn)
  │     → SIMULATOR_LIMITATION_NOTED { kind: "trajectory", id: "TRJ-STABLE" }
  │
  └─ TREATMENT_EFFECT_APPLIED.payload.symptoms
        produced by advanceTime#runPendingItem("treatment_effect")
        scheduled only by executeCommand#scheduleGovernedTreatmentEffect, which requires:
          a. a content effect matching (drug|fluid) AND route
          b. isRuntimeAuthoritative(reviewStatusOf(effect))          → false (all pending)
          c. effect.response_envelope != null                        → false (all null)
        → nothing scheduled; the medication IS still administered and recorded

  ── SOURCE_CONTROL_COMPLETED ────────────────────────────────────────────────
  └─ toPostSourceControlPain(symptoms)                [structural; architecture-owned]
       preSourceControlPainScoreAtSourceControl ← old value (history)
       preSourceControlPainScore ← null
       postSourceControlPainScore ← null             [content: TRJ-POSTOP-RECOVERY, model: null, pending]
       painState ← "post_source_control"

  ── while painState = post_source_control ───────────────────────────────────
  └─ no producer exists. `postSourceControlPainModeled: false`; the status
     renderer says so in words rather than reporting the old number.
```

### Every event type that can write pain, exhaustively

`core/state/painProvenance.test.js` feeds **every** member of the event vocabulary a payload that tries to write pain and physiology, and asserts the exact set that succeeds:

| May write `symptoms` | May write `physiology` |
|---|---|
| `DISEASE_PROGRESSED` | `DISEASE_PROGRESSED` |
| `TREATMENT_EFFECT_APPLIED` | `TREATMENT_EFFECT_APPLIED` |
| `SOURCE_CONTROL_COMPLETED` (state transition only, no value) | `DETERIORATION_DETECTED` |
| | `COMPLICATION_OCCURRED` |

A new event type that gains the ability to write pain fails that test on the day it is added.

---

## 5. Required regression test — status

> "When all disease trajectories and treatment effects are below `approved_for_training`, pain remains unchanged over clinical time unless another explicitly approved patient-truth event changes it."

Implemented as `src/core/state/painProvenance.test.js`:

| Test | Covers |
|---|---|
| with every trajectory below approved_for_training, pain does not move over clinical time | task §23.1 |
| an unapproved analgesia effect leaves the drug given and the pain unchanged | task §23.2 |
| a per-route effect is matched by route, so no drug inherits another route's response | matrix M04 |
| only the allowlisted event types can write pain or physiology at all | task §23.3 |
| TIME_ADVANCED carries no patient truth, whatever is attached to it | D2 |
| a DISEASE_PROGRESSED event's symptoms payload actually reaches state | D1 |
| source control transitions pain to a separate state rather than decrementing the old one | task §23.38 |

---

## 6. What the reviewer should take from this

1. The governance gate held. The report about it did not.
2. The evidence process needs the same rigour as the runtime: a smoke note that contradicts its attached replay is indistinguishable, from the outside, from a real governance failure — and cost this pass a full investigation to rule out.
3. Two real defects were nevertheless found in the pain path, one of which (D2) would have become a genuine bypass the first time anyone attached values to `TIME_ADVANCED`.

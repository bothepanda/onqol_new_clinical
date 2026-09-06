# APP-004 post-remediation smoke session — 2026-08-25

Required by the remediation task §25. Run in **Reference Hospital**, in ordinary resident Russian, after the clinical-content remediation pass.

- **Replay JSON:** [`APP004_POST_REVIEW_SMOKE_REPLAY.json`](./APP004_POST_REVIEW_SMOKE_REPLAY.json)
- **Seed:** `app004-post-review-smoke`
- **Content version:** `e9abf135bec6d237`
- **Patient generated:** male, 47, right lower quadrant pain, ~14 h from onset, retrocecal phenotype (APP-004)
- **Outcome:** `complete` / `PATIENT_DISCHARGED` at 700 case-minutes
- **Events:** 132 · **Learner turns:** 28
- **`patientTruthApproved`:** `false`

## How this run was produced, and why it differs from last time

The 2026-08-23 manual smoke note claimed a pain transition (4.3 → 7.6) that its own attached replay does not contain — the browser session and the regenerated JSON were different patients. That cost this pass a full P0 investigation to rule out a governance bypass (see [`../review/APP004_PAIN_CAUSAL_TRACE_2026-08-25.md`](../review/APP004_PAIN_CAUSAL_TRACE_2026-08-25.md)).

So this run is produced by `scripts/smokeApp004.mjs`, which drives the case through **`core/session/submitLearnerTurn.js` — the same orchestration entry point `useSession` calls from the React app** — and writes the transcript, the debrief and the export from a single execution. The narrative and the artifact cannot disagree, because they are the same run.

**This is a deviation from "run APP-004 manually" and is stated as one.** The browser was additionally used to verify the UI path renders the new outcomes (see §"Browser verification" below), but the recorded evidence above is the scripted run.

---

## What the session verified

| §25 check | Result |
|---|---|
| history | OK — nausea/vomiting, self-treatment and (for applicable patients) sex-conditional lines render coherently |
| exam | OK — soft, not distended, participates in respiration, no involuntary guarding, no peritoneal irritation, psoas reported, **no Rovsing/percussion checklist** |
| selected labs | OK — «БХАК» asks *«Какие показатели биохимии нужны?»* from the **Лаборатория**, and only the named analytes come back |
| US optional | OK — CT was ordered without any prior ultrasound and nothing objected |
| CT full abdomen/pelvis | OK — nine authored regions + free-fluid variant + conclusion; **no appendix diameter anywhere** |
| analgesia order | Executed and recorded; **no response modelled** — see BLOCKED below |
| preop | OK — readiness derived from IV access, prophylaxis (drug + dose + route), anaesthesia review on actual arrival, consent |
| KZ jurisdictional investigations | OK — coagulation and ABO/Rh ordered by the learner completed when their results landed; when not ordered, staff obtain them and the omission is recorded as `jurisdictional_workflow_omission` |
| laparoscopic operation | OK |
| no routine drain | OK — «дренаж не ставлю» correctly selected appendectomy **plus aspiration**, drain not placed |
| postop monitoring | OK — `vitals q4h` accepted |
| oral intake | OK — «можно пить» recorded as `ORAL_INTAKE_PRESCRIBED` |
| discharge | Accepted — see the caveat under BLOCKED |
| debrief | Generated from the event log; `importantMisses: []`, `referenceComparison.available: false`, `contentGovernance.pilotReady: false` |
| JSON export | OK — replay JSON attached |

---

## Clinical response status — ACTIVE / BLOCKED / NOT AUTHORED

The task requires this to be stated explicitly and forbids describing a blocked effect as working.

### ACTIVE

| behaviour | notes |
|---|---|
| patient generation (age 18–58, ≤24 h onset, coherent nausea/vomiting, seeded pain site incl. RLQ) | runs, but on **non-approved** content — 11 `patient_truth` limitations are recorded at minute 0 |
| investigation ordering, turnaround, preliminary-then-formal reporting | hospital operational data |
| biochemistry analyte clarification and per-analyte results | matrix V07/V08 |
| CT full abdomen/pelvis report, ultrasound nondiagnostic wording | matrix I03/I04 |
| preoperative readiness derived from real events | |
| KZ jurisdictional preop workflow (ABO/Rh, coagulation), labelled as jurisdictional | matrix PR08/PR09, §13 |
| operative decision matching, negation-safe | |
| structural discharge gate, discharge bundle, automatic histopathology | matrix PO17/PO18/PO20 |
| pre → post source-control pain STATE transition | matrix PO01 |

### BLOCKED_BY_GOVERNANCE

| behaviour | content | status | learner-visible consequence |
|---|---|---|---|
| disease progression over time | `TRJ-STABLE` | `pending`, and `natural_course_model: null` | vitals and pain do not move; 4 × `SIMULATOR_LIMITATION_NOTED` in this run |
| analgesia response | 6 per-(drug, route) effects | `pending`, all `response_envelope: null` | ketoprofen 100 mg IV was **given and recorded**; pain did not change |
| fluid response | `fluid_crystalloid` | `pending`, `requires_patient_state: volume_deficit` | no vital-sign change from an infusion |
| post-source-control recovery | `post_source_control_course` | `model: null` | the status snapshot says, in words, that postoperative pain is not modelled |
| clinical discharge readiness | 6 criteria | all `pending` | 6 × `SIMULATOR_LIMITATION_NOTED { kind: "discharge_criterion" }` at discharge |
| every clinical rule (consent, 24 h delay, cefazolin dose, drain, postop antibiotics, laparoscopy preference) | `rules.yaml` | all `pending` | none can teach; `referenceComparison.available: false` |

### NOT_YET_AUTHORED

| behaviour | why |
|---|---|
| postoperative complications | matrix T06 — `superficial_ssi` removed from the first slice and **not replaced** |
| deterioration / unstable trajectory | matrix T08 — deferred |
| aspiration-risk management for a short fasting interval | matrix PR03 — needs anaesthesia review |
| beta-lactam allergy pathway | matrix AB06 — needs a reviewed alternative regimen first |
| prophylaxis missed at the OR door | matrix PR07 — cannot arise while prophylaxis is a blocking preop item |
| unnecessary conversion to open, partial cecectomy, close-without-appendectomy | matrix O12/O13/O15 — recognised and challenged, **not executed**, no fabricated complication |
| pain-driven HR/RR component | matrix V02 — needs calibration |

---

## Bugs this session found (all fixed, all now covered by tests)

Found by *running* the case, not by the suite, which is why the run is required.

1. **The status snapshot reported a stale pain value as current.** At 700 minutes — after source control, with the last vitals observation at minute 60 — it printed «Боль 5.1/10». Two separate faults: the learner view returned a pain value observed in a *different pain state*, and the renderer printed a ten-hour-old observation with no indication of its age. Fixed: pain is withheld when the observation's pain state no longer matches the patient's, and vitals older than 30 minutes are labelled «последнее измерение N мин назад».
2. **Negation matching spilled across clauses.** «удаляю аппендикс, аспирирую жидкость, дренаж не ставлю» selected plain appendectomy instead of appendectomy-plus-aspiration, because the ±2-word negation window around «жидкость» reached a «не» belonging to the next clause. Fixed with an asymmetric window (two words back, one forward), which still catches both «дренаж не ставлю» and «не ставлю дренаж».
3. **Options containing a negation were unmatchable.** «ничего не делаю, ушиваю» and «закрываю без аппендэктомии» are authored operative options, and the negation check vetoed them for containing their own negation — the learner said exactly the authored words and the interpreter returned nothing. Fixed: only negations the learner adds *on top of* the phrase reverse it.
4. **A jurisdictional investigation the learner had ordered was reported as an omission.** Coagulation and ABO/Rh were ordered at minute 180, were still in the lab at incision, and staff announced «не была назначена — оформляю по порядку отделения». Telling a learner they never ordered something they did order is the failure the foundation spec names by example. Fixed: an item whose investigation is already ordered is skipped by the catch-up, and completes when its result lands.
5. **The patient was still recorded as being in the emergency department during the operation.** `START_PROCEDURE` never moved them. Not cosmetic: `left_theatre_and_recovery` is a structural discharge criterion, so «выписываю» straight off the operating table passed every structural check. Fixed.

---

## Awkward but not bugs

- **«переоценю через N часов» with no named parameter** advances the clock, delivers everything due, and *then* the nurse asks «Что именно переоцениваешь?». Carried over from the previous session's notes; still reads oddly, still defensible (time genuinely passed because the learner chose to wait).
- **Vitals never move.** Correct and intended while the trajectory is unapproved — but a resident will notice, and the status line now at least says when the values were last measured.
- **Reference-mode turnaround feels long** (CBC 70 min = 40 authored + 30 reference-lab). Intended: Reference is well-resourced, not magical.

---

## Browser verification

`npm run dev`, Chrome, Reference Hospital, seed generated by the app (female, 40, right lumbar pain, ~11 h — inside the new 18–58 / ≤24 h bounds). Verified through the real UI:

- «БХАК» → **ЛАБОРАТОРИЯ: Какие показатели биохимии нужны?** (attributed to the lab, not the nurse, not the mentor);
- «КТ ОБП» → preliminary radiologist call, then the full abdomen/pelvis report rendered in the transcript;
- no console errors.

---

## Unresolved clinical blockers found in play

These are reported, not worked around. Full list and grouping in [`../review/APP004_CLINICAL_REMEDIATION_REPORT_2026-08-25.md`](../review/APP004_CLINICAL_REMEDIATION_REPORT_2026-08-25.md) §D.

1. **The learner cannot observe that their analgesia worked.** Unchanged from the last session, and now correctly attributed: six per-(drug, route) effects exist, all with null response envelopes, pending pharmacy review.
2. **The disease does not progress.** `TRJ-STABLE` has no course model at all — the old arithmetic was withdrawn by clinical review, not merely gated.
3. **Clinical discharge readiness is not evaluated.** A patient can be discharged as soon as they leave theatre. The previous build's fever blocker was removed because 38.0 °C was an unreviewed number in code, not approved content.
4. **No clinical rule can teach.** Every rule is `pending`, so the debrief's reference comparison is unavailable and the mentor's only teaching comes from the scaffolding ladder plus two structural questions.
5. **Patient truth is not approved.** 11 generating content objects, 0 approved. The build says so on the log, in the export and in the debrief.

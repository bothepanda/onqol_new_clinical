# APP-004 Manual Smoke Session — 2026-08-23

Required by the vertical-slice task brief §20. Run against the real learner UI (`npm run dev`, Vite dev server, Chrome), Reference Hospital mode, using resident-style Russian rather than the exact strings the tests assert on.

- **Replay JSON:** [`APP004_VNEXT_MANUAL_SMOKE_REPLAY.json`](./APP004_VNEXT_MANUAL_SMOKE_REPLAY.json)
- **Seed:** `mt4u3m6s-k0gena` (captured from the browser session; the JSON was regenerated deterministically from that seed + the same inputs, so it is byte-reproducible)
- **Content version:** `66f7ea5dce1fac0b`
- **Patient generated:** woman, 28, right-flank pain ~15 h, retrocecal phenotype (APP-004)
- **Outcome:** `complete` / `PATIENT_DISCHARGED` at 730 case-minutes
- **Events:** 95 · **Learner turns:** 20

The replay JSON also carries `manual_smoke_transcript` (the exact learner inputs and rendered outputs, in order) and `debrief`, so this session can be re-read without the app.

## What the session verified

| Required check (§20) | Result |
|---|---|
| mode selection | OK — Reference chosen from the start screen |
| free-text examination / history | OK — «осмотрю пациента» asked what to examine; «живот» returned the full retrocecal abdominal exam |
| compound orders | OK — «ОАК, ОАМ и БХАК» became three parallel orders; «в отделение, vitals каждые 4 часа» became a disposition **and** a monitoring plan |
| nurse clarification | OK — «кетопрофен 100 мг» (no route) asked for the route; the nurse, not the mentor, asked |
| time progression | OK — 0 → 730 case-minutes, driven by stated waits, never by wall-clock typing time |
| automatic result arrival | OK — lab and CT results arrived on their own at their own different times during a later wait, unprompted |
| treatment response | **Not demonstrable — governance-blocked.** See below |
| current status | OK — «что с пациентом сейчас?» returned a snapshot without restarting the exam and without moving the clock |
| diagnostic reasoning | OK — CT preliminary report preceded the formal report, attributed to the radiologist |
| preop | OK — readiness derived from four real actions plus consent; the anesthesiologist had to physically arrive before that item completed |
| operation | OK — decision-level fidelity, content-driven option matching |
| postop disposition | OK — ward, tracked as `postop.disposition` |
| monitoring | OK — prescribed vitals q4h; adequacy derived |
| discharge | OK — accepted here; see the caveat below |
| debrief | OK — generated from event history, present in the replay JSON |
| JSON download | OK — the button produces the export; captured and inspected |

## Bugs this session found (all fixed, all now covered by tests)

The automated suite was green when this session started. Every one of these was found by *playing* the case, which is exactly why the task brief requires the manual run.

1. **Reassessing the abdomen answered "Клинически значимых изменений нет."** `PATIENT_REASSESSED` carries `region: "reassessment"`, which is not `"abdomen"`, so every reassessment fell through to the universal normal-exam layer. The learner asked to re-examine the abdomen and was told nothing was wrong with it. Fixed with a dedicated reassessment renderer; two regression tests added. Every prior test asserted on *state* and none on *prose*, which is how this survived.
2. **Committing to surgery produced total silence.** `MANAGEMENT_PLAN_COMMITTED`, `PREOP_ITEM_COMPLETED`, `CONSENT_OBTAINED`, `PROCEDURE_STARTED`, `OPERATIVE_DECISION_MADE`, `PATIENT_MOVED` and others had no renderer case and returned `null`. Fixed; the mentor now also asks «Что нужно сделать до операции?» as Contract §16 requires.
3. **An open mentor question swallowed real clinical orders.** With a question open, the whole next turn routed to `MENTOR_ANSWER`, so answering «NPO, венозный доступ, антибиотикопрофилактика» executed *nothing*. Fixed: a turn that contains real commands executes them and answers the question at the same time (Contract §7.5).
4. **`«дренаж не ставлю»` was read as a decision to place a drain.** The content phrase `"дренаж"` matched the literal word and ignored the `не` that reverses it — the simulator recorded the *opposite* of what the surgeon said. Fixed with negation-aware matching on both sides of the word (Russian puts the negation before the verb or after the noun).
5. **`«в отделение, vitals каждые 4 часа»` silently dropped the disposition.** The whole-turn monitoring shortcut consumed the compound turn; the patient stayed in the ED with a ward monitoring plan. Fixed.
6. **`content_versions` always exported the literal string `"unversioned"`.** The content hash was written only into `contentIndex.json`, never into the disease bundle `exportSession` actually reads — silently defeating the replay guarantee that equal `content_versions` means byte-identical clinical content. Fixed.
7. **Command ids came from a process-global counter**, so replaying the same seed in a fresh process produced the same clinical events with different `commandId`s, and two sessions in one process diverged outright. Since the causal trail joins on `commandId`, this quietly broke the determinism the export claims. Found by a test playing one seed twice in one process; fixed to be a pure function of (turn, position).
8. **The EMS handoff invented a diastolic blood pressure** (`АД 121/70`) that no reviewed content models. Removed — it now reads `АД сист. 121`, and the sidebar labels it the same way. Inventing a plausible clinical number is precisely what Governance Spec §2 forbids.

## Awkward interactions that were NOT bugs, but are worth knowing

- **«переоценю через 3 часа» with no named parameter** advances the clock, delivers everything due in that window, and *then* the nurse asks «Что именно переоцениваешь?». Time genuinely passed because the learner genuinely chose to wait, so this is defensible — but it reads slightly oddly, because the clarification arrives after three hours of results. A future pass may want to ask before consuming the interval.
- **«удаляю аппендикс…» is echoed back as «Принято: удалю аппендикс, аспирирую жидкость»** — the confirmation uses the content's canonical phrasing, not the learner's words, so the tense visibly changes. Harmless, but it looks like the system is quoting the learner incorrectly.
- **Lab turnaround feels long in Reference mode** (CBC 70 min: 40 authored + 30 reference-lab). That is the intended "Reference is not magical" behavior (Foundation Spec §14.1), not a defect, but a resident will notice.

## Unresolved clinical / content gaps found in play

These are **blockers for full acceptance**, reported rather than worked around (task brief §21, §23):

1. **Pain did not fall after analgesia.** Ketoprofen was given and administered correctly; `treatment_effects.analgesia_iv_nsaid` is `review_status: pending`, so the runtime governance gate withheld the effect. Pain in fact *rose* over the case (4.3 → 7.6), because the untreated-disease drift is also unapproved and equally withheld — the numbers move only through the seeded initial value and nothing else. **The learner currently cannot observe that their treatment worked.**
2. **No disease progression.** `TRJ-STABLE` is `pending`; the replay records a `SIMULATOR_LIMITATION_NOTED` for it (visible in the debrief as `trajectory:TRJ-STABLE`) on every time advance rather than silently freezing the patient.
3. **No postoperative complication check ran.** `superficial_ssi` is `pending`; the check is *not* rolled and is explicitly *not* reported as "cleared", because clearing it would falsely assert that a reviewed probability had been evaluated.
4. **The only Level-4 safety stop is inert.** `RULE-CONSENT-BEFORE-PROCEDURE` is `reviewed_internal`, so it cannot create an authoritative safety stop. Starting an operation without consent is still refused, but by the *structural* preop-readiness gate, not by the clinical rule — the rule appears in the export's `governanceBlocked` trail instead.
5. **Discharge accepted at 12 h post-admission with pain 7.6/10.** Only structural criteria are enforced (fever, active unresolved complication), because `discharge_criteria` in `complications.yaml` is `pending`. A clinically meaningful discharge gate needs that content approved.
6. **`site_marking` shows in the debrief as an omission.** Correct per authored content (`blocking: false`), and correctly non-blocking — noted because it is the one miss the debrief reported and it should be reviewed for whether it belongs in the APP-004 requirement list at all.

None of the above were filled in from model memory. Each is listed in the blocker table in [`../IMPLEMENTATION_GAP_AUDIT_2026-08-23.md`](../IMPLEMENTATION_GAP_AUDIT_2026-08-23.md) §3 and will begin working automatically, with no code change, once the corresponding content item is promoted to `approved_for_training` through clinical review.

# Wave B — fluids_01 validation report (Mentor + Evidence Integration)

**Verdict: `PARTIAL`.** Wave B is not promoted. The deterministic system is complete and tested; what is *not* demonstrated is live grounded teaching (0 of 9 live grounded drafts were accepted by the independent verifier) and reliable free-language understanding for compound live phrasing. Details, evidence and the explicit answer are below.

Branch `feat/stateful-grounded-mentor-wave-b`. Donor `onqol-trainer` was read-only throughout: the frozen case `cases/2026-09-25-fluids-01.md` still hashes to `b4d1351e…c01a` (v1.2) and the donor working tree has no tracked modifications by this work (its HEAD moved from `4a8c17b` to `93d594a` through the owner's own later commits; nothing here touched it).

## 1. Validation gate

| Gate item | Result | Evidence |
|---|---|---|
| fluids_01 playable end-to-end | **Yes, in the engine and the scripted/live harness.** No browser route: `useSession.js` still hardcodes the appendicitis bundle (a `?case=FLUIDS-01` switch was judged out of scope — "no UI redesign") | `fluids01.sessions.test.js`, `scripts/liveFluidsSession.mjs` |
| Generic card retrieval for ≥ 2 bundles | **Yes.** One `cardRetrieval.js`, driven by each library's own `retrieval` metadata; appendicitis (`app004-library.json`) and fluids (`fluids01-library.json`) selected by session scope | `cardRetrieval.generic.test.js` |
| No fluids-specific mentor implementation | **Yes.** Static check that no code under `src/ai`, `src/core`, `src/app` names the case; issues, cards, thresholds, labs, findings live in `src/content` | `noCaseSpecificMentor.test.js` |
| F01–F14 | **Pass** | `fluids01.behavior.test.js` (+ F10 in `fluids01.grounded.test.js`) |
| 5 scripted resident trajectories | **Pass** (A strong, B average, C vague, D stuck, E adaptive, + E2 non-adapting) | `fluids01.sessions.test.js` |
| 3 live-provider sessions reviewed | **Done: 4 sessions (L1–L4), 43 turns.** Reviewed; findings below | `docs/evidence/WAVE_B_FLUIDS_LIVE_SESSIONS.md` (summary), raw in gitignored `private/wave-b-live/` |
| 0 hidden-truth leaks | **0 observed** — all lab/ABG values and exam findings appeared only after being ordered/performed; static disclosure tests | `fluids01.disclosure.test.js`; live scan of all visible text |
| 0 unsupported clinical numbers reaching the learner | **0** (deterministic verbatim-number policy; 0 grounded drafts accepted live so nothing model-authored reached the learner) | `fluids01.grounded.test.js` F10 |
| 0 unsupported management recommendation | **0** — verifier + `noNewManagement`; live: none reached the learner | same |
| Patient progression responds to actions/reassessment | **Yes.** Effects with source-row bounds, untreated deterioration, overload at cumulative 2500 mL, furosemide, dosed vital disclosure; live L3 reproduced overload (RR↑, SpO₂ 92 %, crackles) after 2500 mL | `fluids01.behavior.test.js`, L3 |
| Mentor conversation meets the V1-like behavioural target | **Partly** — see §4 | live sessions |
| All previous tests | **743 / 743 pass** | `npm test` |
| lint / build / content / governance | clean / clean / OK / no violations | `npm run lint`, `build`, `content:check`, `governance:check` |
| Donor unchanged | **Yes** (see header) | git + SHA-256 |

## 2. What was built this wave (all generic; content lives in `src/content`)

- **Content-driven retrieval** (`cardRetrieval.js`, `libraryRegistry.js`): per-library retrieval metadata (issue map, text patterns, `applies_when` / `exceptions_when` over learner-visible state only, `case_scope`, limit); only `approved_for_training` cards are retrievable; a bounded subset is offered, never the library.
- **fluids_01 clinical-card package**: 34 atomic cards (33 approved, `FLU-RESUS-002` pending_review and unretrievable). Every card carries verbatim `source_quotes` that are substrings of the pinned source; card numbers must be a subset of its quotes; any new content stem not in the quote must be a declared `glue_terms`. Proof: `docs/evidence/WAVE_B_FLUIDS_CARD_FAITHFULNESS.json` (34 cards, 0 failing, source SHA pinned = observed), `scripts/verifyMentorCardFaithfulness.mjs`, `fluids01.cards.governance.test.js`.
- **Teaching candidates from real state** (`teachingCandidates.js`, `rules.yaml#teaching_issues`): six issues (reassessment plan, fluid choice, diuretic before volume, continuing after overload, overload unaddressed, consult ownership) detected from learner actions and *learner-visible* state, with priority, once-only, follow-through, scaffold ladders whose top rung quotes approved cards verbatim.
- **Mentor input** (this session): the deterministic decision (`intent`: question, scaffold level, expected answer domains) is now given to both grounded draft and verifier, so the model rephrases a decision instead of inventing one; the resident's own numbers may be restated only in a conversational sentence; a refused draft records a categorical reason code; a library may declare `grounded_min_scaffold` to reserve the model rewrite for the rungs that actually teach card content (fluids: 3).
- **Disease-agnostic wiring for labs/ABG**: content-declared lab results with `{lab.*}`/`{physiology.*}` tokens, result variants keyed to fluid choice, absolute ETA; only tests the case declares are orderable.
- **Debrief from real history** (`teachingIssueTimeline.js`, `buildDebrief.js`): teaching-issue timeline; separates simulator limitation from learner omission; no numeric score.

## 3. Live findings (L1–L4)

Aggregate over 43 live turns: mentor spoke on 9, was silent on 34 (a strong resident, L1, drew no mentor speech at all — correct). Of 9 grounded attempts (draft + independent verifier, one regeneration), **0 accepted, 9 safe deterministic fallbacks**.

Why grounded drafts failed (from raw records; codes/reasons only):
1. Early drafts: echoed learner numbers, wrong `factId`s, symbols like `<15` (now: echo allowed in conversation only; instructions tightened).
2. Drafts ignored the "ask only the question at scaffold 1–2" rule and recited cards (now given `intent`; the verifier enforces it and did, in L2/L4).
3. The verifier (gpt-5-mini) is inconsistent: it rejected a sentence restating a nurse-confirmed "Введено: фуросемид 40 мг" as "no fact that the drug was given", and flagged card-derived text as "hidden diagnosis" while its own reasoning said the text was acceptable. Strictness is correct in direction (nothing unsupported reaches the learner) but the acceptance rate is ~0. This needs a stronger verifier model or a calibrated rubric — a spend/model decision, not attempted (see gaps).

Practical effect on the resident: the visible reply was always the deterministic reviewed question or scaffold, which is short, on-topic and safe. It is *not* the fluent, learner-word-reactive grounded teaching that was intended.

Interpreter findings (live semantic-first, gpt-5-mini) — fixed in this session unless noted:
- `STOP_INFUSION` for «останавливаю инфузию» was rejected for lack of a lexical anchor (stem «останавл») — fixed + test.
- «струйно/быстро» not bound to a bolus; only the first of several reassess targets kept; whole-sentence evidence span turned a plan («потом…») into withholding the whole order; a fluid name read as a lactate test; spurious «не распознано» for list items — all fixed earlier.
- **Open:** «рингера» without «лактат» is (rightly) not grounded as lactated Ringer and is dropped with a generic "unrecognised" notice instead of a clarification; «оцениваю лёгкие и шейные вены» is returned by the model as one REASSESS with region ids and rejected (works when phrased as separate examine/measure clauses); «через 15 минут переоцениваю…» (future plan) is not executed; «кислород» produces a spurious drug-clarification (oxygen not modeled); statements of reasoning («это перегрузка объёмом») are reported as "unrecognised" noise.

## 4. Manual inspection (ТЗ §13)

1. **Managing a patient or a quiz?** Managing a patient in the strong path (L1: measure, examine, labs, bolus, reassess, monitor; no mentor speech). Quiz-like when the mentor speaks: the deterministic questions are direct ("Как ты поймёшь, что болюс подействовал?"). Acceptable, not yet natural.
2. **Reacts to what the resident said?** The *decision* to speak is driven by real actions (diuretic with low output → C1; bolus without follow-up → reassessment issue). The *wording* reacts to the resident only through the deterministic phrase, because no grounded draft passed.
3. **Knows when not to intervene?** Yes: 34/43 silent; L1 silent throughout; issues closed by the resident's own reassessment stayed closed; once-only issues did not repeat.
4. **«не знаю» → progressive teaching?** Yes (L2, L4): scaffold 1→2→3→4 on the *same* issue, never the same question repeated; level 3 offers options, level 4 quotes the approved card and hands the decision back. Quality of level-4 text is the card's own wording (see item 9).
5. **Decision ownership returned?** Yes — every rung ends with a question to the resident; level 4 ends "Как ты изменишь план?".
6. **Patient state changes with treatment?** Yes (L1 BP/HR/perfusion improved after boluses; L3 overload after 2500 mL with RR↑, SpO₂ 92 %, crackles, nurse alert; UO changed 80 → 35 mL/h with timing).
7. **Can the resident revise the plan after reassessment?** Yes (L2: diuretic → examine catheter/perfusion → issue closed → bolus; L3: stop infusion, furosemide, senior called — the resident acted on the overload).
8. **Alternate reasoning path survives?** Yes in the engine (scripted C, E). Live, the resident reached the same actions by different orders/phrasings; but only if each clause survives the interpreter (§3 open items).
9. **Any medical statement not traceable to approved content?** None model-authored reached the learner. One item for clinical review: the deterministic scaffold-4 text (a verbatim approved card quote) says «диуретик, назначенный до оценки… подозреваемой гиповолемии, — критическая ошибка кейса», i.e. it uses the source's own evaluative label and names hypovolaemia before the resident did. It *is* traceable (card FLU-OLIGURIA-001 quote) but conflicts with the addendum given to the model ("no evaluative labels, don't name the interpretation"). Logged in the clinical review gaps.

## 5. The question

> Can a resident now complete fluids_01 naturally, in their own clinical language, with patient consequences and selective grounded teaching, without discovering a hidden expected phrase sequence?

**Not clearly yes → `PARTIAL`.**

- *Own clinical language, no hidden phrase sequence:* mostly. Actions are read by a lexicon plus a live semantic layer; L1–L4 completed with natural wording, and every case that failed did so with a visible "unrecognised" notice rather than a wrong action. But several ordinary phrasings still need rewording (list in §3), so a resident can sometimes have to rediscover a phrasing.
- *Patient consequences:* yes.
- *Selective:* yes (silent by default, issues once, follow-through).
- *Grounded teaching:* **not demonstrated live** — the deterministic reviewed text is what is shown.

## 6. Recommended next steps (not done; need decisions)

1. Verifier: try a stronger model or a calibrated rubric for `noNewManagement`/`noHiddenDiagnosis` on card-derived text (spend decision — the per-session ledger stayed intact; nothing was lifted).
2. Clarification instead of a generic notice when a model-proposed fluid/concept is not literally grounded («рингера»).
3. Interpreter: examine-vs-reassess routing for lungs/neck veins; future-plan («через 15 минут переоцениваю») as a recorded plan.
4. Optional `?case=FLUIDS-01` browser route behind the flag.
5. Clinical review of the items in `WAVE_B_FLUIDS_CLINICAL_REVIEW_GAPS.md`.

## 7. Follow-up 2026-10-20 (engineering only)

Done: item 2 (a semantic «рингера» naming another Ringer solution now becomes a which-solution clarification; «болюс», «струйно» evidence an infusion), item 3 in part («оцениваю лёгкие и шейные вены» examines both; «через 15 минут переоцениваю…» already executes deterministically), item 4 (`/?case=FLUIDS-01`, internal builds only). Also: «кислород» is reported as a recognised simulator limitation instead of a drug clarification or «не распознано»; a stated hypothesis is recorded as reasoning. Still open: item 1 (verifier model/spend decision) and item 5 (clinical review).

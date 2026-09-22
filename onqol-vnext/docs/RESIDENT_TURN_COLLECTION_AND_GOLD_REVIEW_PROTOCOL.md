# Resident-turn collection and independent gold review

Status (2026-09-20): tooling built and tested; **nothing new collected, nothing labelled, nothing adjudicated.** The one existing session (9 turns) is quarantined and development-only. Interpreter v3A.1 is frozen as a *development baseline* and is not to be altered from newly collected evaluation turns before the predefined evaluation is complete. The holdout has not been run.

```
node scripts/freezeReadiness.mjs          # where things stand, read from artifacts, changes nothing
node scripts/residentCollectionCli.mjs status
node scripts/evidenceGovernance.mjs       # fails on any tracked/staged raw or sealed file
```

## 1. What is collected, and what is not

| collected | how |
| --- | --- |
| the words each resident types to the simulator, one record per turn | the case log a learner already downloads (`exportSession.js`); nothing new is recorded |
| the conversational context that was open (a clarification, a mentor question), derived from the previous turn's outcomes | same export |
| a **participant alias** the coordinator assigns (`P01`…), linking a session to a person **without naming them** | coordinator, at collection time |
| **not collected**: name, email, institution, account, device, IP, free-text about the person; the tool has no field for any of them | — |

Plan: **150–250 real turns** if collected naturally across the pilot, from as many participants as the pilot has (first pilot: 8 residents). **60 is the minimum readiness gate, not a validation target**: it says only that the collection is large enough to look at. What may be *evaluated* is the untouched, participant-grouped evaluation split (gates below). The ledger has no cap.

## 2. Where each data class lives, and who can reach it

`private/` is **gitignored** and lives on the machine that runs the collection. "Who can reach it" below is what the tooling enforces plus the process it assumes; operating-system access to that machine, backup policy and retention period are **owner decisions not made here** (see §8).

| data class | location | in Git | reachable by |
| --- | --- | --- | --- |
| raw session exports (what a resident downloads) | `private/resident-exports/` or outside the repo | never | collection coordinator |
| resident-turn ledger (words + context, no label) | `private/resident-turns/RESIDENT_TURN_LEDGER.json` | never | coordinator; developers only through the **development** split |
| **sealed** system readings (what the interpreter did) | `private/resident-turns/RESIDENT_TURN_SYSTEM_READINGS.json` | never | never handed to a labeller or adjudicator; the packet builder cannot read it |
| participant roster (aliases, session links, private salt) | `private/participants/PARTICIPANT_ROSTER.json` | never | coordinator only |
| the alias ↔ person link | the coordinator's own records, **outside the repo and outside this tool** | never | coordinator only |
| split plan (participant → split, append-only, hash-chained) | `private/participants/RESIDENT_SPLIT_PLAN.json` | never | coordinator |
| blind packets (words + context + an empty label) | `private/gold-review/packets/` | never | the labellers it is handed to |
| each reviewer's independent decisions (alias-attributed) | `private/gold-review/reviews/` | never | that reviewer; the coordinator; the adjudicator sees both labels of a disputed item, never the system |
| adjudication working files (alias-attributed) | `private/gold-review/adjudication/` | never | adjudicator; coordinator |
| reviewer roster / credentials | coordinator's records, outside the repo | never | coordinator |
| **manifest**: counts, session/turn/participant **keys**, SHA-256 of each turn's words, split, eligibility | `docs/evidence/resident-turns/RESIDENT_TURN_MANIFEST.json` | yes | anyone with the repo (no words, no alias) |
| blind-review agreement / adjudication status | `docs/evidence/gold-review/`, `INTERPRETER_V3_GOLD_ADJUDICATION.json` | yes | anyone with the repo (ids, hashes, aliases `R01`/`A01`, no names) |
| **released rows**: de-identified words + adjudicated label | `docs/evidence/resident-gold/ADJUDICATED_RESIDENT_ROWS.json` | yes, gated (§6) | anyone with the repo |
| clean synthetic holdout manifest | `docs/evidence/INTERPRETER_V3_HOLDOUT_MANIFEST.json` | yes | anyone with the repo |

Enforcement, not just policy: `.gitignore` covers `private/` and the raw/sealed file names; every writer of words, readings, packets, reviews, rosters and plans goes through `assertPrivateOutput` (a path outside `private/` is refused); `npm run governance:check` (in `npm run verify` and CI) fails on any tracked or staged file that is one of these classes **by name or by content** (schema markers; a raw resident export is recognised by shape + resident purpose, scripted engineering sessions excluded). The blind packet builder copies only `(id, words, context)` and throws if anything else — a system reading, a split, a participant key, a reviewer — is present.

## 3. Participants and participant-grouped splits

* A **participant** is an alias (`P01`…). The tracked repository sees only `participantKey` = HMAC(alias) under a private salt, so no alias can be recomputed from anything tracked.
* A session belongs to exactly **one** participant, forever. A session not yet linked is **quarantined**: collected and counted, in no split, never evaluation-eligible.
* **Splits are per participant** (`RESIDENT_DEVELOPMENT` / `RESIDENT_EVALUATION`, target ≈ 40 % of participants to evaluation). All of a participant's sessions and turns go to one split: **no participant's language is in both.** Assignment is **append-only** and hash-chained; a participant is never moved, and the order exports were read in does not change the result.
* Words the developers have already seen are not unseen: a turn marked `seen_by_developers` can only ever be development data, and its participant is forced to development. (The first pilot session is marked this way: its words had been copied into the corpus and regression tests.)
* Evaluation readiness (separate from the 60 floor): ≥ 3 evaluation participants and ≥ 60 evaluation-eligible turns. Below that the evaluation cannot be read as a result.

```
node scripts/residentCollectionCli.mjs register P07
node scripts/collectResidentTurns.mjs <export.json | dir> --participant P07     # or ingest unlinked, then:
node scripts/residentCollectionCli.mjs assign <sessionKey> P07
node scripts/residentCollectionCli.mjs mark-seen <sessionKey>
node scripts/residentCollectionCli.mjs status
```

**Untouched means untouched.** No interpreter code, prompt, schema, registry, metric or threshold may change because of what an evaluation-split turn says, before the predefined evaluation is completed. Developer-facing tooling reads the development split only; evaluation words are released to the repository only after the evaluation is reported (§6).

## 4. Blind gold review — what a label captures

A reviewer sees the learner's words and the stated context, **never** the interpreter's reading, what the system executed, model output, the split or the participant. Label v2 records, per turn:

| field | content |
| --- | --- |
| `actions[]` | each explicit action: type, parameters (missing ones in `absent`), **commitment state** (`COMMITTED`, `TENTATIVE`, `CONDITIONAL`, `INTERROGATIVE`, `FUTURE_PLAN`, `DECLINED`), optional `sequenceStep` (`сначала X, затем Y` = two COMMITTED steps), and the verbatim words |
| `patientQuestions[]` | questions put to the patient: topic + words |
| `reasoning[]` | expressed reasoning: working diagnosis, differential, stability, observation plan, contingency, disposition intent, rationale — words, not actions |
| `ambiguity` | `genuine` true/false; kinds (missing parameter, unclear target/scope/commitment, multiple readings); acceptable readings; notes |

Every `evidence` must be the learner's own words, verbatim (checked). From a final label the evaluation gold is derived mechanically: only COMMITTED actions and patient questions are *commands*; every other commitment state becomes `mustNotExecute` (the system executing one is a false execution); a committed action with a missing parameter is `clarify`; a genuinely ambiguous turn with nothing committed is `unresolved`. Hedge / condition / deferral / refusal conventions are product decisions, stated to the reviewer in the packet.

## 5. Three separate records

1. **Independent reviewer decisions** — two labellers (`R01`, `R02`), different people, each labels the whole packet alone. One private file per reviewer. Agreement is computed field by field (actions, questions, reasoning, ambiguity; a difference in commitment state alone is counted separately because it decides whether something executes).
2. **Adjudication** — a third person (`A01`), never one of the two labellers, sees both labels of each disputed item (not the system), decides `accept_A` / `accept_B` / `amend` / `exclude`, and **attests de-identification** of the words. A decision is never overwritten. Alias-attributed; private working file.
3. **Released row** — the tracked product: de-identified words + adjudicated label + derived gold + `independentAgreement`. Unlinked (quarantined) turns and excluded items are never released.

```
node scripts/residentGoldCli.mjs packet --split development|evaluation|all
node scripts/residentGoldCli.mjs check --packet <file> --review <file> --reviewer R01
node scripts/residentGoldCli.mjs compare --packet-id <id> --a R01 --b R02
node scripts/residentGoldCli.mjs adjudicate --packet-id <id> --a R01 --b R02 --decisions <file>
node scripts/residentGoldCli.mjs release
```

Reviewers and adjudicators are recorded **by alias only** (`REVIEWER_ALIAS` / `ADJUDICATOR_ALIAS`); a name is rejected. Who an alias is stays with the coordinator. The old synthetic-corpus review (`goldReviewCli.mjs`) follows the same alias rule.

## 6. Release gate for evaluation rows

Development rows are released with their words after adjudication. **Evaluation rows are released hash-only** (`textSha256`, `labelSha256`, participant key, split) until the owner records `evaluationCompleted: true` in `docs/evidence/resident-gold/RESIDENT_EVALUATION_STATE.json` — which happens only after the predefined evaluation on that split has been run and reported. The CLI never sets it.

## 7. Rules that keep the review honest

1. Labellers and adjudicators never see interpreter outputs, model outputs or metrics for the items they judge.
2. Labelling evaluation turns feeds the gold and nothing else. A genuine interpreter defect revealed by an evaluation label is **recorded, not fixed**, before the evaluation is run.
3. Existing draft gold is never rewritten; adjudication references rows by id and hash.
4. An amended gold is a fact about the label, not a licence to retune on the rows that were amended.
5. Interpreter v3A.1 is not altered from evaluation turns before the predefined evaluation is complete; any change afterwards is a new candidate with a new freeze.

## 8. Still the owner's to settle (not decided here)

* Consent wording shown to residents; who may hold the private store; how long it is kept; whether a resident may withdraw (the manifest lets a withdrawal be honoured by key without touching Git).
* Machine-level access control and backup of `private/` (the tool enforces *where* data is written, not who can read the disk).
* Who the labellers (two) and the adjudicator (one) are; whether one clinician may label some items and adjudicate others (the tool forbids adjudicating an item one labelled).
* The predefined evaluation itself (metrics, thresholds, when `evaluationCompleted` flips).

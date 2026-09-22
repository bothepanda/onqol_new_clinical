# Resident collection — readiness after the data-governance cleanup

Date: 2026-09-20 · Branch `feat/onqol-vnext-clean-core` · Nothing has been collected; the collection phase is prepared, not started. History rewritten and verified (see §2).

## 1. Baseline

Interpreter v3A.1 stays exactly as measured on 2026-09-20 (`INTERPRETER_V3_CORPUS_DEVELOPMENT_2026-09-20-v3a1-run1.json`) — the final development baseline for this candidate. The 20 remaining development rows are not fixed. The holdout has not been run. After this cleanup the offline replay of the recorded run through the current code is **identical** on every development row (89.1 %, 0 false executions, 0 regressions); the only edits to interpreter source since the live run are three example phrases in comments in `deterministicInterpreter.js` (de-identification), so that file's hash differs from the run's receipt while its behaviour does not. Any freeze is a new hash anyway.

## 2. Cleanup status

| requirement | status |
| --- | --- |
| 1. Remove the raw resident session export from **history** | **DONE (2026-09-20).** Branch `feat/onqol-vnext-clean-core` rewritten (81 commits, tip `a645c6f3` → `9173a01d`; exactly 14 files differ from the old tip: the 7 deleted evidence files and the 7 redacted ones). `origin` had no refs, so nothing was force-pushed. Old objects purged; `git fsck --full` clean. One further copy was found and removed: a Codex turn-diff checkpoint ref (`refs/codex/turn-diffs/…`, a Sep 8 tree snapshot) that still held the export; deleted with your approval. Final scan of **every object in the database** (1,916, all reachable): 0 hits for the session id, the export path, the distinctive phrases, export-shaped resident blobs, or commit messages. The two generic order phrases occur only in the separate legacy project `onqol-trainer/`, from its initial commit on, so they are not derived from the session. |
| 2. Remove/regenerate evaluation rows derived from it | **Done in the tree.** The 9 Stage 2 rows built from it are removed (their ids `stage2-001…009` are retired, never reused, so every other id, the development evidence and adjudication keys stay valid). The 6 holdout evidence files that carried their words are deleted. The regression test §20 now uses de-identified synthetic wording of the same structural cases; the derived quotes in 4 review/task docs are redacted; three example phrases in interpreter comments replaced. **Same edits to history are part of the kit** (index-filter over all 81 commits, plus the 4 commit messages that quote the session id). |
| 3. New clean holdout manifest and hash | **Done and frozen (not run)** — see §3. |
| 4. Raw exports, sealed readings, blind packets, reviewer-identifiable material writable only under `private/` | **Done and tested** — see §4. |
| 5. Tracked repo limited to de-identified adjudicated rows, schemas, manifests, hashes, aggregates | **Done** — enforced by `governance:check` by name and by content. One acknowledged exception until item 1 is executed: the raw export still appears in `git ls-files`/history. |

## 3. New clean holdout

`docs/evidence/INTERPRETER_V3_HOLDOUT_MANIFEST.json` — status `CLEAN_NOT_RUN_NOT_FROZEN`

| | |
| --- | --- |
| **fingerprint (sha256)** | **`24b3409ea23f123e97a78f257436909712f438007d7244475439c9752532d1d0`** |
| rows / groups | 41 rows, author-written synthetic, draft linguistic gold; no resident language, no participant |
| recipe | sha256(JSON.stringify(rows)) over the raw holdout rows in corpus order; split rule unchanged (sha256(group) mod 4 = 0; a group is never split) |
| supersedes | `3427c699…edf13e` (50 rows) — 9 of those rows were built from the raw export; **not preserved** |
| retired ids | `stage2-001…009` |
| status | **`FROZEN_NOT_RUN`** — fingerprint sealed 2026-09-20 (`sealSha256` `008d23ee…6421`); the holdout has not been run. This seals the holdout rows only, not the interpreter candidate |
| consumed / runs | false / none |

Verified by `node scripts/holdoutManifest.mjs --check` and by a test (no row derived from resident language, retired ids never reused, manifest equals corpus). The fingerprint depends only on the corpus rows, so rewriting history does not change it. A limitation to state plainly: the synthetic holdout and development rows share one author, so "no participant in both" cannot be true of the synthetic corpus; the participant-grouped guarantee applies to **resident** turns (§4–5 of the protocol), which is where the untouched evaluation will come from.

## 4. What will be collected, where it lives, who reaches it

See the table in `docs/RESIDENT_TURN_COLLECTION_AND_GOLD_REVIEW_PROTOCOL.md` §2. In one line each:

* **Collected:** the words a resident types, the open clarification / mentor question before each turn, and a coordinator-assigned participant alias (`P01`…). No name, email, institution, account, device or IP — the tool has no field for them.
* **Private (gitignored `private/`, never Git):** raw exports; the ledger (words); the **sealed** system readings; the participant roster and private salt; the split plan; blind packets; each reviewer's independent decisions; adjudication working files. Reachable by the collection coordinator; labellers get only their packet; the adjudicator sees both labels of a disputed item, never the system. The alias↔person link and the reviewer/adjudicator identities are kept by the coordinator **outside the repo and outside the tool**.
* **Tracked (Git):** the text-free manifest (keys, counts, SHA-256), review-check aggregates, adjudication status (aliases only), the **released** de-identified adjudicated rows — development rows with words after adjudication, **evaluation rows hash-only until you record `evaluationCompleted: true`** — and the holdout manifest.
* **Not decided here:** consent wording, retention period, disk-level access control/backup of `private/`, who the two labellers and the adjudicator are.

## 5. Built (tests: `npm run verify` → 540/540)

* **Participants** (`residentParticipants.mjs`): alias-only, salted `participantKey`, a session belongs to one participant forever.
* **Participant-grouped splits** (`residentSplits.mjs`): per participant, deterministic, append-only, hash-chained; developer-seen words → development only; unlinked sessions quarantined. Scales to ≥ 250 turns (tested with 256 from 8 participants); 60 is a floor, 150–250 the plan; evaluation readiness needs ≥ 3 evaluation participants and ≥ 60 eligible turns.
* **Label v2** (`residentGold.mjs`): explicit actions with commitment state and sequence step, patient questions, expressed reasoning, genuine ambiguity; verbatim-evidence check; mechanical derivation of evaluation gold (`mustNotExecute` for every non-committed state).
* **Blind packet**: copies only (id, words, context), throws on any leak; **independent reviews**, **comparison** and **adjudication** are three separate records; reviewers/adjudicators by alias; adjudicator ≠ labeller; de-identification attested; gated release.
* Existing synthetic-corpus review (`goldReviewCli.mjs`) now also requires aliases.

## 6. Current collection state (from the tooling)

9 turns, 1 session, **quarantined** (no participant linked) and **seen by developers** → development-only; 0 evaluation-eligible turns; 0 participants; below the 60 floor by 51.

## 7. Remaining, all yours

1. Delete the pre-rewrite backup bundle `private/backups-quarantine/pre-rewrite-2026-09-20.bundle` (it contains the raw export) and, if you like, `private/history-rewrite/` (its transform script contains the redacted phrases); both are gitignored.
2. The owner decisions in protocol §8 before the first real export is ingested.

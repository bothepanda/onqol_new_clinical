# Wave B — Fluids Source Manifest

Records exactly what was copied from the read-only donor repository, from where, and under what provenance. No file in the donor repository was modified, created, or deleted to produce this manifest.

## Donor repository

- **Path actually used:** `/Users/botagozkaukenova/onqol-trainer/onqol-trainer` (the ТЗ named `/Users/botagozkaukenova/Documents/ChatGPT/onqol-trainer`, which does not exist on this machine; the correct path was confirmed by the user 2026-09-23 after two other `onqol-trainer` copies — `~/Documents/GitHub/onqolV2/onqol-trainer` and `~/Documents/ChatGPT/_archive/onqol-trainer-3.5.0-internal-2026-08-21` — were checked and found to contain no fluids case at all, appendicitis only).
- **Git remote:** `origin` → (local; branch tracks `origin/prototype/study-sessions`)
- **Branch:** `prototype/study-sessions`
- **HEAD at time of discovery:** `4a8c17b7dcf28aa355a5f1de637d7cc6857f8dae` — "docs: update ЛЕГАСИ-ИСХОДНАЯ path after moving it out of the repo root" (2026-09-22)
- **Working tree status at time of discovery:** untracked-only (`.DS_Store`, `.claude/`, `MVP-akselerator.md`, `PRD-onqol-trainer.md`, `corpus/` — all pre-existing, unrelated to this manifest; nothing staged or modified)

## Source case file

| Field | Value |
|---|---|
| Path | `onqol-trainer/cases/2026-09-25-fluids-01.md` |
| Case version | **1.2** — status in file: "УТВЕРЖДЕНА, ЗАМОРОЖЕНА" (approved, frozen), 21 September 2026 |
| Scheduled session date | 25 September 2026 |
| Language | Russian |
| SHA-256 | `b4d1351e02847468f2e5c23a7e9b5b1a0c3121ae2e617d19b6b726188588c01a` |
| Introduced | commit `5b4f7b9` — "feat: study sessions mode (/study) for resident training" |
| Last modified | commit `2df6f3b` — "fix: tutor prompt study-1.1 (dosed data disclosure, hint tagging) and case v1.2" |
| Version history | Only one version exists in the repository (no 1.0/1.1 files survive — the case file's own changelog section documents 0.2 → 1.0 → 1.1 → 1.2 narratively, not as separate files). No version conflict: this is unambiguously the current and only version. |
| Primary textbook source | Adams G.A., *On Call Surgery*, ch. 12 (fluids) — used as pedagogical starting point, not as clinical authority |

### Guideline provenance recorded in the case file itself

| Guideline | Used for | Verification status (as stated in source) |
|---|---|---|
| Surviving Sepsis Campaign 2026 | fluid type, starches, albumin, CRT, dynamic indices | Checked against SCCM page |
| NICE CG174 (updated 2017-05-05) | bolus, maintenance, potassium, monitoring | **Checked against PDF** (§§1.2.1, 1.2.5, 1.3.1, 1.4.1–1.4.4). Explicit caveat: repeat-bolus and the "2000 mL → call senior" threshold were **not found** in this PDF (attributed to NICE's algorithm 2, not included) |
| ASCRS/SAGES ERAS 2023 (*Dis Colon Rectum* 66:15) | balanced solutions, colloids, NG tube, drain, GDT | **Checked against PDF**: rec. 13 (strong, 1A), 14 (strong, 1B), 16 (weak, 2B), 19 (strong, 1B) |
| KDIGO 2012 (AKI) | AKI staging criteria | Current published version |

The source file explicitly flags SSC as a sepsis guideline used only as a directional reference for fluid-type/resuscitation logic in this non-septic postoperative-hypovolemia case, not as direct authority for this patient.

## Related source files (pedagogy, runtime, and process — not clinical content)

| Path | Role | SHA-256 |
|---|---|---|
| `onqol-trainer/api/_lib/tutor.js` | Tutor system prompt (`PROMPT_VERSION = "study-1.3"`), dosed-disclosure rule, 3-level hint ladder + `<<HINT item=N level=L>>` tagging, tutored vs. closed-book-retest mode, debrief prompt | `9652390ec1f3cda92eb0c704ed76eaddcffcf2fd7125fd75c688668a5aedda03` |
| `onqol-trainer/api/_lib/grader.js` | Independent grader (`GRADER_VERSION = "grade-1.2"`): 0/1/2 scoring rules, mandatory verbatim quote-as-evidence, C1/C2 critical-flag rules, score transition taxonomy (удержано/потеряно/закреплено/усвоено/…) | `179d5728962226013d4489d46e7b93fe7395fb884d73ec77fb5fd08a33de01c2` |
| `onqol-trainer/api/study.js` | Study-session HTTP flow (attempt lifecycle, mode switching) | `f42845cfe827f0fcfecfeb281404576a6fd476946c4d18972bf72c5d8b17f754` |
| `onqol-trainer/api/_lib/cases.generated.js` | Compiled case registry the donor runtime reads | `87441720bbf2ed9bee6fb47274031e839e788ecbb744c7f89e40bf22ce6f2da2` |
| `onqol-trainer/src/study/StudyApp.jsx` | Resident-facing study UI | `c49fe06066fdc335d29b976a016f04bfe806764b18010506314c42c634a2d593` |
| `onqol-trainer/src/study/AdminPanel.jsx` | Admin/export/review UI (JSON export, manual grading review) | `6c4fe85e1e929258f2833fa1c1a589949e18af14e3e6170cfbe8ed811b8dba5d` |
| `onqol-trainer/docs/ocenka-po-vygruzke.md` | Offline grading-by-export process doc (grading is not automatic; done post-session via a Claude Code pass over the export) | `ea1f01093b69f70ae5e7d811194729a53ac8fccea7ec6ab92c1e3ef597dcf019` |
| `onqol-trainer/docs/soglasie-chernovik.md` | Consent form draft (Anthropic-only data-handling clause) | `7556aeb655207a2036023974b874ca3bf37564db60e907ac161e381972a7f22f` |

## Case version and review status — what the manifest can and cannot assert

The case file's own header states v1.2 is "УТВЕРЖДЕНА, ЗАМОРОЖЕНА" by the user (Botagoz Kaukenova) on 2026-09-21, with per-guideline verification status recorded inline (checked-against-PDF vs. not-found-in-PDF vs. current-published-version). This is materially stronger provenance than most content this codebase has migrated before.

**What this manifest does not assert:** that this approval satisfies vNext's own governance bar (`review_status === "approved_for_training"` with dated reviewer provenance in the `source_ids`/`reviewers` shape `core/rules/governance.js` and the content-build pipeline require, per [`ARCHITECTURE.md`](./ARCHITECTURE.md) and [`governance-gate-strict-approved-only`](../../../../.claude memory — vNext governance must not be self-promoted)). The donor approval was of a *pedagogical case document* for a different runtime with different governance machinery, not a line-item review against vNext's card schema. Per ТЗ §5 and this project's standing rule, that promotion decision is not this manifest's to make — see the open question raised in the accompanying report to the user.

## Known limitations

- Only one patient/case exists in the donor's fluids track (`2026-09-25-fluids-01.md`). "Часть E. Близнец" (twin case, CHF + pancreatitis patient) is an explicit *sketch*, not a written case ("Распишу после утверждения основного кейса" — to be written after the main case is approved) — it is out of scope for Wave B and is not migrated.
- The donor's grading is **offline/asynchronous** (a human runs a Claude Code pass over an exported JSON after each session; there is no live automated grader in the donor runtime, `STUDY_GRADING` is unset by design). Wave B's "no competence score" requirement (ТЗ §45) is compatible with this, but the donor's rubric-as-scored-artifact model does not map 1:1 onto vNext's "observed strengths / missed decisions / teaching points" debrief shape — this is a genuine design translation, not a mechanical port.
- The case's branching table (Часть B) gives deterministic vital-sign/lab responses to a fixed set of learner actions (bolus, repeat bolus, >2.5 L unreassessed, furosemide, no intervention, bleeding workup, escalation) for **one fixed patient**, not a generated phenotype. This is unlike `appendicitis`'s phenotype-library generation model (`patientGenerator.js`) and is the intended shape per the case design (a single scripted teaching patient) — flagged here because it means Wave B's patient truth is closer to a fixed fixture than to a generated instance, which affects how `core/patient/` is extended (see migration map / open questions).

## Source integrity check (to be re-run and recorded at Wave B completion, ТЗ §56)

Baseline recorded now, to be diffed against at completion:

```
$ git -C /Users/botagozkaukenova/onqol-trainer status --short
 M ../.DS_Store   (parent-directory file, outside the repo; unrelated)
$ git -C /Users/botagozkaukenova/onqol-trainer rev-parse HEAD
4a8c17b7dcf28aa355a5f1de637d7cc6857f8dae
```

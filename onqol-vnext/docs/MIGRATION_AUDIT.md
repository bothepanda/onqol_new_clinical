# Migration Audit — ON QOL vNext Clean-Core Rebuild

**Date:** 2026-08-23
**Author:** Claude Code, executing `CLAUDE_CODE_TASK_ONQOL_VNEXT_REBUILD_v1_2026-08-22.md`

This document is written **before** implementation began, per §1 of the task brief, and is not retroactively edited to look more complete than the inspection actually was.

---

## 1. Contracts located and read

| # | Document | Location found | Status |
|---|---|---|---|
| 1 | ON QOL North Star | `~/Downloads/ONQOL_NORTH_STAR.md` | Found, read in full (62 lines, Russian) |
| 2 | ON QOL Product Behavior Contract v1.0 | `~/Downloads/onqol v4/ONQOL_PRODUCT_BEHAVIOR_CONTRACT_v1.0_2026-08-22.md` | Found, read in full (842 lines) |
| 3 | ON QOL Core Foundation Spec v1.0 | `~/Downloads/ONQOL_CORE_FOUNDATION_SPEC_v1.0_2026-08-22.md` | Found, read in full (1693 lines) — attached directly to the task |
| 4 | ON QOL Clinical Evidence Governance Spec v1.0 | `~/Downloads/ONQOL_CLINICAL_EVIDENCE_GOVERNANCE_SPEC_v1.0_2026-08-13.md` | Found (filename lacks the `(1)` suffix named in the brief; content matches by title), read in full (651 lines) |
| 5 | ON QOL Mentor Behavior Spec v1.0 | `~/Downloads/ONQOL_MENTOR_BEHAVIOR_SPEC_v1.0_2026-08-13.md` | Found (same filename-suffix note as #4), read in full (945 lines) |

All five governing documents were located and read before any code was written. No referenced foundation/spec document was missing.

## 2. Legacy material inspected

From `onqol-trainer/`:

- `src/V25Trainer.jsx`, `src/V25Trainer.css` — visual shell reference (palette, layout, sidebar structure).
- `src/clinical/v25/**`, `src/clinical/v35/**`, `src/clinical/core/**`, `src/clinical/semanticRouter.js`, `src/clinical/caseEngine.js` — inspected for failure modes and content, **not imported**.
- `src/clinical/diseases/appendicitis/appendicitis.core.yaml`, `locales/ru.yaml`, `locales/kk.yaml` — reviewed clinical content, source-of-truth candidate for migration.
- `src/clinical/v35/phenotypes.js`, `src/clinical/v35/examSlots.js` — phenotype and exam-slot content (retrocecal/classic presentations, WSES/KZ_AA_2018-sourced physiology envelopes).
- `KZ_RESOURCE_PROFILES_REVIEW.md`, `DOSING_RULES_CLINICAL_REVIEW_v0.2_2026-08-20.md`, `CLINICAL_VALIDATION_MATRIX.md`, `REFERENCE_RESOURCE_PROFILE_PILOT_APPROVAL_2026-08-20.md` — governance/review-state documents.
- `src/clinical/governance/ruleEligibility.js` — inspected for its fail-closed evaluation *pattern* (an unevaluable rule condition is `unknown`, never `met`). The pattern was reimplemented cleanly in `src/core/rules/ruleEngine.js`; the file itself was not imported or copied.
- `package.json`, `vite.config.js`, `eslint.config.js`, `.nvmrc`, `public/favicon.svg`, `public/icons.svg` — infrastructure reference.
- `server/openaiGateway.mjs` — inspected for generic security/provider patterns (server-side key, timeout, `store: false`, rate limiting, access-control seam). Not copied wholesale.

## 3. What was reused

**Copied as files (whitelisted infrastructure, task brief §5.1):**
- `public/favicon.svg`, `public/icons.svg`
- `.nvmrc`

**Copied as traceable migration material (task brief §6), not as trusted runtime code**, into `onqol-vnext/migration/legacy-content/`:
- `appendicitis/appendicitis.core.yaml`, `locales/ru.yaml`, `locales/kk.yaml`
- `appendicitis/phenotypes.js`, `appendicitis/examSlots.js`
- `KZ_RESOURCE_PROFILES_REVIEW.md`, `DOSING_RULES_CLINICAL_REVIEW_v0.2_2026-08-20.md`, `CLINICAL_VALIDATION_MATRIX.md`, `REFERENCE_RESOURCE_PROFILE_PILOT_APPROVAL_2026-08-20.md`

**Re-authored as new clean content** under `onqol-vnext/src/content/diseases/appendicitis/` (`disease.yaml`, `phenotypes.yaml`, `trajectories.yaml`, `findings.yaml`, `rules.yaml`, `operative.yaml`, `complications.yaml`): the five V3.5 appendicitis phenotypes (`early_subtle`, `classic`, `pelvic`, `retrocecal`, `late_complicated`), physiology envelopes needed to reconstruct their review fixtures, exam-slot wording, and the three signed dosing rows (cefazolin/metronidazole prophylaxis) were carried forward with **their original review limitations and provenance preserved** — nothing was promoted to a higher review status than the legacy corpus already recorded. APP-001–003 remain `review_pending`, APP-004 `development_only`, and APP-005 `faculty_preview`. See §5 and `docs/APPENDICITIS_VARIANT_MIGRATION_2026-08-28.md`.

**Reused (rebuilt from the visual pattern, not the component code):** the teal/mint palette, mono-uppercase chrome labels, proportional-sans conversation text, white-card-on-pale-background composition, and the right-sidebar concept — extracted into `src/ui/styles/tokens.css` / `shell.css` as new tokens, not `v25-*` classes.

## 4. What was intentionally not reused

Per task brief §5.3, none of the following became an import dependency of the new core (inspected only, for failure modes / test ideas):

- `src/clinical/v25/**` (engine.js, turnPlanner.js, turnKind.js, scenarioEngine.js, temporalPatientModel.js, etc.)
- `src/clinical/v3/**`, `src/clinical/v35/**` (runtimePath.js, pathStates.js, createCase.js, actionContracts.js, sessionSelector.js, releaseGate.js, manifest.js, alternatives.js)
- `src/clinical/semanticRouter.js`, `src/clinical/caseEngine.js`
- `src/clinical/core/mentorPolicy.js`, `mentorHeuristics.js`, `reasoningState.js`
- `src/V25Trainer.jsx` (not imported; visual reference only)
- `server/openaiGateway.mjs`, `src/clinical/v25/openAIBackendClient.js` (generic ideas only; provider-neutral gateway rebuilt from scratch as `server/aiGateway.mjs`)
- Any single derived `path_state`/phase field as a source of truth
- Regex-driven operative progression
- Mentor-driven case progression
- Legacy V1 session transcripts (excluded from the clinical evidence corpus per the Governance Spec §3, unchanged in vNext)

## 5. Clinical content migrated, with review/provenance state

All migrated content retains the review state it had in the legacy corpus. Nothing was promoted to `approved_for_training` by the act of migration (Governance Spec §7).

| Content | Migrated as | `review_status` carried forward |
|---|---|---|
| Disease card (classification, physiology envelopes, numeric facts, teaching traps) | `content/diseases/appendicitis/disease.yaml` | `reviewed_internal`, `independent_review_status: pending` (unchanged) |
| `early_subtle`, `classic`, `pelvic`, `retrocecal`, `late_complicated` phenotypes | `content/diseases/appendicitis/phenotypes.yaml` | `pending` (unchanged); no learner activation |
| Exam-slot wording, universal normal layer | `content/diseases/appendicitis/findings.yaml` | `reviewed_internal` for the universal layer; `pending` for phenotype-specific slot content (unchanged) |
| Cefazolin / metronidazole / appendectomy prophylaxis dosing rules | `content/diseases/appendicitis/rules.yaml` (`RULE-CEFAZOLIN-PROPHYLAXIS-DOSE`) | `reviewed_internal`, reviewers Сарина Т.Т. + Каукенова Б.Н., dated 2026-08-20, `allowed_runtime_effects: [mentor_teaching]`, `score_weight: 0` — identical constraints to the legacy signed subset |
| KZ hospital resource profiles (R1/R2/R3) | `core/hospital/hospitalProfiles.js` | `reviewStatus: pending_owner_review` (explicitly not upgraded — matches `KZ_RESOURCE_PROFILES_REVIEW.md`'s own `WORKFLOW_ASSUMPTIONS_PENDING_OWNER_REVIEW`) |
| Reference hospital profile | `core/hospital/hospitalProfiles.js` | `reviewStatus: approved_for_pilot` (matches `REFERENCE_RESOURCE_PROFILE_PILOT_APPROVAL_2026-08-20.md`) |

Independent clinical review, Kazakh clinical-language review, and the KZ resource-profile owner review remain **pending** in vNext exactly as they were pending in the legacy corpus. Migrating content did not and could not close those gates.

## 6. No missing referenced file

Every document named in task brief §1 was located under a plausible filename variant and read. No stop condition from §34 ("an authoritative foundation/spec document is missing") applies.

## 7. Completeness disclaimer

This audit reflects what was inspected during a single build pass. It intentionally does not claim to have read every legacy test, every AB-testing artifact (`AB_MENTOR_*`), or every pilot-operations document (`PILOT_*`, `REMEDIATION_STATUS.md`, etc.) in `onqol-trainer/` — those are pilot-operations material, not architecture or clinical-content sources, and were out of scope for this rebuild's inspection.

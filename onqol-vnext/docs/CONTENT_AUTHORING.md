# Content Authoring Guide

Clinical content lives entirely under `src/content/`. This document is for whoever authors the *next* disease module or extends appendicitis — not for engine changes.

## File layout (per disease)

```text
src/content/diseases/<disease_id>/
├── disease.yaml         classification, physiology envelopes, numeric facts, teaching traps
├── phenotypes.yaml       phenotype cards + case presets
├── trajectories.yaml     natural history, treatment effects, investigation ETAs
├── findings.yaml         exam-slot wording, universal normal-exam layer, history template
├── rules.yaml            reviewed clinical/safety rules (the four-level model)
├── operative.yaml        preop requirements, operative sequence, decisions
├── complications.yaml    postoperative course, probabilistic complications
└── locales/              locale status notes (see below)
```

Shared, disease-independent content lives in `src/content/shared/<category>/*.yaml` (currently `medications/formulary.yaml`; `actions/`, `examinations/`, `investigations/`, `perioperative/`, `resources/` exist as empty category folders, ready for content).

Run `npm run content:build` after any edit. It compiles every disease's YAML into `src/content/generated/<disease>.json` plus `shared.json`, and it **fails the build** — not just warns — if a rule in `rules.yaml` is missing `source_ids`, `review_status`, or (when claiming `approved_for_training`) recorded `reviewers`. This is deliberate: `scripts/buildContentIndex.mjs` is the release gate described in Governance Spec §19, enforced mechanically rather than by someone remembering to check.

## Provenance is mandatory, not decorative

Every rule in `rules.yaml` must carry, at minimum:

```yaml
- id: RULE-SOMETHING
  level: LEVEL_2_EDUCATIONAL     # one of the four safety levels, see safetyLevels.js
  conditions: [...]              # see "Writing a rule condition" below
  teaching_point_ru: "..."       # what the mentor may say, verbatim or near-verbatim
  source_ids: [WSES2025]         # must resolve to an entry in disease.yaml's sources
  review_status: reviewed_internal   # draft | reviewed | reviewed_internal | approved_for_training | deprecated
  score_weight: 0
```

**Never** set `review_status: approved_for_training` because a rule "seems obviously right." That status requires the same independent-review bar as the legacy corpus (Governance Spec §8: two reviewers minimum for a high-risk rule, more if it crosses specialties) — record `reviewers: [...]` and `reviewed_at` when it's actually been given that review, not before.

## Writing a rule condition

Conditions are evaluated by `core/rules/conditions.js` against `{ state, learnerVisible, command }`. **`learnerVisible` never contains hidden patient truth** — see `core/state/learnerView.js`. If your rule needs to know something the patient engine knows but the learner hasn't been shown yet, the fix is never to read `state.truth` from a new condition evaluator; it's to make sure the fact becomes a disclosed finding (via `payload.findingIds` on the event that reveals it) and key the condition off `findingRevealed`.

An evaluator that doesn't exist yet, or a condition whose evaluator returns `undefined`, makes the whole rule `UNKNOWN` → ineligible. This is intentional fail-closed behavior (`ruleEngine.test.js` has a regression test for it) — do not "fix" a rule that isn't firing by making its evaluator guess.

## Adding a phenotype

A `phenotypes.yaml` entry needs: `phenotype_id`, `compatible_morphologies`, `presentation` (hours_from_onset range, pain_score range, pain sites, history lines, `examination_slots` — fixed states — and `examination_slot_choices` — drawn per-seed from a small option list), and `imaging` (ultrasound/CT/operative-truth text). Every `examination_slots` value must be a key that exists in `findings.yaml`'s matching `exam_slots[].states` — the patient generator does not validate this at build time yet (see `docs/KNOWN_GAPS.md`), so a typo here silently drops that finding from the rendered exam rather than erroring.

Add a `case_presets` entry pointing at the phenotype to make it selectable by `casePresetId`.

## Adding a second disease (the architecture's own acceptance test)

Per Core Runtime Spec §63/§71: create `src/content/diseases/<new_disease>/` with the same seven required files. If you find yourself wanting to add `if (diseaseId === "...")` anywhere in `src/core/` or `src/ai/renderer/renderEvent.js` to make it work, stop — that's the signal the abstraction is incomplete, not a signal to add the branch. The two legitimate ways to extend the engine for genuinely new mechanics are: (1) a new `core/rules/conditions.js` evaluator, generic across diseases, or (2) a new `core/commands/commandTypes.js` command, likewise generic. Neither should ever hardcode a disease id.

## Locale status

Clinical content (`*_ru` fields) is RU-only in this build, matching the legacy corpus's own `kk: draft_clinical_translation` state — see `src/content/diseases/appendicitis/locales/README.md`. Do not add `*_kk` clinical strings without a Kazakh clinical-language reviewer; the locale *architecture* (this folder, `ru`/`kk` as first-class ids everywhere in `core`/`ai`) is ready for it, but filling it in is a clinical-content task, not an engineering one.

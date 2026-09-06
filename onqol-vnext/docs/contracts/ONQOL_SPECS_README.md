# ON QOL Authoritative Specification Set

**Date:** 2026-08-30  
**Status:** Authoritative contract index

This folder contains the current product contracts for ON QOL. These documents are intended to be read together, but each has a distinct authority boundary.

## Current authoritative documents

| Document | Version | Governs | Does not govern |
|---|---:|---|---|
| `ONQOL_NORTH_STAR_v1.1_2026-08-30.md` | 1.1 | Product purpose, end-state, non-negotiable principles, scope of the simulation | Detailed implementation behavior, clinical doses, mentor state machine |
| `ONQOL_CORE_RUNTIME_SPEC_v2.0_2026-08-30.md` | 2.0 | Patient/world/runtime behavior, state ownership, time, resources, interpreter boundaries, replay, operative/postoperative flow, scaling | Which medical rule is clinically correct, detailed mentor pedagogy |
| `ONQOL_CLINICAL_GOVERNANCE_SPEC_v1.1_2026-08-30.md` | 1.1 | Clinical authority, evidence hierarchy, provenance, review states, source conflicts, high-risk content, release gates | UI behavior, runtime architecture except where needed for safety boundaries |
| `ONQOL_MENTOR_SPEC_v1.1_2026-08-30.md` | 1.1 | Mentor intervention, adequacy states, scaffolding, learner ownership, live teaching behavior, mentor evidence boundary | Patient truth, hospital truth, clinical rule creation |

## Superseded documents

The following documents are superseded by this set and should not remain active sources of truth:

- `ONQOL_NORTH_STAR` version 1.0 dated 2026-08-09;
- `ONQOL_PRODUCT_BEHAVIOR_CONTRACT_v1.0_2026-08-22.md`;
- `ONQOL_CORE_FOUNDATION_SPEC_v1.0_2026-08-22.md`;
- `ONQOL_CLINICAL_EVIDENCE_GOVERNANCE_SPEC_v1.0_2026-08-13.md`;
- `ONQOL_MENTOR_BEHAVIOR_SPEC_v1.0_2026-08-13.md`.

For auditability, old files may be moved to an archive folder. They should not be used by implementation agents as parallel authority.

## What was consolidated

`ONQOL_CORE_RUNTIME_SPEC_v2.0_2026-08-30.md` consolidates the old Product Behavior Contract and Core Foundation Specification. The two old documents substantially overlapped and risked drifting apart.

The consolidated runtime specification preserves the agreed learner-facing behavior while making the architecture boundary explicit:

- Patient Engine owns biology;
- Hospital / World Engine owns operational reality and resources;
- Clinical Rule Layer owns reviewed medical authority;
- Language Interpreter converts learner language to explicit structured intent;
- Mentor owns adaptive teaching behavior only;
- Event / Causal History owns reconstruction and replay.

## Conflict-resolution order

These documents are complementary rather than a single hierarchy. When a direct conflict appears, use the following rule:

1. **Clinical truth, safety, evidence, review status, dose, threshold, indication, contraindication, or treatment effect:** Clinical Governance wins.
2. **Who owns state, what changes time, how resources behave, what transitions are structurally valid, what the interpreter may execute:** Core Runtime wins.
3. **Whether the mentor intervenes, what teaching mode it uses, scaffolding, question behavior, and learner ownership:** Mentor Spec wins.
4. **High-level product purpose or a decision not specified elsewhere:** North Star guides interpretation.

If two current authoritative documents still appear to conflict after applying these boundaries, do not silently choose one. Record the conflict and request an explicit contract change.

## Clinical content is separate from product contracts

Disease-specific clinical review tables, source registries, conflict maps, phenotype files, formulary rules, treatment effects, discharge criteria, and scenario content are not part of this four-document constitution.

They may change more frequently and must follow Clinical Governance.

Likewise, sprint tasks, wave reports, test counts, model bake-off results, pilot readiness reports, and known-gap lists are implementation/status artifacts, not permanent product contracts.

## Rule for implementation agents

Before a material runtime change:

1. read all four authoritative specifications;
2. identify which contract owns the requested behavior;
3. preserve unrelated contract behavior;
4. do not convert an implementation limitation into a clinical rule;
5. do not promote pending clinical content simply to make a feature appear complete;
6. report any contract conflict instead of improvising a new product rule.

# ON QOL Emergency Surgery Corpus v1

This is the first retrieval corpus for the ON QOL clinical reasoning simulator.

## What it is for

The corpus gives the semantic router a broad emergency-surgery vocabulary and lets the system retrieve
relevant background when it needs to understand terms, abbreviations, synonyms, procedures and relationships.

It is **not** the patient simulator's source of truth.

The hierarchy is:

`Case Card > validated Disease Card > current disease-specific guideline > Kazakhstan overlay > general corpus`

A retrieved guideline passage must never create a patient finding or assign a score.

## What to ingest now

Start with the three P0 open-access sources:

1. Global intra-abdominal infection pathways (2021)
2. WSES source-control guidelines (2023)
3. Cesena laparoscopic-first consensus (2023)

Then ingest P1 disease-specific open-access sources as those Disease Cards are added.

The 2020 appendicitis guideline is useful for terminology and older background, but the current appendicitis
clinical authority in ON QOL should remain the validated Disease Card based on the 2025 WSES update.

## Why not Sabiston yet

This corpus is intentionally built from open-access guideline material with explicit reuse terms. It gives the
router most of the vocabulary and acute-care relationships needed for MVP testing without licensing a
commercial textbook.

## Files

- `corpus_manifest.yaml`: source registry and authority metadata
- `RETRIEVAL_POLICY.md`: hard rules for retrieval and medical authority
- `CODEX_INTEGRATION.md`: implementation instructions
- `chunk_metadata.schema.json`: metadata schema for indexed chunks
- `SOURCES.md`: human-readable source list

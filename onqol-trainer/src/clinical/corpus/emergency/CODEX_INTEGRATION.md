# Codex integration brief

## Objective

Add a small RAG/reference layer to the existing semantic router without giving the RAG layer authority over
patient findings, scoring or case state.

## Step 1: create a corpus registry

Read `corpus_manifest.yaml`.

Only automatically ingest records where:
- `ingest_fulltext: true`
- license is explicitly compatible with product ingestion

Do not automatically ingest JAMA full text.

## Step 2: fetch and normalize

For each ingestible source:
1. fetch from the official article URL
2. prefer the publisher PDF or clean article HTML
3. retain title, year, DOI, source ID and license
4. strip navigation, reference widgets and unrelated page chrome
5. preserve section headings
6. preserve recommendation/statement boundaries

Do not paraphrase the source during ingestion.

## Step 3: chunking

Do NOT use blind fixed-size chunks as the primary strategy.

Preferred:
- recommendation/statement as atomic chunk when present
- otherwise heading + paragraph group
- target approximately 500-1000 tokens
- max about 1200 tokens
- overlap only when context would otherwise be lost

Never split:
- recommendation from its qualifiers
- strength/quality of evidence from the recommendation
- condition heading from the recommendation it governs

Attach metadata defined in `chunk_metadata.schema.json`.

## Step 4: retrieval

Semantic-router retrieval query should combine:
- raw user utterance
- current case specialty / condition
- current phase
- allowed concept IDs and short definitions

Retrieve a small number of chunks (e.g. top 3-5).

Retrieved text is context for semantic interpretation only.

## Step 5: router contract

LLM output stays strict structured JSON.

The LLM may:
- map natural language to allowed concepts
- detect a recognized medical concept absent from the case schema
- detect ambiguity
- detect a likely terminology synonym

The LLM may not:
- invent findings
- invent a new allowed action
- set case state
- set scores
- confirm a diagnosis mid-case from RAG text

## Step 6: recognized but undefined

Example:

User:
"Ровзинг, psoas, obturator?"

RAG/router recognizes:
- rovsing_sign
- psoas_sign
- obturator_sign

If the Case Card defines only `rovsing_sign`:
- return the defined Rovsing finding
- mark the other two as `recognized_but_undefined`
- log them to `content_gaps`

Do not substitute a general abdominal exam.

## Step 7: conflict handling

If a general-corpus source conflicts with the Disease Card:
- Disease Card wins at runtime
- log the conflict for clinical review

Do not silently rewrite the Disease Card.

## Step 8: tests before expanding corpus

Run existing RU/KZ router tests plus:
- specific named signs
- mixed RU/EN terms
- misspellings
- abbreviations
- multiple intents in one message
- recognized-but-undefined concept
- retrieved source conflict with Disease Card

Acceptance target for curated test set: >=95% correct intent/concept mapping.

Only after this works should more documents be added.

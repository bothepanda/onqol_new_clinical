# ON QOL appendicitis concept dictionary v0.1

## Goal

Integrate `appendicitis.concepts.yaml` as a semantic vocabulary layer between the LLM router and the deterministic Case Engine.

This file is **not** a clinical source of truth. It must never generate patient findings, scoring, or recommendations.

## Required behavior

Pipeline:

`user free text -> LLM semantic router -> validated concept_ids -> Case Engine -> case-authored findings/state/scoring`

### Router input

Pass:
- raw user text
- locale (`ru` or `kk`, but mixed RU/KK/EN terms must be accepted)
- current case phase/state
- the allowed concept subset for the current case
- concept descriptions and aliases from `appendicitis.concepts.yaml`

Do not pass the entire disease card if it is not needed for routing.

### Router output

Strict JSON only:

```json
{
  "intents": [
    {
      "type": "request_history | request_examination | request_test | diagnosis | management | question | unknown",
      "concept_id": "language_neutral_concept_id | null",
      "confidence": 0.0
    }
  ],
  "unresolved_fragments": []
}
```

### Validation

1. Keep only concept_ids present in the case's allowed concept list.
2. Never invent a concept_id.
3. A message may return multiple concepts.
4. Broad concepts such as `physical_examination`, `relevant_history`, and `abdominal_examination` may expand using `broad_expands_to`, but reveal only sub-findings actually defined in the current Case Card.
5. If one fragment is unresolved, execute the recognized fragments. Do not show a global failure message.
6. `Ortolani` is an intentional negative test: do not map it to Rovsing, psoas, obturator, or generic abdominal exam.
7. The router may understand a concept that the Case Card does not define. In that case return/log `recognized_but_undefined` and do not invent a finding.

## Important separation

- `appendicitis.core.yaml`: evidence and clinical rules.
- `appendicitis.concepts.yaml`: language/semantic vocabulary.
- `case.*.yaml`: patient-specific findings and state transitions.
- scoring engine: deterministic evaluation.
- LLM: interpretation and wording only.

## Acceptance tests

Run every entry in `router_tests.ru_kk.yaml`.

Minimum acceptance threshold for MVP:
- >= 95% exact concept-set accuracy overall
- 100% on safety-critical multi-intent tests
- 100% on the three special signs test:
  `Ровзинга + psoas + obturator`
- no forced mapping of `Ortolani`

Log every failed phrase so the dictionary can be expanded from real usage rather than by guessing synonyms.

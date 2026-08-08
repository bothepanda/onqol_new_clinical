# Migration notes for Codex

## Replace the current duplicate RU/KK disease-card model

Do not maintain two clinical Markdown copies as independent sources of truth.

Target:

```text
clinical/
  diseases/
    appendicitis/
      appendicitis.core.yaml
      locales/
        ru.yaml
        kk.yaml
      CLINICAL_REVIEW_NEEDED.md
```

## Required changes

1. Parse `appendicitis.core.yaml` into typed objects.
2. Validate every `text_key` against both locale files at build/test time.
3. Reject a locale build if a key is missing.
4. Never read numbers or scoring rules from locale text.
5. Treat `operationalized_rules[*].eligible_for_scoring: false` as non-scoreable discussion points.
6. Encode recommendation strength explicitly. `conditional` must not become an absolute ban.
7. When a `kz_protocol_delta` applies, final feedback should show both the international and Kazakhstan positions with provenance.
8. Do not expose exact AIR/AAS/PAS points while `numeric_cutoffs_available_in_corpus: false`.
9. Do not expose a specific antibiotic drug/dose as WSES guidance.
10. Keep the production gate closed while `review.release_gate.production_allowed: false`.

## Tests to add

- RU and KK produce identical structured clinical decisions and score for the same canonical action sequence.
- Changing locale does not change any number, recommendation ID, strength, certainty, or score.
- A conditional recommendation can be deviated from with an explicit reason without triggering an engine-level “impossible action” error.
- A periappendicular abscess case can legally enter an NOM branch where defined by WSES-R13.1/R13.2.
- The engine does not apply the old blanket rule “NOM only uncomplicated”.
- Operationalized transfer rules cannot affect score until approved.

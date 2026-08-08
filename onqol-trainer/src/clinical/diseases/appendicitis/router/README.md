# ON QOL Appendicitis Semantic Layer v0.1

Files:
- `appendicitis.concepts.yaml`: RU/KZ/EN concept vocabulary for semantic routing.
- `router_tests.ru_kk.yaml`: 40 acceptance phrases (20 RU, 20 KZ).
- `CODEX_INTEGRATION.md`: integration requirements.

Design principle:
**wide language understanding, narrow clinical authority.**

The router may understand many ways a clinician phrases an action. Patient-specific findings remain exclusively in the Case Card.

Kazakh terminology is a working clinical translation and should be reviewed by a Kazakh-speaking surgeon before pilot release.

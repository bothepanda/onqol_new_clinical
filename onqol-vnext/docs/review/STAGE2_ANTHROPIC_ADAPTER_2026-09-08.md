# Anthropic Adapter Followup

Status: adapter implemented; live interpreter smoke blocked by provider schema complexity.

## Approved Live Attempts

After explicit payload approval, three separately recorded transport-smoke attempts returned HTTP 400:

1. `06c1ecc1-a5a9-44d5-aa38-d169d1de200a`: numeric minimum/maximum unsupported.
2. `760ad1c5-f008-46b2-b97c-6f6539dd58f2`: 22 union-typed parameters exceed the provider limit of 16.
3. `7b507b02-de65-4124-9321-27b0def1ddbd`: compiled grammar too large.

Each directory is under `docs/evidence/stage2-anthropic/` and preserves its candidate fingerprint, original response journal and result. No failed attempt was replaced. Each stopped after the first input, so the injection input was not executed. All three returned deterministic fallback.

Transport-only changes remove confidence bounds (the local validator still enforces 0..1) and represent nullable action parameters as optional typed properties. Sixteen infrastructure tests pass after these changes. The provider still rejects the resulting schema; no successful completion or interpreter quality is claimed. Further schema redesign is not included in this smoke result. The application remains on its prior provider configuration.

- Local ANTHROPIC_API_KEY is present. Official GET /v1/models returned HTTP 200 and listed claude-haiku-4-5-20251001 on 2026-09-08. No key value was printed.
- Selection is explicit: ONQOL_AI_PROVIDER=anthropic. ONQOL_ANTHROPIC_MODEL defaults to the dated Haiku model above. Existing OpenAI default and its evidence files remain unchanged.
- Server translates system messages, strict JSON schema and usage into the existing client envelope. Refusal, truncation and unexpected content fail closed. Existing timeouts and reserved-dollar caps remain active.
- Pricing: USD 1 input / 5 output per million tokens. Sources checked 2026-09-08: https://platform.claude.com/docs/en/about-claude/pricing and https://platform.claude.com/docs/en/build-with-claude/structured-outputs.
- Anthropic does not receive the OpenAI-specific store flag; this implementation makes no claim about vendor-side retention.
- Four added tests and all 16 infrastructure tests pass. Full npm run verify passes: 388 tests, content check, offline corpus, lint and production build.
- The initial live smoke command was rejected before execution by automatic permission review. The user subsequently approved the described payload; the live attempts above supersede that permission blocker.
- Smoke command: node scripts/smokeAnthropicInterpreter.mjs. Each run creates a separate transport-smoke candidate and durable response journal; it does not consume or replace the frozen corpus. Do not rerun the unchanged rejected schema expecting a quality measurement.
- The old OpenAI source freeze no longer matches the working tree after adapter changes. Do not revise its evidence in place or claim that its acceptance gate passed. A full Anthropic corpus candidate still needs its own complete freeze and independent gold review.
- Existing running application was not switched. Live completion, schema acceptance, latency and quality remain unverified for Anthropic.

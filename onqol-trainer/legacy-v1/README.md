# ON QOL V1 conversational prototype

This directory is an independently built historical prototype. It is not part
of the North Star learner bundle and must be deployed as a separate protected
project/URL.

V1 intentionally preserves its original prompt-driven behaviour: the model
creates the patient facts, coaching and summary. It therefore is not suitable
for clinical assessment, validated scoring, efficacy claims or mixing with
North Star sessions.

## Required environment

- `ANTHROPIC_API_KEY`: provider credential, server-side only.
- `ONQOL_V1_ACCESS_TOKEN`: shared internal access code required by the gateway.
- `ONQOL_V1_ALLOWED_ORIGIN`: exact deployed origin, for example
  `https://v1.example.kz`.
- `ANTHROPIC_V1_MODEL`: optional model override.

Use Vercel Deployment Protection (or equivalent hosting authentication) in
addition to the gateway access code. Do not deploy this directory as part of
the main ON QOL project.

## Local verification

```bash
npm ci
npm test
npm run lint
npm run build
ANTHROPIC_API_KEY=... ONQOL_V1_ACCESS_TOKEN=... npm run dev
```

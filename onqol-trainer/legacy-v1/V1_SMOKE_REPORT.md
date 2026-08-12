# V1 smoke report

Status: local automated gates and start/access UI smoke pass; a full live
provider session and protected-host access smoke remain external.

## Automated gates

| Gate | Status | Evidence |
| --- | --- | --- |
| Independent app entry and build | verified | `npm run build` succeeds from `legacy-v1/` |
| No browser provider key | verified | same-origin gateway tests pass; provider key is server-only |
| No public history blob | verified | Vercel Blob dependency and root history endpoint removed |
| V1-only version identity | verified | package `onqol-v1-prototype@1.0.0-internal` |
| Explicit non-evaluation label | verified | persistent V1 warning banner is part of the V1 entry point |
| Main product contains no V1 switch/import | verified | root product-boundary tests pass |
| V1 tests and lint | verified | 4 tests pass; ESLint passes |
| Production dependencies | verified | `npm audit --omit=dev`: 0 vulnerabilities |
| Desktop access/start UI | verified locally | 1280x720: warning, token gate and category grid visible; vertical scroll available |
| Mobile access/start UI | verified locally | 390x844: no horizontal overflow; access fields stack to 44px controls; category grid remains reachable |

## External smoke test still required

- Configure a rotated `ANTHROPIC_API_KEY` and a strong
  `ONQOL_V1_ACCESS_TOKEN` in a separate hosting project.
- Enable hosting-level deployment protection and set the exact allowed origin.
- Run a complete model-backed case on desktop and mobile and verify chat
  scrolling, completion, summary and visible provider errors.
- Confirm the deployed URL cannot be reached anonymously and does not share
  telemetry, storage or credentials with the North Star product.

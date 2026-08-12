# ON QOL version map

Verified: 2026-08-11.

| Layer | Current version | Authority |
| --- | --- | --- |
| Main application release | `3.5.0-internal` | root `package.json` |
| Executable engine | `2.5.2` | `src/clinical/v25/engine.js` (historical module path retained) |
| V3.5 clinical content | `3.5.7` | `src/clinical/v35/manifest.js` |
| Replay export schema | `3.5.0` | `src/clinical/v25/replayExport.js` |
| Reasoning snapshot contract | `3.5.0` | `src/clinical/v35/runtimePath.js` |
| V3.5 scoring contract | version exported by `scoringContract.js`; mode `formative_only` | `src/clinical/v35/scoringContract.js` |
| Router schema | `router-v2` | `src/clinical/schemas/routerSchema.js` |
| Appendicitis disease card | `0.2.0` | composed case metadata |
| Appendicitis router policy | `0.3.1` | composed case metadata |
| Legacy V1 comparison app | `1.0.0-internal` | `legacy-v1/package.json` |

Application, engine, clinical content, schemas and policies intentionally have
separate versions. Session and replay records persist the relevant values so a
content update does not silently rewrite an earlier run.


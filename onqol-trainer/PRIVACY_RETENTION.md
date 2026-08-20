# ON QOL pilot privacy and retention

Status: technical implementation complete for the scoped local-storage pilot;
owner approval, deployed-host verification and the controlled file-transfer
workflow remain release gates.

Scoped cohort: **N=8 residents**, RU/reference/APP-001–004/formative-only.

## Processing and minimisation

- Learner and trainer messages are processed by the same-origin model gateway.
  The provider key remains server-side and requests set `store: false`.
- Provider processing is disclosed before start. Under the provider's default
  abuse-monitoring policy, eligible request/response content can be retained for
  up to 30 days; a shorter/no-retention claim requires confirmed ZDR or MAM for
  this project.
- Current-tab transcript exists in memory. Persisted browser snapshots remove
  messages, turn plans, raw event text and verbatim/reasoning fields.
- There is no central history endpoint or server-side session repository in this
  codebase.

## Local retention and deletion

- Structured sessions, snapshots, analytics, clinical reports and the random
  browser pseudonym expire after seven days.
- Expired session artifacts and report records are purged when the repository or
  report queue is next opened. The pseudonym is rotated when next requested.
- `deleteSession(sessionId)` removes the local session record, snapshot,
  analytics and any explicitly opted-in development raw-event copy.
- The optional `persistRawText` path is development-only and must remain off for
  the pilot.

## Export boundary

- A replay JSON includes structured state, provider telemetry, a redacted
  transcript and same-session clinical reports.
- `raw_learner_text_included: false` means unredacted raw text is excluded; it
  does not mean the redacted transcript is anonymous.
- Browser retention cannot delete a downloaded file. The supervised pilot must
  define a restricted destination, authorised recipients and deletion date, and
  must prohibit personal email, messengers and public upload links.

## Access and release gates

- A random browser id is a pseudonym, not an access credential.
- Production requires an exact HTTPS origin, a separate strong pilot code,
  protected hosting, rate/spend controls and a rotated provider key.
- `src/clinical/governance/pilotReleaseApprovals.js` is the canonical approval
  manifest. Privacy may change to `approved` only with reviewer, date, evidence
  and scope; the deployment variable must match that approval id.
- Any future central store or cross-device resume requires a new data-flow,
  access-control, retention and deletion review before implementation.

Provider data controls: https://developers.openai.com/api/docs/guides/your-data

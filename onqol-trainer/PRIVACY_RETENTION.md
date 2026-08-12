# ON QOL pilot privacy and retention

Status: implementation baseline; owner consent text and hosting policy remain
external release gates.

## Data minimisation

- Raw learner free text is **off by default** for persistence.
- The active transcript exists only in memory for the current browser tab.
- Persisted local snapshots contain structured engine state and events, but no
  transcript, turn plans, raw event text, learner quotes or verbatim reasoning.
- Provider requests use `store: false`; the provider key remains server-side.
- There is no public or central history endpoint in this repository.

The optional `persistRawText` repository flag exists only for controlled
development tests. It must not be enabled for a pilot without a documented need,
participant consent, access control, a clinical-detail redaction layer and a
shorter approved retention period.

## Retention and deletion

- Local structured session snapshots expire after seven days.
- Expired snapshots are deleted on the next save/read operation.
- `deleteSession(sessionId)` removes the local session record, structured
  snapshot, analytics events and any explicitly opted-in raw-event copy.
- User-triggered JSON replay export is outside automatic browser retention; the
  user controls the downloaded file.

## Identity and access

- Learners receive a random anonymous browser id; it is not an authorization
  credential.
- Model access uses a separate internal pilot code, exact-origin policy and
  hosting protection.
- Any future server repository must enforce authenticated ownership for read,
  write and delete. Browser ids or query parameters are insufficient.

## Remaining release gates

1. Owner-approved participant information and consent text.
2. Confirmed provider-key rotation.
3. Hosting authentication and durable rate/spend controls.
4. A server retention/deletion policy if central pilot storage is introduced.
5. A structured-event resume implementation; raw transcript persistence will
   not be reintroduced to obtain resume.

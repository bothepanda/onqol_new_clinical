import { createHmac, randomBytes } from "node:crypto";

/**
 * Participant-level identifiers that contain no direct identity.
 *
 * A participant is a person who takes part in the pilot. The tool never stores a
 * name, an email, an institution or an account: it stores an ALIAS the pilot
 * coordinator chose (`P01`, `P02`, ...) and links sessions to it. Who `P07` is
 * stays in the coordinator's own records, outside this repository and outside this
 * tool. The roster is PRIVATE (gitignored); the tracked repository only ever sees
 * `participantKey`, a keyed hash of the alias under a private salt, so the alias
 * cannot be recomputed from anything tracked.
 *
 * Why participants matter: the same person's phrasing, abbreviations and habits
 * recur across their turns and sessions. If some of a person's turns were used to
 * develop the interpreter and others to evaluate it, the evaluation would measure
 * memorised idiosyncrasy. Every split in this project is therefore made at the
 * participant level (residentSplits.mjs), never at turn or session level.
 */
export const ROSTER_SCHEMA = "onqol-participant-roster-v1";
export const PARTICIPANT_ALIAS = /^P\d{2,3}$/;

export function emptyRoster() {
  return { schema: ROSTER_SCHEMA, note: "PRIVATE. Aliases only - never a name. Do not commit.", salt: randomBytes(16).toString("hex"), participants: {}, sessions: {} };
}

export const participantKeyOf = (roster, alias) => `PK${createHmac("sha256", roster.salt).update(alias).digest("hex").slice(0, 10)}`;

export function registerParticipant(roster, alias) {
  if (!PARTICIPANT_ALIAS.test(alias ?? "")) throw new Error("participant_alias_invalid: use P01, P02, ... (an alias, never a name)");
  if (roster.participants[alias]) return roster;
  const next = structuredClone(roster);
  next.participants[alias] = { key: participantKeyOf(roster, alias), registeredAt: new Date().toISOString() };
  return next;
}

/** Links a session to a registered participant. A session belongs to exactly one participant, forever. */
export function assignSession(roster, sessionKey, alias) {
  if (!roster.participants[alias]) throw new Error(`participant_not_registered:${alias}`);
  const current = roster.sessions[sessionKey];
  if (current && current !== alias) throw new Error(`session_already_assigned:${sessionKey}->${current}`);
  if (current) return roster;
  const next = structuredClone(roster);
  next.sessions[sessionKey] = alias;
  return next;
}

/** `{ alias, participantKey }` of a session, or null while it is unassigned. */
export function participantOfSession(roster, sessionKey) {
  const alias = roster.sessions[sessionKey];
  return alias ? { alias, participantKey: roster.participants[alias].key } : null;
}

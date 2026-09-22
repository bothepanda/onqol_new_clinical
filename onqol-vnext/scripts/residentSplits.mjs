import { createHash } from "node:crypto";

/**
 * Participant-grouped evaluation splits for real resident turns.
 *
 * Rules (they are the point of this file):
 *  - The unit of assignment is the PARTICIPANT. All of a participant's sessions and
 *    turns go to exactly one split; no participant's language is in both.
 *  - Assignment is APPEND-ONLY. A participant, once assigned, is never moved, so
 *    what was untouched stays untouched. The plan is recorded with a running hash.
 *  - A participant whose words were seen by the developers (for example the first
 *    pilot session, whose turns had been copied into the corpus and the regression
 *    tests) can only be DEVELOPMENT: their language is no longer unseen.
 *  - A session not yet linked to a participant is QUARANTINED: collected, counted,
 *    but in no split and in no evaluation, until the coordinator links it.
 *  - EVALUATION turns are untouched: no interpreter code, prompt, schema, registry
 *    or metric may be changed from them before the predefined evaluation is
 *    completed. Developer-facing tools read the DEVELOPMENT split only.
 */
export const SPLIT = Object.freeze({ DEVELOPMENT: "RESIDENT_DEVELOPMENT", EVALUATION: "RESIDENT_EVALUATION" });
export const PLAN_SCHEMA = "onqol-resident-split-plan-v1";

/**
 * Collection targets. 60 is the MINIMUM readiness gate: below it nothing can be
 * said. It is not a validation target. The plan is 150-250 turns collected
 * naturally across the pilot, from as many participants as the pilot has.
 */
export const COLLECTION_TARGETS = Object.freeze({
  minimumReadinessTurns: 60,
  plannedTurns: { min: 150, max: 250 },
  minimumEvaluationParticipants: 3,
  minimumEvaluationTurns: 60,
  evaluationShareOfParticipants: 0.4,
});

const sha = (value) => createHash("sha256").update(value).digest("hex");

export function emptyPlan({ seed = "onqol-resident-split-1", evaluationShare = COLLECTION_TARGETS.evaluationShareOfParticipants } = {}) {
  return { schema: PLAN_SCHEMA, seed, evaluationShare, assignments: {}, sequence: 0, chain: sha("genesis") };
}

/**
 * Assigns participants that have no assignment yet. `candidates` are
 * `{ participantKey, forcedSplit? }`. Existing assignments are never touched.
 * Within a batch the order is a fixed hash order, so the result does not depend on
 * the order the exports happened to be read in.
 */
export function assignParticipants(plan, candidates) {
  const next = structuredClone(plan);
  const fresh = candidates.filter((c) => !next.assignments[c.participantKey]);
  const forced = fresh.filter((c) => c.forcedSplit);
  const free = fresh.filter((c) => !c.forcedSplit).sort((a, b) => sha(`${plan.seed}|${a.participantKey}`).localeCompare(sha(`${plan.seed}|${b.participantKey}`)));
  const place = (candidate, split, reason) => {
    next.sequence += 1;
    next.assignments[candidate.participantKey] = { split, seq: next.sequence, reason };
    next.chain = sha(`${next.chain}|${next.sequence}|${candidate.participantKey}|${split}`);
  };
  for (const candidate of forced) place(candidate, candidate.forcedSplit, "forced");
  for (const candidate of free) {
    const total = Object.keys(next.assignments).length;
    const evaluation = Object.values(next.assignments).filter((a) => a.split === SPLIT.EVALUATION).length;
    place(candidate, evaluation + 1 <= Math.round(next.evaluationShare * (total + 1)) ? SPLIT.EVALUATION : SPLIT.DEVELOPMENT, "share");
  }
  return next;
}

/** True when `later` only appends to `earlier`: no assignment was changed or removed. */
export function planOnlyAppends(earlier, later) {
  return Object.entries(earlier.assignments).every(([key, value]) => later.assignments[key]?.split === value.split && later.assignments[key]?.seq === value.seq);
}

/**
 * Where a collected turn stands. `turn.exposure` is "unseen" (default) or
 * "seen_by_developers". Returns `{ participantKey, split, evaluationEligible, reasons }`.
 */
export function classifyTurn({ turn, participantKey, plan }) {
  const reasons = [];
  if (!participantKey) return { participantKey: null, split: null, evaluationEligible: false, reasons: ["session_not_linked_to_a_participant"] };
  const split = plan.assignments[participantKey]?.split ?? null;
  if (!split) reasons.push("participant_not_yet_assigned");
  if ((turn.exposure ?? "unseen") !== "unseen") reasons.push("seen_by_developers");
  return { participantKey, split, evaluationEligible: split === SPLIT.EVALUATION && reasons.length === 0, reasons };
}

/** Throws when any participant has turns in both splits. */
export function assertParticipantDisjoint(classified) {
  const seen = new Map();
  for (const { participantKey, split } of classified) {
    if (!participantKey || !split) continue;
    if (seen.has(participantKey) && seen.get(participantKey) !== split) throw new Error(`participant_in_both_splits:${participantKey}`);
    seen.set(participantKey, split);
  }
  return true;
}

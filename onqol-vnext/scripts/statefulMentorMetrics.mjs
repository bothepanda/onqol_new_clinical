#!/usr/bin/env node
/**
 * Stateful Grounded Mentor Wave A - offline conversation metrics (ТЗ §21).
 *
 * Computes the 8 named rates from recorded sessions' event logs. Offline by
 * design (no live dashboard this wave - see docs/STATEFUL_GROUNDED_MENTOR_WAVE_A.md
 * §"Explicitly deferred"), mirroring the existing `scripts/v3Metrics.mjs`
 * convention of small, documented, replay-derived definitions.
 *
 * Input: one or more session EXPORT files (`exportSession.js`'s shape - the
 * files `useSession.js`'s "download export" button produces), or a directory
 * containing them. Everything here reads only `.events`; it never needs
 * `current_state` or the patient/hospital sections.
 *
 * Usage:
 *   node scripts/statefulMentorMetrics.mjs <file-or-dir> [<file-or-dir> ...]
 *   node scripts/statefulMentorMetrics.mjs --out report.json <dir>
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const HIDDEN_TRUTH_PATTERN = /hidden|leak/i;
const UNSUPPORTED_PATTERN = /unsupported|^supported$/i;
const ATTRIBUTION_PATTERN = /attribution/i;

function collectEventFiles(inputs) {
  const files = [];
  for (const input of inputs) {
    const stat = statSync(input);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(input)) {
        if (entry.endsWith(".json")) files.push(path.join(input, entry));
      }
    } else {
      files.push(input);
    }
  }
  return files;
}

function loadSessions(files) {
  return files.map((file) => {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    const events = Array.isArray(parsed) ? parsed : parsed.events;
    if (!Array.isArray(events)) throw new Error(`${file}: no "events" array found (not a session export?)`);
    return { file, events };
  });
}

/**
 * One session's worth of MENTOR_INTERVENED / MENTOR_GROUNDED_RESPONSE_RENDERED
 * events -> per-metric tallies. Kept as counts, not rates, so the caller can
 * sum across many sessions before dividing (a rate-of-rates would silently
 * under-weight short sessions).
 */
function tallySession(events) {
  const tally = {
    spokenInterventions: 0,
    repeatedQuestion: 0,
    sufficientButSpoke: 0,
    continuationRecognized: 0,
    continuationOpportunities: 0,
    teachInterventions: 0,
    prematureLecture: 0,
    highScaffoldInterventions: 0,
    ownershipReturned: 0,
    sufficientWithPriorPending: 0,
    sufficientAdvanced: 0,
    groundedResponses: 0,
    hiddenTruthFlagged: 0,
    unsupportedFlagged: 0,
    falseAttributionFlagged: 0,
  };

  let priorSpoken = null; // the last spoken MENTOR_INTERVENED payload
  let priorPendingIssueId = null; // state.mentor.pendingMentorQuestion?.issueId BEFORE the current event

  for (const event of events) {
    if (event.type === "MENTOR_GROUNDED_RESPONSE_RENDERED") {
      tally.groundedResponses += 1;
      const reasons = event.payload.reasons ?? [];
      if (reasons.some((r) => HIDDEN_TRUTH_PATTERN.test(r))) tally.hiddenTruthFlagged += 1;
      if (reasons.some((r) => UNSUPPORTED_PATTERN.test(r))) tally.unsupportedFlagged += 1;
      if (reasons.some((r) => ATTRIBUTION_PATTERN.test(r))) tally.falseAttributionFlagged += 1;
      continue;
    }
    if (event.type !== "MENTOR_INTERVENED") continue;
    const p = event.payload;
    const spoke = p.spoke !== false;

    if (spoke) {
      tally.spokenInterventions += 1;
      if (priorSpoken && priorSpoken.issueId && priorSpoken.issueId === p.issueId && priorSpoken.scaffolding === p.scaffolding) {
        tally.repeatedQuestion += 1;
      }
      if (p.adequacy === "SUFFICIENT") tally.sufficientButSpoke += 1;
      if (p.mode === "TEACH") {
        tally.teachInterventions += 1;
        if ((p.scaffolding ?? 0) >= 3 && (p.probingStreak ?? 0) <= 1) tally.prematureLecture += 1;
      }
      if ((p.scaffolding ?? 0) >= 3) {
        tally.highScaffoldInterventions += 1;
        if (p.openQuestion) tally.ownershipReturned += 1;
      }
      if (p.adequacy && p.adequacy !== "SUFFICIENT" && priorPendingIssueId) {
        tally.continuationOpportunities += 1;
        if ((p.probingStreak ?? 0) > 1) tally.continuationRecognized += 1;
      }
      if (p.adequacy === "SUFFICIENT" && priorPendingIssueId) {
        tally.sufficientWithPriorPending += 1;
        // "pendingMentorQuestion" in p: present only when memory was recomputed this turn.
        if ("pendingMentorQuestion" in p && p.pendingMentorQuestion === null) tally.sufficientAdvanced += 1;
      }
      priorSpoken = p;
    }
    if ("pendingMentorQuestion" in p) priorPendingIssueId = p.pendingMentorQuestion?.issueId ?? null;
  }
  return tally;
}

function rate(numerator, denominator) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : null;
}

/**
 * Wave B additions (fluids_01). Same counts-not-rates convention.
 *
 *  - reassessment follow-through: of the learner's bolus infusions, how many were
 *    followed by an observation or a monitoring plan before the next bolus
 *    (or that the learner had planned monitoring for beforehand)
 *  - world-vs-mentor clarification: of the turns where the WORLD (nurse / lab)
 *    had to ask for a missing operational parameter, how many were answered by
 *    the world alone rather than also drawing a mentor intervention
 *  - stale issue reopen: spoken interventions on an issue that had already been
 *    deferred to the debrief
 */
export function tallyWaveB(events) {
  const tally = { boluses: 0, followedUp: 0, clarificationTurns: 0, clarificationsWorldOnly: 0, spoken: 0, staleReopened: 0 };
  let monitoringPlanned = false;
  const deferred = new Set();
  const turns = [];
  for (const event of events) {
    if (event.type === "LEARNER_TURN_RECEIVED") turns.push([]);
    else if (turns.length) turns.at(-1).push(event);
    if (event.type === "MONITORING_PRESCRIBED") monitoringPlanned = true;
  }
  const bolusEvents = events.filter((e) => e.type === "INFUSION_STARTED" && e.cause?.actor === "learner" && e.payload?.bolus === true);
  tally.boluses = bolusEvents.length;
  monitoringPlanned = false;
  bolusEvents.forEach((bolus, index) => {
    const start = events.indexOf(bolus);
    const next = bolusEvents[index + 1] ? events.indexOf(bolusEvents[index + 1]) : events.length;
    const window = events.slice(start + 1, next);
    const plannedBefore = events.slice(0, start).some((e) => e.type === "MONITORING_PRESCRIBED");
    if (plannedBefore || window.some((e) => ["VITALS_OBSERVED", "MONITORING_PRESCRIBED"].includes(e.type))) tally.followedUp += 1;
  });
  for (const turn of turns) {
    const clarified = turn.some((e) => e.type === "CLARIFICATION_REQUESTED");
    const mentorSpoke = turn.some((e) => e.type === "MENTOR_INTERVENED" && e.payload.spoke !== false);
    if (clarified) {
      tally.clarificationTurns += 1;
      if (!mentorSpoke) tally.clarificationsWorldOnly += 1;
    }
    for (const e of turn) {
      if (e.type !== "MENTOR_INTERVENED") continue;
      for (const id of e.payload.deferredMentorIssues ?? []) deferred.add(id);
      if (e.payload.spoke !== false && e.payload.issueId) {
        tally.spoken += 1;
        if (deferred.has(e.payload.issueId) && !(e.payload.deferredMentorIssues ?? []).includes(e.payload.issueId)) tally.staleReopened += 1;
      }
    }
  }
  return tally;
}

export function computeMetrics(sessions) {
  const totals = sessions.reduce((sum, { events }) => {
    const t = tallySession(events);
    for (const key of Object.keys(t)) sum[key] = (sum[key] ?? 0) + t[key];
    return sum;
  }, {});

  const waveB = sessions.reduce((sum, { events }) => {
    const t = tallyWaveB(events);
    for (const key of Object.keys(t)) sum[key] = (sum[key] ?? 0) + t[key];
    return sum;
  }, {});

  return {
    sessionCount: sessions.length,
    reassessment_followthrough_rate: rate(waveB.followedUp, waveB.boluses),
    world_vs_mentor_clarification_accuracy: rate(waveB.clarificationsWorldOnly, waveB.clarificationTurns),
    stale_issue_reopen_rate: rate(waveB.staleReopened, waveB.spoken),
    _waveBCounts: waveB,
    question_repeat_rate: rate(totals.repeatedQuestion, totals.spokenInterventions),
    unnecessary_intervention_rate: rate(totals.sufficientButSpoke, totals.spokenInterventions),
    same_issue_persistence_accuracy: rate(totals.continuationRecognized, totals.continuationOpportunities),
    premature_lecture_rate: rate(totals.prematureLecture, totals.teachInterventions),
    ownership_return_rate: rate(totals.ownershipReturned, totals.highScaffoldInterventions),
    sufficient_answer_advancement_rate: rate(totals.sufficientAdvanced, totals.sufficientWithPriorPending),
    hidden_truth_leak_rate: rate(totals.hiddenTruthFlagged, totals.groundedResponses),
    unsupported_claim_rate: rate(totals.unsupportedFlagged, totals.groundedResponses),
    // Not one of the 8 named metrics, but the same shape and useful to see
    // alongside them - how often the verifier itself caught a false
    // attribution before it reached the learner.
    false_source_attribution_rate: rate(totals.falseAttributionFlagged, totals.groundedResponses),
    _counts: totals,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf("--out");
  const outFile = outIndex >= 0 ? args[outIndex + 1] : null;
  const inputs = args.filter((a, i) => a !== "--out" && i !== outIndex + 1);
  if (!inputs.length) {
    console.error("Usage: node scripts/statefulMentorMetrics.mjs [--out report.json] <session-export-file-or-dir> ...");
    process.exit(1);
  }
  const files = collectEventFiles(inputs);
  if (!files.length) {
    console.error("No .json files found in the given input(s).");
    process.exit(1);
  }
  const sessions = loadSessions(files);
  const metrics = computeMetrics(sessions);
  const json = JSON.stringify(metrics, null, 2);
  if (outFile) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(outFile, json);
    console.log(`Wrote ${outFile} (${sessions.length} session(s)).`);
  } else {
    console.log(json);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(error); process.exit(1); });
}

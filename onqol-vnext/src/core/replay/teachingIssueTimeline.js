/**
 * The debrief's view of teaching issues, built ONLY from the event log.
 *
 * For every issue the mentor raised it separates what a single "missed item"
 * flag would blur:
 *
 *   initial gap            what the learner did that raised it, and when
 *   mentor-assisted        prompts given, highest scaffold reached, the turn
 *   correction             the turn the learner's next answer/action closed it
 *   later independent      the same situation recurring and being handled with
 *                          no prompt (from the issue's `follow_through` content)
 *   persistent gap         still open at the end, or deferred to the debrief
 *   safety-relevant event  a reviewed rule that fired (recorded, never scored)
 *
 * No number, no pass/fail: a learner who missed something once, was helped, and
 * then did it unprompted is described as exactly that - not as "failed".
 */
import { EVENT } from "../events/eventTypes.js";

export function buildTeachingIssueTimeline({ events, bundle }) {
  const definitions = new Map((bundle.rules?.teaching_issues ?? []).map((issue) => [issue.id, issue]));
  const turnAt = turnIndexer(events);
  const issues = new Map();
  let pendingIssue = null;

  const entry = (issueId) => {
    if (!issues.has(issueId)) {
      issues.set(issueId, { issueId, raised: [], prompts: 0, maxScaffold: 0, resolved: null, deferred: false });
    }
    return issues.get(issueId);
  };

  for (const event of events) {
    if (event.type !== EVENT.MENTOR_INTERVENED) continue;
    const p = event.payload;
    const turn = turnAt(event);
    if (p.spoke !== false && p.issueId) {
      const e = entry(p.issueId);
      e.raised.push({ turn, atMinutes: event.atMinutes, mode: p.mode, scaffolding: p.scaffolding ?? null });
      e.prompts += 1;
      e.maxScaffold = Math.max(e.maxScaffold, p.scaffolding ?? 0);
      e.resolved = null;
    }
    if (Array.isArray(p.deferredMentorIssues)) {
      for (const id of p.deferredMentorIssues) entry(id).deferred = true;
    }
    if ("pendingMentorQuestion" in p) {
      const next = p.pendingMentorQuestion?.issueId ?? null;
      if (pendingIssue && next !== pendingIssue && p.adequacy === "SUFFICIENT" && !entry(pendingIssue).deferred) {
        entry(pendingIssue).resolved = { turn, atMinutes: event.atMinutes };
      }
      pendingIssue = next;
    }
  }

  const followThrough = (issueId, resolvedAtMinutes) => {
    const rule = definitions.get(issueId)?.follow_through;
    if (!rule || resolvedAtMinutes == null) return null;
    const after = events.filter((event) => event.atMinutes > resolvedAtMinutes);
    let handled = 0;
    let omitted = 0;
    after.forEach((event, index) => {
      if (event.type !== rule.trigger_event || event.cause?.actor !== "learner") return;
      const nextTrigger = after.findIndex((other, i) => i > index && other.type === rule.trigger_event);
      const window = after.slice(index + 1, nextTrigger === -1 ? undefined : nextTrigger);
      if (window.some((other) => rule.expected_events.includes(other.type))) handled += 1;
      else omitted += 1;
    });
    return { handledUnprompted: handled, repeatedOmissions: omitted };
  };

  return [...issues.values()].map((e) => {
    const def = definitions.get(e.issueId);
    const later = e.resolved ? followThrough(e.issueId, e.resolved.atMinutes) : null;
    let status = "open_at_end";
    if (e.deferred) status = "deferred_to_debrief";
    else if (e.resolved) status = later?.handledUnprompted > 0 && later.repeatedOmissions === 0 ? "corrected_then_independent" : later?.repeatedOmissions > 0 ? "corrected_then_repeated" : "corrected_after_prompt";
    return {
      issueId: e.issueId,
      topic: def?.concepts?.[0] ?? null,
      initialGap: e.raised[0] ?? null,
      mentorPrompts: e.prompts,
      highestScaffold: e.maxScaffold,
      correction: e.resolved,
      laterBehavior: later,
      status,
      safetyRelevant: def?.scope === "rule",
      summaryRu: def?.debrief_ru?.[status] ?? null,
    };
  });
}

function turnIndexer(events) {
  const turns = events.filter((event) => event.type === EVENT.LEARNER_TURN_RECEIVED);
  return (event) => {
    let n = 0;
    for (const turn of turns) if (turn.atMinutes <= event.atMinutes && events.indexOf(turn) <= events.indexOf(event)) n += 1;
    return n;
  };
}

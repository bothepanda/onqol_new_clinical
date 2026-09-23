/**
 * Teaching-candidate generation (Wave B) - generic, content-driven.
 *
 * After a turn has been executed, "what, if anything, is worth saying about
 * THIS moment?" is answered from two content sources, never from a disease
 * branch:
 *
 * `rules.yaml#teaching_issues`: content-declared issues, each with a
 * priority, its own wording and scaffold ladder, and ONE of
 *
 *   scope: rule     fires when the named reviewed rule (`rule_id`) fired on a
 *                   command executed this turn - the rule stays the clinical
 *                   authority, the issue only owns how the mentor asks about it
 *   scope: command  the trigger conditions hold for some command executed this turn
 *   scope: turn     the trigger conditions hold over the post-turn state and
 *                   the commands executed this turn
 *
 * An issue is wording and timing, not a clinical claim: it may only be
 * `not_a_clinical_rule` (authority_layer mentor_behavior) or approved. What the
 * mentor may SAY as clinical content still comes only from approved cards.
 *
 * Priority (lower = more urgent), matching the ТЗ §24 order:
 *   1 safety-critical current problem      3 major current reasoning gap
 *   2 (learner explicitly stuck/asked - handled by mentorEngine's STUCK path)
 *   4 missing rationale for a current decision   5 one clarification for a present decision
 *   6 brief reinforcement                  (no candidate = silence)
 *
 * A candidate is NOT produced for an issue the learner has already had
 * deferred to the debrief (an old omission is not resurrected), and an issue
 * that is currently pending continues at the NEXT scaffold level instead of
 * being asked again from the top.
 */
import { evaluateRule, VERDICT } from "../../core/rules/ruleEngine.js";
import { isRuntimeAuthoritative } from "../../core/rules/governance.js";
import { reviewStatusOf } from "../../core/rules/contentProvenance.js";

/** issueId -> { scaffold_ru, concepts, expects } for every content-declared issue. */
export function isTeachingIssueActive(issue) {
  const status = reviewStatusOf(issue);
  return isRuntimeAuthoritative(status) || (status === "not_a_clinical_rule" && (issue.provenance?.authority_layer ?? issue.authority_layer) === "mentor_behavior");
}

export function buildIssueDefinitions(bundle) {
  const definitions = {};
  for (const issue of bundle.rules?.teaching_issues ?? []) {
    definitions[issue.id] = { scaffold_ru: issue.scaffold_ru, concepts: issue.concepts ?? [], expects: issue.expects };
  }
  return definitions;
}

/**
 * @param {object} args
 * @param {object} args.bundle
 * @param {object} args.state              state AFTER this turn's commands
 * @param {object} args.learnerVisible     buildLearnerVisibleState(state)
 * @param {Array}  args.results            this turn's command results
 * @returns {Array} candidates, most urgent first
 */
export function detectTeachingCandidates({ bundle, state, learnerVisible, results, interpreted = null }) {
  const executed = results.filter((r) => r.outcome === "EXECUTED" && r.command);
  // What the learner STATED as a plan for later ("потом переоценю…") is not
  // executed, but it is a plan - for "is there a follow-up plan?" it counts.
  const statedPlans = (interpreted?.withheldCommands ?? []).filter((c) => c.commitment?.status === "FUTURE_PLAN").map((c) => c.type);
  const turn = { commands: executed.map((r) => ({ type: r.command.type, params: r.command.params })), statedPlans };
  const deferred = new Set(state.mentor.deferredMentorIssues ?? []);
  const pending = state.mentor.pendingMentorQuestion ?? null;
  const definitions = buildIssueDefinitions(bundle);
  const found = [];

  const levelFor = (issueId, fallbackText) => {
    if (pending?.issueId !== issueId) return { scaffolding: 1, textRu: fallbackText };
    const next = Math.min(4, (pending.scaffoldingLevel ?? 1) + 1);
    return { scaffolding: next, textRu: definitions[issueId]?.scaffold_ru?.[next] ?? fallbackText };
  };

  for (const issue of bundle.rules?.teaching_issues ?? []) {
    if (!isTeachingIssueActive(issue) || deferred.has(issue.id)) continue;
    // `once: true` - a closed issue is not reopened without new evidence: once it
    // has been raised and is no longer pending, it stays closed for the case.
    if (issue.once === true && (state.mentor.raisedIssues ?? []).includes(issue.id) && pending?.issueId !== issue.id) continue;
    const base = { state, learnerVisible, bundle, turn };
    let triggered;
    if (issue.scope === "rule") triggered = executed.some((r) => (r.firedRules ?? []).some((rule) => rule.id === issue.rule_id));
    else if (issue.scope === "command") triggered = executed.some((r) => evaluateRule({ id: issue.id, conditions: issue.trigger }, { ...base, command: r.command }).verdict === VERDICT.MET);
    else triggered = evaluateRule({ id: issue.id, conditions: issue.trigger }, base).verdict === VERDICT.MET;
    if (!triggered) continue;
    found.push({
      issueId: issue.id, priority: issue.priority, mode: issue.mode ?? "CLARIFY",
      ...(issue.scope === "rule" ? { ruleId: issue.rule_id } : {}),
      concepts: issue.concepts ?? [], expects: issue.expects,
      ...levelFor(issue.id, issue.prompt_ru),
    });
  }

  return found.sort((a, b) => a.priority - b.priority || String(a.issueId).localeCompare(String(b.issueId)));
}

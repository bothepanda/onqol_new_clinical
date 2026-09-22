import { absentViolations, isComplete, matchesGold, paramsMatch } from "./legacyMetrics.mjs";

/**
 * Mechanical failure tagging for one scored row. A tag is a MECHANISM of failure, derived from the
 * interpreter's own telemetry and the row's gold; it names no learner text. The systemic classes the
 * report groups them into are decided by reading the tagged rows (private/), not here.
 *
 * Every tag: { class, detail, type? }. `class` is one of
 *   false-execution   FE_NOT_COMMITTED · FE_UNMODELED_MISRESOLVED · FE_PARAM_ALTERED · FE_ON_NON_ACTION_TURN · FE_OTHER
 *   miss              MISS_WITHHELD · MISS_PARAM_MISMATCH · MISS_CLARIFIED_INSTEAD · MISS_MODEL_REJECTED · MISS_NOT_PROPOSED
 *   clarification     CLARIFY_NOT_RAISED · CLARIFY_PARAM_LOSS · CLARIFY_COMPLETED_WITH_INVENTED_PARAM · SPURIOUS_CLARIFY
 *   other             SPURIOUS_COMMIT · INVENTED_ABSENT_PARAM
 */
const normalize = (text) => String(text ?? "").toLowerCase().replace(/\u0451/g, "\u0435").replace(/\s+/g, " ").trim();
const paramDiff = (command, wanted) => Object.entries(wanted ?? {}).filter(([key, value]) => !paramsMatch(command.params, { [key]: value })).map(([key, value]) => `${key}:${JSON.stringify(command.params?.[key] ?? null)}!=${JSON.stringify(value)}`);

export function classifyRow({ row, gold, score, turn }) {
  const tags = [];
  const view = score.view;
  const withheld = view.withheld ?? [];
  const decisions = row.hybrid?.semanticTelemetry?.candidateDecisions ?? [];
  const nb = turn?.namedButNotCommitted ?? [];
  const unmodeled = (turn?.unmodeledFragments ?? []).map((f) => normalize(f.text));
  const restraint = !gold.commands.some((g) => (g.expect ?? "execute") !== "optional");

  for (const command of score.falseExecutions) {
    const source = normalize(command.sourceText);
    const named = nb.find((n) => n.type === command.type);
    const overlapsUnmodeled = unmodeled.some((f) => f && source && (f.includes(source) || source.includes(f)));
    const near = gold.commands.find((g) => g.type === command.type);
    if (named) tags.push({ class: "FE_NOT_COMMITTED", type: command.type, detail: `${named.state}` });
    else if (overlapsUnmodeled) tags.push({ class: "FE_UNMODELED_MISRESOLVED", type: command.type, detail: JSON.stringify(command.params) });
    else if (near) tags.push({ class: "FE_PARAM_ALTERED", type: command.type, detail: paramDiff(command, near.params).join(",") || "extra_command_of_expected_type" });
    else if (restraint) tags.push({ class: "FE_ON_NON_ACTION_TURN", type: command.type, detail: "" });
    else tags.push({ class: "FE_OTHER", type: command.type, detail: JSON.stringify(command.params) });
  }

  for (const { gold: g, mode } of score.missed) {
    const sameType = [...view.complete, ...view.incomplete].filter((c) => c.type === g.type || (g.altTypes ?? []).includes(c.type));
    if (mode === "clarify" || mode === "either") {
      const incomplete = sameType.find((c) => !isComplete(c));
      const complete = sameType.find((c) => isComplete(c));
      if (incomplete) tags.push({ class: "CLARIFY_PARAM_LOSS", type: g.type, detail: paramDiff(incomplete, g.params).join(",") });
      else if (complete) tags.push({ class: "CLARIFY_COMPLETED_WITH_INVENTED_PARAM", type: g.type, detail: absentViolations(complete, g).join(",") || "complete_where_incomplete_expected" });
      else tags.push({ class: "CLARIFY_NOT_RAISED", type: g.type, detail: "" });
      continue;
    }
    const held = withheld.find((w) => w.type === g.type && matchesGold({ type: w.type, params: w.params }, g));
    const rejected = decisions.find((d) => d.type === g.type && d.validation === "REJECT");
    if (held) tags.push({ class: "MISS_WITHHELD", type: g.type, detail: held.commitment?.status ?? "withheld" });
    else if (sameType.length) {
      const same = sameType[0];
      if (!isComplete(same)) tags.push({ class: "MISS_CLARIFIED_INSTEAD", type: g.type, detail: paramDiff(same, g.params).join(",") });
      else tags.push({ class: "MISS_PARAM_MISMATCH", type: g.type, detail: paramDiff(same, g.params).join(",") });
    } else if (rejected) tags.push({ class: "MISS_MODEL_REJECTED", type: g.type, detail: (rejected.reasonCodes ?? []).join("+") });
    else tags.push({ class: "MISS_NOT_PROPOSED", type: g.type, detail: JSON.stringify(g.params) });
  }

  for (const command of score.falseCommits.filter((c) => !score.falseExecutions.some((e) => e.id === c.id))) tags.push({ class: "SPURIOUS_COMMIT", type: command.type, detail: JSON.stringify(command.params) });
  for (const command of score.spuriousClarifications) tags.push({ class: "SPURIOUS_CLARIFY", type: command.type, detail: JSON.stringify(command.params) });
  for (const item of score.invented) tags.push({ class: "INVENTED_ABSENT_PARAM", type: item.command.type, detail: item.keys.join(",") });
  return tags;
}

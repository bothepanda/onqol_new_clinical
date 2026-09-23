/**
 * A model that names several actions in one sentence sometimes gives the first
 * action the WHOLE sentence as its evidence span while the later actions get
 * their own clauses («вводим болюс …, потом переоценю …»: the bolus span covers
 * the reassessment clause too). The commitment gate then judges the bolus by
 * every clause its span touches, and the deferral cue that belongs to the
 * reassessment («потом») withholds the bolus.
 *
 * Deterministic repair, applied only to the model's candidate spans and only
 * when the attribution is unambiguous: an action whose span covers the whole
 * turn, while other actions of the same turn have strictly narrower spans
 * inside it, keeps the LARGEST contiguous stretch that is left after those
 * narrower spans are removed. Nothing is invented - the result is still the
 * learner's own words - and an action with no narrower sibling is untouched.
 */
import { tokenize, locateSpan } from "./textMatch.js";

export function narrowBroadEvidence(output, rawText) {
  const actions = output?.clinicalActions;
  if (!Array.isArray(actions) || actions.length < 2) return output;
  const tokens = tokenize(rawText);
  const ranges = actions.map((action) => {
    const first = action.evidenceSpans?.[0];
    return first ? locateSpan(tokens, first) : null;
  });
  const isBroad = (range) => range && range[0] === 0 && range[1] >= tokens.length - 1;
  let changed = false;
  const narrowed = actions.map((action, index) => {
    const own = ranges[index];
    if (!isBroad(own) || action.evidenceSpans.length !== 1) return action;
    const siblings = ranges.filter((range, i) => i !== index && range && range[1] - range[0] < own[1] - own[0]);
    if (!siblings.length) return action;
    const taken = new Array(tokens.length).fill(false);
    for (const [start, end] of siblings) for (let i = start; i < end; i += 1) taken[i] = true;
    let best = null;
    for (let i = own[0]; i < own[1]; ) {
      if (taken[i]) { i += 1; continue; }
      let j = i;
      while (j < own[1] && !taken[j]) j += 1;
      if (!best || j - i > best[1] - best[0]) best = [i, j];
      i = j;
    }
    if (!best) return action;
    const span = tokens.slice(best[0], best[1]).join(" ");
    if (!span || locateSpan(tokens, span) == null) return action;
    changed = true;
    return { ...action, evidenceSpans: [span] };
  });
  return changed ? { ...output, clinicalActions: narrowed } : output;
}

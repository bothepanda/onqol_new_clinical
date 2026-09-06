import { contentConditionsMet, readStatePath } from "../rules/contentConditions.js";

const EFFECT_DOMAINS = Object.freeze(["physiology", "symptoms", "truth", "postop"]);

/** Evaluate at most one reviewed bounded transition for one clock advance. */
export function evaluateBoundedStateTransition({ model, state, currentStateId, enteredAtMinutes, targetMinutes, rng, streamName }) {
  if (model?.kind !== "bounded_state_transitions") return null;
  const initialStateId = model.initial_state_id ?? model.states?.[0]?.id;
  const from = currentStateId ?? initialStateId;
  if (!from) return null;
  const enteredAt = Number.isFinite(enteredAtMinutes) ? enteredAtMinutes : 0;
  const elapsed = targetMinutes - enteredAt;
  const candidates = (model.transitions ?? [])
    .filter((transition) => transition.from === from)
    .filter((transition) => elapsed >= (transition.eligible_after_minutes ?? 0))
    .filter((transition) => transition.latest_minutes == null || elapsed <= transition.latest_minutes)
    .filter((transition) => contentConditionsMet(transition.conditions, state))
    .sort((a, b) => (a.eligible_after_minutes ?? 0) - (b.eligible_after_minutes ?? 0) || String(a.id).localeCompare(String(b.id)));

  for (const transition of candidates) {
    const probability = transition.probability ?? 1;
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) continue;
    const transitionId = transition.id ?? `${transition.from}->${transition.to}`;
    const stream = rng.stream(`${streamName}:${transitionId}`);
    if (!stream.chance(probability)) continue;
    return {
      transitionId,
      from,
      to: transition.to,
      enteredAtMinutes: targetMinutes,
      effects: materializeEffects(transition.effects ?? {}, state, stream),
      deterioration: transition.deterioration ?? null,
      ruleIds: transition.rule_ids ?? [],
      sourceIds: transition.source_ids ?? [],
    };
  }
  return null;
}

function materializeEffects(authored, state, stream) {
  const effects = {};
  for (const domain of EFFECT_DOMAINS) {
    const authoredDomain = authored[domain];
    if (!authoredDomain || typeof authoredDomain !== "object" || Array.isArray(authoredDomain)) continue;
    const materialized = {};
    for (const [field, spec] of Object.entries(authoredDomain)) {
      const current = readStatePath(state, `${domain}.${field}`);
      const value = materializeValue(spec, current, stream);
      if (value !== undefined) materialized[field] = value;
    }
    if (Object.keys(materialized).length) effects[domain] = materialized;
  }
  return effects;
}

function materializeValue(spec, current, stream) {
  if (spec === null || ["string", "number", "boolean"].includes(typeof spec)) return spec;
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return undefined;
  if ("set" in spec) return spec.set;
  if (Number.isFinite(spec.delta) && Number.isFinite(current)) return current + spec.delta;
  if (validRange(spec.range)) return stream.range(spec.range[0], spec.range[1], spec.decimals ?? 1);
  if (validRange(spec.delta_range) && Number.isFinite(current)) {
    return current + stream.range(spec.delta_range[0], spec.delta_range[1], spec.decimals ?? 1);
  }
  return undefined;
}

function validRange(value) {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite) && value[0] <= value[1];
}

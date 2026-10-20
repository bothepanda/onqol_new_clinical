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
    .filter((transition) => transition.from === from && Number.isFinite(transition.eligible_after_minutes) && transition.eligible_after_minutes >= 0)
    .filter((transition) => elapsed >= (transition.eligible_after_minutes ?? 0))
    .filter((transition) => transition.latest_minutes == null || elapsed <= transition.latest_minutes)
    .filter((transition) => contentConditionsMet(transition.conditions, state))
    .sort((a, b) => (a.eligible_after_minutes ?? 0) - (b.eligible_after_minutes ?? 0) || String(a.id).localeCompare(String(b.id)));

  for (const transition of candidates) {
    const probability = transition.probability;
    if (probability !== undefined && (!Number.isFinite(probability) || probability < 0 || probability > 1)) continue;
    const transitionId = transition.id ?? `${transition.from}->${transition.to}`;
    const stream = rng.stream(`${streamName}:${transitionId}`);
    // Legacy reviewed condition-only transitions are deterministic rules, not
    // inferred stochastic rates. Only an explicit probability causes a draw.
    if (probability !== undefined && !stream.chance(probability)) continue;
    const effects = materializeEffects(transition.effects ?? {}, state, stream);
    if (!effects) continue;
    const candidate = { ...state };
    for (const [domain, values] of Object.entries(effects)) candidate[domain] = { ...state[domain], ...values };
    if (!contentConditionsMet(transition.dependencies, candidate)) continue;
    return {
      rng: { seed: rng.seed, stream: `${streamName}:${transitionId}`, probability: probability ?? null, mode: probability === undefined ? "authored_condition_only" : "probabilistic", selected: true },
      transitionId,
      from,
      to: transition.to,
      enteredAtMinutes: targetMinutes,
      effects,
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
      if (value === undefined) return null;
      materialized[field] = value;
    }
    if (Object.keys(materialized).length) effects[domain] = materialized;
  }
  return effects;
}

function materializeValue(spec, current, stream) {
  if (spec === null || ["string", "boolean"].includes(typeof spec) || Number.isFinite(spec)) return spec;
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return undefined;
  const modes = ["set", "delta", "range", "delta_range"].filter((key) => Object.hasOwn(spec, key));
  if (modes.length !== 1) return undefined;
  const draw = (r) => {
    if (!validRange(r) || (spec.distribution !== undefined && !["uniform", "centred"].includes(spec.distribution))) return undefined;
    const decimals = spec.decimals ?? 1;
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 6) return undefined;
    return Math.max(r[0], Math.min(r[1], stream[spec.distribution === "centred" ? "centred" : "range"](r[0], r[1], decimals)));
  };
  let value;
  if ("set" in spec) value = spec.set;
  else if (Number.isFinite(spec.delta) && Number.isFinite(current)) value = current + spec.delta;
  else if ("range" in spec) value = draw(spec.range);
  else if ("delta_range" in spec && Number.isFinite(current)) { const delta = draw(spec.delta_range); if (Number.isFinite(delta)) value = current + delta; }
  if (value !== null && !["string", "boolean"].includes(typeof value) && !Number.isFinite(value)) return undefined;
  const c = spec.constraints;
  if (c) {
    if (!Number.isFinite(value) || Object.keys(c).some((key) => !["min", "max", "cannot_cross"].includes(key))) return undefined;
    if ((c.min !== undefined && (!Number.isFinite(c.min) || value < c.min)) || (c.max !== undefined && (!Number.isFinite(c.max) || value > c.max))) return undefined;
    if (c.cannot_cross && (!validRange(c.cannot_cross) || !Number.isFinite(current) ||
      (Math.max(current, value) >= c.cannot_cross[0] && Math.min(current, value) <= c.cannot_cross[1]))) return undefined;
  }
  return value;
}

function validRange(value) {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite) && value[0] <= value[1];
}

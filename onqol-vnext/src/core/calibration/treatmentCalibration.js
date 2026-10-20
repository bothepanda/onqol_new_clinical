import { isRuntimeAuthoritative } from "../rules/governance.js";
import { reviewStatusOf } from "../rules/contentProvenance.js";
import { contentConditionsMet, readStatePath } from "../rules/contentConditions.js";

const range = (v) => Array.isArray(v) && v.length === 2 && v.every(Number.isFinite) && v[0] <= v[1];
const conditions = (v, state) => v === undefined || (Array.isArray(v) && contentConditionsMet(v, state));
const camel = (s) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
export function calibrationIdentity(item, id, bundle, rng) {
  return { id: item.calibration_id ?? item.provenance?.id ?? id,
    version: item.version ?? bundle.__contentVersion ?? "unversioned", reviewStatus: reviewStatusOf(item),
    sourceIds: item.source_ids ?? [], seed: rng.seed, algorithm: "fnv1a-mulberry32" };
}

// Extends existing response_envelope. Legacy reviewed envelopes retain their
// authored delta/bounds semantics; v2 requires explicit interaction policy.
export function scheduleGovernedTreatmentEffect({ bundle, state, command, matchKey, matchValue, route, rng }) {
  const pending = [];
  for (const [effectId, effect] of Object.entries(bundle.trajectories?.treatment_effects ?? {})) {
    if (effect.applies_to_routes && !effect.applies_to_routes.includes(route)) continue;
    if (!(matchKey === "drugId" ? effect.applies_to : effect.applies_to_fluid)?.includes(matchValue)) continue;
    if (!isRuntimeAuthoritative(reviewStatusOf(effect))) continue;
    if (effect.requires_patient_state && state.truth?.[effect.requires_patient_state] !== true) continue;
    if (!conditions(effect.conditions, state)) continue;
    const envelope = effect.response_envelope;
    const identity = calibrationIdentity(effect, effectId, bundle, rng);
    const base = { id: `${command.id}::effect::${effectId}`, effectId, commandId: command.id,
      ruleId: effect.provenance?.id ?? effectId, sourceIds: effect.source_ids ?? [], calibration: identity };
    if (!envelope || !Number.isFinite(envelope.onset_minutes) || envelope.onset_minutes < 0 || !validEnvelope(envelope)) {
      pending.push({ ...base, kind: "treatment_effect_unavailable", dueAtMinutes: state.clock.elapsedMinutes, reason: "invalid_or_missing_calibration" }); continue;
    }
    const interaction = envelope.interaction;
    const previous = (state.pending ?? []).filter((x) => x.effectId === effectId);
    const history = state.calibrationApplications?.[effectId] ?? [];
    if (interaction?.stacking === "once" && (previous.length || history.length)) continue;
    if (interaction?.stacking === "no_overlap" && (previous.length || history.some((x) => state.clock.elapsedMinutes < x.atMinutes + interaction.window_minutes))) continue;
    const draws = [];
    const sample = (value, name, distribution = "uniform", decimals = 1) => {
      if (Number.isFinite(value)) return value;
      const streamName = `treatment_effect:${effectId}:${command.id}:${name}`;
      const stream = rng.stream(streamName);
      const selected = Math.max(value[0], Math.min(value[1], stream[distribution === "centred" ? "centred" : "range"](value[0], value[1], decimals)));
      draws.push({ stream: streamName, range: value, distribution, selected });
      return selected;
    };
    const deltas = {}, symptomDeltas = {}, specs = [];
    if (envelope.effects) {
      for (const spec of envelope.effects) specs.push({ ...spec, delta: sample(spec.delta ?? spec.delta_range, `${spec.domain}.${spec.field}`, spec.distribution, spec.decimals) });
    } else {
      for (const [key, value] of Object.entries(envelope)) {
        if (!/_delta(?:_range)?$/.test(key)) continue;
        const name = camel(key.replace(/_delta(?:_range)?$/, ""));
        (name === "painScore" ? symptomDeltas : deltas)[name] = sample(value, name);
      }
    }
    pending.push({ ...base, kind: "treatment_effect", deltas, symptomDeltas, specs,
      calibration: { ...identity, draws, interaction: interaction ?? "legacy_authored_additive" },
      bounds: envelope.bounds ?? null, durationMinutes: envelope.duration_minutes ?? null,
      dependencies: envelope.dependencies ?? [], dueAtMinutes: state.clock.elapsedMinutes + envelope.onset_minutes });
  }
  return pending;
}

export function validEnvelope(envelope) {
  if (envelope.schema_version !== undefined && envelope.schema_version !== 2) return false;
  if (envelope.effects !== undefined) {
    if (envelope.schema_version !== 2 || !Array.isArray(envelope.effects) || !envelope.effects.length ||
      !["additive", "once", "no_overlap"].includes(envelope.interaction?.stacking)) return false;
    if (envelope.interaction.stacking === "no_overlap" && !(Number.isFinite(envelope.interaction.window_minutes) && envelope.interaction.window_minutes >= 0)) return false;
    const seen = new Set();
    for (const spec of envelope.effects) {
      const key = `${spec.domain}.${spec.field}`;
      if (!["physiology", "symptoms"].includes(spec.domain) || !/^[A-Za-z][A-Za-z0-9]*$/.test(spec.field ?? "") || seen.has(key) ||
        !(Number.isFinite(spec.delta) !== range(spec.delta_range)) || !["uniform", "centred"].includes(spec.distribution) ||
        !Number.isInteger(spec.decimals) || spec.decimals < 0 || spec.decimals > 6 || typeof spec.units !== "string" || !spec.units) return false;
      seen.add(key);
      const c = spec.constraints;
      if (c && (Object.keys(c).some((k) => !["min", "max", "cannot_cross"].includes(k)) || (!Number.isFinite(c.min) && c.min !== undefined) || (!Number.isFinite(c.max) && c.max !== undefined) ||
        (c.min !== undefined && c.max !== undefined && c.min > c.max) ||
        (c.cannot_cross !== undefined && !range(c.cannot_cross)))) return false;
    }
  } else {
    const deltas = Object.entries(envelope).filter(([key]) => /_delta(?:_range)?$/.test(key));
    if (!deltas.length || deltas.some(([, value]) => !Number.isFinite(value) && !range(value))) return false;
  }
  return envelope.dependencies === undefined || Array.isArray(envelope.dependencies);
}

// Atomic multivariable effects: every value and postcondition must be valid,
// otherwise no subset can create an impossible combination.
export function materializeTreatmentSpecs(item, state) {
  const effects = { physiology: {}, symptoms: {} };
  for (const spec of item.specs ?? []) {
    const previous = readStatePath(state, `${spec.domain}.${spec.field}`);
    if (!Number.isFinite(previous)) return null;
    const c = spec.constraints ?? {};
    let value = Math.round((previous + spec.delta) * 10 ** spec.decimals) / 10 ** spec.decimals;
    // Saturation cannot reverse the authored direction.
    if (spec.delta > 0 && c.max !== undefined) value = Math.max(previous, Math.min(value, c.max));
    if (spec.delta < 0 && c.min !== undefined) value = Math.min(previous, Math.max(value, c.min));
    if ((c.min !== undefined && value < c.min) || (c.max !== undefined && value > c.max)) return null;
    // An explicitly authored forbidden interval also supports cannot-normalize.
    if (c.cannot_cross && Math.max(previous, value) >= c.cannot_cross[0] && Math.min(previous, value) <= c.cannot_cross[1]) return null;
    effects[spec.domain][spec.field] = value;
  }
  const candidate = { ...state, physiology: { ...state.physiology, ...effects.physiology }, symptoms: { ...state.symptoms, ...effects.symptoms } };
  return contentConditionsMet(item.dependencies, candidate) ? effects : null;
}

export function causalPatch(state, effects, calibration) {
  const before = {}, after = {};
  for (const [domain, values] of Object.entries(effects)) {
    if (!["physiology", "symptoms", "truth", "postop"].includes(domain) || !values) continue;
    before[domain] = {}; after[domain] = {};
    for (const [key, value] of Object.entries(values)) {
      before[domain][key] = state[domain]?.[key] ?? null; after[domain][key] = value;
    }
  }
  return { ...calibration, before, effect: effects, after, disclosure: "existing_observation_events_only" };
}

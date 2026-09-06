/**
 * Dynamic Real-Hospital resource constraints (task brief P1-1).
 *
 * A static profile says what a hospital HAS. This says what is wrong with it
 * tonight: the CT is down, the single overnight OR is occupied, the senior
 * surgeon is delayed, the ICU has no bed. Core Runtime Spec §14.2 treats these
 * as first-class, because adapting to them is the actual learning objective
 * of Real-world mode.
 *
 * OPERATIONAL DATA, NOT CLINICAL CONTENT. These are Hospital/World Engine
 * facts (Core Runtime Spec §46) - how long a scanner is broken is not a
 * clinical rule, and so is not subject to the `approved_for_training` gate
 * in `core/rules/governance.js`. They cannot alter biology; they only alter
 * what is available, which is precisely the separation Contract §3.3
 * requires.
 *
 * SEEDED, NOT RANDOM PER SESSION. The roll happens once at session creation
 * from the session seed, so replaying a seed reproduces the same broken
 * scanner (Core Runtime Spec §42). At most one constraint is drawn, and most
 * sessions draw none - a hospital where something is always broken teaches
 * learners to expect the trick rather than to adapt.
 */

const CANDIDATES = Object.freeze([
  {
    id: "ct_scanner_down",
    capabilityKey: "ct",
    weight: 1,
    reasonKey: "resource.ct.down_for_repair",
    textRu: "КТ сейчас недоступна: аппарат на ремонте, срок восстановления неизвестен.",
  },
  {
    id: "or_occupied",
    capabilityKey: "operatingRoom",
    weight: 1,
    addedEtaMinutes: 90,
    reasonKey: "resource.or.occupied",
    textRu: "Единственная операционная занята другим экстренным пациентом.",
  },
  {
    id: "icu_no_bed",
    capabilityKey: "icuBed",
    weight: 1,
    reasonKey: "resource.icu.no_bed",
    textRu: "Свободных коек в ОРИТ сейчас нет.",
  },
  {
    id: "senior_surgeon_delayed",
    staffRole: "seniorSurgeon",
    weight: 1,
    addedEtaMinutes: 40,
    reasonKey: "resource.senior_surgeon.delayed",
    textRu: "Старший хирург задерживается: выехал из дома.",
  },
]);

/** Probability that a Real-world session has any dynamic constraint at all. */
const CONSTRAINT_CHANCE = 0.5;

/**
 * @returns {Array<object>} zero or one constraint, drawn deterministically
 *   from the session seed. Reference mode never draws one (§14.1: reference
 *   removes artificial resource barriers, though not time itself).
 */
export function rollDynamicConstraints({ mode, rng }) {
  if (mode !== "real") return [];
  const stream = rng.stream("hospital_constraints");
  if (!stream.chance(CONSTRAINT_CHANCE)) return [];
  const picked = stream.pick(CANDIDATES);
  return [{ ...picked, active: true, disclosed: false }];
}

/**
 * Applies active constraints on top of a profile's baseline capabilities.
 *
 * Returns a NEW capabilities object; the profile itself is frozen shared
 * data and is never mutated.
 */
export function applyConstraintsToCapabilities(capabilities, constraints) {
  let result = { ...capabilities };
  for (const constraint of constraints) {
    if (!constraint.active || !constraint.capabilityKey) continue;
    const current = result[constraint.capabilityKey];
    if (!current) continue;
    result = {
      ...result,
      [constraint.capabilityKey]: constraint.addedEtaMinutes
        ? { ...current, etaMinutes: (current.etaMinutes ?? 0) + constraint.addedEtaMinutes }
        : { ...current, available: false, reason: constraint.reasonKey },
    };
  }
  return result;
}

export function applyConstraintsToStaff(staff, constraints) {
  let result = { ...staff };
  for (const constraint of constraints) {
    if (!constraint.active || !constraint.staffRole) continue;
    const current = result[constraint.staffRole];
    if (!current) continue;
    result = {
      ...result,
      [constraint.staffRole]: { ...current, etaMinutes: (current.etaMinutes ?? 0) + (constraint.addedEtaMinutes ?? 0) },
    };
  }
  return result;
}

/**
 * The constraint (if any) that explains why a given capability just failed to
 * resolve - so the world can disclose the real operational reason at the
 * moment the learner runs into it (task brief §12.3), rather than announcing
 * every constraint up front.
 */
export function constraintForCapability(constraints, capabilityKey) {
  return constraints.find((constraint) => constraint.active && constraint.capabilityKey === capabilityKey) ?? null;
}

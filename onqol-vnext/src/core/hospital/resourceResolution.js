import { withinHours } from "../time/clock.js";

/**
 * Resolving one requested resource against the active hospital profile.
 *
 * This is where Core Runtime Spec §50's three-way distinction is enforced in
 * code, because it is the single most important product-safety rule in the
 * hospital layer: a request must resolve to exactly one of
 *
 *   "available"            recognized, and the hospital has it right now
 *   "unavailable_resource"  recognized, but this simulated hospital does not
 *                           have it now - a REAL fact about the world
 *   "unsupported_content"   the platform does not model this order at all
 *
 * and only "unavailable_resource" may ever be spoken to the learner as a
 * hospital limitation. Collapsing "unsupported_content" into "unavailable" -
 * or the reverse - is exactly the bug Core Runtime Spec §50 and the
 * vNext task brief call out by name ("never say a medication is unavailable
 * merely because the software failed to recognize it").
 */
export function resolveResource({ hospital, capabilityKey, clock }) {
  const capability = hospital.capabilities[capabilityKey];
  if (!capability) {
    return { status: "unsupported_content", reasonKey: "resource.unsupported_content" };
  }
  if (!capability.available) {
    return { status: "unavailable_resource", reasonKey: capability.reason ?? "resource.unavailable" };
  }
  if (capability.onlyDuringHours) {
    const [fromHour, toHour] = capability.onlyDuringHours;
    const hour = clock.hospitalHour;
    if (!withinHours(hour, fromHour, toHour)) {
      return { status: "unavailable_resource", reasonKey: "resource.unavailable_at_this_hour" };
    }
  }
  if (capability.unitsAvailable === 0) {
    return { status: "unavailable_resource", reasonKey: "resource.no_unit_available" };
  }
  return { status: "available", etaMinutes: capability.etaMinutes ?? 0 };
}

/**
 * Recognized-but-unavailable staff/consultant (Core Runtime Spec §22-§23):
 * calling is always a valid action; the ETA is a hospital fact, not a
 * mentor-authored number.
 */
export function callStaff({ hospital, role }) {
  const entry = hospital.staff[role];
  if (!entry) return { status: "unsupported_content" };
  return { status: "called", etaMinutes: entry.etaMinutes };
}

import { withShared } from "../core/content/loadBundle.js";
import { FLUIDS_VERTICAL_SLICE_V1 } from "../ai/interaction/featureFlags.js";
import appendicitisBundle from "./generated/appendicitis.json" with { type: "json" };
import fluidsBundle from "./generated/fluids_01.json" with { type: "json" };
import sharedBundle from "./generated/shared.json" with { type: "json" };

/**
 * Cases the browser can start. The start screen still never offers a
 * diagnosis (Core Runtime Spec §4): APP-004 is the default unknown-patient
 * game, and any other case is reached only through an explicit internal
 * `?case=` link that a pilot build refuses. Case registration is content:
 * product code under src/app reads this catalog and never names a case.
 */
export const DEFAULT_CASE_ID = "APP-004";

export const CASES = Object.freeze({
  "APP-004": Object.freeze({
    casePresetId: "APP-004",
    bundle: withShared(appendicitisBundle, sharedBundle),
    interactionFlags: Object.freeze({}),
    internalOnly: false,
    fixedStartIso: null,
    presentationRu: null, // the default "Острый живот" label
  }),
  "FLUIDS-01": Object.freeze({
    casePresetId: "FLUIDS-01",
    bundle: withShared(fluidsBundle, sharedBundle),
    interactionFlags: Object.freeze({ [FLUIDS_VERTICAL_SLICE_V1]: true }),
    internalOnly: true,
    // The handoff names the hour («02:10»), so the clock must agree with it
    // instead of taking a seeded start time.
    fixedStartIso: "2026-09-25T02:10:00+05:00",
    // Case-bar label: the reason for the call, never a diagnosis.
    presentationRu: "Вызов в отделение",
  }),
});

/**
 * Resolves the case for this page load. An unknown, malformed or
 * pilot-forbidden request falls back to the default case rather than
 * erroring, so a stale link can never strand a learner.
 */
export function resolveCaseId(search, { pilot = false } = {}) {
  const requested = new URLSearchParams(search ?? "").get("case");
  if (!requested) return DEFAULT_CASE_ID;
  const entry = CASES[requested.toUpperCase()];
  if (!entry) return DEFAULT_CASE_ID;
  if (entry.internalOnly && pilot) return DEFAULT_CASE_ID;
  return entry.casePresetId;
}

export function caseEntry(caseId) {
  return CASES[caseId] ?? CASES[DEFAULT_CASE_ID];
}

/**
 * Merging a compiled disease bundle with the shared content library.
 *
 * `scripts/buildContentIndex.mjs` writes one JSON file per disease plus one
 * `shared.json` (medications, examinations, actions, investigations,
 * perioperative, resources - the "universal action library" of Foundation
 * Spec §64). Every call site that needs a bundle goes through this function
 * so `bundle.shared.*` is always present and callers never have to remember
 * to merge it themselves.
 */
export function withShared(diseaseBundle, sharedBundle) {
  return { ...diseaseBundle, shared: sharedBundle };
}

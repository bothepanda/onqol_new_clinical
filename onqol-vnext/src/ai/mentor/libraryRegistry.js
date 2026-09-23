/**
 * Choosing the approved mentor library for a case.
 *
 * A library declares the scope it is approved for (`scope.casePresetId`,
 * `sessionPurpose`, `locale`); a session may only use a library whose scope
 * matches it exactly (groundedDialogue.js#validateContext enforces the same
 * rule again at call time). Adding a case means adding a library file with its
 * own scope - never a branch here.
 */
export function selectLibrary(libraries, { casePresetId, sessionPurpose, locale }) {
  return (
    libraries.find(
      (library) =>
        library.scope?.casePresetId === casePresetId &&
        library.scope?.sessionPurpose === sessionPurpose &&
        library.scope?.locale === locale,
    ) ?? null
  );
}

/**
 * The scenario's start-of-day, derived from the session seed.
 *
 * Seeded rather than a fixed constant (task brief §14): hardcoding every case
 * to 02:15 made time-of-day resource logic untestable in play and made every
 * session feel identical before the first word.
 *
 * BOTH SHIFTS MUST BE UNSIGNED. `hash` is forced to an unsigned 32-bit value
 * by `>>> 0`, but `>>` is the SIGNED right shift: for any hash at or above
 * 2^31 - a little under half of them - `hash >> 5` came out negative, `% 60`
 * stayed negative, and the start time read "2026-08-23T12:-16:00+05:00".
 * `createClock` rejects that as unparsable, so roughly 44% of real sessions
 * threw before the first message and the app rendered nothing at all.
 *
 * This lives in its own module, rather than inside `useSession.js`, for one
 * reason: `useSession.js` imports the compiled content bundles as JSON without
 * Node's `with { type: "json" }` attribute (Vite supplies it), so it cannot be
 * imported from a `node --test` file. The one function a human's click
 * actually depends on was therefore untestable where it lived, which is
 * exactly how a 44%-of-sessions crash survived a 219-test suite.
 */
export function seededStartIso(seed) {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const hour = String(hash % 24).padStart(2, "0");
  const minute = String((hash >>> 5) % 60).padStart(2, "0");
  return `2026-08-23T${hour}:${minute}:00+05:00`;
}

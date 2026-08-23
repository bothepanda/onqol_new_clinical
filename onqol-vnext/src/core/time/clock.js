/**
 * The hospital clock.
 *
 * Two numbers, both of which the learner is entitled to see:
 *
 *   hospitalDateTime  - wall time inside the simulated hospital. It exists
 *                       because night is not day: at 02:40 the CT technologist
 *                       is at home and the senior surgeon is 25 minutes away.
 *   elapsedCaseMinutes - minutes since the patient arrived.
 *
 * Neither has anything to do with how long the learner spent typing, how long
 * a model took to answer, or how many messages have been exchanged. Time moves
 * when a clinical event moves it, and only then.
 */

const MINUTE_MS = 60_000;

/**
 * @param {object} options
 * @param {string} options.startIso  ISO-8601 with offset, e.g. "2026-08-23T02:15:00+05:00"
 */
export function createClock({ startIso }) {
  const startMs = Date.parse(startIso);
  if (Number.isNaN(startMs)) throw new Error(`Clock start "${startIso}" is not a parsable instant.`);
  // The offset is carried as text: the hospital is in one place and its local
  // wall time should not be re-rendered through the viewer's timezone.
  const offset = startIso.slice(-6);
  return Object.freeze({ startIso, startMs, offset, elapsedMinutes: 0 });
}

export function clockAt(clock, elapsedMinutes) {
  return Object.freeze({ ...clock, elapsedMinutes });
}

/** Absolute hospital instant for a given elapsed minute count. */
export function hospitalInstant(clock, elapsedMinutes = clock.elapsedMinutes) {
  return new Date(clock.startMs + elapsedMinutes * MINUTE_MS);
}

/** "02:40" in hospital local time. */
export function hospitalTimeLabel(clock, elapsedMinutes = clock.elapsedMinutes) {
  const instant = hospitalInstant(clock, elapsedMinutes);
  const offsetMinutes = parseOffsetMinutes(clock.offset);
  const shifted = new Date(instant.getTime() + offsetMinutes * MINUTE_MS);
  const hh = String(shifted.getUTCHours()).padStart(2, "0");
  const mm = String(shifted.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** "01:23" - elapsed case time as hours:minutes. */
export function elapsedLabel(elapsedMinutes) {
  const total = Math.max(0, Math.round(elapsedMinutes));
  const hh = String(Math.floor(total / 60)).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** Full ISO instant, in hospital local offset, for the event log. */
export function hospitalIso(clock, elapsedMinutes = clock.elapsedMinutes) {
  const offsetMinutes = parseOffsetMinutes(clock.offset);
  const shifted = new Date(hospitalInstant(clock, elapsedMinutes).getTime() + offsetMinutes * MINUTE_MS);
  return `${shifted.toISOString().slice(0, 19)}${clock.offset}`;
}

/** Hospital-local hour, 0-23. Resource rules are written against this. */
export function hospitalHour(clock, elapsedMinutes = clock.elapsedMinutes) {
  const offsetMinutes = parseOffsetMinutes(clock.offset);
  return new Date(hospitalInstant(clock, elapsedMinutes).getTime() + offsetMinutes * MINUTE_MS).getUTCHours();
}

/** True when the hospital-local hour falls in [fromHour, toHour) across midnight. */
export function withinHours(hour, fromHour, toHour) {
  if (fromHour === toHour) return true;
  if (fromHour < toHour) return hour >= fromHour && hour < toHour;
  return hour >= fromHour || hour < toHour;
}

function parseOffsetMinutes(offset) {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

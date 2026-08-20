/**
 * Alphabet for the code a participant reads off the screen and types into a
 * form. Crockford base32 minus the letters that get copied wrong by hand: I and
 * L look like 1, O looks like 0, U turns short codes into words nobody wants to
 * dictate. What is left cannot be misread, which is the entire requirement.
 */
const READABLE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const SESSION_CODE_LENGTH = 5;

function randomBytes(count) {
  const bytes = new Uint8Array(count);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }
  for (let index = 0; index < count; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

/**
 * The calendar day as the person in front of the screen would write it, in the
 * browser's own timezone - not in UTC.
 *
 * Almaty is UTC+5, so `toISOString().slice(0, 10)` labels everything started
 * before 05:00 local with the previous day. A resident who trains at 01:00 and
 * then copies the code plus today's date into the feedback form produces two
 * different days for one session, and whoever reconciles the pilot has to guess
 * which one is real. The day is a human label here, never a key and never a
 * retention deadline - those stay on timestamps - so the local reading is the
 * correct one.
 */
export function localDayStamp(at = new Date()) {
  const date = at instanceof Date ? at : new Date(at);
  const valid = Number.isNaN(date.getTime()) ? new Date() : date;
  const year = String(valid.getFullYear()).padStart(4, "0");
  const month = String(valid.getMonth() + 1).padStart(2, "0");
  const day = String(valid.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * A short session code the participant can read out or type: ONQOL-20260820-A7K3M.
 *
 * It exists next to `session_id`, not instead of it. The UUID stays the key
 * everything is stored and joined by; this is the human-facing handle, so that a
 * resident copying their session into the feedback form has five characters to
 * copy rather than thirty-six.
 *
 * Non-identifying by construction: a date and five random characters, no learner
 * name, no email, no browser id. Safe to display and safe to put in pilot
 * analytics.
 *
 * Collision risk: 30^5 is about 24 million codes per calendar day, and the
 * pilot runs tens of sessions a day. The code is a label for humans, never a
 * lookup key, so a collision would cost a manual disambiguation, not a mix-up
 * of two people's data.
 */
export function createSessionCode(startedAt = new Date()) {
  const day = localDayStamp(startedAt).replaceAll("-", "");
  const suffix = [...randomBytes(SESSION_CODE_LENGTH)]
    .map((byte) => READABLE_ALPHABET[byte % READABLE_ALPHABET.length])
    .join("");
  return `ONQOL-${day}-${suffix}`;
}

export function createUuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}


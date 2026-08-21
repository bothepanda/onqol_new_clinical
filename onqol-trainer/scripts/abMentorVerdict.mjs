/**
 * Whether an A/B run measured anything, and whether what it measured is good.
 *
 * WHY THIS IS A SEPARATE FILE
 *
 * On 20.08.2026 the harness reported "no regressions" for a run in which not one
 * reply came from the model. Every mentor turn had failed with a transport error
 * and fallen back to the template, and the summary counted the templates as the
 * result. The comparison the harness exists to make had never happened, and
 * nothing said so.
 *
 * The fix is not only the bug that caused it. A measurement tool has to
 * distinguish three outcomes, and this one collapsed the first two:
 *
 *   1. the model did not run          -> no measurement. Not a result.
 *   2. the model ran and did badly    -> a measurement, and a bad one.
 *   3. the model ran and did well     -> a measurement, and a good one.
 *
 * So the verdict lives here, as a pure function of the telemetry, and the script
 * exits non-zero on 1 and 2 alike. It is separate from abMentor.mjs because that
 * file runs a whole session at import time: a test that imported it to check the
 * verdict would replay the fixture as a side effect.
 */

/** Reasons that mean the request never reached a model. */
export const TRANSPORT_FAILURE_REASONS = Object.freeze(["mentor_agent_error"]);

/**
 * How much fallback is tolerable in a live run before the run is called a
 * failure.
 *
 * The observed rate on fixture 91ba7206 with a reachable model is zero: seven
 * turns, seven from the model, no rejections and no repairs. So this is not a
 * negotiated budget - it is a tripwire a little above the floor, there to catch
 * a run that has quietly stopped exercising the voice.
 */
export const DETERMINISTIC_SHARE_LIMIT = 0.25;

/**
 * @param {object} input
 * @param {object} input.telemetry   buildMentorTelemetry() output
 * @param {boolean} input.live       whether a model was actually configured
 * @param {number} [input.limit]     deterministic share ceiling for live runs
 * @returns {{ok: boolean, exitCode: number, failures: Array, share: number|null}}
 */
export function harnessVerdict({ telemetry, live, limit = DETERMINISTIC_SHARE_LIMIT }) {
  const summary = telemetry?.summary || {};
  const spoke = summary.mentor_turns || 0;
  const fromTemplate = summary.from_template || 0;
  const reasons = summary.rejection_reasons || {};
  const failures = [];

  // 1. No measurement. Checked in every mode, including offline: with no model
  //    configured there is nothing to fail in transit, so seeing this offline
  //    means something else is wrong.
  // Telemetry keeps the provider detail after the category
  // (`mentor_agent_error: fetch failed`). Match the category prefix as well as
  // the bare key; otherwise a real transport failure looks like a successful
  // live measurement.
  const transport = Object.entries(reasons).filter(([observed, count]) =>
    count > 0 && TRANSPORT_FAILURE_REASONS.some(
      (reason) => observed === reason || observed.startsWith(`${reason}:`)
    )
  );
  if (transport.length) {
    failures.push({
      code: "transport_failure",
      detail:
        `Модель не отвечала: ${transport.map(([reason, count]) => `${reason}×${count}`).join(", ")}. ` +
        "Это несостоявшийся замер, а не результат прогона.",
    });
  }

  // 2. A measurement that stopped exercising the voice. Only meaningful live:
  //    offline every reply is a template by construction, and failing on that
  //    would make the offline mode unusable rather than honest.
  const share = spoke ? fromTemplate / spoke : null;
  if (live && spoke > 0 && share > limit) {
    failures.push({
      code: "deterministic_share_exceeded",
      detail:
        `Из ${spoke} реплик ментора ${fromTemplate} пришли из шаблона ` +
        `(${Math.round(share * 100)}%), порог ${Math.round(limit * 100)}%.`,
    });
  }

  // 3. A live run that produced no mentor turns at all measured nothing either.
  if (live && spoke === 0) {
    failures.push({
      code: "no_mentor_turns",
      detail: "Живой прогон не дал ни одной реплики ментора: сравнивать нечего.",
    });
  }

  return { ok: failures.length === 0, exitCode: failures.length ? 1 : 0, failures, share };
}

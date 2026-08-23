import { useCallback, useMemo, useState } from "react";
import { createSession } from "../../core/session/createSession.js";
import { submitLearnerTurn } from "../../core/session/submitLearnerTurn.js";
import { buildLearnerVisibleState } from "../../core/state/learnerView.js";
import { renderEvent } from "../../ai/renderer/renderEvent.js";
import {
  renderStatusSnapshot,
  renderClarification,
  renderUnsupported,
  renderUnavailableResource,
  renderPreopNotReady,
  renderDischargeNotReady,
} from "../../ai/renderer/renderStatus.js";
import { exportSession } from "../../core/replay/exportSession.js";
import { buildDebrief } from "../../core/replay/buildDebrief.js";
import { withShared } from "../../core/content/loadBundle.js";
import diseaseBundle from "../../content/generated/appendicitis.json";
import sharedBundle from "../../content/generated/shared.json";

const bundle = withShared(diseaseBundle, sharedBundle);
const CASE_PRESET_ID = "APP-004";

function nowIso() {
  return new Date().toISOString();
}

function randomSeed() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Scenario start time is seeded, not a fixed constant (task brief §14):
 * hardcoding every case to 02:15 made time-of-day resource logic untestable
 * in play and made every session feel identical before the first word.
 */
function seededStartIso(seed) {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const hour = String(hash % 24).padStart(2, "0");
  const minute = String((hash >> 5) % 60).padStart(2, "0");
  return `2026-08-23T${hour}:${minute}:00+05:00`;
}

/**
 * Owns one session's lifecycle for the React tree.
 *
 * Everything clinical goes through `core/session/submitLearnerTurn.js` -
 * the same entry point the learner-journey tests use - so the app cannot
 * reach a capability the tests bypass, and the tests cannot exercise one
 * the app has no path to (task brief §17). This hook only turns the result
 * into `{ role, speakerRu, textRu }` messages for `ChatShell`.
 */
export function useSession() {
  const [session, setSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [debrief, setDebrief] = useState(null);

  const startSession = useCallback(({ mode, realProfileId, locale = "ru" }) => {
    const seed = randomSeed();
    const next = createSession({
      sessionId: `session-${Date.now()}`,
      seed,
      mode,
      realProfileId,
      casePresetId: CASE_PRESET_ID,
      bundle,
      locale,
      startIso: seededStartIso(seed),
    });
    setSession(next);
    setDebrief(null);
    const arrival = next.events.find((e) => e.type === "PATIENT_ARRIVED");
    setMessages([toMessage("env", renderEvent({ event: arrival, bundle, patient: next.patient }))]);
  }, []);

  const submitTurn = useCallback(
    (text) => {
      if (!session) return;
      setBusy(true);
      setMessages((prev) => [...prev, { id: `${Date.now()}-learner`, role: "learner", speakerRu: null, textRu: text }]);

      const learnerVisibleBefore = buildLearnerVisibleState(session.state);
      const turn = submitLearnerTurn({ session, text });
      const rendered = [];

      // Events produced by time passing during a stated wait are narrated in
      // the order they actually happened, before the action that waited for
      // them (Contract §7.3 - results arrive when ready, not when asked for).
      for (const event of turn.timeEvents ?? []) {
        rendered.push(toMessage("env", renderEvent({ event, bundle, patient: turn.session.patient })));
      }

      for (const result of turn.outcomes) {
        if (result.outcome === "STATUS_SNAPSHOT") rendered.push(toMessage("env", renderStatusSnapshot(learnerVisibleBefore)));
        else if (result.outcome === "CLARIFY") rendered.push(toMessage("env", renderClarification(result.missing)));
        else if (result.outcome === "UNSUPPORTED_CONTENT") rendered.push(toMessage("env", renderUnsupported()));
        else if (result.outcome === "UNAVAILABLE_RESOURCE") rendered.push(toMessage("env", renderUnavailableResource(result.reasonKey)));
        else if (result.outcome === "PREOP_NOT_READY") rendered.push(toMessage("env", renderPreopNotReady(result.missingItems, bundle)));
        else if (result.outcome === "DISCHARGE_NOT_READY") rendered.push(toMessage("env", renderDischargeNotReady(result.blockers)));
        else if (result.outcome === "SAFETY_STOP") {
          rendered.push({ id: `${Date.now()}-safety`, role: "mentor", speakerRu: "Наставник", textRu: result.teachingPointRu });
        } else {
          for (const event of result.events ?? []) {
            rendered.push(toMessage("env", renderEvent({ event, bundle, patient: turn.session.patient })));
          }
        }
      }

      if (turn.mentor?.textRu) {
        rendered.push({ id: `${Date.now()}-mentor`, role: "mentor", speakerRu: "Наставник", textRu: turn.mentor.textRu });
      }

      setSession(turn.session);
      setMessages((prev) => [...prev, ...rendered.filter(Boolean)]);

      // A case ends when the patient reaches a terminal state, not when the
      // learner stops typing (Core Foundation Spec §56) - that is when the
      // debrief becomes available.
      if (turn.session.state.session.status === "complete") {
        setDebrief(buildDebrief({ session: turn.session, bundle }));
      }
      setBusy(false);
    },
    [session],
  );

  const downloadExport = useCallback(() => {
    if (!session) return;
    const bundleExport = exportSession({ session, generatedAtIso: nowIso() });
    const blob = new Blob([JSON.stringify(bundleExport, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `onqol-session-${session.sessionId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [session]);

  const learnerVisible = useMemo(() => (session ? buildLearnerVisibleState(session.state) : null), [session]);

  return { session, messages, busy, debrief, startSession, submitTurn, downloadExport, learnerVisible, bundle };
}

function toMessage(role, rendered) {
  if (!rendered) return null;
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role, speakerRu: rendered.speakerRu, textRu: rendered.textRu };
}

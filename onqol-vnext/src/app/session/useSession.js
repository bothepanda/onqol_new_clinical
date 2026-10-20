import { renderPatientDialogue, exportPatientTranscript } from "./renderPatientDialogue.js";
import { useCallback, useMemo, useRef, useState } from "react";
import { createSession } from "../../core/session/createSession.js";
import { submitLearnerTurn, recordGroundedMentorResponse } from "../../core/session/submitLearnerTurn.js";
import { hospitalIso } from "../../core/time/clock.js";
import { buildLearnerVisibleState } from "../../core/state/learnerView.js";
import { renderEvent } from "../../ai/renderer/renderEvent.js";
import { exportSession } from "../../core/replay/exportSession.js";
import { buildDebrief } from "../../core/replay/buildDebrief.js";
import { withShared } from "../../core/content/loadBundle.js";
import { seededStartIso } from "./seededStart.js";
import diseaseBundle from "../../content/generated/appendicitis.json";
import sharedBundle from "../../content/generated/shared.json";
import { AI_INTERACTION_V2, STATEFUL_GROUNDED_MENTOR_V1, resolveInterpreterMode, INTERPRETER_MODE, isStatefulGroundedMentorEnabled } from "../../ai/interaction/featureFlags.js";
import { renderMentorResponse } from "./renderMentorResponse.js";
import { renderTurnMessages, toMessage } from "./renderTurn.js";
import { createGatewayProviderClient } from "../../ai/providerClient.js";
import { interpretHybrid } from "../../ai/interpreter/hybridInterpreter.js";
import { interpretSemanticFirst } from "../../ai/interpreter/semanticFirstInterpreter.js";
import { buildTurnContext } from "../../core/session/submitLearnerTurn.js";
import { interpretTurn } from "../../ai/interpreter/interpretTurn.js";
import { routeUnifiedChat, INTENT_CLARIFICATION } from "./unifiedChat.js";
import { requestMentorDialogue } from "./mentorDialogue.js";
import { buildChatTurnContext } from "./interpreterContext.js";
import {
  clearPersistedSession,
  createPersistedSession,
  loadPersistedSession,
  savePersistedSession,
} from "./sessionPersistence.js";

const bundle = withShared(diseaseBundle, sharedBundle);
const CASE_PRESET_ID = "APP-004";
const shadowProvider = createGatewayProviderClient();
// Internal sessions default to semantic-first. Resolve against the persisted
// session purpose below, so resuming a pilot cannot promote the new contract.
const MENTOR_EXPERIMENT = import.meta.env.VITE_ONQOL_MENTOR === "experimental";

function nowIso() {
  return new Date().toISOString();
}

function randomSeed() {
  const requested = new URLSearchParams(globalThis.location?.search ?? "").get("seed");
  if (requested && import.meta.env.DEV && /^[A-Za-z0-9_-]{1,80}$/.test(requested)) return requested;
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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
export function useSession({ patientDialogue = false, storageKey } = {}) {
  const [session, setSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [persistenceError, setPersistenceError] = useState(false);
  const persist = useCallback((next, nextMessages) => {
    setPersistenceError(!savePersistedSession(globalThis.localStorage, createPersistedSession({ session: next, messages: nextMessages }), storageKey));
  }, [storageKey]);
  const submitting = useRef(false);
  const [debrief, setDebrief] = useState(null);
  const [resumeCandidate, setResumeCandidate] = useState(() =>
    loadPersistedSession(globalThis.localStorage, bundle, storageKey),
  );

  const startSession = useCallback(({ mode, realProfileId, locale = "ru" }) => {
    clearPersistedSession(globalThis.localStorage, storageKey);
    const seed = randomSeed();
    const next = createSession({
      sessionId: `session-${Date.now()}`,
      seed,
      mode,
      realProfileId,
      casePresetId: CASE_PRESET_ID,
      ...(patientDialogue ? { clinicalContentPolicy: "approved_only" } : {}),
      // Default build stays internal_development (development route, patient
      // truth not approved -> debrief carries the "не для пилота" note). The
      // NU resident-pilot build sets VITE_ONQOL_PILOT=true so APP-004 runs on
      // the learner_pilot route, where every patient-truth dependency is
      // approved_for_training and the session-audience gate opens.
      sessionPurpose: import.meta.env.VITE_ONQOL_PILOT === "true" ? "learner_pilot" : "internal_development",
      interactionFlags: {
        [AI_INTERACTION_V2]: import.meta.env.VITE_AI_INTERACTION_V2 === "true",
        [STATEFUL_GROUNDED_MENTOR_V1]: import.meta.env.VITE_STATEFUL_GROUNDED_MENTOR_V1 === "true",
      },
      bundle,
      locale,
      startIso: seededStartIso(seed),
    });
    setSession(next);
    setDebrief(null);
    const arrival = next.events.find((e) => e.type === "PATIENT_ARRIVED");
    const initialMessages = [toMessage("env", renderEvent({ event: arrival, bundle, patient: next.patient, state: next.state }))];
    setMessages(initialMessages);
    persist(next, initialMessages);
    setResumeCandidate(null);
  }, [storageKey, patientDialogue, persist]);

  const resumeSession = useCallback(() => {
    if (!resumeCandidate) return;
    setSession(resumeCandidate.session);
    setMessages(resumeCandidate.messages);
    setDebrief(resumeCandidate.completed ? buildDebrief({ session: resumeCandidate.session, bundle }) : null);
    setResumeCandidate(null);
  }, [resumeCandidate]);

  const discardPersistedSession = useCallback(() => {
    clearPersistedSession(globalThis.localStorage, storageKey);
    setResumeCandidate(null);
  }, [storageKey]);

  const mentorEnabled = MENTOR_EXPERIMENT && session?.state.session.purpose === "internal_development" && session?.state.session.locale === "ru";
  const submitTurn = useCallback(
    async (text) => {
      if (!session || submitting.current) return;
      submitting.current = true;
      setBusy(true);
      try {
      setMessages((prev) => [...prev, { id: `${Date.now()}-learner`, role: "learner", speakerRu: null, textRu: text }]);

      const learnerVisibleBefore = buildLearnerVisibleState(session.state);
      const interpreterMode = resolveInterpreterMode(import.meta.env.VITE_ONQOL_INTERPRETER, { purpose: session.state.session.purpose });
      const interpret = interpreterMode === INTERPRETER_MODE.SEMANTIC_FIRST ? interpretSemanticFirst : interpretHybrid;
      const interpreted = interpreterMode !== INTERPRETER_MODE.DETERMINISTIC
        ? await interpret({
            text,
            turnContext: buildChatTurnContext(session, messages),
            bundle: session.bundle,
            idPrefix: `t${session.state.turn}`,
            provider: createGatewayProviderClient({ sessionId: session.sessionId,
              onUnavailable: ({ code }) => { console.error("onqol_hybrid_unavailable", { code }); },
            }),
            locale: session.state.session.locale,
          })
        : mentorEnabled ? interpretTurn({ text, turnContext: buildTurnContext(session), bundle: session.bundle, idPrefix: `t${session.state.turn}` }) : undefined;
      // A transport/schema failure is an operational notice, never an occasion
      // for the mentor to guess what should have executed. Keep it in the turn
      // event log even when conversational mentoring is enabled.
      const route = mentorEnabled && !interpreted?.interpretationNotice ? routeUnifiedChat(text, interpreted) : null;
      if (route && !route.execute) {
        const learnerMessage = { id: `${Date.now()}-learner`, role: "learner", speakerRu: null, textRu: text };
        const result = route.kind === "clarify"
          ? { text: INTENT_CLARIFICATION, question: null, audit: { status: "clarification", route, input: text, calls: [] } }
          : await requestMentorDialogue({ session, messages, text });
        const next = appendDialogue(session, result, route, interpreted);
        const nextMessages = [...messages, learnerMessage, dialogueMessage(result)];
        setSession(next); setMessages(nextMessages);
        persist(next, nextMessages);
        return;
      }
      const turn = submitLearnerTurn({ session, text, shadowProvider, interpreted });
      // Stateful Grounded Mentor Wave A: `submitLearnerTurn` already recorded
      // the deterministic `turn.mentor.textRu` in the event log above - this
      // only decides what to SHOW, and only when the session opted in via
      // STATEFUL_GROUNDED_MENTOR_V1 (a session-level flag, independent of the
      // older MENTOR_EXPERIMENT/`route.discuss` channel below, which this
      // leaves untouched).
      let mentorTextRu = turn.mentor?.textRu ?? null;
      let sessionAfterMentorRender = turn.session;
      if (!route?.discuss && isStatefulGroundedMentorEnabled(session.state.session) && turn.mentor?.textRu) {
        const grounded = await renderMentorResponse({ session: turn.session, mentor: turn.mentor, messages, text });
        if (grounded) {
          mentorTextRu = grounded.text;
          sessionAfterMentorRender = recordGroundedMentorResponse(
            turn.session,
            { mode: turn.mentor.mode, ...grounded.audit },
            hospitalIso(turn.session.clockRoot, turn.session.state.clock.elapsedMinutes),
          );
        }
      }
      let rendered = renderTurnMessages({ turn, bundle, learnerVisibleBefore, interpreted, route, mentorTextRu });

      let completedSession = sessionAfterMentorRender;
      if (route?.discuss && turn.session.state.session.status !== "complete" && !turn.outcomes.some((x) => x.outcome === "SAFETY_STOP")) {
        // Teach only after execution results have been rendered; an order is not a result.
        const result = await requestMentorDialogue({ session: turn.session, messages: [...messages, ...rendered.filter(Boolean)], text });
        completedSession = appendDialogue(turn.session, result, route);
        rendered.push(dialogueMessage(result));
      }
      if (patientDialogue) {
        const speech = await renderPatientDialogue({ session: completedSession, rendered, messages });
        rendered = speech.messages; completedSession = speech.session;
      }
      setSession(completedSession);
      void turn.shadowTelemetryPromise.then((telemetry) => {
        if (!telemetry) return;
        setSession((current) => {
          if (!current || current.sessionId !== telemetry.sessionId) return current;
          const alreadyRecorded = (current.aiTelemetry ?? []).some((item) => item.turn === telemetry.turn);
          return alreadyRecorded ? current : { ...current, aiTelemetry: [...(current.aiTelemetry ?? []), telemetry] };
        });
      });
      const nextMessages = [...messages, { id: `${Date.now()}-learner-persisted`, role: "learner", speakerRu: null, textRu: text }, ...rendered.filter(Boolean)];
      setMessages(nextMessages);
      persist(completedSession, nextMessages);

      // A case ends when the patient reaches a terminal state, not when the
      // learner stops typing (Core Runtime Spec §56) - that is when the
      // debrief becomes available.
      if (turn.session.state.session.status === "complete") {
        setDebrief(buildDebrief({ session: turn.session, bundle }));
      }
      } finally {
        submitting.current = false;
        setBusy(false);
      }
    },
    [messages, session, mentorEnabled, patientDialogue, persist],
  );

  const downloadExport = useCallback(() => {
    if (!session) return;
    const bundleExport = patientDialogue ? exportPatientTranscript({ session, messages }) : exportSession({ session, generatedAtIso: nowIso() });
    const blob = new Blob([JSON.stringify(bundleExport, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `onqol-session-${session.sessionId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [session, messages, patientDialogue]);

  const learnerVisible = useMemo(() => (session ? buildLearnerVisibleState(session.state) : null), [session]);

  return {
    session, messages, busy, debrief, resumeCandidate, startSession, resumeSession,
    discardPersistedSession, submitTurn, downloadExport, learnerVisible, bundle,
    mentorEnabled, persistenceError,
  };
}

function appendDialogue(session, result, route, interpreted = null) {
  const entry = { ...result.audit, route, atClinicalTurn: session.state.turn, atMinutes: session.state.clock.elapsedMinutes, textShown: result.text, question: result.question,
    ...(interpreted ? { interpretation: { mode: interpreted.mode, telemetry: interpreted.semanticTelemetry ?? null } } : {}) };
  return { ...session, mentorDialogue: [...(session.mentorDialogue ?? []), entry] };
}
function dialogueMessage(result) {
  return { id: `${Date.now()}-mentor-discussion`, role: "mentor", speakerRu: "Наставник", textRu: result.text };
}

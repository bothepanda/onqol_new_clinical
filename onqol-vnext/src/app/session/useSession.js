import { useCallback, useMemo, useRef, useState } from "react";
import { createSession } from "../../core/session/createSession.js";
import { submitLearnerTurn } from "../../core/session/submitLearnerTurn.js";
import { buildLearnerVisibleState } from "../../core/state/learnerView.js";
import { renderEvent } from "../../ai/renderer/renderEvent.js";
import {
  renderStatusSnapshot,
  renderClarification,
  renderUnsupported,
  renderNotCommitted,
  renderOrderValidationFailure,
  renderAlreadyPending,
  renderUnavailableResource,
  renderPreopNotReady,
  renderDischargeNotReady,
  renderDispositionNotReady,
  renderHospitalPolicyBlock,
  renderOptionNotModeled,
  renderNoPendingWork,
  renderUnrecognizedFragments,
} from "../../ai/renderer/renderStatus.js";
import { exportSession } from "../../core/replay/exportSession.js";
import { buildDebrief } from "../../core/replay/buildDebrief.js";
import { withShared } from "../../core/content/loadBundle.js";
import { seededStartIso } from "./seededStart.js";
import diseaseBundle from "../../content/generated/appendicitis.json";
import sharedBundle from "../../content/generated/shared.json";
import { AI_INTERACTION_V2, resolveInterpreterMode, INTERPRETER_MODE } from "../../ai/interaction/featureFlags.js";
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
export function useSession() {
  const [session, setSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [debrief, setDebrief] = useState(null);
  const [resumeCandidate, setResumeCandidate] = useState(() =>
    loadPersistedSession(globalThis.localStorage, bundle),
  );

  const startSession = useCallback(({ mode, realProfileId, locale = "ru" }) => {
    clearPersistedSession(globalThis.localStorage);
    const seed = randomSeed();
    const next = createSession({
      sessionId: `session-${Date.now()}`,
      seed,
      mode,
      realProfileId,
      casePresetId: CASE_PRESET_ID,
      // Default build stays internal_development (development route, patient
      // truth not approved -> debrief carries the "не для пилота" note). The
      // NU resident-pilot build sets VITE_ONQOL_PILOT=true so APP-004 runs on
      // the learner_pilot route, where every patient-truth dependency is
      // approved_for_training and the session-audience gate opens.
      sessionPurpose: import.meta.env.VITE_ONQOL_PILOT === "true" ? "learner_pilot" : "internal_development",
      interactionFlags: { [AI_INTERACTION_V2]: import.meta.env.VITE_AI_INTERACTION_V2 === "true" },
      bundle,
      locale,
      startIso: seededStartIso(seed),
    });
    setSession(next);
    setDebrief(null);
    const arrival = next.events.find((e) => e.type === "PATIENT_ARRIVED");
    setMessages([toMessage("env", renderEvent({ event: arrival, bundle, patient: next.patient }))]);
    setResumeCandidate(null);
  }, []);

  const resumeSession = useCallback(() => {
    if (!resumeCandidate) return;
    setSession(resumeCandidate.session);
    setMessages(resumeCandidate.messages);
    setDebrief(resumeCandidate.completed ? buildDebrief({ session: resumeCandidate.session, bundle }) : null);
    setResumeCandidate(null);
  }, [resumeCandidate]);

  const discardPersistedSession = useCallback(() => {
    clearPersistedSession(globalThis.localStorage);
    setResumeCandidate(null);
  }, []);

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
        savePersistedSession(globalThis.localStorage, createPersistedSession({ session: next, messages: nextMessages }));
        return;
      }
      const turn = submitLearnerTurn({ session, text, shadowProvider, interpreted });
      const rendered = [];
      if (interpreted?.interpretationNotice) rendered.push(toMessage("env", { speakerRu: "Система", textRu: interpreted.interpretationNotice }));

      // Events produced by time passing during a stated wait are narrated in
      // the order they actually happened, before the action that waited for
      // them (Contract §7.3 - results arrive when ready, not when asked for).
      for (const event of turn.timeEvents ?? []) {
        rendered.push(toMessage("env", renderEvent({ event, bundle, patient: turn.session.patient })));
      }

      for (const result of turn.outcomes) {
        if (result.outcome === "STATUS_SNAPSHOT" || (result.outcome === "EXECUTED" && result.command?.type === "REQUEST_STATUS")) rendered.push(toMessage("env", renderStatusSnapshot(learnerVisibleBefore)));
        else if (result.outcome === "CLARIFY")
          rendered.push(toMessage("env", renderClarification(result.missing, { promptRu: result.clarifyPromptRu, by: result.clarifyBy })));
        else if (result.outcome === "UNSUPPORTED_CONTENT") rendered.push(toMessage("env", renderUnsupported(result)));
        else if (result.outcome === "ORDER_VALIDATION_FAILED") rendered.push(toMessage("env", renderOrderValidationFailure(result)));
        else if (result.outcome === "ALREADY_PENDING") rendered.push(toMessage("env", renderAlreadyPending(result)));
        else if (result.outcome === "NO_PENDING_WORK") rendered.push(toMessage("env", renderNoPendingWork()));
        else if (result.outcome === "UNAVAILABLE_RESOURCE") rendered.push(toMessage("env", renderUnavailableResource(result.reasonKey)));
        else if (result.outcome === "PREOP_NOT_READY") rendered.push(toMessage("env", renderPreopNotReady(result.missingItems, bundle)));
        else if (result.outcome === "DISCHARGE_NOT_READY") rendered.push(toMessage("env", renderDischargeNotReady(result.blockers)));
        else if (result.outcome === "DISPOSITION_NOT_READY") rendered.push(toMessage("env", renderDispositionNotReady(result.blockers)));
        else if (result.outcome === "HOSPITAL_POLICY_BLOCK") rendered.push(toMessage("env", renderHospitalPolicyBlock(result)));
        else if (result.outcome === "OPTION_NOT_MODELED") rendered.push(toMessage("env", renderOptionNotModeled(result)));
        else if (result.outcome === "SAFETY_STOP") {
          rendered.push({ id: `${Date.now()}-safety`, role: "mentor", speakerRu: "Наставник", textRu: result.teachingPointRu });
        } else {
          for (const event of result.events ?? []) {
            rendered.push(toMessage("env", renderEvent({ event, bundle, patient: turn.session.patient })));
          }
        }
      }

      // Time consumed BY an action (interfacility transport) is narrated after
      // the action itself - the ambulance leaves, then it arrives (Contract §7.1).
      for (const event of turn.afterEvents ?? []) {
        rendered.push(toMessage("env", renderEvent({ event, bundle, patient: turn.session.patient })));
      }

      if (!route?.discuss && turn.interpreted.withheldCommands?.length) {
        rendered.push(toMessage("env", renderNotCommitted()));
      }

      if (!route?.discuss && !interpreted?.interpretationNotice && turn.interpreted.unmatchedFragments?.length) {
        rendered.push(toMessage("env", renderUnrecognizedFragments(turn.interpreted.unmatchedFragments)));
      }

      if (!route?.discuss && turn.mentor?.textRu) {
        rendered.push({ id: `${Date.now()}-mentor`, role: "mentor", speakerRu: "Наставник", textRu: turn.mentor.textRu });
      }

      let completedSession = turn.session;
      if (route?.discuss && turn.session.state.session.status !== "complete" && !turn.outcomes.some((x) => x.outcome === "SAFETY_STOP")) {
        // Teach only after execution results have been rendered; an order is not a result.
        const result = await requestMentorDialogue({ session: turn.session, messages: [...messages, ...rendered.filter(Boolean)], text });
        completedSession = appendDialogue(turn.session, result, route);
        rendered.push(dialogueMessage(result));
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
      savePersistedSession(globalThis.localStorage, createPersistedSession({ session: completedSession, messages: nextMessages }));

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
    [messages, session, mentorEnabled],
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

  return {
    session, messages, busy, debrief, resumeCandidate, startSession, resumeSession,
    discardPersistedSession, submitTurn, downloadExport, learnerVisible, bundle,
    mentorEnabled,
  };
}

function toMessage(role, rendered) {
  if (!rendered) return null;
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role, speakerRu: rendered.speakerRu, textRu: rendered.textRu };
}

function appendDialogue(session, result, route, interpreted = null) {
  const entry = { ...result.audit, route, atClinicalTurn: session.state.turn, atMinutes: session.state.clock.elapsedMinutes, textShown: result.text, question: result.question,
    ...(interpreted ? { interpretation: { mode: interpreted.mode, telemetry: interpreted.semanticTelemetry ?? null } } : {}) };
  return { ...session, mentorDialogue: [...(session.mentorDialogue ?? []), entry] };
}
function dialogueMessage(result) {
  return { id: `${Date.now()}-mentor-discussion`, role: "mentor", speakerRu: "Наставник", textRu: result.text };
}

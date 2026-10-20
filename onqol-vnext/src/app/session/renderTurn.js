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
  renderRecognizedUnmodeled,
} from "../../ai/renderer/renderStatus.js";

/**
 * Everything the learner sees for one executed turn, in the order it
 * happened. Extracted from `useSession.js` (behaviour unchanged) so the exact
 * same rendering can be driven by tests and the live-session runner - what a
 * resident reads in the app is what a scripted resident reads in the suite.
 */
export function renderTurnMessages({ turn, bundle, learnerVisibleBefore, interpreted, route = null, mentorTextRu = null }) {
  const rendered = [];
  if (interpreted?.interpretationNotice) rendered.push(notice(toMessage("env", { speakerRu: "Система", textRu: interpreted.interpretationNotice })));

  // Events produced by time passing during a stated wait are narrated in
  // the order they actually happened, before the action that waited for
  // them (Contract §7.3 - results arrive when ready, not when asked for).
  for (const event of turn.timeEvents ?? []) {
    rendered.push(toMessage("env", renderEvent({ event, bundle, patient: turn.session.patient, state: turn.session.state })));
  }

  for (const result of turn.outcomes) {
    if (result.outcome === "STATUS_SNAPSHOT" || (result.outcome === "EXECUTED" && result.command?.type === "REQUEST_STATUS")) rendered.push(toMessage("env", renderStatusSnapshot(result.visibleSnapshot ?? learnerVisibleBefore)));
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
        rendered.push(toMessage("env", renderEvent({ event, bundle, patient: turn.session.patient, state: turn.session.state })));
      }
    }
  }

  // Time consumed BY an action (interfacility transport) is narrated after
  // the action itself - the ambulance leaves, then it arrives (Contract §7.1).
  for (const event of turn.afterEvents ?? []) {
    rendered.push(toMessage("env", renderEvent({ event, bundle, patient: turn.session.patient, state: turn.session.state })));
  }

  if (!route?.discuss && turn.interpreted.withheldCommands?.length) {
    rendered.push(notice(toMessage("env", renderNotCommitted())));
  }

  if (!route?.discuss && turn.interpreted.recognizedUnmodeled?.length) {
    rendered.push(notice(toMessage("env", renderRecognizedUnmodeled(turn.interpreted.recognizedUnmodeled))));
  }

  if (!route?.discuss && !interpreted?.interpretationNotice && turn.interpreted.unmatchedFragments?.length) {
    rendered.push(notice(toMessage("env", renderUnrecognizedFragments(turn.interpreted.unmatchedFragments))));
  }

  if (!route?.discuss && mentorTextRu) {
    rendered.push({ id: `${Date.now()}-mentor`, role: "mentor", speakerRu: "Наставник", textRu: mentorTextRu });
  }
  return rendered;
}

// Interpreter/parser notices are about the SIMULATOR, not the patient or the
// world: they are shown to the learner but never given to the mentor as facts.
const notice = (message) => (message ? { ...message, kind: "system_notice" } : message);

export function toMessage(role, rendered) {
  if (!rendered) return null;
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role, speakerRu: rendered.speakerRu, textRu: rendered.textRu };
}

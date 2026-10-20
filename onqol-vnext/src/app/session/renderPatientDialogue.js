import { createSpeechInput, acceptSpeechResult } from "../../ai/patient/flexiblePatient.js";

export async function renderPatientDialogue({ session, rendered, messages, fetchImpl = globalThis.fetch }) {
  const output = [], audits = [];
  for (const message of rendered.filter(Boolean)) {
    const input = createSpeechInput({ message, context: messages });
    if (!input) { output.push(message); continue; }
    const metadata = { sessionId: session.sessionId, turn: session.state.turn, stateVersion: session.events.at(-1)?.seq ?? 0,
      // Review metadata stays local; IDs can themselves encode hidden truth.
      contentVersions: session.state.session?.contentVersions ?? {},
      calibrationIds: [...new Set([...(session.patientTruthInventory?.entries ?? []).map((x) => x.contentId), ...session.events.flatMap((event) => event.payload.calibration?.id ? [event.payload.calibration.id] : [])])] };
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 65000);
    try {
      const response = await fetchImpl("/api/flexible/turn", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.sessionId, input }), signal: controller.signal });
      if (!response.ok) throw new Error("renderer_transport_unavailable");
      const result = await response.json();
      const text = acceptSpeechResult(input, result);
      audits.push({ ...result.audit, ...metadata, visibleFacts: input.allowedFacts, speaker: input.speaker, textShown: text });
      output.push({ ...message, textRu: text });
    } catch (error) {
      audits.push({ ...metadata, speaker: input.speaker, visibleFacts: input.allowedFacts, attempts: [], retryCount: 0,
        fallbackUsed: true, transportError: error.message, textShown: message.textRu });
      output.push(message);
    } finally { clearTimeout(timer); }
  }
  return { messages: output, session: { ...session, patientDialogue: [...(session.patientDialogue ?? []), ...audits] } };
}

// Explicitly limited learner download: no hidden state, seed, event payloads,
// raw rejected generations, calibration IDs or reviewer-only evidence.
export function exportPatientTranscript({ session, messages }) {
  return { version: "flexible-patient-2-transcript", sessionId: session.sessionId,
    elapsedMinutes: session.state.clock.elapsedMinutes, status: session.state.session.status,
    messages: messages.map(({ role, speakerRu, textRu }) => ({ role, speakerRu, textRu })) };
}

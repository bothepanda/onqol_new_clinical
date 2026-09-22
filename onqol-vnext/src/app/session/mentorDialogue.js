// Only already displayed environment text can become factual context. The model
// never receives session.state, patient, content bundle or undisclosed results.
export function buildDialogueContext({ session, messages, text }) {
  const display = messages.filter((x) => typeof x.textRu === "string");
  const facts = display.filter((x) => x.role === "env").slice(-80)
    .map((x) => ({ id: x.id, text: x.textRu.slice(0, 4000) }));
  return {
    casePresetId: session.state.session.casePresetId,
    sessionPurpose: session.state.session.purpose,
    locale: session.state.session.locale,
    text,
    history: display.slice(-24).map((x) => ({ role: x.role, text: x.textRu.slice(0, 4000) })),
    facts,
    historyTruncated: display.length > 24 || display.some((x) => x.textRu.length > 4000),
  };
}

export async function requestMentorDialogue({ session, messages, text, fetchImpl = globalThis.fetch }) {
  const context = buildDialogueContext({ session, messages, text });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 75000);
  try {
    const response = await fetchImpl("/api/mentor/dialogue", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: session.sessionId, context }), signal: controller.signal,
    });
    if (!response.ok) throw new Error(`mentor_http_${response.status}`);
    const result = await response.json();
    if (typeof result.text !== "string" || !result.audit || !["accepted", "fallback"].includes(result.audit.status)) throw new Error("invalid_response");
    return result;
  } catch (error) {
    return {
      text: "Наставник сейчас недоступен. Вопрос сохранён; можно продолжить работу с пациентом или попробовать обсудить его позже.",
      question: null,
      audit: { status: "fallback", context, calls: [], errorCode: error.name === "AbortError" ? "provider_timeout" : "gateway_unavailable" },
    };
  } finally { clearTimeout(timer); }
}

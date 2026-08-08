export async function getOpenAIBackendStatus(fetchImpl = fetch) {
  try {
    const response = await fetchImpl("/api/v25/openai/status", {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`OpenAI status failed (${response.status}).`);
    return await response.json();
  } catch {
    return {
      configured: false,
      provider: "openai",
      routerModel: "gpt-5.6-luna",
      simulatorModel: "gpt-5.6-terra",
      mentorModel: "gpt-5.6-luna",
    };
  }
}

export function createOpenAIBackendClient({ task, fetchImpl = fetch }) {
  if (!["router", "simulator", "mentor"].includes(task)) {
    throw new Error("Unsupported ON QOL model task.");
  }

  return async function openAIBackendClient(prompt) {
    const response = await fetchImpl("/api/v25/openai", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ task, prompt }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `OpenAI backend error (${response.status}).`);
    return payload.output || "";
  };
}

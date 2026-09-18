import { mkdirSync, appendFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export function createStage2Journal(directory) {
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${randomUUID()}.jsonl`);
  let seq = 0;
  return {
    file,
    append(entry) {
      const row = { seq: ++seq, receivedAt: new Date().toISOString(), ...entry };
      appendFileSync(file, JSON.stringify(row) + "\n", { mode: 0o600, flush: true });
      return row;
    },
  };
}

export function createJournaledFetch({ fetchImpl, journal, raw, apiKey, journalFile = journal.file }) {
  return async (...args) => {
    try {
      const response = await fetchImpl(...args);
      const body = await response.clone().text();
      const rawBody = apiKey ? body.replaceAll(apiKey, "[REDACTED_API_KEY]") : body;
      const entry = journal.append({ status: response.status, rawBody, requestId: response.headers.get("x-request-id") });
      let payload = null;
      try { payload = JSON.parse(rawBody); } catch { /* Keep the original non-JSON response. */ }
      raw.push({ ...entry, payload, journalFile });
      return response;
    } catch (error) {
      journal.append({ errorCode: error.name === "AbortError" ? "provider_timeout" : "provider_transport_error" });
      throw error;
    }
  };
}

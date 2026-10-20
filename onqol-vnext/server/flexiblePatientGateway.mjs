import { createAiGateway } from "./aiGateway.mjs";
import { invokeGateway } from "./mentorGateway.mjs";
import { renderFlexibleSpeech, validSpeechInput } from "../src/ai/patient/flexiblePatient.js";
import { fileBudgetStore } from "./budgetStore.mjs";
import { fileURLToPath } from "node:url";

// Deliberately opt-in, with the existing provider adapter, rate/cost caps and
// no client key. Only disclosed speech reaches this renderer; no patient state.
export function createFlexiblePatientGateway({ env = process.env, fetchImpl, logger = console, providerOverride,
  budgetStore = fileBudgetStore(fileURLToPath(new URL("../.onqol-flexible-budget.json", import.meta.url))) } = {}) {
  const gateway = createAiGateway({ env, fetchImpl, logger, budgetStore, timeoutMs: 30000 });
  return (req, res, next) => {
    if (req.url?.split("?")[0] !== "/api/flexible/turn") return next();
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "private, no-store");
    const fail = (status, error) => { res.statusCode = status; res.end(JSON.stringify({ error })); };
    if (env.ONQOL_FLEXIBLE_PATIENT !== "true" || env.VITE_ONQOL_PILOT === "true") return fail(404, "flexible_disabled");
    if (req.method !== "POST") return fail(405, "invalid_request");
    if (env.ONQOL_ALLOWED_ORIGIN && req.headers.origin && req.headers.origin !== env.ONQOL_ALLOWED_ORIGIN) return fail(403, "origin_rejected");
    void (async () => {
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (Buffer.byteLength(raw) > 350000) throw new Error("request_too_large");
      }
      const body = JSON.parse(raw);
      if (Object.keys(body).some((key) => !["sessionId", "input"].includes(key)) ||
        !/^[A-Za-z0-9_-]{1,100}$/.test(body.sessionId ?? "") || !validSpeechInput(body.input)) throw new Error("invalid_projection");
      const provider = providerOverride ?? { complete: (request) => invokeGateway(gateway, request, body.sessionId, req) };
      const result = await renderFlexibleSpeech({ input: body.input, provider });
      res.end(JSON.stringify(result));
    })().catch(() => fail(400, "invalid_request_or_session_limit"));
  };
}

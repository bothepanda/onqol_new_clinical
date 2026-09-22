import { Readable } from "node:stream";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createAiGateway } from "./aiGateway.mjs";
import { fileBudgetStore } from "./budgetStore.mjs";
import { runGroundedDialogue } from "../src/ai/mentor/groundedDialogue.js";

const libraryText = readFileSync(new URL("../src/content/mentor/app004-library.json", import.meta.url), "utf8");
const library = { ...JSON.parse(libraryText), sha256: createHash("sha256").update(libraryText).digest("hex") };

// Reuse the provider adapter, timeout, rate and cost caps with a separate ledger.
// Request prompts and approved knowledge are constructed server-side.
export function createMentorGateway({ env, fetchImpl, budgetStore = fileBudgetStore(fileURLToPath(new URL("../.onqol-mentor-budget.json", import.meta.url))), logger = console, limits = {} } = {}) {
  const gateway = createAiGateway({ env, fetchImpl, budgetStore, logger, limits, timeoutMs: 30000 });
  return (req, res, next) => {
    if (req.url?.split("?")[0] !== "/api/mentor/dialogue") return next();
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "private, no-store");
    if (env.ONQOL_EXPERIMENTAL_MENTOR !== "true") { res.statusCode = 404; res.end(JSON.stringify({ error: "mentor_disabled" })); return; }
    if (req.method !== "POST") { res.statusCode = 405; res.end(JSON.stringify({ error: "invalid_request" })); return; }
    if (env.ONQOL_ALLOWED_ORIGIN && req.headers.origin && req.headers.origin !== env.ONQOL_ALLOWED_ORIGIN) { res.statusCode = 403; res.end(JSON.stringify({ error: "origin_rejected" })); return; }
    void handle().catch(() => { if (!res.writableEnded) { res.statusCode = 400; res.end(JSON.stringify({ error: "invalid_request" })); } });
    async function handle() {
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (Buffer.byteLength(raw) > 60000) throw new Error("request_too_large");
      }
      const body = JSON.parse(raw);
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(body.sessionId ?? "")) throw new Error("invalid_request");
      const c = body.context;
      if (!c || !Array.isArray(c.history) || !Array.isArray(c.facts)) throw new Error("invalid_request");
      // Never forward unexpected fields (patient truth, caller cards or prompts).
      const context = {
        casePresetId: c.casePresetId, sessionPurpose: c.sessionPurpose, locale: c.locale, text: c.text,
        history: c.history.map((x) => ({ role: x.role, text: x.text })),
        facts: c.facts.map((x) => ({ id: x.id, text: x.text })),
        historyTruncated: c.historyTruncated === true,
      };
      const provider = { complete: (request) => invokeGateway(gateway, request, body.sessionId, req) };
      const result = await runGroundedDialogue({ provider, context, library });
      res.end(JSON.stringify(result));
    }
  };
}

export function invokeGateway(gateway, request, sessionId, original = {}) {
  return new Promise((resolve, reject) => {
    const req = Readable.from([JSON.stringify({ ...request, sessionId })]);
    req.url = "/api/ai/mentor";
    req.method = "POST";
    req.headers = original.headers ?? {};
    req.socket = { remoteAddress: original.socket?.remoteAddress ?? "local-mentor" };
    const res = {
      statusCode: 200, setHeader() {},
      end(raw) {
        try {
          const data = JSON.parse(raw);
          if (this.statusCode >= 400) { reject(Object.assign(new Error(data.error), { code: data.error })); return; }
          resolve({ text: data.choices?.[0]?.message?.content, meta: { model: data.model, usage: data.usage, costUsd: data.costUsd } });
        } catch (error) { reject(error); }
      },
    };
    gateway(req, res, () => reject(new Error("gateway_unavailable")));
  });
}

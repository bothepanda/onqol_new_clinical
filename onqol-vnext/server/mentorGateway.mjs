import { Readable } from "node:stream";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createAiGateway } from "./aiGateway.mjs";
import { fileBudgetStore } from "./budgetStore.mjs";
import { runGroundedDialogue } from "../src/ai/mentor/groundedDialogue.js";
import { renderGroundedMentorText } from "../src/ai/mentor/statefulGroundedMentor.js";
import { selectLibrary } from "../src/ai/mentor/libraryRegistry.js";

// Every approved library under src/content/mentor/*-library.json. The library
// for a request is chosen by the session's own scope (libraryRegistry.js) -
// adding a case adds a file, not a branch here.
const libraryDir = new URL("../src/content/mentor/", import.meta.url);
const libraries = readdirSync(libraryDir)
  .filter((name) => name.endsWith("-library.json"))
  .map((name) => {
    const text = readFileSync(new URL(name, libraryDir), "utf8");
    return { ...JSON.parse(text), sha256: createHash("sha256").update(text).digest("hex") };
  });

// Reuse the provider adapter, timeout, rate and cost caps with a separate ledger.
// Request prompts and approved knowledge are constructed server-side.
export function createMentorGateway({ env, fetchImpl, budgetStore = fileBudgetStore(fileURLToPath(new URL("../.onqol-mentor-budget.json", import.meta.url))), logger = console, limits = {} } = {}) {
  const gateway = createAiGateway({ env, fetchImpl, budgetStore, logger, limits, timeoutMs: 30000 });
  return (req, res, next) => {
    const path = req.url?.split("?")[0];
    if (path === "/api/mentor/dialogue") return handleDialogue(req, res, next);
    if (path === "/api/mentor/stateful-response") return handleStatefulResponse(req, res, next);
    return next();
  };

  function handleDialogue(req, res, next) {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "private, no-store");
    if (env.ONQOL_EXPERIMENTAL_MENTOR !== "true") { res.statusCode = 404; res.end(JSON.stringify({ error: "mentor_disabled" })); return; }
    if (req.method !== "POST") { res.statusCode = 405; res.end(JSON.stringify({ error: "invalid_request" })); return; }
    if (env.ONQOL_ALLOWED_ORIGIN && req.headers.origin && req.headers.origin !== env.ONQOL_ALLOWED_ORIGIN) { res.statusCode = 403; res.end(JSON.stringify({ error: "origin_rejected" })); return; }
    void handle().catch(() => { if (!res.writableEnded) { res.statusCode = 400; res.end(JSON.stringify({ error: "invalid_request" })); } });
    async function handle() {
      const body = await readJsonBody(req);
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(body.sessionId ?? "")) throw new Error("invalid_request");
      const context = parseContext(body.context);
      const provider = { complete: (request) => invokeGateway(gateway, request, body.sessionId, req) };
      // No library for this scope: the first one is used only so the scope
      // check inside runGroundedDialogue rejects it (scope_not_approved) - no
      // provider call is made.
      const library = selectLibrary(libraries, context) ?? libraries[0];
      const result = await runGroundedDialogue({ provider, context, library });
      res.end(JSON.stringify(result));
    }
  }

  // Stateful Grounded Mentor Wave A. Separate route, separate flag
  // (STATEFUL_GROUNDED_MENTOR_V1) - a server-side kill switch independent of
  // the older ONQOL_EXPERIMENTAL_MENTOR one, and of the client-side session
  // flag of the same name (docs/STATEFUL_GROUNDED_MENTOR_WAVE_A.md).
  function handleStatefulResponse(req, res, next) {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "private, no-store");
    if (env.STATEFUL_GROUNDED_MENTOR_V1 !== "true") { res.statusCode = 404; res.end(JSON.stringify({ error: "mentor_disabled" })); return; }
    if (req.method !== "POST") { res.statusCode = 405; res.end(JSON.stringify({ error: "invalid_request" })); return; }
    if (env.ONQOL_ALLOWED_ORIGIN && req.headers.origin && req.headers.origin !== env.ONQOL_ALLOWED_ORIGIN) { res.statusCode = 403; res.end(JSON.stringify({ error: "origin_rejected" })); return; }
    void handle().catch(() => { if (!res.writableEnded) { res.statusCode = 400; res.end(JSON.stringify({ error: "invalid_request" })); } });
    async function handle() {
      const body = await readJsonBody(req);
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(body.sessionId ?? "")) throw new Error("invalid_request");
      const context = parseContext(body.context);
      // A plain string id used only to bound which approved cards are
      // offered (cardRetrieval.js) - never trusted as clinical content.
      const issueId = typeof body.issueId === "string" && body.issueId.length <= 200 ? body.issueId : null;
      const deterministicFallbackText = typeof body.deterministicFallbackText === "string" ? body.deterministicFallbackText.slice(0, 2000) : null;
      const concepts = Array.isArray(body.concepts) ? body.concepts.filter((c) => typeof c === "string" && c.length <= 100).slice(0, 10) : [];
      // Learner-visible slice only (cardRetrieval.js#buildRetrievalView); a
      // plain bounded object used solely to evaluate card conditions.
      const visibleState = body.visibleState && typeof body.visibleState === "object" && JSON.stringify(body.visibleState).length <= 4000 ? body.visibleState : null;
      const library = selectLibrary(libraries, context) ?? libraries[0];
      const provider = { complete: (request) => invokeGateway(gateway, request, body.sessionId, req) };
      const result = await renderGroundedMentorText({ provider, context, issueId, library, visibleState, concepts, deterministicFallbackText });
      res.end(JSON.stringify(result));
    }
  }
}

async function readJsonBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 60000) throw new Error("request_too_large");
  }
  return JSON.parse(raw);
}

// Never forward unexpected fields (patient truth, caller cards or prompts) -
// shared by both routes above.
function parseContext(c) {
  if (!c || !Array.isArray(c.history) || !Array.isArray(c.facts)) throw new Error("invalid_request");
  return {
    casePresetId: c.casePresetId, sessionPurpose: c.sessionPurpose, locale: c.locale, text: c.text,
    history: c.history.map((x) => ({ role: x.role, text: x.text })),
    facts: c.facts.map((x) => ({ id: x.id, text: x.text })),
    historyTruncated: c.historyTruncated === true,
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

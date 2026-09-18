/**
 * Provider-neutral AI gateway middleware.
 *
 * Generic ideas kept from the legacy `server/openaiGateway.mjs` (vNext task
 * brief §5.4): the API key lives only here, server-side; the browser bundle
 * never receives it; every request has a timeout; OpenAI receives
 * `store: false`. Provider retention policies are separate from this flag.
 * There is a request-scoped access
 * control seam and a rate-limit seam. Everything provider-specific
 * (request/response shape, model names) is rebuilt from scratch behind this
 * one function and does not leak into `src/ai/*` or `src/core/*`.
 *
 * The domain core (`src/core`) never imports this file or anything
 * provider-specific - it only ever receives already-decided commands and
 * already-rendered text, matching Core Runtime Spec §66.
 */
import process from "node:process";
import { anthropicRequest, anthropicResponse } from "./anthropicAdapter.mjs";
import { interpreterModelConfig, INTERPRETER_BUDGET, completionCost } from "../src/ai/modelConfig.js";

const DEFAULT_TIMEOUT_MS = INTERPRETER_BUDGET.gatewayMs;

export function createAiGateway({ env = process.env, fetchImpl = globalThis.fetch, logger = console, budgetStore = null } = {}) {
  const config = interpreterModelConfig(env);
  const apiKey = config.provider === "anthropic" ? env.ANTHROPIC_API_KEY : env.OPENAI_API_KEY;
  const budget = budgetStore?.load() ?? { sessions: {}, pilotReservedUsd: 0 };
  const allowedOrigin = env.ONQOL_ALLOWED_ORIGIN ?? null;
  const rateLimiter = createFixedWindowLimiter({ windowMs: 60_000, max: Number(env.ONQOL_RATE_LIMIT_PER_MIN ?? 60) });

  return function aiGatewayMiddleware(req, res, next) {
    if (!req.url.startsWith("/api/ai/")) return next();

    if (allowedOrigin && req.headers.origin && req.headers.origin !== allowedOrigin) {
      res.statusCode = 403;
      res.end(JSON.stringify({ error: "provider_auth" }));
      return;
    }

    if (!rateLimiter.allow(req.socket?.remoteAddress ?? "unknown")) {
      res.statusCode = 429;
      res.end(JSON.stringify({ error: "rate_limited" }));
      return;
    }

    if (!apiKey) {
      // No provider configured: every AI task has a deterministic fallback
      // (`src/ai/interpreter`, `src/ai/renderer`, `src/ai/mentor`), so this is
      // a real, working mode - not a failure - and the gateway says so
      // explicitly rather than pretending a provider exists.
      res.statusCode = 501;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "no_provider_configured" }));
      return;
    }

    handleRequest(req, res, { apiKey, config, fetchImpl, reserve, timeoutMs: DEFAULT_TIMEOUT_MS }).catch((error) => {
      const code = error.name === "AbortError" ? "provider_timeout" : error.code ?? "provider_error";
      logger.error("onqol_gateway", { code, upstreamStatus: error.upstreamStatus ?? null });
      res.statusCode = code === "provider_timeout" ? 504 : ["provider_quota", "rate_limited"].includes(code) ? 429 : code === "provider_auth" ? 401 : 502;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: PUBLIC_ERRORS.has(code) ? code : "provider_error" }));
    });
  };

  function reserve(sessionId, requestBytes) {
    if (typeof sessionId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(sessionId)) throw codedError("provider_error");
    const entry = Object.hasOwn(budget.sessions, sessionId) ? budget.sessions[sessionId] : { calls: 0, reservedUsd: 0 };
    // UTF-8 bytes conservatively bound input tokens. Failed calls keep their reservation.
    const amount = (requestBytes * config.pricing.inputPerMillionUsd + config.maxCompletionTokens * config.pricing.outputPerMillionUsd) / 1e6;
    if (entry.calls >= config.sessionMaxCalls || entry.reservedUsd + amount > config.sessionMaxUsd || budget.pilotReservedUsd + amount > config.pilotMaxUsd) throw codedError("provider_quota");
    entry.calls += 1;
    entry.reservedUsd += amount;
    budget.pilotReservedUsd += amount;
    Object.defineProperty(budget.sessions, sessionId, { value: entry, enumerable: true, writable: true, configurable: true });
    budgetStore?.save(budget);
  }
}

const PUBLIC_ERRORS = new Set(["no_provider_configured", "rate_limited", "provider_auth", "provider_quota", "provider_timeout", "provider_error"]);
function codedError(code, upstreamStatus) { return Object.assign(new Error(code), { code, upstreamStatus }); }

async function handleRequest(req, res, { apiKey, config, timeoutMs, fetchImpl, reserve }) {
  const body = await readJsonBody(req);
  if (req.method !== "POST" || !Array.isArray(body.messages) || !body.messages.length || !body.responseFormat) throw codedError("provider_error");
  const request = config.provider === "anthropic" ? anthropicRequest(body, config, apiKey) : {
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: config.model, messages: body.messages,
    response_format: body.responseFormat, reasoning_effort: config.reasoningEffort,
    max_completion_tokens: config.maxCompletionTokens, store: false }) };
  const requestBody = request.body;
  reserve(body.sessionId, Buffer.byteLength(requestBody) + 4096);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(config.endpoint, {
      method: "POST",
      headers: request.headers,
      body: requestBody,
      signal: controller.signal,
    });
    let data = await response.json();
    if (!response.ok) {
      const code = response.status === 401 || response.status === 403 ? "provider_auth"
        : response.status === 429 ? (/quota|credit|balance/.test(data.error?.code ?? "") ? "provider_quota" : "rate_limited") : "provider_error";
      throw codedError(code, response.status);
    }
    if (config.provider === "anthropic") data = anthropicResponse(data);
    res.statusCode = response.status;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ model: data.model, choices: [{ message: { content: data.choices?.[0]?.message?.content ?? null } }],
      usage: data.usage, costUsd: completionCost(data.usage, config.pricing) }));
  } finally {
    clearTimeout(timeout);
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (Buffer.byteLength(raw) > 65536) { reject(codedError("provider_error")); req.destroy(); }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function createFixedWindowLimiter({ windowMs, max }) {
  const hits = new Map();
  return {
    allow(key) {
      const now = Date.now();
      const windowStart = Math.floor(now / windowMs);
      const entry = hits.get(key);
      if (!entry || entry.window !== windowStart) {
        hits.set(key, { window: windowStart, count: 1 });
        return true;
      }
      entry.count += 1;
      return entry.count <= max;
    },
  };
}

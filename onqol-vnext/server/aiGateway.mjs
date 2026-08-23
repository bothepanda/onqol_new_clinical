/**
 * Provider-neutral AI gateway middleware.
 *
 * Generic ideas kept from the legacy `server/openaiGateway.mjs` (vNext task
 * brief §5.4): the API key lives only here, server-side; the browser bundle
 * never receives it; every request has a timeout; `store: false` is passed
 * to whichever provider is configured, so conversation content is not
 * retained on the vendor side by default; there is a request-scoped access
 * control seam and a rate-limit seam. Everything provider-specific
 * (request/response shape, model names) is rebuilt from scratch behind this
 * one function and does not leak into `src/ai/*` or `src/core/*`.
 *
 * The domain core (`src/core`) never imports this file or anything
 * provider-specific - it only ever receives already-decided commands and
 * already-rendered text, matching Core Foundation Spec §66.
 */
import process from "node:process";

const DEFAULT_TIMEOUT_MS = 20_000;

export function createAiGateway({ env = process.env } = {}) {
  const apiKey = env.OPENAI_API_KEY;
  const allowedOrigin = env.ONQOL_ALLOWED_ORIGIN ?? null;
  const rateLimiter = createFixedWindowLimiter({ windowMs: 60_000, max: Number(env.ONQOL_RATE_LIMIT_PER_MIN ?? 60) });

  return function aiGatewayMiddleware(req, res, next) {
    if (!req.url.startsWith("/api/ai/")) return next();

    if (allowedOrigin && req.headers.origin && req.headers.origin !== allowedOrigin) {
      res.statusCode = 403;
      res.end(JSON.stringify({ error: "origin_not_allowed" }));
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
      res.end(JSON.stringify({ error: "no_provider_configured", fallback: "deterministic" }));
      return;
    }

    handleRequest(req, res, { apiKey, timeoutMs: Number(env.ONQOL_AI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS) }).catch((error) => {
      res.statusCode = 502;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "provider_error", detail: String(error?.message ?? error) }));
    });
  };
}

async function handleRequest(req, res, { apiKey, timeoutMs }) {
  const body = await readJsonBody(req);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: body.model ?? "gpt-5-mini",
        messages: body.messages,
        response_format: body.responseFormat,
        store: false,
      }),
      signal: controller.signal,
    });
    const data = await response.json();
    res.statusCode = response.status;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(data));
  } finally {
    clearTimeout(timeout);
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
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

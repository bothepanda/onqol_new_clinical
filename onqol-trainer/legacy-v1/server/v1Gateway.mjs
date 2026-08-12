import { timingSafeEqual } from "node:crypto";

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const MAX_BODY_BYTES = 250_000;
const MAX_MESSAGES = 200;
const MAX_MESSAGE_CHARS = 20_000;
const REQUESTS_PER_MINUTE = 30;

function json(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(payload));
}

function tokenMatches(actual, expected) {
  if (!actual || !expected) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length
    && timingSafeEqual(actualBuffer, expectedBuffer);
}

function bearerToken(req) {
  const value = req.headers.authorization || "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

function originAllowed(req, configuredOrigin) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (configuredOrigin) return origin === configuredOrigin;
  const forwardedHost = req.headers["x-forwarded-host"];
  const host = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost || req.headers.host;
  try {
    return Boolean(host) && new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function readJson(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    if (Buffer.byteLength(JSON.stringify(req.body), "utf8") > MAX_BODY_BYTES) {
      const error = new Error("Request is too large.");
      error.statusCode = 413;
      throw error;
    }
    return req.body;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("Request is too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    const error = new Error("Invalid V1 message history.");
    error.statusCode = 400;
    throw error;
  }
  return messages.map((message) => {
    if (
      !message
      || !["user", "assistant"].includes(message.role)
      || typeof message.content !== "string"
      || message.content.length === 0
      || message.content.length > MAX_MESSAGE_CHARS
    ) {
      const error = new Error("Invalid V1 message history.");
      error.statusCode = 400;
      throw error;
    }
    return { role: message.role, content: message.content };
  });
}

export function buildAnthropicRequest({ system, messages, model = DEFAULT_MODEL }) {
  if (typeof system !== "string" || system.length < 100 || system.length > 100_000) {
    const error = new Error("Invalid V1 system prompt.");
    error.statusCode = 400;
    throw error;
  }
  return {
    model,
    max_tokens: 2048,
    system,
    messages: normalizeMessages(messages),
  };
}

export async function requestAnthropic({ apiKey, system, messages, model, fetchImpl = fetch }) {
  if (!apiKey) {
    const error = new Error("V1 provider is not configured.");
    error.statusCode = 503;
    throw error;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(buildAnthropicRequest({ system, messages, model })),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(`V1 provider request failed (${response.status}).`);
      error.statusCode = response.status;
      throw error;
    }
    const output = (payload.content || [])
      .filter((item) => item?.type === "text")
      .map((item) => item.text || "")
      .join("")
      .trim();
    if (!output) throw new Error("V1 provider returned no text.");
    return { output, model: payload.model || model || DEFAULT_MODEL };
  } finally {
    clearTimeout(timeout);
  }
}

export function createV1Gateway(options = {}) {
  const buckets = new Map();

  function withinRateLimit(req) {
    const now = Date.now();
    const key = req.socket?.remoteAddress || "unknown";
    const bucket = buckets.get(key) || { windowStartedAt: now, count: 0 };
    if (now - bucket.windowStartedAt >= 60_000) {
      bucket.windowStartedAt = now;
      bucket.count = 0;
    }
    bucket.count += 1;
    buckets.set(key, bucket);
    return bucket.count <= REQUESTS_PER_MINUTE;
  }

  return async function v1Gateway(req, res, next) {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname !== "/api/anthropic") {
      if (next) return next();
      return json(res, 404, { error: "Not found." });
    }
    if (req.method !== "POST") return json(res, 405, { error: "Method not allowed." });
    if (!originAllowed(req, options.allowedOrigin)) {
      return json(res, 403, { error: "Origin is not allowed." });
    }
    if (!tokenMatches(bearerToken(req), options.accessToken)) {
      return json(res, 401, { error: "Invalid V1 access code." });
    }
    if (!withinRateLimit(req)) return json(res, 429, { error: "Too many V1 requests." });

    try {
      const body = await readJson(req);
      const result = await requestAnthropic({
        apiKey: options.apiKey,
        system: body.system,
        messages: body.messages,
        model: options.model || DEFAULT_MODEL,
        fetchImpl: options.fetchImpl,
      });
      return json(res, 200, result);
    } catch (error) {
      const statusCode = Number(error.statusCode) || (error.name === "AbortError" ? 504 : 500);
      return json(res, statusCode, { error: error.message || "V1 gateway error." });
    }
  };
}

export { DEFAULT_MODEL };

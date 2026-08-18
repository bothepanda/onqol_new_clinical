import { createHash, timingSafeEqual } from "node:crypto";
import {
  ROUTER_RESPONSE_FORMAT,
  ROUTER_SCHEMA_VERSION,
} from "../src/clinical/schemas/routerSchema.js";

export const OPENAI_GATEWAY_VERSION = "2026-08-13.1";
const SIMULATOR_SCHEMA_VERSION = "simulator-envelope-v3";
const MENTOR_SCHEMA_VERSION = "mentor-policy-rendering-v3";

const DEFAULT_MODELS = Object.freeze({
  router: "gpt-5.6-luna",
  simulator: "gpt-5.6-terra",
  // Clinical truth stays deterministic; the mentor chooses whether and how to
  // intervene among current, bounded candidate teaching issues.
  mentor: "gpt-5.6-luna",
});

const TASKS = Object.freeze({
  router: {
    maxOutputTokens: 2400,
    // The schema is NOT written here. It lives in
    // src/clinical/schemas/routerSchema.js, next to the prompt that asks for it
    // and the normaliser that consumes it - see that file for what a second
    // copy cost. A test asserts this is the very same object.
    format: ROUTER_RESPONSE_FORMAT,
  },
  simulator: {
    maxOutputTokens: 3000,
    format: {
      type: "json_schema",
      name: "onqol_simulator_envelope",
      strict: true,
      schema: {
        type: "object",
        properties: {
          response_parts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                classification: {
                  type: "string",
                  enum: ["LOCKED_FACT", "INFERABLE_FINDING", "UNKNOWN"],
                },
                source_id: { type: ["string", "null"] },
                exact_text: { type: ["string", "null"] },
                requested_fragment: { type: ["string", "null"] },
                reason_code: {
                  type: ["string", "null"],
                  enum: [
                    "not_authorized_finding",
                    "unrecognized_fragment",
                    "unknown_medication",
                    "not_modelled_for_variant",
                    null,
                  ],
                },
              },
              required: [
                "classification",
                "source_id",
                "exact_text",
                "requested_fragment",
                "reason_code",
              ],
              additionalProperties: false,
            },
          },
          retrieval_sources_used: { type: "array", items: { type: "string" } },
        },
        required: ["response_parts", "retrieval_sources_used"],
        additionalProperties: false,
      },
    },
  },
  mentor: {
    // Deliberately small. The mentor speaks two to four sentences; a large
    // budget invites it to start teaching, which is exactly what it must not do
    // mid-case.
    maxOutputTokens: 600,
    format: {
      type: "json_schema",
      name: "onqol_mentor_reply",
      strict: true,
      schema: {
        type: "object",
        properties: {
          mode: {
            type: "string",
            enum: [
              "CONTINUE",
              "REINFORCE",
              "CLARIFY",
              "CHALLENGE",
              "TEACH",
              "SAFETY_STOP",
            ],
          },
          issue_id: { type: ["string", "null"] },
          mentor_text: { type: "string" },
          question_domain: { type: ["string", "null"] },
          factual_claims: {
            type: "array",
            items: {
              type: "object",
              properties: {
                source_id: { type: "string" },
                text: { type: "string" },
              },
              required: ["source_id", "text"],
              additionalProperties: false,
            },
          },
        },
        required: ["mode", "issue_id", "mentor_text", "factual_claims", "question_domain"],
        additionalProperties: false,
      },
    },
  },
});

const MAX_BODY_BYTES = 750_000;
const REQUESTS_PER_MINUTE = 40;
const REQUESTS_PER_DAY = 1_000;

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
  const value = req.headers?.authorization || "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

function originAllowed(req, configuredOrigin) {
  const origin = req.headers?.origin;
  if (!origin) return true;
  if (configuredOrigin) return origin === configuredOrigin;
  const forwardedHost = req.headers?.["x-forwarded-host"];
  const host = Array.isArray(forwardedHost)
    ? forwardedHost[0]
    : forwardedHost || req.headers?.host;
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

export function extractOpenAIResponseText(payload) {
  return (payload?.output || [])
    .filter((item) => item?.type === "message")
    .flatMap((item) => item.content || [])
    .filter((content) => content?.type === "output_text")
    .map((content) => content.text || "")
    .join("")
    .trim();
}

export function buildOpenAIRequest({ task, prompt, models = DEFAULT_MODELS }) {
  const taskConfig = TASKS[task];
  if (!taskConfig) {
    const error = new Error("Unsupported ON QOL model task.");
    error.statusCode = 400;
    throw error;
  }
  if (typeof prompt?.system !== "string" || typeof prompt?.user !== "string") {
    const error = new Error("Invalid ON QOL prompt envelope.");
    error.statusCode = 400;
    throw error;
  }
  if (prompt.system.length + prompt.user.length > 500_000) {
    const error = new Error("Prompt is too large.");
    error.statusCode = 413;
    throw error;
  }

  return {
    model: models[task],
    reasoning: { effort: "low" },
    instructions: prompt.system,
    input: prompt.user,
    text: { format: taskConfig.format },
    max_output_tokens: taskConfig.maxOutputTokens,
    store: false,
  };
}

export async function requestOpenAI({ apiKey, task, prompt, models, fetchImpl = fetch }) {
  if (!apiKey) {
    const error = new Error("OpenAI backend is not configured.");
    error.statusCode = 503;
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildOpenAIRequest({ task, prompt, models })),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error("Model provider request failed.");
      error.statusCode = 502;
      error.providerStatus = response.status;
      throw error;
    }
    const output = extractOpenAIResponseText(payload);
    if (!output) throw new Error("OpenAI response did not contain text output.");
    return { output, responseId: payload.id || null, model: payload.model || models[task] };
  } finally {
    clearTimeout(timeout);
  }
}

export function createOpenAIGateway(options = {}) {
  const apiKey = options.apiKey || "";
  const accessToken = options.accessToken || "";
  const allowedOrigin = options.allowedOrigin || "";
  const requireAccessControl = options.requireAccessControl === true;
  const accessControlConfigured = !requireAccessControl || Boolean(accessToken && allowedOrigin);
  const models = {
    router: options.routerModel || DEFAULT_MODELS.router,
    simulator: options.simulatorModel || DEFAULT_MODELS.simulator,
    mentor: options.mentorModel || DEFAULT_MODELS.mentor,
  };
  const requestBuckets = new Map();
  const clientBuckets = new Map();
  const requestsPerMinute = options.requestsPerMinute || REQUESTS_PER_MINUTE;
  const requestsPerDay = options.requestsPerDay || REQUESTS_PER_DAY;

  function consumeBucket(store, key, now) {
    const bucket = store.get(key) || {
      minuteStartedAt: now,
      minuteCount: 0,
      dayStartedAt: now,
      dayCount: 0,
    };
    if (now - bucket.minuteStartedAt >= 60_000) {
      bucket.minuteStartedAt = now;
      bucket.minuteCount = 0;
    }
    if (now - bucket.dayStartedAt >= 86_400_000) {
      bucket.dayStartedAt = now;
      bucket.dayCount = 0;
    }
    bucket.minuteCount += 1;
    bucket.dayCount += 1;
    store.set(key, bucket);
    return bucket.minuteCount <= requestsPerMinute && bucket.dayCount <= requestsPerDay;
  }

  function withinRateLimit(req, sessionId) {
    const now = Date.now();
    const forwarded = req.headers?.["x-forwarded-for"];
    const address = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim()
      || req.socket?.remoteAddress
      || "local";
    const tokenFingerprint = bearerToken(req)
      ? createHash("sha256").update(bearerToken(req)).digest("hex").slice(0, 16)
      : "no-token";
    const clientKey = `${address}:${tokenFingerprint}`;
    const sessionKey = `${tokenFingerprint}:${sessionId}`;
    return consumeBucket(clientBuckets, clientKey, now)
      && consumeBucket(requestBuckets, sessionKey, now);
  }

  return async function openAIGateway(req, res, next) {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (!url.pathname.startsWith("/api/v25/openai")) {
      if (next) return next();
      return json(res, 404, { error: "Not found." });
    }

    if (!accessControlConfigured) {
      return json(res, 503, { error: "ON QOL API access control is not configured." });
    }
    if (!originAllowed(req, allowedOrigin)) {
      return json(res, 403, { error: "Origin is not allowed." });
    }

    if (req.method === "GET" && url.pathname === "/api/v25/openai/status") {
      return json(res, 200, {
        configured: Boolean(apiKey),
        accessRequired: Boolean(accessToken),
        originRestricted: Boolean(allowedOrigin),
        provider: "openai",
        gatewayVersion: OPENAI_GATEWAY_VERSION,
        routerModel: models.router,
        simulatorModel: models.simulator,
        mentorModel: models.mentor,
        schemas: {
          router: { version: ROUTER_SCHEMA_VERSION, ready: true },
          simulator: { version: SIMULATOR_SCHEMA_VERSION, ready: true },
          mentor: { version: MENTOR_SCHEMA_VERSION, ready: true },
        },
      });
    }

    if (req.method !== "POST" || url.pathname !== "/api/v25/openai") {
      return json(res, 405, { error: "Method not allowed." });
    }
    if (accessToken && !tokenMatches(bearerToken(req), accessToken)) {
      return json(res, 401, { error: "Invalid ON QOL access code." });
    }
    const sessionId = String(req.headers?.["x-onqol-session-id"] || "");
    if (!/^[a-zA-Z0-9:_-]{8,128}$/.test(sessionId)) {
      return json(res, 400, { error: "A valid ON QOL session id is required." });
    }
    if (!withinRateLimit(req, sessionId)) return json(res, 429, { error: "Too many model requests." });

    try {
      const body = await readJson(req);
      const result = await requestOpenAI({
        apiKey,
        task: body.task,
        prompt: body.prompt,
        models,
        fetchImpl: options.fetchImpl,
      });
      return json(res, 200, result);
    } catch (error) {
      const statusCode = Number(error.statusCode) || (error.name === "AbortError" ? 504 : 500);
      const safeMessage = [400, 413].includes(statusCode)
        ? error.message
        : statusCode === 504
          ? "Model service timed out."
          : "Model service is temporarily unavailable.";
      return json(res, statusCode, { error: safeMessage });
    }
  };
}

export { DEFAULT_MODELS };

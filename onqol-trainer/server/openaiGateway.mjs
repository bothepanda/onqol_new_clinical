const DEFAULT_MODELS = Object.freeze({
  router: "gpt-5.6-luna",
  simulator: "gpt-5.6-terra",
  // The mentor only rephrases an authored brief. It needs fluency, not
  // clinical reasoning: the clinical content is decided before it is called.
  mentor: "gpt-5.6-luna",
});

const TASKS = Object.freeze({
  router: {
    maxOutputTokens: 2400,
    format: {
      type: "json_schema",
      name: "onqol_action_extraction",
      strict: true,
      schema: {
        type: "object",
        properties: {
          intents: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: {
                  type: "string",
                  enum: [
                    "request_history",
                    "request_examination",
                    "request_test",
                    "diagnosis",
                    "management",
                    "question",
                    "unknown",
                  ],
                },
                concept_id: { type: ["string", "null"] },
                confidence: { type: "number" },
              },
              required: ["type", "concept_id", "confidence"],
              additionalProperties: false,
            },
          },
          unresolved_fragments: { type: "array", items: { type: "string" } },
          // Reasoning extraction. Structured output is strict, so a field the
          // schema does not name cannot be returned no matter what the prompt
          // asks for - the prompt and this schema have to be changed together.
          //
          // Every field is a record that the learner made a claim. The router is
          // instructed never to judge whether the claim is medically right, and
          // the client normalises this defensively before anything reads it.
          reasoning: {
            type: "object",
            properties: {
              stability: {
                type: "object",
                properties: {
                  stated: { type: "boolean" },
                  learner_assessment: {
                    type: ["string", "null"],
                    enum: ["stable", "unstable", "uncertain", null],
                  },
                },
                required: ["stated", "learner_assessment"],
                additionalProperties: false,
              },
              problem_representation_stated: { type: "boolean" },
              working_diagnosis: {
                type: "object",
                properties: {
                  stated: { type: "boolean" },
                  concept_id: { type: ["string", "null"] },
                  uncertainty_stated: { type: "boolean" },
                },
                required: ["stated", "concept_id", "uncertainty_stated"],
                additionalProperties: false,
              },
              differential: {
                type: "object",
                properties: {
                  stated: { type: "boolean" },
                  ranked: { type: "boolean" },
                  has_dangerous_alternative: { type: "boolean" },
                  concept_ids: { type: "array", items: { type: "string" } },
                },
                required: ["stated", "ranked", "has_dangerous_alternative", "concept_ids"],
                additionalProperties: false,
              },
              test_reasoning: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    concept_id: { type: "string" },
                    purpose_stated: { type: "boolean" },
                    management_consequence_stated: { type: "boolean" },
                  },
                  required: ["concept_id", "purpose_stated", "management_consequence_stated"],
                  additionalProperties: false,
                },
              },
              management: {
                type: "object",
                properties: {
                  plan_stated: { type: "boolean" },
                  urgency_stated: { type: "boolean" },
                  rationale_stated: { type: "boolean" },
                },
                required: ["plan_stated", "urgency_stated", "rationale_stated"],
                additionalProperties: false,
              },
              observation: {
                type: "object",
                properties: {
                  active: { type: "boolean" },
                  goal_stated: { type: "boolean" },
                  reassessment_interval_stated: { type: "boolean" },
                  escalation_criteria_stated: { type: "boolean" },
                },
                required: [
                  "active",
                  "goal_stated",
                  "reassessment_interval_stated",
                  "escalation_criteria_stated",
                ],
                additionalProperties: false,
              },
              reassessment_stated: { type: "boolean" },
              contingency_stated: { type: "boolean" },
              disposition: {
                type: "object",
                properties: {
                  stated: { type: "boolean" },
                  destination: {
                    type: ["string", "null"],
                    enum: [
                      "home",
                      "ward",
                      "or",
                      "icu",
                      "observation",
                      "other_service",
                      "transfer",
                      null,
                    ],
                  },
                },
                required: ["stated", "destination"],
                additionalProperties: false,
              },
              consultation: {
                type: "object",
                properties: {
                  own_assessment_stated: { type: "boolean" },
                  consultation_question_stated: { type: "boolean" },
                },
                required: ["own_assessment_stated", "consultation_question_stated"],
                additionalProperties: false,
              },
            },
            required: [
              "stability",
              "problem_representation_stated",
              "working_diagnosis",
              "differential",
              "test_reasoning",
              "management",
              "observation",
              "reassessment_stated",
              "contingency_stated",
              "disposition",
              "consultation",
            ],
            additionalProperties: false,
          },
        },
        required: ["intents", "unresolved_fragments", "reasoning"],
        additionalProperties: false,
      },
    },
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
              },
              required: ["classification", "source_id", "exact_text"],
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
          mentor_text: { type: "string" },
        },
        required: ["mentor_text"],
        additionalProperties: false,
      },
    },
  },
});

const MAX_BODY_BYTES = 750_000;
const REQUESTS_PER_MINUTE = 40;

function json(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
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
  if (!taskConfig) throw new Error("Unsupported ON QOL model task.");
  if (typeof prompt?.system !== "string" || typeof prompt?.user !== "string") {
    throw new Error("Invalid ON QOL prompt envelope.");
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
      const error = new Error(payload?.error?.message || `OpenAI request failed (${response.status}).`);
      error.statusCode = response.status;
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
  const models = {
    router: options.routerModel || DEFAULT_MODELS.router,
    simulator: options.simulatorModel || DEFAULT_MODELS.simulator,
    mentor: options.mentorModel || DEFAULT_MODELS.mentor,
  };
  const requestBuckets = new Map();

  function withinRateLimit(req) {
    const now = Date.now();
    const key = req.socket?.remoteAddress || "local";
    const bucket = requestBuckets.get(key) || { windowStartedAt: now, count: 0 };
    if (now - bucket.windowStartedAt >= 60_000) {
      bucket.windowStartedAt = now;
      bucket.count = 0;
    }
    bucket.count += 1;
    requestBuckets.set(key, bucket);
    return bucket.count <= REQUESTS_PER_MINUTE;
  }

  return async function openAIGateway(req, res, next) {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (!url.pathname.startsWith("/api/v25/openai")) {
      if (next) return next();
      return json(res, 404, { error: "Not found." });
    }

    if (req.method === "GET" && url.pathname === "/api/v25/openai/status") {
      return json(res, 200, {
        configured: Boolean(apiKey),
        provider: "openai",
        routerModel: models.router,
        simulatorModel: models.simulator,
        mentorModel: models.mentor,
      });
    }

    if (req.method !== "POST" || url.pathname !== "/api/v25/openai") {
      return json(res, 405, { error: "Method not allowed." });
    }
    if (!withinRateLimit(req)) return json(res, 429, { error: "Too many model requests." });

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
      return json(res, statusCode, { error: error.message || "OpenAI gateway error." });
    }
  };
}

export { DEFAULT_MODELS };

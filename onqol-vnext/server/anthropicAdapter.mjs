// API contract: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
export function anthropicRequest(body, config, apiKey) {
  if (body.responseFormat?.type !== "json_schema" || !body.responseFormat.json_schema?.schema) throw new Error("provider_error");
  if (body.messages.some((m) => !["system", "user", "assistant"].includes(m.role) || typeof m.content !== "string")) throw new Error("provider_error");
  const schema = structuredClone(body.responseFormat.json_schema.schema);
  collapseClinicalActions(schema);
  // The local task validator still enforces confidence in [0, 1].
  const confidence = schema.properties?.meta?.properties?.confidence;
  if (confidence?.minimum === 0 && confidence?.maximum === 1) {
    delete confidence.minimum;
    delete confidence.maximum;
    confidence.description = "Confidence must be between 0 and 1 inclusive.";
  }
  return {
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model: config.model, max_tokens: config.maxCompletionTokens,
      system: body.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n"),
      messages: body.messages.filter((m) => m.role !== "system"),
      output_config: { format: { type: "json_schema", schema } } }),
  };
}

/**
 * Transport-only flattening of the per-command-type `anyOf`.
 *
 * The frozen wire schema describes one branch per command type. Anthropic
 * compiles a response schema into a grammar and rejects that shape outright
 * ("the compiled grammar is too large", and before it the 16-union-parameter
 * limit), so no completion is possible at all. One object carrying a `type`
 * enum plus the union of every branch's parameters compiles, and nullable
 * parameters become optional typed properties rather than `["string","null"]`
 * unions.
 *
 * This deliberately widens what the PROVIDER may emit: the transport no longer
 * states which parameters belong to which command type. It does not widen what
 * the simulator accepts. `validateModelConcepts` rejects every parameter that
 * is not allowlisted for the emitted command type
 * (`params.<key>_not_allowlisted`, which clears `eligibleForBinding`), and
 * `validateCommand` still requires the type's own required parameters, so a
 * cross-type parameter can never reach the core. High-risk parameters are
 * absent from the schema upstream and stay absent here.
 *
 * OpenAI keeps the frozen Wave 2.3 wire contract untouched: this runs only on
 * the Anthropic path.
 */
function collapseClinicalActions(schema) {
  const items = schema.properties?.clinicalActions?.items;
  const branches = items?.anyOf;
  if (!Array.isArray(branches) || !branches.length) return;
  const commandTypes = [];
  const properties = {};
  for (const branch of branches) {
    commandTypes.push(...(branch.properties?.type?.enum ?? []));
    for (const [key, field] of Object.entries(branch.properties?.params?.properties ?? {})) {
      if (Array.isArray(field.type)) field.type = field.type.find((type) => type !== "null") ?? field.type[0];
      properties[key] ??= field;
    }
  }
  const template = branches[0];
  schema.properties.clinicalActions.items = {
    type: "object", additionalProperties: false, required: template.required,
    properties: {
      type: { type: "string", enum: commandTypes },
      // Every parameter is optional here; the command type decides which ones
      // are legal, and that decision is enforced locally, not on the wire.
      params: { type: "object", additionalProperties: false, required: [], properties },
      evidenceSpans: template.properties.evidenceSpans,
      statedParameters: template.properties.statedParameters,
    },
  };
}

export function anthropicResponse(data) {
  if (data.stop_reason !== "end_turn" || !Array.isArray(data.content) || data.content.length !== 1 || data.content[0].type !== "text") throw new Error("provider_error");
  return { model: data.model, choices: [{ message: { content: data.content[0].text } }],
    usage: { prompt_tokens: data.usage?.input_tokens, completion_tokens: data.usage?.output_tokens } };
}

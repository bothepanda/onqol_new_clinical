import { HIGH_RISK_PARAMETER_KEYS } from "./deterministicParameterBinder.js";
import { ACTION_RESPONSE_FORMAT } from "./semanticTaskSchemas.js";

// A separate transport schema preserves the frozen Wave 2.3 wire contract.
export function stage2ActionFormat(allowlist) {
  const schema = structuredClone(ACTION_RESPONSE_FORMAT.json_schema.schema);
  schema.properties.clinicalActions.items = { anyOf: allowlist.commandTypes.map((type) => {
    const keys = (allowlist.parameterSchemas[type] ?? []).filter((key) => !HIGH_RISK_PARAMETER_KEYS.includes(key) && key !== "bolus");
    const properties = Object.fromEntries(keys.map((key) => [key,
      ["analytes", "targets"].includes(key)
        ? { type: ["array", "null"], items: { type: "string" } }
        : key === "untilNextPending" ? { type: ["boolean", "null"] } : { type: ["string", "null"] },
    ]));
    return { type: "object", additionalProperties: false,
      required: ["type", "params", "evidenceSpans", "statedParameters"],
      properties: {
        type: { type: "string", enum: [type] },
        params: { type: "object", additionalProperties: false, required: keys, properties },
        evidenceSpans: { type: "array", items: { type: "string" }, minItems: 1 },
        statedParameters: schema.properties.clinicalActions.items.properties.statedParameters,
      } };
  }) };
  for (const key of ["ambiguities", "unresolvedFragments"]) {
    schema.properties[key].items.required = ["evidenceSpan", "reason", "explanation"];
    schema.properties[key].items.properties.explanation.type = ["string", "null"];
    schema.properties[key].items.properties.reason.type = "string";
  }
  schema.properties.meta.properties.schemaVersion.type = "string";
  return { type: "json_schema", json_schema: { name: "onqol_stage2_action", strict: true, schema } };
}

export function normalizeStage2Output(output) {
  if (!output || typeof output !== "object" || !Array.isArray(output.clinicalActions)) return output;
  return { ...output, clinicalActions: output.clinicalActions.map((action) => {
    if (!action?.params || typeof action.params !== "object" || Array.isArray(action.params)) return action;
    return { ...action, params: Object.fromEntries(Object.entries(action.params).filter(([, value]) => value !== null)) };
  }) };
}

export function stage2SafeContext(request) {
  const payload = JSON.parse(request.messages[1].content);
  const open = payload.openStaffClarification;
  if (open) {
    const allowed = new Set(request.allowlist.parameterSchemas[open.commandType] ?? []);
    payload.openStaffClarification = {
      commandType: request.allowlist.commandTypes.includes(open.commandType) ? open.commandType : null,
      missing: (open.missing ?? []).filter((key) => allowed.has(key)),
      params: Object.fromEntries(Object.entries(open.params ?? {}).filter(([key, value]) => allowed.has(key)
        && (["string", "number", "boolean"].includes(typeof value) || (Array.isArray(value) && value.every((v) => typeof v === "string"))))),
    };
  }
  request.messages[1].content = JSON.stringify(payload);
}

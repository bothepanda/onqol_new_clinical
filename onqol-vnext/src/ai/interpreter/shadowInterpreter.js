import { interpretWithModel } from "./modelInterpreter.js";
import { compareInterpretations } from "./shadowComparison.js";

export async function runInterpreterShadow({ provider, text, locale, learnerVisible, turnContext, bundle, deterministic }) {
  const startedAt = Date.now();
  let modelResult;
  try {
    modelResult = await interpretWithModel({ provider, text, locale, learnerVisible, turnContext, bundle });
  } catch (error) {
    return emptyTelemetry({
      status: "normalization_failure",
      elapsedMs: Date.now() - startedAt,
      errorCode: errorCode(error),
    });
  }

  let comparison = null;
  if (modelResult.output) {
    try {
      comparison = compareInterpretations({ deterministic, modelResult });
    } catch (error) {
      return telemetryFromResult({
        modelResult,
        status: "comparison_failure",
        comparison: null,
        elapsedMs: Date.now() - startedAt,
        errorCode: errorCode(error),
      });
    }
  }

  return telemetryFromResult({
    modelResult,
    status: modelResult.status,
    comparison,
    elapsedMs: Date.now() - startedAt,
    errorCode: modelResult.errorCode ?? null,
  });
}

function telemetryFromResult({ modelResult, status, comparison, elapsedMs, errorCode }) {
  return {
    kind: "interaction_shadow",
    status,
    clinicalAuthority: "none",
    executedSource: "deterministic",
    elapsedMs,
    errorCode,
    schemaErrors: modelResult.schemaErrors ?? [],
    conceptErrors: modelResult.conceptErrors ?? [],
    actionValidation: modelResult.actionValidation ?? [],
    commandValidation: modelResult.commandValidation ?? [],
    bindingDiagnostics: modelResult.bindingDiagnostics ?? [],
    proposedCommands: modelResult.proposedCommands ?? [],
    boundCommands: modelResult.boundCommands ?? [],
    acceptedCommands: modelResult.acceptedCommands ?? [],
    inventions: modelResult.inventions ?? emptyInventions(),
    comparison,
    modelOutput: modelResult.output,
    normalizedReasoning: modelResult.normalizedReasoning ?? {},
    parsedProviderOutput: modelResult.parsedOutput ?? null,
    rawProviderOutput: modelResult.rawOutput ?? null,
    rawProviderPayload: modelResult.providerEvidence?.rawProviderPayload ?? null,
    providerMeta: modelResult.providerEvidence?.returnedModelMetadata ?? modelResult.providerMeta ?? null,
    providerEvidenceCaptured: modelResult.providerEvidence?.captured === true,
    providerEvidence: modelResult.providerEvidence ?? null,
  };
}

function emptyTelemetry({ status, elapsedMs, errorCode }) {
  return {
    kind: "interaction_shadow", status, clinicalAuthority: "none", executedSource: "deterministic", elapsedMs, errorCode,
    schemaErrors: [], conceptErrors: [], actionValidation: [], commandValidation: [], bindingDiagnostics: [],
    proposedCommands: [], boundCommands: [], acceptedCommands: [], inventions: emptyInventions(), comparison: null,
    modelOutput: null, normalizedReasoning: {}, parsedProviderOutput: null, rawProviderOutput: null, rawProviderPayload: null,
    providerMeta: null, providerEvidenceCaptured: false, providerEvidence: null,
  };
}

function emptyInventions() {
  return {
    highRisk: [], inventedNumericParameterCount: 0,
    beforeBinder: { highRisk: [], inventedNumericParameterCount: 0 },
    afterBinder: { highRisk: [], inventedNumericParameterCount: 0 },
  };
}
function errorCode(error) { return String(error?.code ?? error?.message ?? error?.name ?? "processing_error").slice(0, 160); }

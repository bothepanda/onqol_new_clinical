import { routeUserInput } from "./semanticRouter.js";

export const ACTION_EXTRACTOR_VERSION = "0.3.1";

export async function extractLearnerActions(input, caseData, session, options = {}) {
  const parsed = await routeUserInput(input, caseData, session, {
    ...options,
    llm: options.llm || options.actionExtractorLLM,
  });
  const confidences = parsed.actions
    .map((action) => Number(action.confidence))
    .filter(Number.isFinite);

  return {
    ...parsed,
    parserConfidence:
      confidences.length > 0
        ? confidences.reduce((sum, confidence) => sum + confidence, 0) / confidences.length
        : 0,
    routerVersion: options.routerVersion || caseData.router_version || ACTION_EXTRACTOR_VERSION,
  };
}

import { scoreSession } from "../scoring.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function scoreV25Session(caseData, session) {
  const base = scoreSession(caseData, session);
  const delayPenalty = session.temporalState?.flags?.includes("delay_risk") && !session.temporalState.sourceControl ? 6 : 0;
  const prerequisitePenalty = (session.prerequisiteWarnings || []).length * 2;
  const temporalPenalty = delayPenalty + prerequisitePenalty;
  const overallScore = clamp(base.overallScore - temporalPenalty, 0, 100);
  const domainScores = { ...base.domainScores };

  // A domain with nothing to score stays `null`; a penalty cannot drag an
  // unmeasured domain down from an imaginary 100.
  if (temporalPenalty && Number.isFinite(domainScores.Prioritization)) {
    domainScores.Prioritization = clamp(domainScores.Prioritization - temporalPenalty, 0, 100);
  }

  return {
    ...base,
    overallScore,
    domainScores,
    temporalPenalty,
    delayPenalty,
    prerequisitePenalty,
    temporalFlags: session.temporalState?.flags || [],
  };
}

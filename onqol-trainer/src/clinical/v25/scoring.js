import { scoreSession } from "../scoring.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function scoreV25Session(caseData, session) {
  const base = scoreSession(caseData, session);

  // Waiting is not a mistake.
  //
  // The delay penalty used to fire whenever the case raised `delay_risk`, and in
  // the first live run that flag came from a six-hour ultrasound queue the
  // learner neither caused nor could shorten. Docking points for a hospital's
  // night shift teaches nothing except that the trainer is unfair.
  //
  // What IS assessable is what the learner did about it - monitoring, an
  // alternative route, escalation. None of those are modelled yet, so nothing is
  // charged: the delay is reported as a flag and left to the debrief.
  const delayPenalty = 0;
  const systemDelayMinutes = (session.eventLog || [])
    .flatMap((entry) => entry.time_cost_breakdown || [])
    .reduce((sum, entry) => sum + (entry.queue_delay_minutes || 0), 0);
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
    // Minutes the learner waited because of the shift, not because of a
    // decision. Reported so a debrief can say so out loud.
    systemDelayMinutes,
    temporalFlags: session.temporalState?.flags || [],
  };
}

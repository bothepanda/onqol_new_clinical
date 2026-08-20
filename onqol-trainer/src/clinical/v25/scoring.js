import { scoreSession } from "../scoring.js";
import { reasoningFlags } from "../core/reasoningState.js";

export const FORMATIVE_DOMAINS = Object.freeze([
  Object.freeze({
    id: "stability_safety",
    title_ru: "Стабильность и безопасность",
    signals: Object.freeze([
      Object.freeze({ id: "stability_stated", label_ru: "оценка стабильности сформулирована" }),
    ]),
  }),
  Object.freeze({
    id: "problem_representation",
    title_ru: "Представление проблемы",
    signals: Object.freeze([
      Object.freeze({
        id: "problem_representation_stated",
        label_ru: "краткое представление проблемы сформулировано",
      }),
    ]),
  }),
  Object.freeze({
    id: "differential",
    title_ru: "Дифференциальный диагноз",
    signals: Object.freeze([
      Object.freeze({ id: "differential_stated", label_ru: "дифференциальный ряд сформулирован" }),
      Object.freeze({
        id: "dangerous_alternative_named",
        label_ru: "опасная альтернатива названа",
      }),
    ]),
  }),
  Object.freeze({
    id: "test_purpose",
    title_ru: "Цель исследований",
    signals: Object.freeze([
      Object.freeze({ id: "investigation_justified", label_ru: "цель исследования обоснована" }),
    ]),
  }),
  Object.freeze({
    id: "management_reasoning",
    title_ru: "Обоснование тактики",
    signals: Object.freeze([
      Object.freeze({ id: "management_plan_stated", label_ru: "план ведения сформулирован" }),
      Object.freeze({ id: "management_rationale_stated", label_ru: "обоснование плана сформулировано" }),
    ]),
  }),
  Object.freeze({
    id: "reassessment",
    title_ru: "Переоценка",
    signals: Object.freeze([
      Object.freeze({ id: "reassessment_stated", label_ru: "переоценка запланирована" }),
    ]),
  }),
  Object.freeze({
    id: "contingency_escalation",
    title_ru: "Условия изменения плана и эскалация",
    signals: Object.freeze([
      Object.freeze({ id: "contingency_stated", label_ru: "условие изменения плана сформулировано" }),
      Object.freeze({
        id: "consultation_question_stated",
        label_ru: "цель консультации сформулирована",
      }),
    ]),
  }),
  Object.freeze({
    id: "disposition",
    title_ru: "Маршрутизация",
    signals: Object.freeze([
      Object.freeze({ id: "disposition_stated", label_ru: "маршрутизация сформулирована" }),
    ]),
  }),
]);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function scoreV25Session(caseData, session) {
  const systemDelayMinutes = (session.eventLog || [])
    .flatMap((entry) => entry.time_cost_breakdown || [])
    .reduce((sum, entry) => sum + (entry.queue_delay_minutes || 0), 0);

  if (caseData.scoring?.eligible_for_scoring === false) {
    const observedFlags = reasoningFlags(session.workingMemory?.reasoningState);
    return {
      eligibleForScoring: false,
      mode: "formative_only",
      reviewStatus: caseData.scoring.review_status || "unvalidated",
      overallScore: null,
      domainScores: Object.fromEntries(FORMATIVE_DOMAINS.map((domain) => [domain.id, null])),
      formativeDomains: FORMATIVE_DOMAINS.map((domain) => ({
        id: domain.id,
        title_ru: domain.title_ru,
        signals: domain.signals.map((signal) => ({
          ...signal,
          observed: observedFlags.has(signal.id),
        })),
      })),
      completed: [...(session.completedActions || [])],
      missedExpected: [],
      missedCritical: [],
      unsafeActions: [...(session.unsafeActions || [])],
      unnecessaryActions: [...(session.unnecessaryActions || [])],
      criticalErrorFlag: null,
      criticalErrors: [],
      unsafeActionsPerformed: [],
      criticalOmissions: [],
      criticalOmissionsSuppressed: [],
      earned: null,
      penalties: null,
      maxExpected: null,
      temporalPenalty: null,
      delayPenalty: null,
      prerequisitePenalty: null,
      systemDelayMinutes,
      temporalFlags: session.temporalState?.flags || [],
    };
  }

  const base = scoreSession(caseData, session);

  // Waiting is not a mistake. A system queue is reported, not charged.
  const delayPenalty = 0;
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

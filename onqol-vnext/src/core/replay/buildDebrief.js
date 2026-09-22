import { EVENT } from "../events/eventTypes.js";
import { reviewStatusOf, authorityLayerOf, jurisdictionOf, isJurisdictional } from "../rules/contentProvenance.js";
import { hasWorkingDiagnosis } from "../reasoning/reasoningState.js";
import { isLearnerFacingSessionApproved } from "../session/sessionPurpose.js";

/**
 * Formative debrief v1 (task brief §15, Contract §25, Mentor Spec §21).
 *
 * Built ENTIRELY from the event log - never from a language model
 * remembering the conversation (Core Runtime Spec §62). That is what
 * prevents the failure mode the foundation spec calls out by name: telling a
 * learner they never ordered antibiotics when they did order them and the
 * simulator failed to execute it.
 *
 * NO NUMERICAL SCORE. Governance Spec §22 is explicit that a score must not
 * be presented as competence until the rubric is validated for the intended
 * population, and it has not been.
 *
 * The five categories the task brief requires be kept apart:
 *
 *   observedBehavior    what the learner actually did, with timestamps
 *   clinicalCorrectness only where an APPROVED rule fired - nothing else
 *   resourceLimitation  what the hospital could not provide
 *   simulatorLimitation what the SOFTWARE could not model
 *   educationalNotes    interpretation, clearly labelled as such
 *
 * The distinction that matters most is the last two: a simulator limitation
 * must never appear as a learner omission (task §21, Contract §25).
 */
export function buildDebrief({ session, bundle }) {
  const { state, events } = session;

  return {
    schema_version: "1.0.0",
    session: { id: state.session.id, status: state.session.status, endpoint: state.session.endpoint },
    caseSummary: buildCaseSummary(state, events),
    observedBehavior: buildObservedBehavior(events),
    whatWentWell: buildStrengths(state, events),
    importantMisses: buildMisses(state, bundle),
    jurisdictionNotes: buildJurisdictionNotes(state, bundle),
    consequences: buildConsequences(events),
    referenceComparison: buildReferenceComparison(bundle),
    resourceLimitations: buildResourceLimitations(events),
    simulatorLimitations: buildSimulatorLimitations(state),
    // Review matrix §G1 / task §3: a build running non-approved patient truth
    // must say so wherever it reports on itself.
    contentGovernance: buildContentGovernance(state),
    learningObjectives: buildLearningObjectives(state),
    reading: buildReading(bundle),
    // Deliberately absent: any numeric competence score (Governance Spec §22).
  };
}

function buildJurisdictionNotes(state, bundle) {
  const context = state.session.jurisdictionContext;
  if (!context || state.hospital.jurisdiction === context) return [];
  const requirements = (bundle.operative?.preop_requirements ?? []).filter(
    (item) => isJurisdictional(item) && jurisdictionOf(item) === context,
  );
  return requirements
    .filter((item) => !state.preop.completed.includes(item.id))
    .map((item) => ({
      kind: "jurisdiction_workflow_note",
      itemId: item.id,
      jurisdiction: context,
      pointRu: `Требование рабочего процесса РК: ${item.label_ru}.`,
      noteRu: "Это не универсальное требование evidence-based маршрута Reference Hospital и не блокировало операцию.",
      sourceIds: item.source_ids ?? [],
    }));
}

function buildCaseSummary(state, events) {
  const terminal = events.find((event) =>
    [EVENT.PATIENT_DISCHARGED, EVENT.PATIENT_TRANSFERRED, EVENT.PATIENT_DIED].includes(event.type),
  );
  return {
    totalCaseMinutes: state.clock.elapsedMinutes,
    endpointType: terminal?.type ?? "incomplete",
    hospitalMode: state.session.mode,
    hospitalProfileId: state.hospital.profileId,
    operativeApproach: state.operative.approach,
    sourceControlAchieved: state.operative.sourceControl,
    disposition: state.postop.disposition,
  };
}

/** Every learner action, in order, with the hospital time it happened at. */
function buildObservedBehavior(events) {
  const OBSERVED = [
    EVENT.HISTORY_OBTAINED,
    EVENT.EXAMINATION_PERFORMED,
    EVENT.PATIENT_REASSESSED,
    EVENT.TEST_ORDERED,
    EVENT.MEDICATION_ADMINISTERED,
    EVENT.INFUSION_STARTED,
    EVENT.MONITORING_PRESCRIBED,
    EVENT.STAFF_CALLED,
    EVENT.MANAGEMENT_PLAN_COMMITTED,
    EVENT.PREOP_ITEM_COMPLETED,
    EVENT.CONSENT_OBTAINED,
    EVENT.PROCEDURE_STARTED,
    EVENT.OPERATIVE_DECISION_MADE,
    EVENT.PATIENT_MOVED,
  ];
  return events
    .filter((event) => OBSERVED.includes(event.type) && event.cause.actor === "learner")
    .map((event) => ({
      atMinutes: event.atMinutes,
      atIso: event.atIso,
      type: event.type,
      detail: summarizePayload(event),
      commandId: event.cause.commandId ?? null,
    }));
}

/**
 * Strengths, evidence-supported only (task brief §15.A). Each entry names
 * the event that justifies it, so nothing here is an unbacked compliment.
 */
function buildStrengths(state, events) {
  const strengths = [];
  const at = (type) => events.find((event) => event.type === type);

  const history = at(EVENT.HISTORY_OBTAINED);
  const exam = events.find((event) => event.type === EVENT.EXAMINATION_PERFORMED);
  if (history && exam) {
    strengths.push({
      pointRu: "Анамнез и осмотр выполнены до назначения исследований и лечения.",
      evidence: [{ type: history.type, atMinutes: history.atMinutes }, { type: exam.type, atMinutes: exam.atMinutes }],
    });
  }

  const reassessments = events.filter((event) => event.type === EVENT.PATIENT_REASSESSED);
  if (reassessments.length >= 2) {
    strengths.push({
      pointRu: `Переоценка пациента выполнена ${reassessments.length} раза — состояние отслеживалось во времени, а не однократно.`,
      evidence: reassessments.map((event) => ({ type: event.type, atMinutes: event.atMinutes })),
    });
  }

  if (state.operative.sourceControl) {
    const decision = at(EVENT.OPERATIVE_DECISION_MADE);
    strengths.push({
      pointRu: "Контроль источника достигнут.",
      evidence: decision ? [{ type: decision.type, atMinutes: decision.atMinutes }] : [],
    });
  }

  if (state.monitoring.prescribed.length > 0) {
    strengths.push({
      pointRu: "Назначен план послеоперационного наблюдения, а не только маршрут пациента.",
      evidence: [{ type: EVENT.MONITORING_PRESCRIBED, parameters: state.monitoring.prescribed }],
    });
  }

  return strengths;
}

/**
 * Misses. Deliberately narrow.
 *
 * Only two classes appear here, and neither invents medicine:
 *  1. preoperative items the CONTENT declared and the learner did not do -
 *     an omission relative to authored requirements, not model memory;
 *  2. structural workflow facts (no monitoring plan on a ward patient).
 *
 * Clinical corrections that would require an approved rule are NOT generated
 * here, because no rule in the current bundle is `approved_for_training` -
 * see `simulatorLimitations` instead. That gap is reported honestly rather
 * than filled with plausible teaching.
 *
 * TWO REMEDIATION CHANGES (2026-08-25):
 *
 *  - `site_marking` is simply gone from the content (matrix PR12), so it can no
 *    longer appear here. Nothing in this function had to change for that,
 *    which is the point of misses being content-driven.
 *  - A jurisdictional requirement is LABELLED as one (matrix §13). "Группа
 *    крови и резус-фактор не назначены" is a Kazakhstan workflow omission, not
 *    a failure of international evidence-based practice, and the debrief must
 *    not blur the two.
 */
function buildMisses(state, bundle) {
  const misses = [];

  if (state.managementPlan.intent === "operative") {
    // `state.preop.required` is the JURISDICTION-FILTERED list committed with
    // the plan; falling back to the full content list would reintroduce KZ
    // items in a non-KZ hospital.
    const required = state.preop.required?.length ? state.preop.required : (bundle.operative.preop_requirements ?? []);
    for (const item of required) {
      if (state.preop.completed.includes(item.id)) continue;
      const jurisdictional = isJurisdictional(item);
      misses.push({
        kind: jurisdictional ? "jurisdictional_workflow_omission" : "preoperative_omission",
        itemId: item.id,
        authorityLayer: authorityLayerOf(item),
        jurisdiction: jurisdictionOf(item),
        pointRu: jurisdictional
          ? `Не оформлено до операции по требованиям юрисдикции (${jurisdictionOf(item)}): ${item.label_ru}.`
          : `Не выполнено до операции: ${item.label_ru}.`,
        noteRu: jurisdictional
          ? "Требование стандарта конкретной юрисдикции/стационара, а не универсальное доказательное правило."
          : null,
        blocking: Boolean(item.blocking),
        sourceIds: item.source_ids ?? [],
        traceableTo: "content:operative.preop_requirements",
      });
    }
  }

  if (state.operative.completed && state.monitoring.adequacy === "inadequate") {
    misses.push({
      kind: "monitoring_omission",
      pointRu: "После операции пациент переведён в отделение без назначенного плана наблюдения.",
      blocking: false,
      traceableTo: "derived:monitoring.adequacy",
    });
  }

  return misses;
}

/**
 * What actually happened to the patient, separated by cause (task §15.C):
 * disease biology, resource constraint, or learner decision. The separation
 * comes from each event's own `cause`, not from re-interpretation.
 */
function buildConsequences(events) {
  return events
    .filter((event) =>
      [EVENT.COMPLICATION_OCCURRED, EVENT.DETERIORATION_DETECTED, EVENT.DISEASE_PROGRESSED, EVENT.TREATMENT_EFFECT_APPLIED].includes(event.type),
    )
    .map((event) => ({
      atMinutes: event.atMinutes,
      type: event.type,
      attribution: attributionOf(event),
      causedBy: { actor: event.cause.actor, commandId: event.cause.commandId, ruleIds: event.cause.ruleIds, source: event.cause.source },
      detail: summarizePayload(event),
    }));
}

function attributionOf(event) {
  if (event.type === EVENT.DISEASE_PROGRESSED) return "disease_natural_course";
  if (event.type === EVENT.TREATMENT_EFFECT_APPLIED) return "learner_treatment";
  if (event.cause.actor === "learner") return "learner_decision";
  return "probabilistic_or_system";
}

/**
 * Comparison against the reference pathway. Only approved content may be
 * cited as "the reference"; nothing here claims a single correct pathway
 * where content supports several (Contract §22.3, Core Runtime Spec §54).
 */
function buildReferenceComparison(bundle) {
  const rules = bundle.rules?.rules ?? [];
  const approved = rules.filter((rule) => reviewStatusOf(rule) === "approved_for_training");
  if (approved.length === 0) {
    return {
      available: false,
      noteRu:
        "Сравнение с эталонным маршрутом не приводится: ни одно клиническое правило в текущем контенте не имеет статуса approved_for_training. Это ограничение симулятора, а не оценка твоих решений.",
    };
  }
  return {
    available: true,
    rules: approved.map((rule) => ({ ruleId: rule.id, claimRu: rule.teaching_point_ru, sourceIds: rule.source_ids })),
  };
}

function buildResourceLimitations(events) {
  return events
    .filter((event) => event.type === EVENT.RESOURCE_CONSTRAINT_REVEALED)
    .map((event) => ({
      atMinutes: event.atMinutes,
      constraintId: event.payload.constraint?.id ?? null,
      textRu: event.payload.constraint?.textRu ?? null,
      noteRu: "Ограничение ресурса стационара. Не является ошибкой обучающегося.",
    }));
}

/**
 * The category that must never be presented as learner failure (task §21).
 */
const NOT_MODELED_LABEL_RU = Object.freeze({ pelvic_ultrasound: "УЗИ органов малого таза" });

function buildSimulatorLimitations(state) {
  const grouped = new Map();
  for (const entry of state.simulatorLimitations) {
    const key = `${entry.kind}:${entry.id}`;
    if (!grouped.has(key)) grouped.set(key, { ...entry, occurrences: 0 });
    grouped.get(key).occurrences += 1;
  }
  return [...grouped.values()].map((entry) => (entry.reason === "not_modeled"
    ? {
        kind: entry.kind,
        id: entry.id,
        reviewStatus: entry.reviewStatus,
        reason: entry.reason,
        occurrences: entry.occurrences,
        pointRu: `${NOT_MODELED_LABEL_RU[entry.id] ?? entry.id}: в этой версии симуляции результат не моделируется.`,
        noteRu:
          "Назначение распознано, но в текущей версии симуляции для него нет утверждённого результата, поэтому оно ничего не изменило. Это ограничение платформы, а не ошибка или пропуск обучающегося.",
      }
    : {
        kind: entry.kind,
        id: entry.id,
        reviewStatus: entry.reviewStatus,
        occurrences: entry.occurrences,
        noteRu:
          "Этот элемент клинического контента ещё не прошёл независимое клиническое рецензирование, поэтому не влиял на симуляцию. Это ограничение платформы, а не пропуск обучающегося.",
      }));
}

/**
 * The release-honesty block (review matrix §G1, §18; task §26.H).
 *
 * A debrief is where a learner or a reviewer forms an impression of how real
 * this simulation is. If the patient was generated from content nobody has
 * approved, and if clinical discharge readiness was never evaluated, the
 * debrief is exactly where that has to be said - not only in a report the
 * learner never opens.
 */
export function buildContentGovernance(state) {
  // Only content withheld for missing approval is a governance matter. An
  // investigation the platform simply does not model is reported separately.
  const kinds = new Set(state.simulatorLimitations.filter((entry) => entry.reason !== "not_modeled").map((entry) => entry.kind));
  return {
    patientTruthApproved: state.session.patientTruthApproved === true,
    pilotReady: isLearnerFacingSessionApproved(state.session),
    noteRu:
      state.session.patientTruthApproved === true
        ? "Клинический контент этого сценария одобрен для обучения."
        : "Этот сценарий работает на клиническом контенте, который ещё не прошёл рецензирование (разработческая сборка). Он не предназначен для пилота с резидентами.",
    withheldKinds: [...kinds],
  };
}

function buildLearningObjectives(state) {
  const objectives = [];
  if (state.managementPlan.intent === "operative" && state.preop.completed.length < (state.preop.required?.length ?? 0)) {
    objectives.push("Отработать полный объём предоперационной подготовки и её обоснование.");
  }
  if (state.observations.examinations.filter((entry) => entry.region === "reassessment").length < 2) {
    objectives.push("Планировать переоценку как отдельное действие с конкретными параметрами и сроком.");
  }
  if (!hasWorkingDiagnosis(state.reasoning)) {
    objectives.push("Формулировать рабочую гипотезу и опасные альтернативы явно, до принятия решения об операции.");
  }
  if (state.operative.completed && state.monitoring.prescribed.length === 0) {
    objectives.push("Назначать план послеоперационного наблюдения вместе с решением о маршруте пациента.");
  }
  return objectives;
}

/** Only registered sources from the disease card (task §15.G). */
function buildReading(bundle) {
  return (bundle.disease?.sources ?? []).map((source) => ({
    id: source.id,
    title: source.title,
    organization: source.organization,
    year: source.publication_year ?? null,
    identifier: source.doi ?? null,
    jurisdiction: source.jurisdiction ?? null,
  }));
}

/**
 * The learner-meaningful part of an event payload: scheduling bookkeeping
 * (`scheduledPending`, `resolvedPendingId`) and internal finding ids are
 * mechanism, not something to show in a debrief.
 */
const PAYLOAD_BOOKKEEPING_KEYS = ["scheduledPending", "resolvedPendingId", "findingIds"];

function summarizePayload(event) {
  return Object.fromEntries(Object.entries(event.payload).filter(([key]) => !PAYLOAD_BOOKKEEPING_KEYS.includes(key)));
}

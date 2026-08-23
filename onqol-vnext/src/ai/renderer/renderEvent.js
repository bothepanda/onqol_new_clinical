import { EVENT } from "../../core/events/eventTypes.js";

/**
 * Turning one domain event into learner-facing Russian text.
 *
 * Foundation Spec §53: "the model may vary phrasing, it may not vary the
 * clinical truth". This renderer is the deterministic, content-driven
 * default - every sentence it produces is assembled from a reviewed
 * template (`content/diseases/.../findings.yaml`, `disease.yaml`) plus a
 * structured value already sitting on the event, never invented. A future
 * LLM rendering pass may vary word choice on top of this (see
 * docs/KNOWN_GAPS.md) but must not be handed anything this function did not
 * already establish as true.
 */
export function renderEvent({ event, bundle, patient }) {
  switch (event.type) {
    case EVENT.PATIENT_ARRIVED:
      return { speakerRu: "Приёмный покой", textRu: event.payload.handoffRu };

    case EVENT.HISTORY_OBTAINED:
      return { speakerRu: "Пациент", textRu: renderHistoryBundle(bundle, patient) };

    case EVENT.EXAMINATION_PERFORMED:
      return { speakerRu: "Осмотр", textRu: renderExamination(event, bundle, patient) };

    case EVENT.PATIENT_REASSESSED:
      return { speakerRu: "Переоценка", textRu: renderReassessment(event, bundle, patient) };

    case EVENT.TEST_ORDERED:
      return {
        speakerRu: "Система",
        textRu: `Назначено: ${labelForTest(event.payload.testId)}. Ожидаемое время результата — ${event.payload.etaMinutes} мин.`,
      };

    case EVENT.TEST_PRELIMINARY_REPORTED:
      return { speakerRu: staffForTest(event.payload.investigationId), textRu: `Предварительно: ${event.payload.preliminary}` };

    case EVENT.TEST_RESULTED:
      return { speakerRu: "Лаборатория/Диагностика", textRu: renderTestResult(event) };

    case EVENT.MEDICATION_ADMINISTERED:
      return { speakerRu: "Медсестра", textRu: `Введено: ${event.payload.drugId} ${event.payload.dose ?? ""} ${event.payload.route ?? ""}`.trim() };

    case EVENT.INFUSION_STARTED:
      return {
        speakerRu: "Медсестра",
        textRu: `Инфузия начата: ${event.payload.fluidId ?? ""} ${event.payload.volumeMl ?? ""} мл${event.payload.durationMinutes ? ` за ${event.payload.durationMinutes} мин` : " болюсно"}.`,
      };

    // Perioperative events previously rendered as `null`, so the learner
    // committed to an operation, completed preparation, and started a
    // procedure to total silence - the UI acknowledged nothing between
    // ordering a CT and the operative finding. Found in the manual smoke
    // session (docs/evidence/APP004_VNEXT_MANUAL_SMOKE_NOTES.md).
    case EVENT.MANAGEMENT_PLAN_COMMITTED:
      return { speakerRu: "Система", textRu: "Решение зафиксировано: оперативная тактика." };

    case EVENT.PREOP_ITEM_COMPLETED:
      return { speakerRu: "Медсестра", textRu: `Выполнено: ${preopLabelRu(event.payload.itemId, bundle)}.` };

    case EVENT.CONSENT_OBTAINED:
      return { speakerRu: "Пациент", textRu: "Согласие на операцию подписано." };

    case EVENT.MONITORING_PRESCRIBED:
      return {
        speakerRu: "Медсестра",
        textRu: `Наблюдение назначено${event.payload.parameters?.length ? `: ${event.payload.parameters.join(", ")}` : ""}.`,
      };

    case EVENT.PROCEDURE_STARTED:
      return { speakerRu: "Операционная", textRu: `Операция начата, доступ — ${approachLabelRu(event.payload.approach)}.` };

    case EVENT.OPERATIVE_DECISION_MADE:
      return { speakerRu: "Операционная", textRu: `Принято: ${operativeChoiceLabelRu(event.payload, bundle)}.` };

    case EVENT.SOURCE_CONTROL_COMPLETED:
      return { speakerRu: "Операционная", textRu: "Источник санирован." };

    case EVENT.PROCEDURE_COMPLETED:
      return { speakerRu: "Операционная", textRu: "Операция завершена. Куда переводим пациента?" };

    case EVENT.PATIENT_MOVED:
      return { speakerRu: "Система", textRu: `Пациент переведён: ${locationLabelRu(event.payload.to)}.` };

    case EVENT.PATIENT_TRANSFERRED:
      return { speakerRu: "Система", textRu: "Пациент переведён в другой стационар." };

    case EVENT.STAFF_CALLED:
      return { speakerRu: "Диспетчер", textRu: `${staffLabelRu(event.payload.role)} вызван(а), ожидаемое время — ${event.payload.etaMinutes} мин.` };

    case EVENT.STAFF_ARRIVED:
      return { speakerRu: staffLabelRu(event.payload.role), textRu: "Я на месте. Что уже сделано?" };

    case EVENT.RESOURCE_CONSTRAINT_REVEALED:
      return { speakerRu: "Система", textRu: event.payload.constraint?.textRu ?? "Ресурс временно недоступен." };

    case EVENT.OPERATIVE_FINDING_REVEALED:
      return { speakerRu: "Операционная", textRu: renderOperativeFinding(event, bundle, patient) };

    case EVENT.DETERIORATION_DETECTED:
      return { speakerRu: "Медсестра", textRu: "Пациенту хуже: " + (event.payload.summaryRu ?? "изменились витальные показатели.") };

    case EVENT.COMPLICATION_OCCURRED:
      return { speakerRu: "Медсестра", textRu: event.payload.presentationRu ?? "Развилось осложнение." };

    case EVENT.PATIENT_DISCHARGED:
      return { speakerRu: "Система", textRu: "Пациент выписан." };

    case EVENT.PATIENT_DIED:
      return { speakerRu: "Система", textRu: "Пациент погиб." };

    default:
      return null; // not every event has learner-facing prose (e.g. bookkeeping events)
  }
}

function renderHistoryBundle(bundle, patient) {
  const template = bundle.findings.history_bundle_ru.template;
  const phenotypeHistory = [
    ...(patient.presentation.historyFixedRu ?? []),
    ...(patient.presentation.historyVariantsRu ?? []),
  ].join(", ");
  return template
    .replace("{onset_hours}", String(Math.round(patient.presentation.onsetHours)))
    .replace("{onset_description}", "постепенно")
    .replace("{phenotype_history}", phenotypeHistory || "без дополнительных уточнений");
}

/**
 * A reassessment reports the parameters the learner actually named
 * (Contract §10, Foundation Spec §12) - not a generic "no significant
 * change".
 *
 * The previous version routed PATIENT_REASSESSED through the ordinary
 * examination renderer, whose `region` for a reassessment is the literal
 * string "reassessment". That is not "abdomen", so every reassessment fell
 * through to the universal normal-exam layer and answered
 * "Клинически значимых изменений нет." even when the learner had explicitly
 * asked to re-examine the abdomen - found in the manual smoke session, not
 * by a test, because every test asserted on state rather than on prose.
 */
const REASSESS_TARGET_LABEL_RU = Object.freeze({
  pain: "боль",
  vitals: "витальные показатели",
  urine_output: "диурез",
  mental_status: "сознание",
});

function renderReassessment(event, bundle, patient) {
  const targets = event.payload.targets ?? [];
  const parts = [];

  if (targets.includes("abdomen_exam")) parts.push(renderAbdominalExam(bundle, patient));

  const named = targets.filter((target) => REASSESS_TARGET_LABEL_RU[target]).map((target) => REASSESS_TARGET_LABEL_RU[target]);
  if (named.length) parts.push(`Переоценены: ${named.join(", ")} — см. текущие показатели.`);

  if (parts.length === 0) parts.push("Пациент осмотрен повторно. Клинически значимых изменений нет.");
  return parts.join(" ");
}

function renderExamination(event, bundle, patient) {
  const region = event.payload.region;
  if (region && region !== "abdomen" && bundle.findings.universal_normal_layer.regions[`${region}_ru`]) {
    return bundle.findings.universal_normal_layer.regions[`${region}_ru`];
  }
  if (region && region !== "abdomen") {
    return bundle.findings.universal_normal_layer.default_ru;
  }
  return renderAbdominalExam(bundle, patient);
}

function renderAbdominalExam(bundle, patient) {
  const slotsById = Object.fromEntries(bundle.findings.exam_slots.map((slot) => [slot.id, slot]));
  const grouped = new Map();
  for (const [slotId, stateValue] of Object.entries(patient.examSlots)) {
    const slot = slotsById[slotId];
    if (!slot) continue;
    const phrase = slot.states[stateValue];
    if (!phrase) continue;
    const filled = phrase.replace(bundle.findings.localisation_token, patient.presentation.painSiteRu);
    if (!grouped.has(slot.group)) grouped.set(slot.group, []);
    grouped.get(slot.group).push(filled);
  }
  const text = [...grouped.values()].map((sentences) => sentences.join(", ") + ".").join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function renderTestResult(event) {
  const { investigationId, result } = event.payload;
  if (typeof result === "string") return `${labelForTest(investigationId)}: ${result}`;
  if (result && typeof result === "object") {
    const parts = Object.entries(result).map(([key, value]) => `${key}: ${value}`);
    return `${labelForTest(investigationId)} — ${parts.join(", ")}`;
  }
  return `${labelForTest(investigationId)}: результат получен.`;
}

function renderOperativeFinding(event, bundle, patient) {
  const step = bundle.operative.operative_sequence.find((s) => s.finding_id === event.payload.findingId);
  if (!step) return patient.truth.operativeTruthRu;
  return step.description_ru.replace("{pelvic_fluid_note}", "") + " " + step.decision_prompt_ru;
}

function labelForTest(testId) {
  const labels = {
    cbc: "ОАК",
    chemistry: "БХАК",
    crp: "СРБ",
    urinalysis: "ОАМ",
    betahcg: "бета-ХГЧ",
    ultrasound_abdomen: "УЗИ брюшной полости",
    ct_abdomen: "КТ брюшной полости",
  };
  return labels[testId] ?? testId;
}

function staffForTest(testId) {
  return testId.startsWith("ct") || testId.startsWith("ultrasound") ? "Рентгенолог" : "Лаборатория";
}

/**
 * The chosen option's own words, from content. No operation name is written
 * in this file - a second disease's decisions render through this same
 * function with no change (Foundation Spec §63).
 */
function operativeChoiceLabelRu(payload, bundle) {
  const decision = bundle.operative?.decisions?.[payload.decisionId];
  const option = decision?.options?.find((entry) => entry.id === payload.choice);
  return option?.matches_ru?.[0] ?? payload.choice;
}

/** Preop item wording comes from content, never from a table here. */
function preopLabelRu(itemId, bundle) {
  const item = (bundle.operative?.preop_requirements ?? []).find((entry) => entry.id === itemId);
  return item?.label_ru ?? itemId;
}

function approachLabelRu(approach) {
  return { laparoscopic: "лапароскопический", open: "открытый" }[approach] ?? approach;
}

function locationLabelRu(location) {
  const labels = {
    emergency_department: "приёмный покой",
    resuscitation: "противошоковая",
    radiology: "рентген-кабинет",
    operating_room: "операционная",
    recovery: "палата пробуждения",
    icu: "ОРИТ",
    surgical_ward: "хирургическое отделение",
    other_facility: "другой стационар",
  };
  return labels[location] ?? location;
}

function staffLabelRu(role) {
  const labels = {
    nurse: "Медсестра",
    radiologist: "Рентгенолог",
    anesthesiologist: "Анестезиолог",
    seniorSurgeon: "Старший хирург",
    icuPhysician: "Реаниматолог",
  };
  return labels[role] ?? role;
}

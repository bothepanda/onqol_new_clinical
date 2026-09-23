import { EVENT } from "../../core/events/eventTypes.js";
import { evaluateContentCondition } from "../../core/rules/contentConditions.js";
import { formatObserved } from "./vitalsLabels.js";

/**
 * Turning one domain event into learner-facing Russian text.
 *
 * Core Runtime Spec §53: "the model may vary phrasing, it may not vary the
 * clinical truth". This renderer is the deterministic, content-driven
 * default - every sentence it produces is assembled from a reviewed
 * template (`content/diseases/.../findings.yaml`, `disease.yaml`) plus a
 * structured value already sitting on the event, never invented. A future
 * LLM rendering pass may vary word choice on top of this (see
 * docs/KNOWN_GAPS.md) but must not be handed anything this function did not
 * already establish as true.
 */
export function renderEvent({ event, bundle, patient, state }) {
  switch (event.type) {
    case EVENT.PATIENT_ARRIVED:
      return { speakerRu: "Приёмный покой", textRu: event.payload.handoffRu };

    case EVENT.HISTORY_OBTAINED:
      return { speakerRu: "Пациент", textRu: renderHistoryBundle(bundle, patient) };

    case EVENT.PATIENT_QUESTION_ANSWERED:
      return { speakerRu: "Пациент", textRu: event.payload.answerRu };

    case EVENT.EXAMINATION_PERFORMED:
      return { speakerRu: "Осмотр", textRu: renderExamination(event, bundle, patient, state) };

    case EVENT.PATIENT_REASSESSED:
      return { speakerRu: "Переоценка", textRu: renderReassessment(event, bundle, patient, state) };

    case EVENT.TEST_ORDERED:
      return {
        speakerRu: "Система",
        textRu: `Назначено: ${labelForTest(event.payload.testId, bundle)}. Ожидаемое время результата — ${event.payload.etaMinutes} мин.`,
      };

    case EVENT.TEST_PRELIMINARY_REPORTED:
      return {
        speakerRu: staffForTest(event.payload.investigationId),
        textRu: `Предварительно: ${formatResult(event.payload.preliminary, event.payload.investigationId, bundle)}`,
      };

    case EVENT.TEST_RESULTED:
      return { speakerRu: "Лаборатория/Диагностика", textRu: renderTestResult(event, bundle) };

    case EVENT.MEDICATION_ADMINISTERED:
      return { speakerRu: "Медсестра", textRu: renderMedicationAdministered(event, bundle) };

    case EVENT.INFUSION_STARTED:
      return {
        speakerRu: "Медсестра",
        textRu: `Инфузия начата: ${fluidLabelRu(event.payload.fluidId, bundle)} ${event.payload.volumeMl ?? ""} мл${event.payload.durationMinutes ? ` за ${event.payload.durationMinutes} мин` : " болюсно"}.`.replace(/\s{2,}/g, " "),
      };

    case EVENT.INFUSION_STOPPED:
      return { speakerRu: "Медсестра", textRu: event.payload.nothingRunning ? "Сейчас ничего не вводится." : "Инфузию остановила." };

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

    // Matrix O16: end-of-operation boilerplate comes from content, and the
    // resident is not quizzed on counts or port closure.
    case EVENT.PROCEDURE_COMPLETED:
      return {
        speakerRu: "Операционная",
        textRu: [event.payload.closureStatementRu, "Куда переводим пациента?"].filter(Boolean).join(" "),
      };

    // Matrix PR02: the fasting history, spoken by whoever obtained it.
    case EVENT.FASTING_HISTORY_OBTAINED:
      return renderFastingHistory(event, bundle);

    case EVENT.ORAL_INTAKE_PRESCRIBED:
      return { speakerRu: "Медсестра", textRu: ORAL_INTAKE_RU[event.payload.level] ?? "Режим питания назначен." };

    // Matrix PO17: automatic hospital workflow, stated once, never quizzed.
    case EVENT.SPECIMEN_SENT_TO_PATHOLOGY:
      return { speakerRu: "Операционная", textRu: `${capitalise(event.payload.labelRu ?? "материал направлен на гистологическое исследование")}.` };

    // Matrix PO18/PO20: the reviewed discharge bundle, issued by the system.
    case EVENT.DISCHARGE_INSTRUCTIONS_ISSUED:
      return renderDischargeBundle(event);

    // Matrix PR08: a jurisdictional investigation the learner did not order,
    // noticed and obtained by staff. Spoken as hospital workflow, never as a
    // clinical correction.
    case EVENT.PREOP_ITEM_OMITTED:
      return {
        speakerRu: "Медсестра",
        textRu: `${capitalise(preopLabelRu(event.payload.itemId, bundle))} не была назначена — оформляю по порядку отделения.`,
      };

    case EVENT.PATIENT_MOVED:
      return { speakerRu: "Система", textRu: `Пациент переведён: ${locationLabelRu(event.payload.to)}.` };

    // Departure and arrival are two separate moments once transport takes
    // real time (Contract §3.2/§7.1) - the learner sees the ambulance leave,
    // then sees it arrive, rather than one instantaneous teleport.
    case EVENT.TRANSFER_INITIATED:
      return {
        speakerRu: "Система",
        textRu: event.payload.etaMinutes
          ? `Организован перевод в другой стационар. Расчётное время в пути — ${event.payload.etaMinutes} мин.`
          : "Организован перевод в другой стационар.",
      };

    case EVENT.PATIENT_TRANSFERRED:
      return { speakerRu: "Система", textRu: "Пациент доставлен в принимающий стационар. Случай передан." };

    case EVENT.STAFF_CALLED:
      return { speakerRu: "Диспетчер", textRu: `${staffLabelRu(event.payload.role)} вызван(а), ожидаемое время — ${event.payload.etaMinutes} мин.` };

    case EVENT.STAFF_ARRIVED:
      return { speakerRu: staffLabelRu(event.payload.role), textRu: "Я на месте. Что уже сделано?" };

    case EVENT.RESOURCE_CONSTRAINT_REVEALED:
      return { speakerRu: "Система", textRu: event.payload.constraint?.textRu ?? "Ресурс временно недоступен." };

    case EVENT.OPERATIVE_FINDING_REVEALED:
      return { speakerRu: "Операционная", textRu: renderOperativeFinding(event, bundle, patient) };

    case EVENT.DETERIORATION_DETECTED:
      return { speakerRu: "Медсестра", textRu: "Пациенту хуже: " + (event.payload.textRu ?? event.payload.summaryRu ?? "изменились витальные показатели.") };

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

/**
 * The history bundle.
 *
 * Every slot is filled from what the patient module actually generated, and an
 * absent fact renders as nothing rather than as a plausible negative: a patient
 * with no self-treatment gets no self-treatment sentence, and a MALE patient
 * has no `sexConditionalHistoryRu` at all, so there is nothing here that could
 * leak an LMP line into a male history (task §11).
 */
function renderHistoryBundle(bundle, patient) {
  const template = bundle.findings.history_bundle_ru.template;
  const phenotypeHistory = [
    ...(patient.presentation.historyFixedRu ?? []),
    ...(patient.presentation.historyVariantsRu ?? []),
  ].join(", ");
  const sexConditional = (patient.presentation.sexConditionalHistoryRu ?? []).join("; ");
  return template
    .replace("{onset_hours}", String(Math.round(patient.presentation.onsetHours)))
    .replace("{onset_description}", "постепенно")
    .replace("{phenotype_history}", phenotypeHistory || "без дополнительных уточнений")
    .replace("{nausea_vomiting}", patient.presentation.nauseaVomitingRu ?? "тошноты и рвоты нет")
    .replace("{self_treatment}", patient.presentation.selfTreatmentRu ? `${capitalise(patient.presentation.selfTreatmentRu)}.` : "")
    .replace("{sex_conditional}", sexConditional ? `${capitalise(sexConditional)}.` : "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * A reassessment reports the parameters the learner actually named
 * (Contract §10, Core Runtime Spec §12) - not a generic "no significant
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

function renderReassessment(event, bundle, patient, state) {
  const targets = event.payload.targets ?? [];
  const parts = [];
  const remainingTargets = [];

  if (targets.includes("abdomen_exam")) parts.push(renderSlotExam(bundle, patient, state, "abdomen"));

  // Wave B: a reassessment target naming a region with findings (static or
  // derived, e.g. "cardiorespiratory" for overload signs) renders the
  // current text inline, not just a "see current values" pointer -
  // reassessment is the moment those findings are supposed to surface.
  for (const target of targets) {
    if (target === "abdomen_exam") continue;
    if (slotRegionsPresent(bundle).has(target) || derivedSlotRegionsPresent(bundle).has(target)) parts.push(renderSlotExam(bundle, patient, state, target));
    else remainingTargets.push(target);
  }

  // Targeted observation: the measurements themselves, only for what was
  // actually reassessed. Content without observation targets keeps the old
  // "see current values" pointer.
  const observedText = formatObserved(event.payload.observed);
  if (observedText) parts.push(`Измерено: ${observedText}.`);
  else if (event.payload.observed === undefined) {
    const named = remainingTargets.filter((target) => REASSESS_TARGET_LABEL_RU[target]).map((target) => REASSESS_TARGET_LABEL_RU[target]);
    if (named.length) parts.push(`Переоценены: ${named.join(", ")} — см. текущие показатели.`);
  }

  if (parts.length === 0) parts.push("Пациент осмотрен повторно. Клинически значимых изменений нет.");
  return parts.join(" ");
}

// Wave B generalization: an exam slot may declare which body region it
// belongs to (`slot.region`); slots that don't declare one default to
// "abdomen", which is exactly appendicitis's existing (and only) region, so
// this is a no-op for every already-authored exam_slots file. A second
// disease whose examination centres on a different region (fluids-01: skin
// perfusion, neck veins, lungs, heart) declares its own `region` per slot
// instead of every finding being forced through "abdomen".
function slotRegionsPresent(bundle) {
  return new Set((bundle.findings.exam_slots ?? []).map((slot) => slot.region ?? "abdomen"));
}

function renderExamination(event, bundle, patient, state) {
  const text = renderExaminationFindings(event, bundle, patient, state);
  const measured = formatObserved(event.payload.observed);
  return measured ? `${text} ${measured}.` : text;
}

function renderExaminationFindings(event, bundle, patient, state) {
  const region = event.payload.region;
  const hasStaticSlots = region && slotRegionsPresent(bundle).has(region);
  const hasDerivedSlots = region && derivedSlotRegionsPresent(bundle).has(region);
  if (hasStaticSlots || hasDerivedSlots) return renderSlotExam(bundle, patient, state, region);
  if (region && bundle.findings.universal_normal_layer.regions[`${region}_ru`]) {
    return bundle.findings.universal_normal_layer.regions[`${region}_ru`];
  }
  if (region) return bundle.findings.universal_normal_layer.default_ru;
  return renderSlotExam(bundle, patient, state, "abdomen");
}

function derivedSlotRegionsPresent(bundle) {
  return new Set((bundle.findings.derived_exam_slots ?? []).map((slot) => slot.region ?? "abdomen"));
}

/**
 * Wave B: a finding may be STATIC (`exam_slots`, chosen once at patient
 * generation - appendicitis's whole exam) or DERIVED (`derived_exam_slots`,
 * a threshold rule evaluated against CURRENT `state` every time the region is
 * examined - fluids-01 needs lung/perfusion findings that change as the
 * patient responds to treatment, which a fixed snapshot cannot express).
 * Both may contribute sentences to the same region; a case with only one
 * kind (appendicitis: static only) is unaffected by the other existing.
 */
function renderSlotExam(bundle, patient, state, region) {
  const slotsById = Object.fromEntries((bundle.findings.exam_slots ?? []).map((slot) => [slot.id, slot]));
  const grouped = new Map();
  const push = (group, phrase) => {
    if (!phrase) return;
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group).push(phrase);
  };

  for (const [slotId, stateValue] of Object.entries(patient.examSlots ?? {})) {
    const slot = slotsById[slotId];
    if (!slot || (slot.region ?? "abdomen") !== region) continue;
    const phrase = slot.states[stateValue];
    if (!phrase) continue;
    push(slot.group, bundle.findings.localisation_token ? phrase.replace(bundle.findings.localisation_token, patient.presentation?.painSiteRu ?? "") : phrase);
  }

  if (state) {
    for (const slot of bundle.findings.derived_exam_slots ?? []) {
      if ((slot.region ?? "abdomen") !== region) continue;
      const rule = (slot.rules ?? []).find((r) => r.default === true || evaluateContentCondition(r.when, state));
      if (rule) push(slot.group, rule.text_ru);
    }
  }

  const text = [
    ...[...grouped.values()].map((sentences) => sentences.join(", ") + "."),
    ...(region === "abdomen" ? patient.presentation?.examinationExtraRu ?? [] : []),
  ].join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function renderTestResult(event, bundle) {
  const { investigationId, result } = event.payload;
  return formatResult(result, investigationId, bundle);
}

/**
 * One investigation result as prose.
 *
 * The CT branch is the point of this function. Matrix I04 / task §9.2: CT is a
 * FULL abdomen/pelvis report, not an "appendix-only" test, because the case
 * begins as an undifferentiated acute abdomen. Every sentence comes from the
 * authored `ct_report_ru.sections`; the renderer concatenates, it does not
 * compose. In particular there is NO appendix diameter anywhere - matrix I05
 * leaves that number NEEDS SOURCE - and no appendicolith or incidental finding,
 * because none exists in content to print.
 */
function formatResult(result, investigationId, bundle = null) {
  if (result == null) return `${labelForTest(investigationId, bundle)}: результат получен.`;
  if (typeof result === "string") return `${labelForTest(investigationId, bundle)}: ${result}`;

  if (result.kind === "structured_report") {
    return [result.modalityRu ? `${result.modalityRu}.` : null, ...(result.sectionsRu ?? []), result.conclusionRu]
      .filter(Boolean)
      .join(" ");
  }

  // Biochemistry: only the analytes the learner asked for (matrix V07).
  if (Array.isArray(result.linesRu)) {
    return `${labelForTest(investigationId, bundle)} — ${result.linesRu.join("; ")}.`;
  }

  if (typeof result.note === "string") return `${labelForTest(investigationId, bundle)}: ${result.note}`;

  // Named in Russian, not by the internal field name (PBC-13). The learner
  // used to read «ОАК — wbc: 15.6, neutrophilPercent: 81» - English
  // identifiers straight out of the physiology object, the same leak as the
  // nurse saying "ketoprofen ... im".
  //
  // ONLY THE NAME IS TRANSLATED. The value is passed through untouched and no
  // unit is appended: a unit is a clinical assertion, and the reviewed
  // physiology envelope does not carry one (see the vitals/labs review table).
  // An unmapped field falls back to its own key rather than being dropped.
  const entries = Object.entries(result);
  const testLabel = labelForTest(investigationId, bundle);

  // A single-field result whose field IS the test («СРБ — СРБ: 44») reads as a
  // stutter; print the value once.
  if (entries.length === 1 && (LAB_FIELD_RU[entries[0][0]] ?? entries[0][0]) === testLabel) {
    return `${testLabel}: ${formatLabValue(entries[0][0], entries[0][1])}`;
  }

  const parts = entries.map(([key, value]) => `${LAB_FIELD_RU[key] ?? key}: ${formatLabValue(key, value)}`);
  return `${testLabel} — ${parts.join(", ")}`;
}

const LAB_FIELD_RU = Object.freeze({
  wbc: "лейкоциты",
  neutrophilPercent: "нейтрофилы",
  crp: "СРБ",
});

/**
 * The value, unchanged. The only thing appended is a unit the FIELD NAME
 * already carries (`neutrophilPercent` is a percentage by definition) - never
 * a unit that would be a new clinical assertion. The reviewed physiology
 * envelope carries no units of its own, so nothing else gets one here.
 */
function formatLabValue(key, value) {
  return key === "neutrophilPercent" ? `${value} %` : String(value);
}

/**
 * What the nurse says when a drug is given (PBC-13).
 *
 * The previous line interpolated `payload.drugId` and `payload.route` raw, so
 * the learner was told «Введено: ketoprofen 100мг im» - a Latin internal
 * identifier and a route code, from a character who is supposed to be a
 * Russian-speaking nurse (Contract §13). The Russian labels already exist in
 * reviewed content (`shared/medications/formulary.yaml#label_ru`), so this
 * invents no clinical fact: it prints the name the content already carries,
 * and falls back to the id if content has none rather than guessing a
 * translation.
 *
 * The DOSE is passed through exactly as the learner stated it. Nothing here
 * normalises, converts or judges it - dose validity is unreviewed clinical
 * content (matrix M04/AB07), and a renderer is not where that changes.
 */
function renderMedicationAdministered(event, bundle) {
  const { drugId, dose, route } = event.payload;
  const parts = [drugLabelRu(drugId, bundle), dose ? formatDoseRu(dose) : null, route ? ROUTE_RU[route] ?? route : null];
  return `Введено: ${parts.filter(Boolean).join(", ")}.`;
}

/** "100мг" -> "100 мг", "2г" -> "2 г". Spacing only; the number is untouched. */
function formatDoseRu(dose) {
  return String(dose).replace(/(\d)\s*(мг|г|мл)$/i, "$1 $2");
}

const ROUTE_RU = Object.freeze({ iv: "внутривенно", im: "внутримышечно", sc: "подкожно", oral: "перорально" });

function drugLabelRu(drugId, bundle) {
  return bundle?.shared?.medications?.medications?.[drugId]?.label_ru ?? drugId;
}

function fluidLabelRu(fluidId, bundle) {
  return bundle?.shared?.medications?.fluids?.[fluidId]?.label_ru ?? fluidId ?? "";
}

const ORAL_INTAKE_RU = Object.freeze({
  nil_by_mouth: "Пациент переведён на нулевой стол, ничего внутрь.",
  liquids: "Разрешена жидкость перорально.",
  diet_as_tolerated: "Разрешена диета по переносимости.",
});

function renderFastingHistory(event, bundle) {
  const content = bundle.findings?.fasting_history;
  const fasting = event.payload.fasting;
  if (!content || !fasting) return { speakerRu: "Пациент", textRu: "Время последнего приёма пищи и жидкости уточнено." };
  const byAnesthesiologist = event.payload.obtainedBy === "anesthesiologist";
  const template = byAnesthesiologist ? content.anesthesia_discovery_ru : content.answer_template_ru;
  return {
    speakerRu: byAnesthesiologist ? "Анестезиолог" : "Пациент",
    textRu: template
      .replace("{solid}", String(Math.round(fasting.lastSolidFoodHoursAgo)))
      .replace("{liquid}", String(Math.round(fasting.lastClearLiquidHoursAgo))),
  };
}

function renderDischargeBundle(event) {
  const { followUpRu, histopathologyRu, returnPrecautionsRu } = event.payload;
  const precautions = returnPrecautionsRu?.length
    ? `Немедленно обратиться при: ${returnPrecautionsRu.join("; ")}.`
    : null;
  return {
    speakerRu: "Система",
    textRu: ["Выписные рекомендации:", followUpRu, histopathologyRu, precautions].filter(Boolean).join(" "),
  };
}

function capitalise(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function renderOperativeFinding(event, bundle, patient) {
  const step = bundle.operative.operative_sequence.find((s) => s.finding_id === event.payload.findingId);
  if (!step) return patient.truth.operativeTruthRu;
  return step.description_ru.replace("{pelvic_fluid_note}", "") + " " + step.decision_prompt_ru;
}

function labelForTest(testId, bundle = null) {
  const declared = bundle?.trajectories?.investigation_timing?.[testId]?.label_ru;
  if (declared) return declared;
  const labels = {
    cbc: "ОАК",
    chemistry: "БХАК",
    crp: "СРБ",
    urinalysis: "ОАМ",
    betahcg: "бета-ХГЧ",
    coagulation: "коагулограмма",
    blood_group_rh: "группа крови и резус-фактор",
    ultrasound_abdomen: "УЗИ брюшной полости",
    ct_abdomen: "КТ органов брюшной полости и малого таза",
  };
  return labels[testId] ?? testId;
}

function staffForTest(testId) {
  return testId.startsWith("ct") || testId.startsWith("ultrasound") ? "Рентгенолог" : "Лаборатория";
}

/**
 * The chosen option's own words, from content. No operation name is written
 * in this file - a second disease's decisions render through this same
 * function with no change (Core Runtime Spec §63).
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
    surgeon: "Хирург",
    icuPhysician: "Реаниматолог",
  };
  return labels[role] ?? role;
}

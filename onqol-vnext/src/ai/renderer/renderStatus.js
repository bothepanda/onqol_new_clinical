/**
 * "What's happening with the patient right now?" (Contract §6, §8): a short
 * current snapshot, built only from `learnerVisible` - never from
 * `state.truth` - and never expanded into a full re-examination.
 */
export function renderStatusSnapshot(learnerVisible) {
  const vitals = learnerVisible.physiologyKnownAt?.values;
  // Systolic only: the reviewed physiology envelope does not model a
  // diastolic value, and the renderer does not invent one (Governance
  // Spec §2). Task brief §14's "clinically usable BP" is conditional on both
  // values existing; here they do not, and saying so honestly beats printing
  // a plausible number nobody reviewed.
  const vitalsRu = vitals
    ? `ЧСС ${vitals.heartRate}/мин, АД сист. ${vitals.systolicBp} мм рт.ст., ЧДД ${vitals.respiratoryRate}/мин, T ${vitals.temperatureC} °C.`
    : "Витальные ещё не оценивались.";
  const painRu = learnerVisible.painScore != null ? `Боль ${learnerVisible.painScore}/10.` : null;
  const pendingRu = learnerVisible.revealedResults
    .filter((r) => r.status === "ordered" || r.status === "in_progress")
    .map((r) => r.id)
    .join(", ");
  return {
    speakerRu: "Система",
    textRu: [
      `Прошло ${Math.round(learnerVisible.clock.elapsedMinutes)} мин. Локация: ${LOCATION_RU[learnerVisible.location] ?? learnerVisible.location}.`,
      vitalsRu,
      painRu,
      pendingRu ? `Ожидают результата: ${pendingRu}.` : null,
    ]
      .filter(Boolean)
      .join(" "),
  };
}

const LOCATION_RU = Object.freeze({
  emergency_department: "приёмный покой",
  resuscitation: "противошоковая",
  radiology: "рентген-кабинет",
  operating_room: "операционная",
  recovery: "палата пробуждения",
  icu: "ОРИТ",
  surgical_ward: "хирургическое отделение",
  other_facility: "другой стационар",
});

const CLARIFY_PROMPTS_RU = Object.freeze({
  route: "Уточните путь введения.",
  dose: "Уточните дозу.",
  drugId: "Уточните препарат.",
  region: "Что именно осматриваешь?",
  targets: "Что именно переоцениваешь?",
  durationMinutes_or_bolus: "За какое время или болюсом?",
  testId: "Какое исследование?",
  role: "Кого именно вызвать?",
});

/** Contract §10: routine order clarification comes from hospital staff. */
export function renderClarification(missing) {
  const prompts = missing.map((key) => CLARIFY_PROMPTS_RU[key]).filter(Boolean);
  return { speakerRu: "Медсестра", textRu: prompts.length ? prompts.join(" ") : "Уточните, пожалуйста." };
}

const UNSUPPORTED_RU = "Это назначение пока не поддерживается текущей версией симуляции. Выбери другое назначение.";

export function renderUnsupported() {
  return { speakerRu: "Система", textRu: UNSUPPORTED_RU };
}

const UNAVAILABLE_RU = Object.freeze({
  "resource.ct.down_for_repair": "КТ сейчас недоступна: аппарат на ремонте, срок восстановления неизвестен.",
  "resource.or.occupied": "Единственная операционная занята другим экстренным пациентом.",
  "resource.icu.no_bed": "Свободных коек в ОРИТ сейчас нет.",
  "resource.senior_surgeon.delayed": "Старший хирург задерживается.",
  "resource.ct.not_installed": "КТ в этой больнице не установлена.",
  "resource.mri.not_installed": "МРТ в этой больнице недоступна.",
  "resource.laparoscopy.absent": "Лапароскопическая стойка в этой больнице отсутствует.",
  "resource.blood.not_authored": "Информация о компонентах крови для этой больницы пока не задана.",
  "resource.unavailable_at_this_hour": "Ресурс недоступен в это время суток.",
  "resource.no_unit_available": "Все единицы этого ресурса сейчас заняты.",
  "resource.unavailable": "Ресурс сейчас недоступен в этой больнице.",
});

export function renderUnavailableResource(reasonKey) {
  return { speakerRu: "Система", textRu: UNAVAILABLE_RU[reasonKey] ?? UNAVAILABLE_RU["resource.unavailable"] };
}

/**
 * The patient is not ready for theatre yet (Contract §16, Core Foundation
 * Spec §58). Spoken by the OR team as an operational fact, naming the
 * missing preparation in the content's own words - never an internal item
 * id, and never a mentor lecture: this is the theatre telling the surgeon
 * the patient is not prepped, which is exactly what would happen.
 */
export function renderPreopNotReady(missingItems, bundle) {
  const labels = (bundle?.operative?.preop_requirements ?? [])
    .filter((item) => missingItems.includes(item.id))
    .map((item) => item.label_ru);
  const named = labels.length ? labels.join(", ") : "подготовка к операции";
  return {
    speakerRu: "Операционная",
    textRu: `Пациент ещё не готов к подаче в операционную. Не выполнено: ${named}.`,
  };
}

/**
 * Discharge refused (task brief §13.5): a clinically natural reason drawn
 * from facts the learner can already see, with no internal rule id and no
 * criterion the learner was never shown.
 */
const DISCHARGE_BLOCKER_RU = Object.freeze({
  fever: "у пациента сохраняется лихорадка",
  active_complication: "есть признаки активного осложнения, которое не разрешено",
});

export function renderDischargeNotReady(blockers) {
  const reasons = blockers.map((key) => DISCHARGE_BLOCKER_RU[key]).filter(Boolean);
  const reasonRu = reasons.length ? reasons.join("; ") : "состояние пациента ещё не соответствует критериям выписки";
  return { speakerRu: "Медсестра", textRu: `Выписать сейчас нельзя: ${reasonRu}. Что делаешь дальше?` };
}

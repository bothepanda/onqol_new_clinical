/**
 * "What's happening with the patient right now?" (Contract §6, §8): a short
 * current snapshot, built only from `learnerVisible` - never from
 * `state.truth` - and never expanded into a full re-examination.
 */
export function renderStatusSnapshot(learnerVisible) {
  const observation = learnerVisible.physiologyKnownAt;
  const vitals = observation?.values;
  // WHEN the values were observed, not just what they were. A snapshot taken
  // ten hours ago is not "the patient right now", and presenting it without a
  // timestamp lets the learner read a stale number as current - the same class
  // of invented certainty task §20 prohibits.
  const staleByMinutes = observation ? Math.round(learnerVisible.clock.elapsedMinutes - observation.atMinutes) : null;
  // Systolic only: the reviewed physiology envelope does not model a
  // diastolic value, and the renderer does not invent one (Governance
  // Spec §2). Task brief §14's "clinically usable BP" is conditional on both
  // values existing; here they do not, and saying so honestly beats printing
  // a plausible number nobody reviewed.
  const vitalsRu = vitals
    ? `ЧСС ${vitals.heartRate}/мин, АД сист. ${vitals.systolicBp} мм рт.ст., ЧДД ${vitals.respiratoryRate}/мин, T ${vitals.temperatureC} °C` +
      (staleByMinutes >= 30 ? ` (последнее измерение ${staleByMinutes} мин назад).` : ".")
    : "Витальные ещё не оценивались.";
  // Matrix PO01: once the source is controlled the pre-source-control pain is a
  // CLOSED state, and the recovery trajectory that would give the new one a
  // value is not approved content. Reporting the old number, or inventing a new
  // one, are both wrong; saying what is and is not modeled is not.
  const painRu = painLineRu(learnerVisible);
  // Contract §6's worked example ends "CBC is ready; CT formal report is
  // pending", so pending work belongs in the snapshot - named the way the
  // learner ordered it, not by internal id. The previous line printed
  // `r.id`, which would have read "Ожидают результата: cbc, ct_abdomen".
  const pendingRu = (learnerVisible.orderedInvestigations ?? [])
    .filter((r) => r.status === "ordered" || r.status === "in_progress")
    .map((r) => TEST_LABEL_RU[r.id] ?? r.id)
    .join(", ");
  // A preliminary report is back but the formal one is not - a distinct state
  // the learner needs to see as distinct (§9.1).
  const preliminaryRu = learnerVisible.revealedResults
    .filter((r) => r.status === "preliminary")
    .map((r) => TEST_LABEL_RU[r.id] ?? r.id)
    .join(", ");
  return {
    speakerRu: "Система",
    textRu: [
      `Прошло ${Math.round(learnerVisible.clock.elapsedMinutes)} мин. Локация: ${LOCATION_RU[learnerVisible.location] ?? learnerVisible.location}.`,
      vitalsRu,
      painRu,
      preliminaryRu ? `Получено предварительное заключение: ${preliminaryRu}; официальное описание ещё не готово.` : null,
      pendingRu ? `Ожидают результата: ${pendingRu}.` : null,
    ]
      .filter(Boolean)
      .join(" "),
  };
}

// Reviewed Russian copy for the three qualitative postoperative pain stages of
// the approved TRJ-POSTOP-RECOVERY model. One line per stage, no numeric score,
// no additional clinical wording.
const POSTOP_PAIN_STAGE_RU = Object.freeze({
  significant: "Послеоперационная боль выраженная.",
  improving: "Послеоперационная боль уменьшается.",
  controlled_on_oral_analgesia: "Послеоперационная боль контролируется пероральными анальгетиками.",
});

function painLineRu(learnerVisible) {
  if (learnerVisible.painScore != null) return `Боль ${learnerVisible.painScore}/10.`;
  if (learnerVisible.painState === "post_source_control") {
    // Render only the actual current authoritative stage the recovery model
    // wrote to state. No stage set yet -> no line (never inferred from elapsed
    // time, and the obsolete "not modelled" statement is gone).
    return POSTOP_PAIN_STAGE_RU[learnerVisible.postopPainStage] ?? null;
  }
  return null;
}

/**
 * Investigation names as the learner ordered them. Shared wording with
 * `renderEvent.js#labelForTest`; kept here rather than imported so the status
 * renderer has no dependency on the event renderer.
 */
const TEST_LABEL_RU = Object.freeze({
  cbc: "ОАК",
  chemistry: "БХАК",
  crp: "СРБ",
  urinalysis: "ОАМ",
  betahcg: "бета-ХГЧ",
  coagulation: "коагулограмма",
  blood_group_rh: "группа крови и резус-фактор",
  ultrasound_abdomen: "УЗИ брюшной полости",
  ct_abdomen: "КТ органов брюшной полости и малого таза",
});

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
  // Matrix V07: the LAB asks which biochemistry values are needed - it does not
  // guess a panel.
  analytes: "Какие показатели биохимии нужны?",
  durationMinutes_or_bolus: "За какое время или болюсом?",
  testId: "Какое исследование?",
  role: "Кого именно вызвать?",
});

const CLARIFY_SPEAKER_RU = Object.freeze({ laboratory: "Лаборатория", nurse: "Медсестра" });

/**
 * Contract §10: routine order clarification comes from hospital staff, never
 * from the mentor.
 *
 * `promptRu` lets CONTENT supply the exact question (an investigation declaring
 * `clarify_prompt_ru`), and `by` lets it choose the speaker, so "Какие
 * показатели биохимии нужны?" comes from the lab rather than the nurse.
 */
export function renderClarification(missing, { promptRu = null, by = "nurse" } = {}) {
  const prompts = promptRu ? [promptRu] : missing.map((key) => CLARIFY_PROMPTS_RU[key]).filter(Boolean);
  return {
    speakerRu: CLARIFY_SPEAKER_RU[by] ?? "Медсестра",
    textRu: prompts.length ? prompts.join(" ") : "Уточните, пожалуйста.",
  };
}

/**
 * A DEPARTMENT policy refusing an order (matrix I12, task §10).
 *
 * Spoken by the department in operational language. It is deliberately NOT
 * phrased as a medical contraindication - "контраст медицински запрещён без
 * креатинина" is a claim the evidence does not support and this product must
 * not teach.
 */
export function renderHospitalPolicyBlock(result) {
  return { speakerRu: result.speakerRu ?? "Система", textRu: result.textRu };
}

/**
 * An operative option the learner genuinely chose, recognised but not modeled
 * (matrix O12/O13, task §17.8-§17.9).
 *
 * The learner is challenged in clinical terms and told plainly that the
 * simulator will not carry it out - rather than the simulator silently doing
 * nothing, or inventing a complication as a punishment.
 */
export function renderOptionNotModeled(result) {
  const challenge = result.challengeRu ? `${result.challengeRu} ` : "";
  return {
    speakerRu: "Операционная",
    textRu: `${challenge}Этот вариант в текущей версии симуляции не выполняется: последствия такого решения ещё не прошли клиническое рецензирование, и выдумывать их система не будет.`,
  };
}

const UNSUPPORTED_RU = "Это назначение пока не поддерживается текущей версией симуляции. Выбери другое назначение.";

export function renderUnsupported() {
  return { speakerRu: "Система", textRu: UNSUPPORTED_RU };
}

export function renderOrderValidationFailure(result) {
  return {
    speakerRu: "Медсестра",
    textRu: result.textRu ?? "Назначение не соответствует одобренной пилотной схеме; уточни препарат, дозу и путь введения.",
  };
}

/**
 * The same investigation was already ordered and its result is still pending
 * (wave §13). An operational note from the lab/diagnostics, not a rejection -
 * the learner is not penalised and no second pending copy is created.
 */
export function renderAlreadyPending(result) {
  const label = TEST_LABEL_RU[result.testId] ?? result.testId ?? "Исследование";
  const textRu = result.phase === "resulted"
    ? `${label}: результат уже получен. Для повторного назначения укажите «повторить» или «в динамике».`
    : `${label}: уже заказано, результат ожидается.`;
  return { speakerRu: "Лаборатория/Диагностика", textRu };
}

export function renderNoPendingWork() {
  return { speakerRu: "Система", textRu: "Сейчас нет назначенных исследований или действий, результатов которых можно ждать." };
}

export function renderUnrecognizedFragments(fragments) {
  const quoted = (fragments ?? []).map((fragment) => `«${fragment}»`).join(", ");
  return {
    speakerRu: "Система",
    textRu: quoted
      ? `Не удалось распознать часть запроса: ${quoted}. Переформулируй её отдельной командой.`
      : "Не удалось распознать действие. Переформулируй запрос конкретнее.",
  };
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
export function renderDischargeNotReady(blockers) {
  // Each blocker carries the CONTENT'S learner-facing reason
  // (`learner_reason_ru`), so no internal criterion id is ever spoken and no
  // criterion the learner was never shown is cited.
  const reasons = blockers.map((blocker) => blocker.reasonRu).filter(Boolean);
  const reasonRu = reasons.length ? reasons.join("; ") : "состояние пациента ещё не соответствует критериям выписки";
  return { speakerRu: "Медсестра", textRu: `Выписать сейчас нельзя: ${reasonRu}. Что делаешь дальше?` };
}

export function renderDispositionNotReady(blockers) {
  const reasons = blockers.map((blocker) => blocker.reasonRu).filter(Boolean);
  const reasonRu = reasons.length ? reasons.join("; ") : "послеоперационный этап ещё не достигнут";
  return { speakerRu: "Медсестра", textRu: `Перевести пациента сейчас нельзя: ${reasonRu}` };
}

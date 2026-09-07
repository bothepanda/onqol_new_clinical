import { isContentAuthoritative } from "./governance.js";

export function validateMedicationOrder({ medication, command, state }) {
  if (!medication || !isContentAuthoritative(medication)) {
    return failure("not_yet_reviewed", "Назначение распознано, но его доза и путь введения не одобрены для пилота.");
  }
  const validation = medication.order_validation;
  if (!validation) return failure("not_yet_reviewed", "Для этого препарата нет одобренной пилотной схемы.");
  const routeRule = validation.routes?.[command.params.route];
  if (!routeRule) return failure("route_not_approved", "Указанный путь введения не входит в одобренную пилотную схему.");

  const doseMg = command.params.doseMg;
  const doseMgPerKg = command.params.doseMgPerKg;
  const fixed = routeRule.allowed_doses_mg;
  const range = routeRule.allowed_dose_range_mg;
  const perKg = routeRule.allowed_dose_mg_per_kg;
  const doseAllowed = Array.isArray(fixed)
    ? fixed.includes(doseMg)
    : Array.isArray(range)
      ? Number.isFinite(doseMg) && doseMg >= range[0] && doseMg <= range[1]
      : Array.isArray(perKg)
        ? perKg.includes(doseMgPerKg)
        : false;
  if (!doseAllowed) return failure("dose_not_approved", "Доза не входит в одобренную пилотную схему; пересмотри назначение.");

  const minimumWeight = routeRule.minimum_weight_kg_by_dose_mg?.[String(doseMg)];
  if (Number.isFinite(minimumWeight) && !(state.demographics?.weightKg >= minimumWeight)) {
    return failure("weight_required", `Эта доза допустима при массе тела не менее ${minimumWeight} кг; масса в этом пациенте не смоделирована.`);
  }

  const previous = (state.treatments?.administered ?? [])
    .filter((item) => item.drugId === command.params.drugId)
    .filter((item) => state.clock.elapsedMinutes - item.atMinutes < 1440);
  const max24h = validation.max_24h_mg;
  if (Number.isFinite(max24h) && previous.reduce((sum, item) => sum + (item.doseMg ?? 0), 0) + doseMg > max24h) {
    return failure("max_24h_exceeded", "Назначение превысит одобренный пилотный максимум за 24 часа; пересмотри дозу или интервал.");
  }
  const minimumInterval = validation.minimum_interval_minutes;
  const last = previous.at(-1);
  if (last && Number.isFinite(minimumInterval) && state.clock.elapsedMinutes - last.atMinutes < minimumInterval) {
    return failure("interval_too_short", "Интервал короче одобренной пилотной схемы; пересмотри время повторной дозы.");
  }
  return { ok: true, classification: "reviewed_safe" };
}

export function evaluateProphylaxisAtMinute({ policy, state, currentOrder = null, atMinutes = state.clock.elapsedMinutes }) {
  if (!policy || !isContentAuthoritative(policy)) return { complete: false, regimenId: null };
  const windowMinutes = policy.administration_window_minutes_before_incision ?? 60;
  const administrations = [
    ...(state.treatments?.administered ?? []).filter((item) => item.purpose === "prophylaxis"),
    ...(currentOrder ? [{ ...currentOrder.params, purpose: "prophylaxis", atMinutes }] : []),
  ];
  for (const regimen of policy.accepted_regimens ?? []) {
    if (regimen.requires === "severe_beta_lactam_allergy" && state.truth?.severeBetaLactamAllergy !== true) continue;
    const matched = regimen.components.every((component) => administrations.some((item) =>
      item.drugId === component.drug_id &&
      item.route === component.route &&
      componentDoseMatches(component, item) &&
      atMinutes - item.atMinutes >= 0 &&
      atMinutes - item.atMinutes <= windowMinutes
    ));
    if (matched) return { complete: true, regimenId: regimen.id, windowMinutes };
  }
  return { complete: false, regimenId: null, windowMinutes };
}

function componentDoseMatches(component, item) {
  if (component.dose_mg != null) {
    return item.doseMg === component.dose_mg;
  }
  return component.dose_mg_per_kg != null && item.doseMgPerKg === component.dose_mg_per_kg;
}

/**
 * Every failure this function can return is a CONFORMANCE boundary — the order
 * is outside the reviewed pilot regimen (unknown route, dose not in the
 * approved set/range, not yet reviewed, cumulative pilot maximum, minimum
 * interval). Wave §12 / activation §11: that is an order-validation boundary,
 * NOT an instantaneous toxicity threshold, and it must not be recorded as
 * `reviewed_unsafe`. A genuine reviewed contraindication (allergy, NSAID in a
 * reviewed major contraindication) is classified where that rule lives, not
 * here.
 */
function failure(code, textRu) {
  return { ok: false, classification: "order_outside_pilot_schema", code, textRu };
}

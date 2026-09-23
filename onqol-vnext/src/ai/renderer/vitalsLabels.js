// Label/unit for every physiology field any disease's content may generate.
// Order is display order. A field a disease never produces is simply skipped.
export const VITALS_FIELD_RU = Object.freeze({
  heartRate: { label: "ЧСС", unit: "/мин" },
  systolicBp: { label: "АД сист.", unit: " мм рт.ст." },
  diastolicBp: { label: "АД диаст.", unit: " мм рт.ст." },
  respiratoryRate: { label: "ЧДД", unit: "/мин" },
  temperatureC: { label: "T", unit: " °C" },
  spo2Percent: { label: "SpO₂", unit: "%" },
  crtSeconds: { label: "CRT", unit: " с" },
  urineOutputMlPerHr: { label: "диурез", unit: " мл/ч" },
  lactate: { label: "лактат", unit: " ммоль/л" },
});
export const VITALS_FIELD_ORDER = Object.keys(VITALS_FIELD_RU);

export function formatObserved(values) {
  return VITALS_FIELD_ORDER.filter((field) => values?.[field] != null)
    .map((field) => `${VITALS_FIELD_RU[field].label} ${String(values[field]).replace(".", ",")}${VITALS_FIELD_RU[field].unit}`)
    .join(", ");
}

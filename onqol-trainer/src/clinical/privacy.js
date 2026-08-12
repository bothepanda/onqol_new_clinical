const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const IIN_RE = /(?<!\d)\d{12}(?!\d)/g;
const PHONE_CANDIDATE_RE = /(?<!\d)(?:\+?\d[\s().-]*){10,15}(?!\d)/g;
const CARD_CANDIDATE_RE = /(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g;
const DOB_RE = /(?:дата\s+рождения|д\.\s*р\.|туған\s+күні)\s*[:№-]?\s*\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/gi;
const LABELED_ID_RE = /(?:удостоверение|паспорт|идентификатор|patient\s*id)\s*[:№-]?\s*[A-ZА-Я0-9-]{6,20}/gi;
const LABELED_NAME_RE = /(?:фио|аты[- ]жөні|patient\s+name)\s*:\s*[A-ZА-ЯЁӘҒҚҢӨҰҮҺІ][^,;\n]{2,80}/gi;
const LABELED_ADDRESS_RE = /(?:адрес|мекенжай|address)\s*:\s*[^;\n]{4,120}/gi;

export function scrubSensitiveText(value) {
  return String(value || "")
    .replace(EMAIL_RE, "[EMAIL_REDACTED]")
    .replace(IIN_RE, "[IIN_REDACTED]")
    .replace(DOB_RE, "[DOB_REDACTED]")
    .replace(LABELED_ID_RE, "[ID_REDACTED]")
    .replace(LABELED_NAME_RE, "[NAME_REDACTED]")
    .replace(LABELED_ADDRESS_RE, "[ADDRESS_REDACTED]")
    .replace(CARD_CANDIDATE_RE, (candidate) => {
      const digitCount = candidate.replace(/\D/g, "").length;
      return digitCount >= 13 && digitCount <= 19 ? "[CARD_REDACTED]" : candidate;
    })
    .replace(PHONE_CANDIDATE_RE, (candidate) => {
      const digitCount = candidate.replace(/\D/g, "").length;
      return digitCount >= 10 && digitCount <= 15 ? "[PHONE_REDACTED]" : candidate;
    });
}

export function scrubSensitiveData(value) {
  if (Array.isArray(value)) return value.map(scrubSensitiveData);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, scrubSensitiveData(entry)])
    );
  }
  return typeof value === "string" ? scrubSensitiveText(value) : value;
}

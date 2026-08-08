const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const IIN_RE = /(?<!\d)\d{12}(?!\d)/g;
const PHONE_CANDIDATE_RE = /(?<!\d)(?:\+?\d[\s().-]*){10,15}(?!\d)/g;

export function scrubSensitiveText(value) {
  return String(value || "")
    .replace(EMAIL_RE, "[EMAIL_REDACTED]")
    .replace(IIN_RE, "[IIN_REDACTED]")
    .replace(PHONE_CANDIDATE_RE, (candidate) => {
      const digitCount = candidate.replace(/\D/g, "").length;
      return digitCount >= 10 && digitCount <= 15 ? "[PHONE_REDACTED]" : candidate;
    });
}


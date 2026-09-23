import { COMMAND } from "../../core/commands/commandTypes.js";
import { containsNormalized } from "./textMatch.js";

export const HIGH_RISK_PARAMETER_KEYS = Object.freeze([
  "dose",
  "doseMg",
  "route",
  "volumeMl",
  "durationMinutes",
  "intervalMinutes",
  "afterMinutes",
]);

const HIGH_RISK = new Set(HIGH_RISK_PARAMETER_KEYS);
const MEDICATION_COMMANDS = new Set([COMMAND.ORDER_MEDICATION, COMMAND.GIVE_ANTIBIOTIC_PROPHYLAXIS]);

/**
 * The model may classify a command and an allowlisted concept. Numeric order
 * parameters are rebuilt only from the learner's verbatim evidence span.
 * This function is evaluation/shadow infrastructure; it never executes a
 * model command and it never consults patient weight or clinical truth.
 */
export function bindModelCommands({ actions, commands, rawText, openClarification = null }) {
  return (actions ?? commands ?? []).map((candidate, index) => bindModelCommand({
    candidate,
    index,
    rawText,
    openClarification,
  }));
}

export function bindModelCommand({ candidate, index = 0, rawText, openClarification = null }) {
  const requestedSpans = candidate.evidenceSpans ?? (candidate.evidence ? [candidate.evidence] : []);
  const verifiedSpans = requestedSpans.map((span) => verbatimEvidence(span, rawText));
  const evidenceVerified = verifiedSpans.length > 0 && verifiedSpans.every(Boolean);
  const evidence = evidenceVerified ? verifiedSpans.join(" ") : null;
  const inherited = inheritedParams(candidate.type, openClarification);
  const safeParams = Object.fromEntries(
    Object.entries(candidate.params ?? {}).filter(([key]) => !HIGH_RISK.has(key)),
  );
  const params = { ...inherited, ...safeParams };
  const rejectedModelParams = Object.fromEntries(
    Object.entries(candidate.params ?? {}).filter(([key]) => HIGH_RISK.has(key)),
  );
  const normalized = normalize(evidence ?? "");
  const explicit = evidence ? bindExplicitParameters(candidate.type, normalized) : { params: {}, unboundExpressions: [] };
  Object.assign(params, explicit.params);

  return {
    index,
    command: { type: candidate.type, params, evidenceSpans: [...requestedSpans], evidence: requestedSpans.join(" ") },
    evidenceVerified,
    statedParameterCategories: [...(candidate.statedParameters ?? [])],
    rejectedModelParams,
    boundParameterKeys: Object.keys(explicit.params),
    unboundExpressions: explicit.unboundExpressions,
  };
}

function bindExplicitParameters(type, text) {
  const params = {};
  const unboundExpressions = [];

  if (MEDICATION_COMMANDS.has(type)) {
    const dose = extractDose(text);
    if (dose) Object.assign(params, dose);
    const route = extractRoute(text);
    if (route) params.route = route;
  }

  if (type === COMMAND.ORDER_INFUSION) {
    const weightBased = /(\d+(?:[.,]\d+)?)\s*(?:мл|ml)\s*\/\s*(?:кг|kg)(?=$|\s|[.,;])/i.exec(text);
    if (weightBased) {
      unboundExpressions.push({ kind: "weight_based_volume", expression: weightBased[0] });
    } else {
      const volume = /(\d+(?:[.,]\d+)?)\s*(?:мл|ml)(?=$|\s|[.,;])/i.exec(text);
      // Litres are volume too («2 л», «около 1 л»): a unit conversion of a number the learner wrote, never a guess.
      // «л/мин» (an oxygen flow) is not a volume: the unit must end the token.
      const litres = volume ? null : /(\d+(?:[.,]\d+)?)\s*(?:л|l)(?=$|\s|[.,;])/i.exec(text);
      if (volume) params.volumeMl = number(volume[1]);
      else if (litres) params.volumeMl = Math.round(number(litres[1]) * 1000);
    }
    const duration = extractDurationMinutes(text, { requiresTemporalCue: true });
    if (duration != null) params.durationMinutes = duration;
    if (/(?:^|[^\p{L}\p{N}])болюс(?:ом)?(?=$|[^\p{L}\p{N}])/iu.test(text)) params.bolus = true;
  }

  if (type === COMMAND.PRESCRIBE_MONITORING) {
    const interval = extractDurationMinutes(text, { requiresTemporalCue: false });
    if (interval != null) params.intervalMinutes = interval;
  }

  // "жду результаты": waiting for what is already in flight, no duration named.
  if (type === COMMAND.WAIT && /(?:жду|дожд[а-яё]*|ожида[а-яё]*)\s+(?:\S+\s+)?(?:результат|анализ|ответ|лаборатор|данные)/i.test(text)) params.untilNextPending = true;

  if (type === COMMAND.REASSESS || type === COMMAND.WAIT) {
    const after = extractDurationMinutes(text, { requiresTemporalCue: false });
    if (after != null) params.afterMinutes = after;
  }

  return { params, unboundExpressions };
}

function extractDose(text) {
  const match = /(\d+(?:[.,]\d+)?)\s*(мг|mg|г|g)(?=$|\s|[.,;])/i.exec(text);
  if (!match) return null;
  const amount = number(match[1]);
  const unit = /^(г|g)$/i.test(match[2]) ? "г" : "мг";
  return {
    dose: `${canonicalNumber(amount)} ${unit}`,
    doseMg: unit === "г" ? amount * 1000 : amount,
  };
}

function extractRoute(text) {
  if (/(?:^|\s)(?:в\s*\/\s*в|iv)(?:$|\s|[.,;!?])/i.test(text) || /внутривен/i.test(text)) return "iv";
  if (/(?:^|\s)(?:в\s*\/\s*м|im)(?:$|\s|[.,;!?])/i.test(text) || /внутримыш/i.test(text)) return "im";
  if (/(?:^|\s)(?:po)(?:$|\s|[.,;!?])/i.test(text) || /внутрь|перорал/i.test(text)) return "oral";
  return null;
}

function extractDurationMinutes(text, { requiresTemporalCue }) {
  const cue = requiresTemporalCue ? "(?:за|в течение)\\s*" : "(?:через|каждые|за|в течение)?\\s*";
  const hours = new RegExp(`${cue}(\\d+(?:[.,]\\d+)?)?\\s*(?:час(?:а|ов)?|ч\\b)`, "i").exec(text);
  if (hours) return number(hours[1] ?? "1") * 60;
  const minutes = new RegExp(`${cue}(\\d+(?:[.,]\\d+)?)\\s*(?:мин(?:ут[уы]?)?|minute(?:s)?)`, "i").exec(text);
  return minutes ? number(minutes[1]) : null;
}

function inheritedParams(type, openClarification) {
  if (!openClarification || openClarification.commandType !== type) return {};
  return { ...(openClarification.params ?? {}) };
}

function verbatimEvidence(evidence, rawText) {
  const raw = String(rawText ?? "");
  const span = String(evidence ?? "").trim();
  if (!span) return null;
  return normalize(raw).includes(normalize(span)) || containsNormalized(raw, span) ? span : null;
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
}
function number(value) { return Number(String(value).replace(",", ".")); }
function canonicalNumber(value) { return Number.isInteger(value) ? String(value) : String(value); }

import { acuteAppendicitisCase } from "./cases/acuteAppendicitis.js";

export const caseRegistry = Object.freeze([acuteAppendicitisCase]);

function normalize(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

function seededUnitInterval(seed) {
  const text = String(seed);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

function matchesFilter(caseData, filters, locale) {
  if (filters.specialty && normalize(caseData.specialty) !== normalize(filters.specialty)) return false;
  if (filters.difficulty && normalize(caseData.difficulty) !== normalize(filters.difficulty)) return false;
  if (
    filters.trainingLevel &&
    ![caseData.training_level, caseData.target_level].some(
      (value) => normalize(value) === normalize(filters.trainingLevel)
    )
  ) {
    return false;
  }
  if (
    filters.resourceSetting &&
    ![caseData.resource_setting, caseData.resource_context?.level].some(
      (value) => normalize(value) === normalize(filters.resourceSetting)
    )
  ) {
    return false;
  }

  const requestedLanguage = filters.language || locale;
  return !requestedLanguage || (caseData.supported_locales || []).includes(requestedLanguage);
}

function selectionMetadata(caseData, selectionMethod, locale) {
  return Object.freeze({
    case_id: caseData.case_id,
    case_version: caseData.case_version,
    selection_method: selectionMethod,
    difficulty: caseData.difficulty,
    resource_context: caseData.resource_context,
    locale,
  });
}

export function selectCase(options = {}) {
  const {
    category,
    filters = {},
    locale = "ru",
    seed,
    requestedCaseId,
    previousCaseId,
    includeInactive = false,
    registry = caseRegistry,
    random = Math.random,
  } = options;

  if (requestedCaseId) {
    const requested = registry.find(
      (caseData) =>
        caseData.case_id === requestedCaseId && (includeInactive || caseData.status === "active")
    );
    if (!requested) throw new Error(`Case ${requestedCaseId} is not available.`);
    return {
      caseData: requested,
      selection: selectionMetadata(requested, "faculty_requested_case_id", locale),
    };
  }

  const eligible = registry.filter(
    (caseData) =>
      (includeInactive || caseData.status === "active") &&
      (!category || caseData.category === category) &&
      matchesFilter(caseData, filters, locale)
  );

  if (eligible.length === 0) throw new Error("No active cases match the selected filters.");
  if (eligible.length === 1) {
    return {
      caseData: eligible[0],
      selection: selectionMetadata(eligible[0], "single_eligible", locale),
    };
  }

  const nonRepeating = previousCaseId
    ? eligible.filter((caseData) => caseData.case_id !== previousCaseId)
    : eligible;
  const candidates = nonRepeating.length > 0 ? nonRepeating : eligible;
  const unit = seed === undefined || seed === null ? random() : seededUnitInterval(seed);
  const selected = candidates[Math.min(candidates.length - 1, Math.floor(unit * candidates.length))];
  const method = seed === undefined || seed === null ? "random" : "seeded_random";

  return {
    caseData: selected,
    selection: selectionMetadata(selected, method, locale),
  };
}


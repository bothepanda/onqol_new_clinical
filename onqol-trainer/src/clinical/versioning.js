function stableSerialize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;

  const entries = Object.entries(value)
    .filter(([, entryValue]) => entryValue !== undefined && typeof entryValue !== "function")
    .sort(([left], [right]) => left.localeCompare(right));

  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`)
    .join(",")}}`;
}

export function contentHash(value) {
  const input = stableSerialize(value);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * prime);
  }

  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function rubricContent(caseData) {
  return {
    expected_actions: caseData.expected_actions,
    acceptable_alternatives: caseData.acceptable_alternatives,
    unnecessary_actions: caseData.unnecessary_actions,
    unsafe_actions: caseData.unsafe_actions,
    critical_omissions: caseData.critical_omissions,
    diagnostic_milestones: caseData.diagnostic_milestones,
    management_milestones: caseData.management_milestones,
    scoring: caseData.scoring,
  };
}

export function buildSessionVersionSnapshot(caseData, options = {}) {
  const snapshot = {
    case_id: caseData.case_id,
    case_version: caseData.case_version,
    disease_card_id: caseData.disease_card_id,
    disease_card_version: caseData.disease_card_version,
    scoring_rubric_version: caseData.scoring_rubric_version,
    router_version: options.routerVersion || caseData.router_version,
    locale: options.locale || caseData.default_locale || "ru",
    resource_context: clone(caseData.resource_context),
    case_content_hash: contentHash(caseData),
    scoring_rubric_hash: contentHash(rubricContent(caseData)),
  };

  return Object.freeze(snapshot);
}


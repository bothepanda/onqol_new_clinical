const OPERATORS = new Set(["equals", "not_equals", "gte", "lte", "includes", "not_includes", "truthy", "falsy"]);

/** Disease-neutral conditions for reviewed runtime content. Unknown input fails closed. */
export function contentConditionsMet(conditions, state) {
  if (!Array.isArray(conditions) || conditions.length === 0) return true;
  return conditions.every((condition) => evaluateContentCondition(condition, state) === true);
}

export function evaluateContentCondition(condition, state) {
  if (!condition || typeof condition.path !== "string" || !OPERATORS.has(condition.operator)) return false;
  const actual = readStatePath(state, condition.path);
  if (actual === undefined) return false;
  switch (condition.operator) {
    case "equals": return actual === condition.value;
    case "not_equals": return actual !== condition.value;
    case "gte": return Number.isFinite(actual) && Number.isFinite(condition.value) && actual >= condition.value;
    case "lte": return Number.isFinite(actual) && Number.isFinite(condition.value) && actual <= condition.value;
    case "includes": return Array.isArray(actual) && actual.includes(condition.value);
    case "not_includes": return Array.isArray(actual) && !actual.includes(condition.value);
    case "truthy": return actual === true;
    case "falsy": return actual === false;
    default: return false;
  }
}

export function readStatePath(state, path) {
  if (!path || path.split(".").some((part) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(part))) return undefined;
  return path.split(".").reduce((value, key) => value?.[key], state);
}

export function isKnownContentOperator(operator) {
  return OPERATORS.has(operator);
}

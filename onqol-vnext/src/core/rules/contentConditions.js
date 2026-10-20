const OPERATORS = new Set(["equals", "not_equals", "gte", "lte", "includes", "not_includes", "truthy", "falsy"]);

/** Disease-neutral conditions for reviewed runtime content. Unknown input fails closed. */
export function contentConditionsMet(conditions, state) {
  if (conditions === undefined || conditions === null) return true;
  if (!Array.isArray(conditions)) return false;
  if (conditions.length === 0) return true;
  return conditions.every((condition) => evaluateContentCondition(condition, state) === true);
}

export function evaluateContentCondition(condition, state) {
  if (!condition || typeof condition.path !== "string" || !OPERATORS.has(condition.operator)) return false;
  const actual = readStatePath(state, condition.path);
  if (actual === undefined) return false;
  const expected = condition.value_path !== undefined ? readStatePath(state, condition.value_path) : condition.value;
  switch (condition.operator) {
    case "equals": return actual === expected;
    case "not_equals": return actual !== expected;
    case "gte": return Number.isFinite(actual) && Number.isFinite(expected) && actual >= expected;
    case "lte": return Number.isFinite(actual) && Number.isFinite(expected) && actual <= expected;
    case "includes": return Array.isArray(actual) && actual.includes(expected);
    case "not_includes": return Array.isArray(actual) && !actual.includes(expected);
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

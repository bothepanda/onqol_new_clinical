function getByPath(object, path) {
  const firstDot = path.indexOf(".");
  if (firstDot > -1) {
    const namespace = path.slice(0, firstDot);
    const literalKey = path.slice(firstDot + 1);
    if (typeof object?.[namespace]?.[literalKey] !== "undefined") {
      return object[namespace][literalKey];
    }
  }

  return path.split(".").reduce((value, key) => value?.[key], object);
}

function collectTextKeys(core) {
  return [
    ...(core.recommendations || []).map((item) => item.text_key),
    ...(core.kz_protocol_delta || []).map((item) => item.text_key),
    ...(core.teaching_traps || []).map((item) => item.text_key),
    ...(core.operationalized_rules || []).map((item) => item.text_key),
    ...Object.values(core.classification || {}).map((item) => item.definition_key || item.note_key),
  ].filter(Boolean);
}

export function validateAppendicitisSource(core, locales) {
  const errors = [];
  const textKeys = collectTextKeys(core);

  for (const localeName of core.supported_locales || []) {
    const locale = locales[localeName];
    if (!locale) {
      errors.push(`Missing locale file: ${localeName}`);
      continue;
    }

    for (const key of textKeys) {
      if (typeof getByPath(locale, key) !== "string") {
        errors.push(`Missing locale key ${localeName}:${key}`);
      }
    }
  }

  for (const recommendation of core.recommendations || []) {
    if (recommendation.strength === "conditional" && recommendation.absolute_ban === true) {
      errors.push(`Conditional recommendation encoded as absolute ban: ${recommendation.id}`);
    }
  }

  for (const rule of core.operationalized_rules || []) {
    if (rule.eligible_for_scoring !== false) {
      errors.push(`Operationalized rule must not score before review: ${rule.id}`);
    }
  }

  if (core.review?.release_gate?.production_allowed !== false) {
    errors.push("Production gate should remain closed until independent review is complete.");
  }

  return {
    ok: errors.length === 0,
    errors,
    textKeys,
  };
}

export function localeHasNoClinicalRuleSections(locale) {
  const forbidden = [
    "recommendations",
    "numeric_facts",
    "resource_context",
    "scoring_semantics",
    "operationalized_rules",
  ];
  return forbidden.filter((key) => Object.hasOwn(locale, key));
}

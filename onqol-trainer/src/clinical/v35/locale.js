// The locale contract, and what is missing against it.
//
// Addendum 2: "RU и KZ используют один clinical data model. Locale содержит
// только текст." So a locale is never a second copy of the case - it is a set of
// strings keyed by the same ids, and clinical truth is identical across
// languages by construction.
//
// KZ text is NOT authored here. Machine-translating clinical prompts is not
// language review, and a Kazakh string nobody has read is worse than an obvious
// gap: it looks done. What this file provides instead is the contract and a
// report of every key still missing, so the gap is countable rather than
// discovered during a pilot.

import { CASE_PRESETS, PHENOTYPES } from "./phenotypes.js";
import { ALTERNATIVE_DISEASES } from "./alternatives.js";
import { PATH_STATES } from "./pathStates.js";

export const SUPPORTED_LOCALES = Object.freeze(["ru", "kk"]);
export const SOURCE_LOCALE = "ru";

/**
 * Which fields carry learner- or mentor-facing text, per object kind.
 *
 * A field listed here must exist in every supported locale before that locale is
 * usable. Anything not listed is structure, and structure has no language.
 */
export const LOCALISED_FIELDS = Object.freeze({
  // Presentation text is now variant lists rather than one sentence, so the
  // localised keys are the lists themselves plus the pain sites.
  phenotype: ["title", "presentation.pain_sites", "imaging.operative_truth"],
  case_preset: ["title", "key_skill"],
  path_state: ["learner_goal", "mentor_focus"],
  alternative: ["hidden_truth", "discriminators", "safe_endpoint"],
});

/** Read `a.b.c` off an object, tolerating absent intermediates. */
function pluck(source, path) {
  return path.split(".").reduce((value, key) => (value == null ? undefined : value[key]), source);
}

/**
 * Every localised key, and which locales actually have it.
 *
 * Fields are stored suffixed (`title_ru`, `title_kk`), so presence is a direct
 * lookup rather than a separate bundle that can drift from the data.
 *
 * @returns {{locale: string, missing: string[], present: number}[]}
 */
export function localeCoverage() {
  const rows = [];
  const check = (kind, id, source, fields) => {
    for (const field of fields) {
      for (const locale of SUPPORTED_LOCALES) {
        const value = pluck(source, `${field}_${locale}`);
        rows.push({
          kind,
          id,
          key: field,
          locale,
          // Some localised fields are lists now (pain sites, examination
          // variants), so presence means "a non-empty string, or a list of them".
          present: Array.isArray(value)
            ? value.length > 0 && value.every((item) => typeof item === "string" && item.trim())
            : typeof value === "string" && value.trim().length > 0,
        });
      }
    }
  };

  for (const [id, phenotype] of Object.entries(PHENOTYPES)) {
    check("phenotype", id, phenotype, LOCALISED_FIELDS.phenotype);
  }
  for (const preset of CASE_PRESETS) {
    check("case_preset", preset.case_preset_id, preset, LOCALISED_FIELDS.case_preset);
  }
  for (const state of PATH_STATES) {
    // mentor_focus exists only where addendum 8.2 names the stage; a state
    // without one is not a missing translation.
    const fields = LOCALISED_FIELDS.path_state.filter(
      (field) => field !== "mentor_focus" || state.mentor_focus_ru !== undefined
    );
    check("path_state", state.state_id, state, fields);
  }
  for (const entry of ALTERNATIVE_DISEASES) {
    check("alternative", entry.alternative_id, entry, LOCALISED_FIELDS.alternative);
  }

  return SUPPORTED_LOCALES.map((locale) => {
    const forLocale = rows.filter((row) => row.locale === locale);
    return {
      locale,
      present: forLocale.filter((row) => row.present).length,
      total: forLocale.length,
      missing: forLocale.filter((row) => !row.present).map((row) => `${row.kind}:${row.id}.${row.key}`),
    };
  });
}

/**
 * Is a locale complete enough to show a learner.
 *
 * The pilot gate: RU must be complete before KZ is started, and KZ must be
 * complete before a Kazakh-speaking resident sees the trainer. Reported, not
 * enforced by hiding - a silently missing string is how a learner ends up
 * reading Russian inside a Kazakh session.
 */
export function localeReadiness() {
  const coverage = localeCoverage();
  return coverage.map((row) => ({
    ...row,
    learner_ready: row.missing.length === 0,
    status:
      row.missing.length === 0
        ? "complete"
        : row.locale === SOURCE_LOCALE
          ? "incomplete_source_locale"
          : "pending_language_review",
  }));
}

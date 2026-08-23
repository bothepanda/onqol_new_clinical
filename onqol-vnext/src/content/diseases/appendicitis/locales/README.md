# Locale status for appendicitis clinical content

Clinical content strings (`*_ru` fields across this module's YAML files) are
authored in Russian only for the first vertical slice, matching the legacy
corpus's own scope (`supported_locales: [ru, kk]`, `kk: draft_clinical_translation`,
pilot scope RU-only per `CLINICAL_VALIDATION_MATRIX.md`).

Kazakh clinical-content translation is **not done** in vNext. It requires a
Kazakh clinical-language reviewer, which the legacy corpus never obtained
either (`translation_status.kk: draft_clinical_translation`). Building the
locale *architecture* to support it (this folder existing, `ru`/`kk` as
first-class locale ids throughout `src/core` and `src/ai`) is in scope; filling
it with reviewed Kazakh clinical prose is not.

UI chrome strings (buttons, labels, sidebar headings) are locale-complete for
`ru`/`kk`/`en` in `src/ui/i18n/` - that is a translation task for interface
copy, not for clinical content, and does not require a clinical reviewer.

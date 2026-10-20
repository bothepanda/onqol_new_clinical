import { normalizeText } from "./textMatch.js";

/**
 * A clause that names an intervention the platform recognises and does not
 * model («кислород», «норадреналин») is not "unrecognised": the learner was
 * understood and the simulator cannot act on it. Such clauses are reported in
 * `recognizedUnmodeled` (and removed from `unmatchedFragments`), which the
 * session records as a simulator limitation
 * (concepts.yaml#recognized_unmodeled_interventions).
 *
 * The raw text is scanned clause by clause, not only the unmatched fragments:
 * a whole-turn shortcut («дайте кислород и измерьте сатурацию» -> one
 * measurement) would otherwise drop the request silently. A negated clause
 * («кислород не нужен», «без кислорода») is not a request.
 *
 * Applies to every interpreter's output and is idempotent, so a recorded
 * interpretation replays to the same result.
 */
export function separateRecognizedUnmodeled(interpreted, bundle, text = null) {
  const entries = bundle?.shared?.interaction?.recognized_unmodeled_interventions ?? [];
  if (!interpreted || entries.length === 0 || interpreted.recognizedUnmodeled) return interpreted;
  const recognized = [];
  for (const clause of splitClauses(interpreted.rawText ?? text ?? "")) {
    if (NEGATED.test(normalizeText(clause))) continue;
    const entry = entries.find((candidate) => mentionsStem(clause, candidate.stems_ru ?? []));
    if (entry && !recognized.some((item) => item.id === entry.id)) recognized.push({ id: entry.id, labelRu: entry.label_ru, fragment: clause });
  }
  if (recognized.length === 0) return interpreted;
  const namesUnmodeled = (fragment) => entries.some((candidate) => mentionsStem(fragment ?? "", candidate.stems_ru ?? []));
  const unmatchedFragments = (interpreted.unmatchedFragments ?? []).filter((fragment) => !namesUnmodeled(fragment));
  // A drug/fluid order with no identified drug or fluid, read from a clause
  // that named an unmodeled intervention, is that intervention - not a
  // "which drug?" clarification (a semantic model may propose oxygen as one).
  const commands = (interpreted.commands ?? []).filter((command) => !(
    UNIDENTIFIED_ORDER[command.type]?.(command.params ?? {}) && namesUnmodeled(command.sourceText)
  ));
  return { ...interpreted, commands, unmatchedFragments, recognizedUnmodeled: recognized };
}

const UNIDENTIFIED_ORDER = Object.freeze({
  ORDER_MEDICATION: (params) => !params.drugId,
  ORDER_INFUSION: (params) => !params.fluidId,
});

const NEGATED = /(?:^|[^\p{L}])(?:не|без|нет|отменяю|отмените|стоп)(?:[^\p{L}]|$)/u;

function splitClauses(text) {
  return String(text).split(/[,;.!?\n]|\s(?:и|а|затем|потом)\s/u).map((part) => part.trim()).filter(Boolean);
}

// Word-start match on normalised text; no `\b` (it never matches Cyrillic).
function mentionsStem(text, stems) {
  const normalized = normalizeText(text);
  return stems.some((stem) => {
    const needle = normalizeText(stem);
    let at = normalized.indexOf(needle);
    while (at >= 0) {
      if (at === 0 || !/[\p{L}\p{N}]/u.test(normalized[at - 1])) return true;
      at = normalized.indexOf(needle, at + 1);
    }
    return false;
  });
}

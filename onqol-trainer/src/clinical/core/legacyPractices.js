/**
 * Registry of non-EBM practices that are nonetheless common in the region.
 *
 * WHY IT EXISTS. A resident who writes «литическая смесь» is not making a typo
 * and is not inventing anything: they are repeating what the department does.
 * The trainer answering "не распознано" teaches nothing, and silently executing
 * it teaches something worse. The right answer is a mentor who recognises the
 * practice, names it, and says what the evidence base actually supports.
 *
 * WHAT THIS FILE CONTAINS AND WHAT IT DOES NOT. Recognition only. Every entry
 * carries the phrases the learner might write and an empty teaching slot with
 * status NEEDS_CLINICAL_REVIEW. The teaching content - what the practice is,
 * why better-evidenced alternatives exist, what to use instead - is authored by
 * the clinical owner against named sources and signed by a reviewer. It is
 * never written in code, and until it is signed the mentor discusses the
 * decision without asserting any clinical claim about the practice.
 *
 * A recognised legacy practice is never executed on the patient as an approved
 * action. It routes to the mentor.
 *
 * The practice ids match the draft entries in DOSING_RULES_DRAFT_v0.1.md so the
 * reviewed teaching text drops into the slots below without a rename.
 *
 * WHAT LEFT THIS REGISTRY, AND WHY IT DID NOT NEED A REPLACEMENT
 *
 * `legacy.metamizole-solo` was removed on 20.08.2026 by owner decision: a drug
 * that is in the Kazakhstan formulary is not a historical practice, and calling
 * it one was a clinical claim this registry has no signed text for. Removing the
 * entry does not make metamizole invisible - `core/operationalization.js` still
 * recognises «метамизол»/«анальгин» as a named agent, and with no approved
 * dosing rule the order is transcribed and classified `not_yet_reviewed` by
 * parameterSafety.js. Recognised, not executed, not judged: which is the
 * behaviour the decision asked for.
 */

export const LEGACY_PRACTICE_REVIEW_STATUS = "NEEDS_CLINICAL_REVIEW";
export const LEGACY_PRACTICE_REGISTRY_VERSION = "legacy-practice-registry-v0.1";

/**
 * @typedef {object} LegacyPractice
 * @property {string} practice_id
 * @property {string} label_ru            what to call it back to the learner
 * @property {RegExp[]} patterns          learner phrasings that name it
 * @property {string|null} teaching_rule_id  the approved rule that teaches it
 * @property {null} what_it_is            authored content, not code
 * @property {null} why_alternatives_exist
 * @property {null} what_instead
 * @property {string} review_status
 */
function legacyPractice(fields) {
  return Object.freeze({
    teaching_rule_id: null,
    // The three content slots stay null until a reviewer signs authored text
    // against a named source. A placeholder sentence here would be exactly the
    // invented medicine this registry exists to catch.
    what_it_is: null,
    why_alternatives_exist: null,
    what_instead: null,
    review_status: LEGACY_PRACTICE_REVIEW_STATUS,
    executes_on_patient: false,
    ...fields,
  });
}

export const LEGACY_PRACTICE_REGISTRY = Object.freeze([
  legacyPractice({
    practice_id: "legacy.lytic-mixture",
    label_ru: "литическая смесь",
    patterns: [
      /литическ\p{L}*\s+смес\p{L}*/iu,
      /(?=[^]*анальгин)(?=[^]*димедрол)[^]*/iu,
      /(?=[^]*метамизол)(?=[^]*дифенгидрамин)[^]*/iu,
      /(?=[^]*анальгин)(?=[^]*папаверин)[^]*/iu,
    ],
  }),
  legacyPractice({
    practice_id: "legacy.golod-holod-pokoy",
    label_ru: "«голод, холод и покой»",
    // The slogan is recognised only as a WHOLE management strategy, which is
    // the only thing about it that is historical (owner decision, 20.08.2026).
    //
    // The earlier patterns also fired on «холод на живот» and «пузырь со льдом»
    // standing alone. Those are single measures, not a tactic, and a resident
    // who names one inside an otherwise complete plan was being handed a
    // historical-practice flag for it. Temporary NPO and disease-specific bowel
    // rest are likewise ordinary orders and must not trigger this entry at all;
    // nutrition in pancreatitis comes from the disease card, not from matching
    // a slogan.
    patterns: [/голод\p{L}*[,\s]+холод\p{L}*[,\s]+(и\s+)?поко\p{L}*/iu],
  }),
]);

export const legacyPracticeById = new Map(
  LEGACY_PRACTICE_REGISTRY.map((practice) => [practice.practice_id, practice])
);

/**
 * Which legacy practices the learner just named.
 *
 * Returns registry entries, not clinical text: the caller hands them to the
 * mentor as "this was named and no approved rule teaches it yet".
 */
export function detectLegacyPractices(text, registry = LEGACY_PRACTICE_REGISTRY) {
  const input = String(text || "");
  if (!input.trim()) return [];
  return registry.filter((practice) =>
    practice.patterns.some((pattern) => pattern.test(input))
  );
}

/** The shape the mentor brief carries. Never contains a clinical assertion. */
export function legacyPracticeBriefEntry(practice) {
  return {
    practice_id: practice.practice_id,
    label_ru: practice.label_ru,
    review_status: practice.review_status,
    teaching_rule_id: practice.teaching_rule_id,
    approved_teaching_available: Boolean(practice.teaching_rule_id),
    guidance:
      "Практика названа резидентом. Одобренного правила по ней пока нет: не утверждай ничего клинического о ней, не назначай её как выполненную и не выдумывай альтернативу.",
  };
}

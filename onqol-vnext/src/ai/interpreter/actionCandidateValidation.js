import { COMMAND, createCommand, validateCommand } from "../../core/commands/commandTypes.js";
import { bindModelCommand } from "./deterministicParameterBinder.js";
import { EXCLUSION_HAS_NO_ALTERNATIVE, GROUNDING_MODE, STAFF_REQUEST_CUES, mentionsImagingCategory, mentionsImagingModality } from "./conceptGrounding.js";
import { enclosingFragmentText } from "./commitmentPolicy.js";
import { detectParameterInventions, identifyingParamKey, matchCandidateLanguage, validateCandidateStructure } from "./modelConceptValidation.js";
import { DEFAULT_PROMOTION_POLICY } from "./promotionPolicy.js";
import { containsAny, normalizeText, substantiveTokens } from "./textMatch.js";

const STAFF_ROLE_WORDS = Object.freeze({ surgeon: ["хирург"], anesthesiologist: ["анестезиолог"], gynecologist: ["гинеколог"], icuPhysician: ["реаниматолог"], radiologist: ["рентгенолог", "радиолог"] });

/**
 * Candidate-level validation of a semantic ACTION task (interpreter v3).
 *
 * Every proposed item - each clinicalAction AND each patientQuestion - is
 * judged on its own:
 *
 *   {
 *     index, source, candidate,
 *     decision: "ACCEPT" | "CLARIFY" | "REJECT",
 *     reasonCodes: [], validatedCommand: null | {...}, evidenceSpans: [],
 *     grounding, missing
 *   }
 *
 * One rejected candidate never invalidates another from the same turn. Only
 * provider / transport / schema failure is task-level, and it is handled by the
 * caller before this function runs.
 *
 * Layers, in order, each with a different job:
 *   A. structural / safety (hard, phrasing-independent): allowlisted type,
 *      parameter schema, concept ids, verbatim evidence, tentative high-risk
 *      guard, parameter invention. Any failure -> REJECT.
 *   B. deterministic parameter binding: numeric / route values come ONLY from
 *      the learner's literal text or an open clarification, never the model.
 *   C. semantic-language matching (conceptGrounding.js): how the learner's
 *      words relate to the chosen concept. Its consequence depends on the
 *      concept kind and on whether the command class is promoted.
 *   D. command completeness (validateCommand): a recognised kind of action with
 *      a missing required parameter is a CLARIFY, never a guess.
 *
 * The model can never make a candidate ACCEPT by asserting more; it can only
 * be accepted, asked about, or dropped.
 */
// A named specialist («эндокринолог», «онколог») the staff registry has no role for. The three modeled roles are excluded by their own words.
const UNMODELED_SPECIALIST = /(?:^|\s)[а-яё]{3,}олог[а-яё]*/;
export const DECISION = Object.freeze({ ACCEPT: "ACCEPT", CLARIFY: "CLARIFY", REJECT: "REJECT" });

export function validateActionCandidates({ output, text, turnContext = {}, allowlist, policy = DEFAULT_PROMOTION_POLICY }) {
  const entries = [
    ...output.clinicalActions.map((candidate, index) => ({ source: "clinicalAction", index, candidate })),
    // A patient question is an ASK_PATIENT command candidate like any other:
    // same validation, same downstream pipeline. There is no second path.
    ...output.patientQuestions.map((question, index) => ({
      source: "patientQuestion",
      index,
      candidate: { type: COMMAND.ASK_PATIENT, params: { topic: question.topic }, evidenceSpans: question.evidenceSpans, statedParameters: [] },
    })),
  ];
  const inventions = detectParameterInventions({
    output: { clinicalActions: entries.map((entry) => entry.candidate) },
    rawText: text,
    openClarification: turnContext.openClarification,
  });
  const candidateResults = entries.map((entry, position) => evaluateCandidate({
    entry,
    position,
    allowlist,
    text,
    openClarification: turnContext.openClarification,
    policy,
    inventionKinds: inventions.highRisk.filter((issue) => issue.index === position).map((issue) => issue.kind),
  }));

  // One phrase is not evidence for several DIFFERENT actions the learner never named. A model that reads a generic
  // label («подготовка к операции») as five separate orders attaches all of them to the same words; each is
  // "semantic only" (no anchor of its own). Such a group is dropped: the learner said one thing, and an
  // unanchored reading may not multiply it into a set of orders.
  const bySpan = new Map();
  for (const result of candidateResults) {
    if (result.decision !== DECISION.ACCEPT || result.grounding !== "semantic_only") continue;
    const key = normalizeText((result.evidenceSpans ?? []).join(" "));
    bySpan.set(key, [...(bySpan.get(key) ?? []), result]);
  }
  for (const group of bySpan.values()) {
    // Two different actions, or two different studies/drugs of the same action, on one unanchored phrase.
    if (new Set(group.map((result) => `${result.validatedCommand.type}:${JSON.stringify(Object.fromEntries(Object.entries(result.validatedCommand.params ?? {}).filter(([key]) => ["testId", "drugId", "fluidId", "region", "role", "destination", "intent", "topic"].includes(key))))}`)).size < 2) continue;
    for (const result of group) {
      result.decision = DECISION.REJECT;
      result.reasonCodes = [...new Set([...result.reasonCodes, "one_span_many_actions"])];
      result.validatedCommand = null;
    }
  }

  const errors = [];
  for (const result of candidateResults) {
    if (result.decision === DECISION.ACCEPT) continue;
    const path = result.source === "clinicalAction" ? "clinicalActions" : "patientQuestions";
    for (const code of result.reasonCodes) errors.push(`${path}[${result.index}].${code}`);
  }
  return {
    candidateResults,
    errors: [...new Set(errors)],
    inventions: { ...inventions, inventedNumericParameterCount: inventions.inventedNumericParameterCount },
    proposedCommands: candidateResults.map((result) => result.candidate),
    acceptedCommands: candidateResults.filter((result) => result.decision === DECISION.ACCEPT).map((result) => result.validatedCommand),
    ambiguousCommands: candidateResults
      .filter((result) => result.decision === DECISION.CLARIFY)
      .map((result) => ({ index: result.index, ...result.validatedCommand })),
    actionValidation: candidateResults.map((result) => ({
      index: result.index, source: result.source, decision: result.decision,
      eligibleForBinding: result.decision === DECISION.ACCEPT, errors: result.decision === DECISION.ACCEPT ? [] : result.reasonCodes,
    })),
  };
}

function evaluateCandidate({ entry, position, allowlist, text, openClarification, policy, inventionKinds }) {
  const { source, index, candidate } = entry;
  const result = {
    index,
    source,
    candidate: { type: candidate.type, params: { ...(candidate.params ?? {}) }, evidenceSpans: [...(candidate.evidenceSpans ?? [])] },
    decision: DECISION.REJECT,
    reasonCodes: [],
    validatedCommand: null,
    evidenceSpans: [...(candidate.evidenceSpans ?? [])],
    grounding: null,
    missing: [],
  };
  const reject = (...codes) => { result.decision = DECISION.REJECT; result.reasonCodes = [...new Set(codes.flat())]; return result; };

  // A. structural / safety
  const hard = [...new Set([...validateCandidateStructure({ item: candidate, allowlist, rawText: text }).errors, ...inventionKinds])];
  if (hard.length) return reject(hard);
  // Strict semantic-first transport never asks the provider for bolus. Like a
  // duration, it can only be read from the resident's own literal parameters.
  if (policy.semanticFirst && candidate.params?.bolus != null) return reject("bolus_must_be_literal");
  // The registry models no procedure at all (`allowlist.procedures` is empty), so an ORDER_PROCEDURE can never be
  // completed: asking «какая процедура?» about a procedure the learner NAMED would ask them something they answered.
  // It is dropped and the fragment stays unresolved. Likewise a call for a specialist the registry has no role for.
  if (candidate.type === COMMAND.ORDER_PROCEDURE && (allowlist.procedures ?? []).length === 0) return reject("procedure_not_modeled");
  if (candidate.type === COMMAND.CALL_STAFF && UNMODELED_SPECIALIST.test(normalizeText((candidate.evidenceSpans ?? []).join(" ")))
    && !(allowlist.staffRoles ?? []).some((role) => containsAny(normalizeText((candidate.evidenceSpans ?? []).join(" ")), STAFF_ROLE_WORDS[role] ?? []))) return reject("role_not_modeled");
  // Summoning staff needs a request in the learner's words (the deterministic pass applies the same rule): «я хирург»
  // names a person, it does not call one.
  if ([COMMAND.CALL_STAFF, COMMAND.REQUEST_ANESTHESIA_REVIEW].includes(candidate.type)
    && !STAFF_REQUEST_CUES.test(`${normalizeText((candidate.evidenceSpans ?? []).join(" "))} ${enclosingFragmentText(text, candidate.evidenceSpans)}`)) {
    return reject("staff_request_not_evident", "action_type_not_evident");
  }
  // Explicit conversation controls (repeat / end case) exist only as the learner's
  // control phrase, read by the deterministic pass. A model never originates one.
  if (policy.isExplicitControl(candidate.type)) return reject("explicit_control_only");

  // Imaging language is never an examination. A model that reads «сделайте
  // визуализацию живота» or «осмотрите живот ультразвуком» as a physical exam is
  // corrected into the question the learner has actually left open - which study?
  // - and nothing is executed. The words checked are the candidate's evidence and
  // the clause it sits in, so an evidence span trimmed to «осмотрите живот» does
  // not hide the modality the learner said next to it.
  if (candidate.type === COMMAND.EXAMINE) {
    const words = `${(candidate.evidenceSpans ?? []).join(" ")} ${enclosingFragmentText(text, candidate.evidenceSpans)}`;
    if (mentionsImagingModality(words) || mentionsImagingCategory(words)) {
      result.decision = DECISION.CLARIFY;
      result.reasonCodes = ["imaging_language_not_examination", "identifying_concept_removed"];
      result.missing = ["testId"];
      result.validatedCommand = { type: COMMAND.ORDER_TEST, params: {}, evidence: (candidate.evidenceSpans ?? []).join(" "), evidenceSpans: [...(candidate.evidenceSpans ?? [])] };
      return result;
    }
  }

  // B. deterministic binding (numeric / route values from literal text only)
  const bound = bindModelCommand({ candidate, index: position, rawText: text, openClarification }).command;

  // C. semantic-language matching
  const language = matchCandidateLanguage(candidate);
  if (language.analyteErrors.length || language.targetErrors.length) return reject(language.analyteErrors, language.targetErrors);
  const { grounding } = language;
  const relaxed = policy.isPromoted(candidate.type) && GROUNDING_MODE[grounding.kind] === "semantic";

  let params = { ...bound.params };
  const codes = [];
  let stripKey = null;
  if (grounding.status === "lexical" || grounding.status === "composite") {
    result.grounding = grounding.status;
    codes.push("concept_lexically_grounded");
  } else if (grounding.kind === "type") {
    // No concept to identify: the kind of action itself is the claim. Protected
    // types need it in the learner's words. A promoted type is accepted on
    // substantive evidence - any words beyond address, courtesy and literal
    // parameters - so that "нпо" or "ничего не давать через рот" need no anchor
    // list entry, while "Коллеги" alone is still nothing.
    if (!policy.isPromoted(candidate.type) || (policy.requiresEvidentKind(candidate.type) && !language.typeEvident)
      || substantiveTokens(candidate.evidenceSpans.join(" ")).length === 0) {
      return reject("lexical_anchor_missing", "action_type_not_evident");
    }
    result.grounding = "semantic_only";
    codes.push("action_semantic_only");
  } else if (grounding.status === "contradicted") {
    // The words name something else. The learner said what they meant; the model disagrees with them.
    return reject("evidence_names_other_concept");
  } else if (grounding.status === "excluded" && EXCLUSION_HAS_NO_ALTERNATIVE.has(grounding.id)) {
    return reject("qualifier_names_unmodeled_study");
  } else if (grounding.status === "excluded" || grounding.status === "category") {
    stripKey = identifyingParamKey({ type: candidate.type, params });
    codes.push(grounding.status === "excluded" ? "qualifier_excludes_concept" : "category_language_ambiguous");
  } else if (relaxed) {
    // In the semantic-first contract a novel phrasing need not reproduce an
    // authored verb. Protected types and the explicit-kind safeguards above
    // remain literal; known contradictions/categories still clarify or reject.
    if (grounding.kind !== "topic" && !language.typeEvident && !policy.semanticFirst) return reject("lexical_anchor_missing", "action_type_not_evident");
    if (substantiveTokens(candidate.evidenceSpans.join(" ")).length === 0) return reject("empty_semantic_evidence");
    result.grounding = "semantic_only";
    codes.push("concept_semantic_only");
  } else {
    stripKey = identifyingParamKey({ type: candidate.type, params });
    codes.push("lexical_anchor_missing");
  }

  if (result.grounding === null && (grounding.status === "excluded" || grounding.status === "category" || !relaxed)) {
    // The concept is not evidenced. It may be turned into a question ("which
    // one?") only when the learner did express the kind of action; otherwise
    // the candidate is dropped. High-risk types have no identifying key at all.
    if (!stripKey || params[stripKey] == null || !language.typeEvident) return reject(codes, "action_type_not_evident");
    params = Object.fromEntries(Object.entries(params).filter(([key]) => key !== stripKey));
    codes.push("identifying_concept_removed");
  }

  // D. command completeness
  const command = createCommand({ id: `candidate-${source}-${index}`, type: candidate.type, params, sourceText: bound.evidence });
  const completeness = validateCommand(command);
  const kindEvident = language.typeEvident || result.grounding === "lexical" || result.grounding === "composite";
  if (completeness.outcome === "CLARIFY") {
    if (!kindEvident && !stripKey) return reject(codes, "missing_required_parameter", "action_type_not_evident");
    result.missing = completeness.missing;
    codes.push("missing_required_parameter");
    result.decision = DECISION.CLARIFY;
  } else {
    result.decision = stripKey ? DECISION.CLARIFY : DECISION.ACCEPT;
  }
  result.reasonCodes = [...new Set(codes)];
  result.validatedCommand = { type: candidate.type, params, evidence: bound.evidence, evidenceSpans: [...bound.evidenceSpans] };
  return result;
}

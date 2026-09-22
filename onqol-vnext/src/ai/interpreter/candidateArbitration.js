import { COMMAND, createCommand, validateCommand } from "../../core/commands/commandTypes.js";
import { CONCEPT_PARAM_KEYS } from "./conceptGrounding.js";
import { COMMITMENT, assessCommitment, assessSequence, isCommitmentClause, orderBySequence, summarizeWithheld } from "./commitmentPolicy.js";
import { DEFAULT_PROMOTION_POLICY } from "./promotionPolicy.js";
import { coversAll, locateRanges, normalizeText, rangesOverlap, tokenize } from "./textMatch.js";

/**
 * Arbitration between the deterministic reading of a turn and the semantic
 * candidates that survived candidate-level validation.
 *
 * Inputs are already-safe structures: deterministic commands, and semantic
 * candidates whose parameters were bound from literal text only. Arbitration
 * never creates a parameter, a concept or a command the model did not propose
 * and validation did not accept; it only decides which of two already-valid
 * readings reaches the command pipeline. Everything it emits is still passed
 * through validateCommand / executeCommand like any other command.
 *
 * Rules (interpreter v3):
 *  - same type + same primary concept .......... one command, both origins recorded
 *  - non-overlapping evidence .................. both commands kept
 *  - overlapping evidence, different reading ... a recorded CONFLICT:
 *      promoted classes, semantic candidate fully validated AND positively
 *      evidenced in the learner's words ....... semantic_override
 *      promoted classes, otherwise ............. deterministic preserved, logged
 *      a protected class on either side ........ never a silent override:
 *        protected semantic vs promoted det ..... deterministic preserved, logged
 *        protected det, same type ............... identifying concept removed -> CLARIFY
 *        protected det, different type .......... withheld, surfaced as unresolved
 *
 * v3A.1:
 *  - a protected model-originated command is ADDED only when it is complete and
 *    literally grounded (lexical / composite evidence); otherwise it is rejected.
 *    It never replaces a deterministic reading (unchanged).
 *  - every semantic-origin command then passes the commitment gate: a command the
 *    learner hedged, conditioned, asked about, deferred or refused is WITHHELD
 *    (commitmentPolicy.js), whatever its type.
 */
export const RESOLUTION = Object.freeze({
  DETERMINISTIC_FAST_PATH: "deterministic_fast_path",
  DETERMINISTIC_PRESERVED: "deterministic_preserved",
  SEMANTIC_ADDED: "semantic_added",
  SEMANTIC_OVERRIDE: "semantic_override",
  CLARIFICATION: "clarification",
  REJECTED: "rejected",
  DEDUPLICATED: "deduplicated",
  WITHHELD: "withheld_uncommitted",
});

const BOOKKEEPING = new Set([COMMAND.STATE_REASONING, COMMAND.ANSWER_MENTOR]);
const COMPOUND_SEPARATOR = /[,;+]|(?:^|\s)и(?=\s)|(?:^|\s)плюс(?=\s)/i;

/**
 * Two commands that are the same clinical intent in different spellings. A
 * question about fasting is the dedicated fasting-history command; the generic
 * question must never displace the purpose-built one (which is what completes
 * the fasting assessment).
 */
const EQUIVALENT_READINGS = Object.freeze({ "ASK_PATIENT:fasting": "ASK_FASTING_HISTORY:" });

export function primaryKey(command) {
  const key = rawKey(command);
  return EQUIVALENT_READINGS[key] ?? key;
}

function rawKey(command) {
  const p = command.params ?? {};
  const concept = p.testId ?? p.drugId ?? p.fluidId ?? p.procedureId ?? p.region ?? p.role ?? p.destination ?? p.to
    ?? p.approach ?? p.choice ?? p.topic ?? (command.type === COMMAND.COMMIT_MANAGEMENT_PLAN ? p.intent : null) ?? "";
  return `${command.type}:${concept}`;
}

export function arbitrate({
  deterministic,
  candidates = [],
  rawText,
  idPrefix = "cmd",
  policy = DEFAULT_PROMOTION_POLICY,
  consulted = false,
}) {
  const rawTokens = tokenize(rawText);
  const compound = COMPOUND_SEPARATOR.test(rawText);
  const baseResolution = consulted ? RESOLUTION.DETERMINISTIC_PRESERVED : RESOLUTION.DETERMINISTIC_FAST_PATH;
  const deterministicCommands = deterministic.commands ?? [];
  const reasoning = deterministicCommands.filter((command) => BOOKKEEPING.has(command.type));

  let final = deterministicCommands.filter((command) => !BOOKKEEPING.has(command.type)).map((command) => {
    const span = locateRanges(rawTokens, [command.sourceText ?? ""]);
    return {
      command, origin: "deterministic", origins: ["deterministic"], resolution: baseResolution, span,
      // A span covering a whole compound turn (a shortcut such as one REASSESS
      // for "боль и витальные через час") says nothing about WHICH words the
      // command was read from, so it only ever conflicts with its own type.
      broad: span == null || (compound && coversAll(span, rawTokens.length)),
    };
  });
  const additions = [];
  const candidateDecisions = [];
  const conflicts = [];
  const withheldFragments = [];

  for (const result of candidates) {
    const record = {
      index: result.index, source: result.source, type: result.candidate?.type ?? null, params: result.candidate?.params ?? {},
      validation: result.decision, reasonCodes: result.reasonCodes ?? [], evidenceSpans: result.evidenceSpans ?? [],
      grounding: result.grounding ?? null, arbitration: null,
    };
    candidateDecisions.push(record);
    if (result.decision === "REJECT" || !result.validatedCommand) {
      record.arbitration = { resolution: RESOLUTION.REJECTED, reason: "candidate_rejected" };
      continue;
    }

    const command = createCommand({
      id: `${idPrefix}-${result.source === "patientQuestion" ? "q" : "s"}${result.index}`,
      type: result.validatedCommand.type,
      params: result.validatedCommand.params ?? {},
      sourceText: result.validatedCommand.evidence ?? (result.evidenceSpans ?? []).join(" "),
    });
    record.commandId = command.id;
    const key = primaryKey(command);
    const span = locateRanges(rawTokens, result.evidenceSpans ?? []);
    const positive = result.grounding === "lexical" || result.grounding === "composite";

    // A protected model-originated command that would EXECUTE must be literally
    // grounded. (A CLARIFY is only a question and is judged by the commitment gate.)
    if (policy.isProtected(command.type) && result.decision === "ACCEPT" && !positive) {
      record.arbitration = { resolution: RESOLUTION.REJECTED, reason: "protected_add_requires_literal_grounding" };
      continue;
    }

    const twin = [...final, ...additions].find((entry) => primaryKey(entry.command) === key);
    if (twin) {
      if (!twin.origins.includes("semantic")) twin.origins.push("semantic");
      record.arbitration = { resolution: RESOLUTION.DEDUPLICATED, into: twin.command.id };
      continue;
    }

    const clashes = final.filter((entry) => entry.origin === "deterministic" && overlaps(entry, span, command.type));
    if (clashes.length === 0) {
      const resolution = result.decision === "CLARIFY" ? RESOLUTION.CLARIFICATION : RESOLUTION.SEMANTIC_ADDED;
      additions.push({ command, origin: "semantic", origins: ["semantic"], resolution, span });
      record.arbitration = { resolution };
      continue;
    }

    if (result.decision === "CLARIFY" && clashes.every((entry) => entry.command.type === command.type)) {
      // A less specific question about something the deterministic pass already read.
      record.arbitration = { resolution: RESOLUTION.DETERMINISTIC_PRESERVED, reason: "subsumed_by_deterministic" };
      continue;
    }

    const conflict = {
      candidate: { source: result.source, index: result.index, type: command.type, key },
      deterministic: clashes.map((entry) => ({ id: entry.command.id, type: entry.command.type, key: primaryKey(entry.command) })),
      resolution: RESOLUTION.DETERMINISTIC_PRESERVED, reason: null,
    };
    conflicts.push(conflict);
    const preserve = (reason) => {
      conflict.reason = reason;
      record.arbitration = { resolution: RESOLUTION.DETERMINISTIC_PRESERVED, reason };
    };

    if (result.decision !== "ACCEPT") { preserve("semantic_candidate_not_fully_validated"); continue; }

    const protectedDeterministic = clashes.filter((entry) => policy.isProtected(entry.command.type));
    // A deterministic command with NO identifying concept ("Какое исследование?")
    // carries no reading to preserve: it only says that a study of this kind was
    // asked for. A fully validated semantic candidate of the same promoted type
    // COMPLETES it. That needs no positive lexical evidence, exactly as when the
    // words had been an unmatched fragment; a category, an exclusion or a
    // contradiction never reach ACCEPT, so they are not completed this way.
    const completesPlaceholder = policy.isPromoted(command.type) && protectedDeterministic.length === 0
      && clashes.every((entry) => entry.command.type === command.type && primaryKey(entry.command) === `${command.type}:`);
    if (!positive && !completesPlaceholder) { preserve("semantic_disagreement_without_lexical_evidence"); continue; }

    if (policy.isPromoted(command.type) && protectedDeterministic.length === 0) {
      const first = final.indexOf(clashes[0]);
      final = final.filter((entry) => !clashes.includes(entry));
      const resolution = completesPlaceholder ? RESOLUTION.SEMANTIC_ADDED : RESOLUTION.SEMANTIC_OVERRIDE;
      final.splice(Math.min(first, final.length), 0, {
        command, origin: "semantic", origins: ["semantic"], resolution, span,
        overridden: clashes.map((entry) => entry.command.id),
      });
      conflict.resolution = resolution;
      if (completesPlaceholder) conflict.reason = "completes_incomplete_deterministic";
      record.arbitration = { resolution, overridden: clashes.map((entry) => entry.command.id), ...(completesPlaceholder ? { reason: "completes_incomplete_deterministic" } : {}) };
      continue;
    }
    if (protectedDeterministic.length === 0) { preserve("protected_semantic_never_overrides"); continue; }

    for (const entry of protectedDeterministic) {
      const clarified = entry.command.type === command.type ? withoutConcept(entry.command) : null;
      if (clarified) {
        final = final.map((item) => (item === entry ? { ...entry, command: clarified, resolution: RESOLUTION.CLARIFICATION, origins: [...entry.origins, "semantic"] } : item));
      } else {
        final = final.filter((item) => item !== entry);
        withheldFragments.push(entry.command.sourceText);
      }
    }
    conflict.resolution = RESOLUTION.CLARIFICATION;
    conflict.reason = "protected_class_disagreement";
    record.arbitration = { resolution: RESOLUTION.CLARIFICATION, reason: "protected_class_disagreement" };
  }

  // The commitment gate for semantic-origin commands. Deterministic commands were
  // gated when they were read; the fragments of any that were withheld still count
  // as carriers, so a trailing condition is attached to the command it governs and
  // not to a neighbour.
  const priorWithheld = (deterministic.withheldCommands ?? []).map((entry) => ({ id: entry.id, type: entry.type, params: entry.params ?? {}, sourceText: entry.sourceText }));
  const candidatesForGate = [...final, ...additions];
  const assessment = assessCommitment({ rawText, commands: [...candidatesForGate.map((entry) => entry.command), ...priorWithheld] });
  const withheld = [];
  const ordered = candidatesForGate.filter((entry) => {
    if (entry.origin !== "semantic") return true;
    const commitment = assessment.get(entry.command.id);
    if (!commitment || commitment.status === COMMITMENT.COMMITTED) return true;
    withheld.push({ command: entry.command, commitment });
    for (const record of candidateDecisions) {
      if (record.commandId === entry.command.id) record.arbitration = { resolution: RESOLUTION.WITHHELD, commitment: commitment.status, cues: commitment.cues };
    }
    return false;
  });
  const anyWithheld = withheld.length > 0 || priorWithheld.length > 0;
  const semanticKept = ordered.filter((entry) => entry.origin === "semantic");
  const keptRanges = semanticKept.map((entry) => entry.span).filter(Boolean);
  const unmatchedFragments = [
    ...(deterministic.unmatchedFragments ?? []).filter((fragment) => {
      const fragmentRanges = locateRanges(rawTokens, [fragment]);
      const normalizedFragment = normalizeText(fragment);
      const byText = semanticKept.some((entry) => {
        const source = normalizeText(entry.command.sourceText);
        return source && (normalizedFragment.includes(source) || source.includes(normalizedFragment));
      });
      return !(byText || (fragmentRanges && keptRanges.some((range) => rangesOverlap(fragmentRanges, range))));
    }).filter((fragment) => !(anyWithheld && isCommitmentClause(fragment))),
    ...withheldFragments,
  ];

  // A stated «сначала X, затем Y» is recorded, and its commands execute in that order.
  const commandSequence = assessSequence({ rawText, commands: ordered.map((entry) => entry.command) });
  const inStatedOrder = orderBySequence(ordered.map((entry) => entry.command), commandSequence);

  return {
    finalCommands: [...inStatedOrder, ...reasoning],
    commandSequence,
    unmatchedFragments,
    candidateDecisions,
    conflicts,
    resolutions: ordered.map((entry) => ({ commandId: entry.command.id, type: entry.command.type, resolution: entry.resolution, origins: [...entry.origins] })),
    semanticCommands: semanticKept.map((entry) => entry.command),
    withheldCommands: summarizeWithheld(withheld),
    policyVersion: policy.version,
  };
}

function overlaps(entry, candidateSpan, candidateType) {
  if (entry.broad || candidateSpan == null) return entry.command.type === candidateType;
  return rangesOverlap(entry.span, candidateSpan);
}

/** A protected command asked about instead of executed: same type, identifying concept removed. */
function withoutConcept(command) {
  const params = Object.fromEntries(Object.entries(command.params ?? {}).filter(([key]) => !CONCEPT_PARAM_KEYS.includes(key)));
  if (Object.keys(params).length === Object.keys(command.params ?? {}).length) return null;
  const stripped = createCommand({ id: command.id, type: command.type, params, sourceText: command.sourceText });
  return validateCommand(stripped).outcome === "CLARIFY" ? stripped : null;
}

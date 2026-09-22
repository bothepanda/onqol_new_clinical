import { createHash } from "node:crypto";
import { COMMAND } from "../src/core/commands/commandTypes.js";
import { buildModelAllowlist } from "../src/ai/interpreter/modelConceptValidation.js";

/**
 * Independent gold labelling and clinician adjudication.
 *
 * The gold in the development / holdout corpora is DRAFT LINGUISTIC intent
 * written by the same author as the interpreter. Two separate acts turn it into
 * something a freeze can rest on, and this module supports both without ever
 * doing either on anyone's behalf:
 *
 *  1. BLIND LABELLING. A reviewer who is not the gold author labels each item
 *     from the learner's words and minimal conversational context ONLY. The
 *     packet contains no draft gold, no system reading, no model output and no
 *     split membership, and its order is a fixed pseudo-random shuffle so
 *     surface variants of one intent are not adjacent.
 *  2. ADJUDICATION. Where the blind label and the draft gold agree, a named
 *     adjudicator may confirm; where they differ, a named adjudicator decides
 *     (confirm draft / amend / exclude). A decision is bound to the hash of the
 *     draft gold it was made against, so it cannot silently drift.
 *
 * Nothing here writes `confirm` by itself. Agreement between two labels is
 * evidence for the adjudicator, not a decision.
 */
export const PACKET_SCHEMA = "onqol-gold-blind-packet-v1";
export const REVIEW_SCHEMA = "onqol-gold-blind-review-v1";
export const DISPOSITIONS = Object.freeze(["commands", "clarify", "unresolved", "no_action"]);
export const DECISIONS = Object.freeze(["confirm", "amend", "exclude"]);
/** Reviewer names that mean "the author of the draft gold": never independent. */
export const AUTHOR_NAMES = /^(claude|assistant|codex|gpt|chatgpt|model|ai)\b/i;
/**
 * Reviewers and adjudicators are recorded by ALIAS only (R01, R02 ... labellers;
 * A01 ... adjudicators). Who an alias is stays with the coordinator, outside the
 * repository: nothing tracked can identify a reviewer.
 */
export const REVIEWER_ALIAS = /^R\d{2}$/;
export const ADJUDICATOR_ALIAS = /^A\d{2}$/;
const NON_LABEL_TYPES = new Set([COMMAND.STATE_REASONING, COMMAND.ANSWER_MENTOR]);
const sha = (value) => createHash("sha256").update(value).digest("hex");
export const hashGold = (gold) => sha(JSON.stringify(gold));

/** The command types and concept ids a label may use, taken from the case content itself. */
export function labelVocabulary(bundle) {
  const allowlist = buildModelAllowlist({ bundle });
  const concepts = {
    testId: [...allowlist.tests, ...allowlist.recognizedUnmodeledTests], drugId: allowlist.drugs, fluidId: allowlist.fluids, procedureId: allowlist.procedures,
    region: allowlist.regions, topic: allowlist.patientQuestionTopics, role: allowlist.staffRoles, destination: allowlist.destinations, to: allowlist.destinations,
    intent: allowlist.managementIntents, route: allowlist.routes,
  };
  const types = Object.values(COMMAND).filter((type) => !NON_LABEL_TYPES.has(type));
  return { types, parameters: Object.fromEntries(types.map((type) => [type, allowlist.parameterSchemas[type] ?? []])), concepts, dispositions: [...DISPOSITIONS] };
}

/** Errors in one label; an empty list means the label is well formed. */
export function validateLabel(label, vocabulary) {
  const errors = [];
  if (!label || typeof label !== "object") return ["label_missing"];
  if (!DISPOSITIONS.includes(label.disposition)) errors.push("disposition_invalid");
  if (!Array.isArray(label.commands)) return [...errors, "commands_not_a_list"];
  if (label.disposition === "no_action" && label.commands.length > 0) errors.push("no_action_with_commands");
  if (label.disposition === "commands" && label.commands.length === 0) errors.push("commands_disposition_without_commands");
  label.commands.forEach((command, index) => {
    if (!vocabulary.types.includes(command?.type)) { errors.push(`commands[${index}].type_unknown`); return; }
    const allowed = new Set(vocabulary.parameters[command.type]);
    for (const [key, value] of Object.entries(command.params ?? {})) {
      if (!allowed.has(key) && key !== "repeat") errors.push(`commands[${index}].params.${key}_not_allowed`);
      else if (vocabulary.concepts[key] && !vocabulary.concepts[key].includes(value)) errors.push(`commands[${index}].params.${key}_unknown_concept`);
    }
    for (const key of command.absent ?? []) if (!allowed.has(key)) errors.push(`commands[${index}].absent.${key}_not_allowed`);
  });
  return errors;
}

/** Canonical form for comparing two labels: disposition + commands as a sorted multiset. */
export function canonicalLabel(label) {
  const commands = (label.commands ?? []).map((c) => JSON.stringify({ type: c.type, params: sortKeys(c.params ?? {}), absent: [...(c.absent ?? [])].sort() })).sort();
  return JSON.stringify({ disposition: label.disposition, commands });
}
const sortKeys = (object) => Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)));
export const labelsAgree = (a, b) => canonicalLabel(a) === canonicalLabel(b);

export function contextInWords(turnContext = {}) {
  const parts = [];
  const open = turnContext.openClarification;
  if (open?.commandType) parts.push(`Перед этой репликой система задала уточняющий вопрос по действию ${open.commandType}; не хватало: ${(open.missing ?? []).join(", ") || "—"}. Уже названо: ${JSON.stringify(open.params ?? {})}.`);
  if (turnContext.openMentorQuestion) parts.push("Перед этой репликой наставник задал обучающемуся вопрос.");
  return parts.length ? parts.join(" ") : "Предыдущего открытого вопроса нет.";
}

/**
 * A blind labelling packet. `items` are `{ id, text, turnContext }`; nothing else
 * about them is copied, so no gold, split, system reading or model output can leak.
 */
export function buildBlindPacket({ items, vocabulary, seed = "onqol-blind-1" }) {
  const shuffled = [...items].sort((a, b) => sha(`${seed}|${a.id}`).localeCompare(sha(`${seed}|${b.id}`)));
  return {
    schema: PACKET_SCHEMA, kind: "BLIND_LABELLING_PACKET", seed,
    instructions: [
      "Label what the LEARNER asked the simulated hospital to do, from their words and the stated context only. You do not judge whether the request is clinically correct.",
      "disposition: commands = the words fully specify the action(s); clarify = an action was asked for but a required detail is missing (list the command, and the missing parameter keys in `absent`); unresolved = words that ask for something the simulator cannot map; no_action = no action was committed (a hypothesis, a plan for later, a condition, a question about whether to act, a refusal).",
      "A hedged, conditional, deferred, refused or 'should I?' request is no_action. A pure question addressed to the patient is ASK_PATIENT (topic from the list). Do not use STATE_REASONING or ANSWER_MENTOR.",
      "Use only the command types, parameter keys and concept ids in `vocabulary`. Do not infer a dose, route, volume or duration the words do not state.",
      "Do not look at the interpreter, its outputs, or the draft labels. Add a short note only when a label is a real judgement call.",
    ],
    vocabulary,
    items: shuffled.map((item) => ({ itemId: item.id, text: item.text, context: contextInWords(item.turnContext), label: { commands: [], disposition: null, notes: null } })),
  };
}

/**
 * Validates one reviewer's completed packet and compares it with draft gold.
 * `draftById` maps item id -> draft gold (absent for real resident turns).
 */
export function checkBlindReview({ packet, review, reviewer, draftById = {}, vocabulary }) {
  const errors = [];
  if (!reviewer || typeof reviewer !== "string" || !reviewer.trim()) errors.push("reviewer_missing");
  else if (AUTHOR_NAMES.test(reviewer.trim())) errors.push("reviewer_is_the_gold_author");
  else if (!REVIEWER_ALIAS.test(reviewer.trim())) errors.push("reviewer_must_be_an_alias");
  const byId = new Map((review?.items ?? []).map((item) => [item.itemId, item]));
  const perItem = [];
  for (const expected of packet.items) {
    const item = byId.get(expected.itemId);
    if (!item) { errors.push(`missing:${expected.itemId}`); continue; }
    if (item.text !== undefined && item.text !== expected.text) errors.push(`text_changed:${expected.itemId}`);
    const problems = validateLabel(item.label, vocabulary);
    if (problems.length) { errors.push(...problems.map((p) => `${expected.itemId}:${p}`)); continue; }
    perItem.push({ itemId: expected.itemId, label: item.label, draft: draftById[expected.itemId] ?? null });
  }
  for (const id of byId.keys()) if (!packet.items.some((i) => i.itemId === id)) errors.push(`unknown_item:${id}`);
  const compared = perItem.filter((entry) => entry.draft);
  const disagree = compared.filter((entry) => !labelsAgree(entry.label, entry.draft));
  return {
    ok: errors.length === 0, errors, reviewer: reviewer ?? null,
    labelled: perItem.length, total: packet.items.length,
    agreement: { compared: compared.length, agree: compared.length - disagree.length, rate: compared.length ? (compared.length - disagree.length) / compared.length : null },
    disagreements: disagree.map((entry) => ({ itemId: entry.itemId, draft: entry.draft, independent: entry.label })),
    labels: perItem,
  };
}

/**
 * Applies named adjudication decisions to the adjudication artifact.
 * `decisions[rowId] = { decision, adjudicator, adjudicatedAt, amendedGold?, notes? }`.
 * A decision on an already-decided row is refused unless `allowRevision` is set,
 * and every decision must be made against the draft gold's current hash.
 */
export function applyDecisions({ adjudication, decisions, draftById, vocabulary, allowRevision = false }) {
  const next = structuredClone(adjudication);
  const errors = [];
  for (const [rowId, decision] of Object.entries(decisions)) {
    const entry = next.rows[rowId];
    if (!entry) { errors.push(`unknown_row:${rowId}`); continue; }
    if (!DECISIONS.includes(decision.decision)) { errors.push(`${rowId}:decision_invalid`); continue; }
    if (!decision.adjudicator || AUTHOR_NAMES.test(decision.adjudicator.trim())) { errors.push(`${rowId}:adjudicator_missing_or_author`); continue; }
    if (!ADJUDICATOR_ALIAS.test(decision.adjudicator.trim())) { errors.push(`${rowId}:adjudicator_must_be_an_alias`); continue; }
    if (Number.isNaN(Date.parse(decision.adjudicatedAt))) { errors.push(`${rowId}:adjudicatedAt_invalid`); continue; }
    if (entry.decision && !allowRevision) { errors.push(`${rowId}:already_decided`); continue; }
    // A real resident turn has no draft gold: there is nothing to "confirm". Its gold is the adjudicated label (amend) or it is excluded.
    if (entry.draftGoldHash === null && decision.decision === "confirm") { errors.push(`${rowId}:no_draft_to_confirm`); continue; }
    if (entry.draftGoldHash !== null && draftById[rowId] && hashGold(draftById[rowId]) !== entry.draftGoldHash) { errors.push(`${rowId}:draft_gold_changed_since_template`); continue; }
    if (decision.decision === "amend") {
      const problems = validateLabel(decision.amendedGold, vocabulary);
      if (problems.length) { errors.push(...problems.map((p) => `${rowId}:${p}`)); continue; }
    }
    next.rows[rowId] = {
      ...entry, decision: decision.decision, adjudicator: decision.adjudicator.trim(), adjudicatedAt: decision.adjudicatedAt,
      amendedGold: decision.decision === "amend" ? decision.amendedGold : null, notes: decision.notes ?? null,
    };
  }
  const rows = Object.values(next.rows);
  const decided = rows.filter((row) => row.decision).length;
  next.status = decided === rows.length ? "ADJUDICATION_COMPLETE" : "PENDING_CLINICIAN_ADJUDICATION";
  return { adjudication: next, errors, decided, total: rows.length };
}

/** Adds an undecided entry for every real resident turn that has none. Resident turns carry no draft gold (draftGoldHash null). */
export function syncResidentRows({ adjudication, turns }) {
  const next = structuredClone(adjudication);
  let added = 0;
  for (const turn of turns) {
    if (next.rows[turn.turnKey]) continue;
    next.rows[turn.turnKey] = { draftGoldHash: null, decision: null, adjudicator: null, adjudicatedAt: null, amendedGold: null, notes: null, source: "real_resident" };
    added += 1;
  }
  if (added) next.status = "PENDING_CLINICIAN_ADJUDICATION";
  return { adjudication: next, added };
}

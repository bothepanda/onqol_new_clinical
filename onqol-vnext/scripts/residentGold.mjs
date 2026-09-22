import { createHash } from "node:crypto";
import { COMMITMENT } from "../src/ai/interpreter/commitmentPolicy.js";
import { normalizeText } from "../src/ai/interpreter/textMatch.js";
import { ADJUDICATOR_ALIAS, AUTHOR_NAMES, REVIEWER_ALIAS, contextInWords } from "./goldReview.mjs";

/**
 * Independent labelling and adjudication of REAL resident turns.
 *
 * A resident turn is judged from the learner's words and the stated conversational
 * context ONLY. The labeller sees no system interpretation, no execution, no model
 * output, no split and no participant: the packet is built from (id, words,
 * context) and `assertBlindPacket` refuses anything else.
 *
 * What a label captures (label v2):
 *   actions[]          each explicit action: type, parameters, the COMMITMENT STATE of
 *                      the words (COMMITTED / TENTATIVE / CONDITIONAL / INTERROGATIVE /
 *                      FUTURE_PLAN / DECLINED), an optional sequence step, and the
 *                      verbatim words it was read from
 *   patientQuestions[] questions put to the patient (topic + words)
 *   reasoning[]        reasoning the learner expressed (working diagnosis, differential,
 *                      stability, observation plan, contingency, disposition intent,
 *                      rationale), with the words
 *   ambiguity          whether the turn is GENUINELY ambiguous, of what kind, and which
 *                      readings a reasonable reviewer would accept
 *
 * Three records, kept apart and never merged in place:
 *   1. each independent reviewer's decisions (one file per reviewer, alias-attributed, private)
 *   2. the adjudication (a third person, alias-attributed; sees both labels, never the system)
 *   3. the released row (tracked): de-identified words + the final adjudicated label,
 *      and only after the adjudicator attests de-identification
 * The interpreter's own reading is never an input to any of them.
 */
export const RESIDENT_LABEL_SCHEMA = "onqol-resident-label-v2";
export const RESIDENT_PACKET_SCHEMA = "onqol-resident-blind-packet-v1";
export const RESIDENT_REVIEW_SCHEMA = "onqol-resident-review-v1";
export const RESIDENT_ADJUDICATION_SCHEMA = "onqol-resident-adjudication-v1";
export const RELEASED_ROWS_SCHEMA = "onqol-adjudicated-resident-rows-v1";

export const COMMITMENT_STATES = Object.freeze(Object.values(COMMITMENT));
export const REASONING_KINDS = Object.freeze(["WORKING_DIAGNOSIS", "DIFFERENTIAL", "STABILITY_ASSESSMENT", "OBSERVATION_PLAN", "CONTINGENCY", "DISPOSITION_INTENT", "RATIONALE", "OTHER"]);
export const AMBIGUITY_KINDS = Object.freeze(["missing_parameter", "unclear_target", "unclear_scope", "unclear_commitment", "multiple_readings", "other"]);
export const ADJUDICATION_CHOICES = Object.freeze(["accept_A", "accept_B", "amend", "exclude"]);

const sha = (value) => createHash("sha256").update(value).digest("hex");
const isAlias = (value, pattern) => typeof value === "string" && pattern.test(value.trim());
const inText = (text, evidence) => typeof evidence === "string" && normalizeText(evidence).length > 0 && normalizeText(text).includes(normalizeText(evidence));

/** Keys that must never appear anywhere in a blind packet: they would leak the system's reading, the split or a person. */
const LEAKY_KEYS = /^(interpretedCommands|withheldCommands|intent|outcomes|readings|model|semanticTelemetry|gold|draft|draftGold|split|participant|participantKey|alias|sessionKey|session|reviewer|reviewerAlias|adjudicat\w*|commandOutcomes|mentorSignal|unmatchedFragments)$/i;

export function emptyResidentLabel() {
  return { actions: [], patientQuestions: [], reasoning: [], ambiguity: { genuine: false, kinds: [], acceptableReadings: [], notes: null }, notes: null };
}

/** Errors in one v2 label; an empty list means well formed. `text` is the learner's words the label is about. */
export function validateResidentLabel(label, { vocabulary, text }) {
  const errors = [];
  if (!label || typeof label !== "object") return ["label_missing"];
  for (const key of ["actions", "patientQuestions", "reasoning"]) if (!Array.isArray(label[key])) errors.push(`${key}_not_a_list`);
  if (errors.length) return errors;
  label.actions.forEach((action, index) => {
    const at = `actions[${index}]`;
    if (!vocabulary.types.includes(action?.type)) { errors.push(`${at}.type_unknown`); return; }
    if (!COMMITMENT_STATES.includes(action.commitment)) errors.push(`${at}.commitment_invalid`);
    if (!inText(text, action.evidence)) errors.push(`${at}.evidence_not_in_the_words`);
    if (action.sequenceStep !== undefined && !(Number.isInteger(action.sequenceStep) && action.sequenceStep >= 1)) errors.push(`${at}.sequenceStep_invalid`);
    const allowed = new Set(vocabulary.parameters[action.type]);
    for (const [key, value] of Object.entries(action.params ?? {})) {
      if (!allowed.has(key) && key !== "repeat") errors.push(`${at}.params.${key}_not_allowed`);
      else if (vocabulary.concepts[key] && !vocabulary.concepts[key].includes(value)) errors.push(`${at}.params.${key}_unknown_concept`);
    }
    for (const key of action.absent ?? []) if (!allowed.has(key)) errors.push(`${at}.absent.${key}_not_allowed`);
  });
  label.patientQuestions.forEach((question, index) => {
    const at = `patientQuestions[${index}]`;
    if (!vocabulary.concepts.topic.includes(question?.topic)) errors.push(`${at}.topic_unknown`);
    if (!inText(text, question?.evidence)) errors.push(`${at}.evidence_not_in_the_words`);
  });
  label.reasoning.forEach((item, index) => {
    const at = `reasoning[${index}]`;
    if (!REASONING_KINDS.includes(item?.kind)) errors.push(`${at}.kind_invalid`);
    if (!inText(text, item?.evidence)) errors.push(`${at}.evidence_not_in_the_words`);
  });
  const ambiguity = label.ambiguity;
  if (!ambiguity || typeof ambiguity.genuine !== "boolean") errors.push("ambiguity.genuine_missing");
  else if (!ambiguity.genuine && (ambiguity.kinds ?? []).length) errors.push("ambiguity.kinds_without_genuine_ambiguity");
  else if (ambiguity.genuine) {
    const kinds = ambiguity.kinds ?? [];
    if (!kinds.length) errors.push("ambiguity.kinds_missing");
    for (const kind of kinds) if (!AMBIGUITY_KINDS.includes(kind)) errors.push(`ambiguity.kind_invalid:${kind}`);
    if (kinds.includes("missing_parameter") && !label.actions.some((action) => (action.absent ?? []).length)) errors.push("ambiguity.missing_parameter_without_absent_keys");
    if (kinds.includes("unclear_commitment") && !label.actions.length) errors.push("ambiguity.unclear_commitment_without_action");
  }
  return errors;
}

/**
 * The evaluation gold derived from a final label. Only COMMITTED actions and
 * questions to the patient are commands; every other commitment state becomes
 * `mustNotExecute` (the system executing one is a false execution). A committed
 * action with missing parameters makes the disposition `clarify`; a genuinely
 * ambiguous turn with nothing committed is `unresolved`.
 */
export function toEvaluationGold(label) {
  const committed = label.actions.filter((action) => action.commitment === COMMITMENT.COMMITTED);
  const commands = [
    ...committed.map((action) => ({ type: action.type, params: action.params ?? {}, ...((action.absent ?? []).length ? { absent: [...action.absent] } : {}) })),
    ...label.patientQuestions.map((question) => ({ type: "ASK_PATIENT", params: { topic: question.topic } })),
  ];
  const needsClarification = committed.some((action) => (action.absent ?? []).length);
  const disposition = needsClarification ? "clarify" : commands.length ? "commands" : label.ambiguity.genuine && label.ambiguity.kinds.some((k) => k === "unclear_target" || k === "multiple_readings") ? "unresolved" : "no_action";
  const mustNotExecute = label.actions.filter((action) => action.commitment !== COMMITMENT.COMMITTED).map((action) => ({ type: action.type, params: action.params ?? {}, commitment: action.commitment }));
  return { commands, disposition, mustNotExecute, reviewStatus: "independent_adjudicated", reviewer: null };
}

const sortKeys = (object) => Object.fromEntries(Object.entries(object ?? {}).sort(([a], [b]) => a.localeCompare(b)));
/** Canonical, order-independent form: evidence wording is NOT part of agreement, the readings are. */
export function canonicalResidentLabel(label) {
  const actions = label.actions.map((a) => JSON.stringify({ type: a.type, params: sortKeys(a.params), absent: [...(a.absent ?? [])].sort(), commitment: a.commitment, step: a.sequenceStep ?? null })).sort();
  const questions = label.patientQuestions.map((q) => q.topic).sort();
  const reasoning = label.reasoning.map((r) => r.kind).sort();
  return { actions, questions, reasoning, ambiguity: { genuine: label.ambiguity.genuine, kinds: [...(label.ambiguity.kinds ?? [])].sort() } };
}

/** Field-level comparison of two independent labels of the same turn. */
export function compareResidentLabels(a, b) {
  const ca = canonicalResidentLabel(a); const cb = canonicalResidentLabel(b);
  const differsIn = ["actions", "questions", "reasoning", "ambiguity"].filter((field) => JSON.stringify(ca[field]) !== JSON.stringify(cb[field]));
  // A commitment-state difference is worth naming on its own: it is the class that decides whether something executes.
  const stateOnly = differsIn.includes("actions") && JSON.stringify(ca.actions.map((s) => ({ ...JSON.parse(s), commitment: null }))) === JSON.stringify(cb.actions.map((s) => ({ ...JSON.parse(s), commitment: null })));
  return { agree: differsIn.length === 0, differsIn, commitmentStateOnly: stateOnly };
}

/**
 * A blind packet. `items` are `{ id, text, turnContext }`; NOTHING else is copied.
 * The order is a fixed shuffle so one participant's consecutive turns are not adjacent.
 */
export function buildResidentPacket({ items, vocabulary, packetId, seed = "onqol-resident-blind-1" }) {
  const shuffled = [...items].sort((a, b) => sha(`${seed}|${a.id}`).localeCompare(sha(`${seed}|${b.id}`)));
  const packet = {
    schema: RESIDENT_PACKET_SCHEMA, kind: "BLIND_LABELLING_PACKET", packetId, seed,
    instructions: [
      "Judge only what the LEARNER said, from their words and the stated context. You do not judge whether it is clinically correct, and you never see what any system did with it.",
      "actions: every explicit action the words ask the hospital to perform, with its parameters (never infer a dose, route, volume or duration that is not stated - list the missing ones in `absent`).",
      `commitment for each action: ${COMMITMENT_STATES.join(" | ")}. COMMITTED = the learner is doing/ordering it now. TENTATIVE (maybe, perhaps) / CONDITIONAL (if...) / INTERROGATIVE (asking whether) / FUTURE_PLAN (later) / DECLINED (not doing / cancelling) are NOT orders. «сначала X, затем Y» is two COMMITTED actions: give sequenceStep 1 and 2.`,
      "patientQuestions: questions put to the patient (topic from the list). reasoning: expressed reasoning (kind from the list) - not an action.",
      "ambiguity.genuine = true only if two reasonable readers could read the words differently or a required detail is missing; then name the kinds and, where useful, the acceptable readings. Do not mark ambiguity to avoid deciding.",
      "Every `evidence` must be the learner's own words, verbatim. Add a short note only where a label is a real judgement call.",
    ],
    vocabulary: { ...vocabulary, commitmentStates: COMMITMENT_STATES, reasoningKinds: REASONING_KINDS, ambiguityKinds: AMBIGUITY_KINDS },
    items: shuffled.map((item) => ({ itemId: item.id, text: item.text, context: contextInWords(item.turnContext), label: emptyResidentLabel() })),
  };
  assertBlindPacket(packet);
  return packet;
}

/** Throws if a packet carries anything but words, context and the empty label to fill. */
export function assertBlindPacket(packet) {
  const walk = (value, where) => {
    if (Array.isArray(value)) return value.forEach((entry, index) => walk(entry, `${where}[${index}]`));
    if (value && typeof value === "object") for (const [key, inner] of Object.entries(value)) { if (LEAKY_KEYS.test(key)) throw new Error(`blind_packet_leaks:${where}.${key}`); walk(inner, `${where}.${key}`); }
  };
  walk(packet.items, "items");
  for (const item of packet.items) if (Object.keys(item).sort().join() !== "context,itemId,label,text") throw new Error(`blind_packet_item_shape:${item.itemId}`);
  return true;
}

/** One independent reviewer's completed packet. The reviewer is recorded by ALIAS. */
export function checkResidentReview({ packet, review, reviewer, vocabulary }) {
  const errors = [];
  if (!isAlias(reviewer, REVIEWER_ALIAS)) errors.push(AUTHOR_NAMES.test(String(reviewer ?? "").trim()) ? "reviewer_is_the_gold_author" : "reviewer_must_be_an_alias");
  if (review?.packetId !== packet.packetId) errors.push("review_is_for_another_packet");
  const byId = new Map((review?.items ?? []).map((item) => [item.itemId, item]));
  const labels = {};
  for (const expected of packet.items) {
    const item = byId.get(expected.itemId);
    if (!item) { errors.push(`missing:${expected.itemId}`); continue; }
    if (item.text !== undefined && item.text !== expected.text) errors.push(`text_changed:${expected.itemId}`);
    const problems = validateResidentLabel(item.label, { vocabulary, text: expected.text });
    if (problems.length) errors.push(...problems.map((problem) => `${expected.itemId}:${problem}`)); else labels[expected.itemId] = item.label;
  }
  for (const id of byId.keys()) if (!packet.items.some((entry) => entry.itemId === id)) errors.push(`unknown_item:${id}`);
  return { ok: errors.length === 0, errors, reviewer: reviewer ?? null, labelled: Object.keys(labels).length, total: packet.items.length, labels };
}

/** Wraps a validated review as the private per-reviewer record. */
export function reviewRecord({ packet, check, completedAt }) {
  return { schema: RESIDENT_REVIEW_SCHEMA, packetId: packet.packetId, reviewer: check.reviewer, completedAt, labels: check.labels };
}

/**
 * Agreement between two independent reviews of one packet, and the items that need
 * an adjudicator. Two reviewers must be different aliases.
 */
export function compareReviews(a, b) {
  if (a.reviewer === b.reviewer) throw new Error("reviewers_must_be_different_people");
  if (a.packetId !== b.packetId) throw new Error("reviews_are_for_different_packets");
  const ids = Object.keys(a.labels).filter((id) => b.labels[id]);
  const items = ids.map((id) => ({ itemId: id, ...compareResidentLabels(a.labels[id], b.labels[id]) }));
  const agree = items.filter((item) => item.agree).length;
  return { packetId: a.packetId, reviewers: [a.reviewer, b.reviewer], compared: items.length, agree, agreementRate: items.length ? agree / items.length : null, commitmentStateOnlyDisagreements: items.filter((i) => i.commitmentStateOnly).length, disagreements: items.filter((item) => !item.agree) };
}

/**
 * Adjudication: a THIRD person (a different alias from both labellers) decides each
 * item. `decisions[itemId] = { choice, adjudicator, adjudicatedAt, finalLabel?, deidentified, notes? }`.
 * Returns the adjudication artifact; existing decisions are never overwritten.
 */
export function applyResidentAdjudication({ adjudication = emptyAdjudication(), decisions, reviewA, reviewB, vocabulary, texts }) {
  const next = structuredClone(adjudication);
  const errors = [];
  for (const [itemId, decision] of Object.entries(decisions)) {
    const a = reviewA.labels[itemId]; const b = reviewB.labels[itemId];
    if (!a || !b) { errors.push(`${itemId}:not_labelled_by_both_reviewers`); continue; }
    if (next.items[itemId]) { errors.push(`${itemId}:already_adjudicated`); continue; }
    if (!ADJUDICATION_CHOICES.includes(decision.choice)) { errors.push(`${itemId}:choice_invalid`); continue; }
    if (!isAlias(decision.adjudicator, ADJUDICATOR_ALIAS)) { errors.push(`${itemId}:adjudicator_must_be_an_alias`); continue; }
    if ([reviewA.reviewer, reviewB.reviewer].includes(decision.adjudicator)) { errors.push(`${itemId}:adjudicator_labelled_this_item`); continue; }
    if (Number.isNaN(Date.parse(decision.adjudicatedAt))) { errors.push(`${itemId}:adjudicatedAt_invalid`); continue; }
    let finalLabel = null;
    if (decision.choice === "accept_A") finalLabel = a;
    else if (decision.choice === "accept_B") finalLabel = b;
    else if (decision.choice === "amend") {
      const problems = validateResidentLabel(decision.finalLabel, { vocabulary, text: texts[itemId] ?? "" });
      if (problems.length) { errors.push(...problems.map((problem) => `${itemId}:${problem}`)); continue; }
      finalLabel = decision.finalLabel;
    }
    if (finalLabel && decision.deidentified !== true) { errors.push(`${itemId}:deidentification_not_attested`); continue; }
    next.items[itemId] = {
      choice: decision.choice, adjudicator: decision.adjudicator, adjudicatedAt: decision.adjudicatedAt, reviewers: [reviewA.reviewer, reviewB.reviewer],
      independentAgreement: compareResidentLabels(a, b).agree, deidentified: finalLabel ? true : null, finalLabel, notes: decision.notes ?? null,
    };
  }
  return { adjudication: next, errors, adjudicated: Object.keys(next.items).length };
}

export const emptyAdjudication = () => ({ schema: RESIDENT_ADJUDICATION_SCHEMA, note: "PRIVATE WORKING FILE. Alias-attributed; the released rows are the tracked product.", items: {} });

/**
 * The tracked product: adjudicated, de-identified rows. DEVELOPMENT rows carry their
 * words and final label. EVALUATION rows stay hash-only until the predefined
 * evaluation is completed (`evaluationCompleted`), so untouched language is not
 * readable by whoever tunes the interpreter. Excluded and unadjudicated items are omitted.
 */
export function buildReleasedRows({ adjudication, texts, classified, evaluationCompleted = false }) {
  const byTurn = new Map(classified.map((entry) => [entry.turnKey, entry]));
  const rows = [];
  for (const [itemId, item] of Object.entries(adjudication.items).sort(([x], [y]) => x.localeCompare(y))) {
    if (!item.finalLabel) continue;
    const meta = byTurn.get(itemId);
    if (!meta?.participantKey || !meta.split) continue; // unlinked sessions are never released
    const base = { id: itemId, participantKey: meta.participantKey, split: meta.split, adjudicator: item.adjudicator, independentAgreement: item.independentAgreement, labelSha256: sha(JSON.stringify(item.finalLabel)) };
    if (meta.split === "RESIDENT_EVALUATION" && !evaluationCompleted) rows.push({ ...base, sealed: true, textSha256: sha(texts[itemId]) });
    else rows.push({ ...base, sealed: false, text: texts[itemId], label: item.finalLabel, gold: toEvaluationGold(item.finalLabel) });
  }
  return { schema: RELEASED_ROWS_SCHEMA, note: "De-identified, adjudicated. Evaluation rows are hash-only until the predefined evaluation is completed.", evaluationCompleted, rows };
}

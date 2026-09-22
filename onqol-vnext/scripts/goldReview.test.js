import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDecisions, buildBlindPacket, checkBlindReview, hashGold, labelVocabulary, labelsAgree, syncResidentRows, validateLabel } from "./goldReview.mjs";
import { goldAdjudicationTemplate, v3Corpus } from "./v3Corpus.mjs";
import { withShared } from "../src/core/content/loadBundle.js";
import disease from "../src/content/generated/appendicitis.json" with { type: "json" };
import shared from "../src/content/generated/shared.json" with { type: "json" };

const vocabulary = labelVocabulary(withShared(disease, shared));
const rows = v3Corpus();

test("every draft gold label in the corpus is well formed under the labelling vocabulary", () => {
  const bad = rows.map((row) => [row.id, validateLabel(row.gold, vocabulary)]).filter(([, errors]) => errors.length);
  assert.deepEqual(bad, []);
});

test("the vocabulary includes the recognised-but-unmodeled pelvic ultrasound, so a labeller can name it", () => {
  assert.ok(vocabulary.concepts.testId.includes("pelvic_ultrasound"));
  assert.deepEqual(validateLabel({ disposition: "commands", commands: [{ type: "ORDER_TEST", params: { testId: "pelvic_ultrasound" } }] }, vocabulary), []);
});

test("a blind packet carries no gold, no split, no system reading, and does not keep surface variants adjacent", () => {
  const packet = buildBlindPacket({ items: rows.map((row) => ({ id: row.id, text: row.text, turnContext: row.turnContext })), vocabulary });
  const serialized = JSON.stringify(packet.items);
  assert.equal(packet.items.length, rows.length);
  assert.ok(!/"gold"|HOLDOUT|DEVELOPMENT|hybrid|deterministic|evidenceSpans/.test(serialized));
  assert.ok(packet.items.every((item) => item.label.disposition === null && item.label.commands.length === 0));
  const order = packet.items.map((item) => rows.findIndex((row) => row.id === item.itemId));
  const adjacent = order.slice(1).filter((position, i) => Math.abs(position - order[i]) === 1).length;
  assert.ok(adjacent < rows.length / 10, `shuffled (adjacent pairs: ${adjacent})`);
  assert.deepEqual(packet.items.map((i) => i.itemId), buildBlindPacket({ items: rows.map((row) => ({ id: row.id, text: row.text, turnContext: row.turnContext })), vocabulary }).items.map((i) => i.itemId), "deterministic");
});

const smallPacket = () => buildBlindPacket({ items: rows.slice(0, 3).map((row) => ({ id: row.id, text: row.text, turnContext: row.turnContext })), vocabulary });
const answer = (packet, byId) => ({ items: packet.items.map((item) => ({ itemId: item.itemId, label: byId(item.itemId) })) });
const draftOf = (id) => rows.find((row) => row.id === id).gold;
const draftById = Object.fromEntries(rows.map((row) => [row.id, row.gold]));

test("a reviewer who is the gold author is never independent", () => {
  const packet = smallPacket();
  const result = checkBlindReview({ packet, review: answer(packet, draftOf), reviewer: "Claude", draftById, vocabulary });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("reviewer_is_the_gold_author"));
  assert.ok(checkBlindReview({ packet, review: answer(packet, draftOf), reviewer: "", draftById, vocabulary }).errors.includes("reviewer_missing"));
});

test("an incomplete, altered or malformed review is refused; a complete one reports agreement and lists the disagreements", () => {
  const packet = smallPacket();
  const partial = { items: answer(packet, draftOf).items.slice(1) };
  assert.ok(checkBlindReview({ packet, review: partial, reviewer: "R01", draftById, vocabulary }).errors.some((e) => e.startsWith("missing:")));
  const malformed = answer(packet, () => ({ disposition: "maybe", commands: [] }));
  assert.ok(checkBlindReview({ packet, review: malformed, reviewer: "R01", draftById, vocabulary }).errors.some((e) => e.endsWith("disposition_invalid")));

  const target = packet.items[0].itemId;
  const review = answer(packet, (id) => (id === target ? { disposition: "no_action", commands: [] } : draftOf(id)));
  const result = checkBlindReview({ packet, review, reviewer: "R01", draftById, vocabulary });
  assert.equal(result.ok, true);
  assert.equal(result.agreement.compared, 3);
  assert.equal(result.agreement.agree, 2);
  assert.deepEqual(result.disagreements.map((d) => d.itemId), [target]);
});

test("label agreement ignores order and key order but not content", () => {
  const a = { disposition: "commands", commands: [{ type: "ORDER_TEST", params: { testId: "cbc" } }, { type: "ORDER_TEST", params: { testId: "crp" } }] };
  const b = { disposition: "commands", commands: [{ type: "ORDER_TEST", params: { testId: "crp" } }, { type: "ORDER_TEST", params: { testId: "cbc" } }] };
  assert.ok(labelsAgree(a, b));
  assert.ok(!labelsAgree(a, { ...b, disposition: "clarify" }));
});

test("adjudication decisions are named, bound to the draft gold hash, and never overwrite a decision silently", () => {
  const sample = rows.slice(0, 2);
  const adjudication = goldAdjudicationTemplate(sample);
  const dById = Object.fromEntries(sample.map((row) => [row.id, row.gold]));
  const decision = (extra = {}) => ({ decision: "confirm", adjudicator: "A01", adjudicatedAt: "2026-10-01T09:00:00Z", ...extra });

  const ok = applyDecisions({ adjudication, decisions: { [sample[0].id]: decision() }, draftById: dById, vocabulary });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.adjudication.rows[sample[0].id].decision, "confirm");
  assert.equal(ok.adjudication.status, "PENDING_CLINICIAN_ADJUDICATION", "one of two decided is not complete");

  assert.ok(applyDecisions({ adjudication: ok.adjudication, decisions: { [sample[0].id]: decision({ decision: "exclude" }) }, draftById: dById, vocabulary }).errors[0].endsWith("already_decided"));
  assert.ok(applyDecisions({ adjudication, decisions: { [sample[1].id]: decision({ adjudicator: "Claude" }) }, draftById: dById, vocabulary }).errors[0].endsWith("adjudicator_missing_or_author"));
  assert.ok(applyDecisions({ adjudication, decisions: { [sample[1].id]: decision({ adjudicatedAt: "yesterday" }) }, draftById: dById, vocabulary }).errors[0].endsWith("adjudicatedAt_invalid"));
  assert.ok(applyDecisions({ adjudication, decisions: { [sample[1].id]: decision({ decision: "amend", amendedGold: { disposition: "commands", commands: [{ type: "ORDER_TEST", params: { testId: "nonsense" } }] } }) }, draftById: dById, vocabulary }).errors[0].includes("unknown_concept"));

  const drifted = { ...dById, [sample[1].id]: { commands: [], disposition: "no_action" } };
  assert.ok(applyDecisions({ adjudication, decisions: { [sample[1].id]: decision() }, draftById: drifted, vocabulary }).errors[0].endsWith("draft_gold_changed_since_template"));

  const complete = applyDecisions({ adjudication: ok.adjudication, decisions: { [sample[1].id]: decision({ decision: "exclude" }) }, draftById: dById, vocabulary });
  assert.equal(complete.adjudication.status, "ADJUDICATION_COMPLETE");
  assert.equal(hashGold(sample[0].gold), adjudication.rows[sample[0].id].draftGoldHash);
});

test("a real resident turn has no draft gold to confirm: its gold is the adjudicated label or it is excluded", () => {
  const turn = { turnKey: "Tabc", text: "ОАК" };
  const { adjudication, added } = syncResidentRows({ adjudication: goldAdjudicationTemplate([]), turns: [turn] });
  assert.equal(added, 1);
  assert.equal(adjudication.rows.Tabc.draftGoldHash, null);
  const base = { adjudicator: "A01", adjudicatedAt: "2026-10-01T09:00:00Z" };
  assert.ok(applyDecisions({ adjudication, decisions: { Tabc: { ...base, decision: "confirm" } }, draftById: {}, vocabulary }).errors[0].endsWith("no_draft_to_confirm"));
  const amended = applyDecisions({ adjudication, decisions: { Tabc: { ...base, decision: "amend", amendedGold: { disposition: "commands", commands: [{ type: "ORDER_TEST", params: { testId: "cbc" } }] } } }, draftById: {}, vocabulary });
  assert.deepEqual(amended.errors, []);
  assert.equal(amended.adjudication.status, "ADJUDICATION_COMPLETE");
});

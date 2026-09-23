import { test } from "node:test";
import assert from "node:assert/strict";
import { narrowBroadEvidence } from "./evidenceNarrowing.js";

const text = "вводим болюс 500 мл стерофундина за 15 минут, потом сразу переоценю давление, пульс и диурез";
const action = (type, span) => ({ type, params: {}, evidenceSpans: [span], statedParameters: [] });

test("a whole-sentence span is narrowed to the clause the narrower sibling leaves over", () => {
  const output = { clinicalActions: [action("ORDER_INFUSION", text), action("REASSESS", "потом сразу переоценю давление, пульс и диурез")] };
  const narrowed = narrowBroadEvidence(output, text);
  assert.equal(narrowed.clinicalActions[0].evidenceSpans[0], "вводим болюс 500 мл стерофундина за 15 минут");
  assert.equal(narrowed.clinicalActions[1].evidenceSpans[0], "потом сразу переоценю давление, пульс и диурез", "the narrower sibling is untouched");
});

test("nothing changes when there is no narrower sibling, or the spans are already clause-local", () => {
  const single = { clinicalActions: [action("ORDER_INFUSION", text)] };
  assert.equal(narrowBroadEvidence(single, text), single);
  const local = { clinicalActions: [action("ORDER_INFUSION", "вводим болюс 500 мл стерофундина за 15 минут"), action("REASSESS", "потом сразу переоценю давление")] };
  assert.equal(narrowBroadEvidence(local, text), local);
});

test("two broad spans are not narrowed against each other (attribution is ambiguous)", () => {
  const two = { clinicalActions: [action("ORDER_INFUSION", text), action("REASSESS", text)] };
  assert.equal(narrowBroadEvidence(two, text), two);
});

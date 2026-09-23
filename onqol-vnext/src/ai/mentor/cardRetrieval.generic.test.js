// Card retrieval is disease-agnostic: the same function, the same rules, two
// different case libraries. Nothing here (or in cardRetrieval.js) names a case.
import { test } from "node:test";
import assert from "node:assert/strict";
import { selectCardsForIssue, isRetrievable } from "./cardRetrieval.js";
import { selectLibrary } from "./libraryRegistry.js";
import appLibrary from "../../content/mentor/app004-library.json" with { type: "json" };
import fluidsLibrary from "../../content/mentor/fluids01-library.json" with { type: "json" };

const libraries = [appLibrary, fluidsLibrary];
const ids = (cards) => cards.map((c) => c.id);

test("the library is chosen by the session's own scope, for both cases", () => {
  const scope = (casePresetId) => ({ casePresetId, sessionPurpose: "internal_development", locale: "ru" });
  assert.equal(selectLibrary(libraries, scope("APP-004")).id, appLibrary.id);
  assert.equal(selectLibrary(libraries, scope("FLUIDS-01")).id, fluidsLibrary.id);
  assert.equal(selectLibrary(libraries, scope("NOPE-1")), null);
  assert.equal(selectLibrary(libraries, { ...scope("FLUIDS-01"), sessionPurpose: "learner_pilot" }), null);
});

test("the same retrieval function serves both bundles from their own metadata", () => {
  assert.deepEqual(ids(selectCardsForIssue({ issueId: "open_approach_rationale", learnerText: "", library: appLibrary })), ["K05"]);
  const choice = selectCardsForIssue({ issueId: "fluids.fluid_choice", learnerText: "", library: fluidsLibrary, casePresetId: "FLUIDS-01" });
  assert.ok(choice.length > 0 && choice.every((c) => c.retrieval.issue_ids.includes("fluids.fluid_choice")));
  // no cross-contamination: an appendicitis issue against the fluids library offers only pedagogy
  assert.ok(selectCardsForIssue({ issueId: "open_approach_rationale", learnerText: "", library: fluidsLibrary }).every((c) => c.kind === "pedagogical"));
});

test("retrieval is bounded by the library's own limit and never returns the whole library", () => {
  const cards = selectCardsForIssue({ issueId: "fluids.fluid_choice", learnerText: "рингер физраствор коллоид крахмал альбумин хлорид", library: fluidsLibrary });
  assert.ok(cards.length <= fluidsLibrary.retrieval_limit);
  assert.ok(cards.length < fluidsLibrary.cards.length);
});

test("a learner's own words can retrieve a card with no open issue (text patterns)", () => {
  assert.ok(ids(selectCardsForIssue({ issueId: null, learnerText: "почему нельзя фуросемид при олигурии?", library: fluidsLibrary })).includes("FLU-OLIGURIA-001"));
});

test("draft, pending_review and deprecated cards are never retrievable, however well they match", () => {
  for (const status of ["draft", "pending_review", "deprecated", "reviewed"]) {
    const lib = structuredClone(fluidsLibrary);
    lib.cards.push({ ...structuredClone(lib.cards[0]), id: `X-${status}`, review_status: status, reviewed_by: ["someone"], retrieval: { issue_ids: ["fluids.fluid_choice"] } });
    assert.ok(!ids(selectCardsForIssue({ issueId: "fluids.fluid_choice", learnerText: "", library: lib })).includes(`X-${status}`), status);
  }
  const pending = fluidsLibrary.cards.find((c) => c.id === "FLU-RESUS-002");
  assert.equal(isRetrievable(pending), false);
  assert.ok(!ids(selectCardsForIssue({ issueId: "fluids.reassessment_plan", learnerText: "повторный болюс", library: fluidsLibrary })).includes("FLU-RESUS-002"));
  // an "approved" card with no recorded reviewer is not retrievable either
  assert.equal(isRetrievable({ ...fluidsLibrary.cards[0], reviewed_by: [] }), false);
});

test("exceptions_when removes a card when the LEARNER-VISIBLE state says it does not apply (overload signs shown -> no bolus guidance)", () => {
  const base = { issueId: "fluids.reassessment_plan", learnerText: "", library: fluidsLibrary };
  const calm = { physiologyKnownAt: { values: { respiratoryRate: 20 } } };
  const overloaded = { physiologyKnownAt: { values: { respiratoryRate: 26 } } };
  assert.ok(ids(selectCardsForIssue({ ...base, visibleState: calm })).includes("FLU-RESUS-001"));
  assert.ok(!ids(selectCardsForIssue({ ...base, visibleState: overloaded })).includes("FLU-RESUS-001"));
  assert.ok(ids(selectCardsForIssue({ ...base, visibleState: overloaded })).includes("FLU-RESUS-003"), "the overload card is still offered");
});

test("applies_when is a filter over learner-visible state; unknown state fails closed", () => {
  const lib = structuredClone(fluidsLibrary);
  lib.cards.push({ ...structuredClone(lib.cards[0]), id: "X-cond", retrieval: { issue_ids: ["x.issue"] }, applies_when: [{ path: "physiologyKnownAt.values.respiratoryRate", operator: "gte", value: 24 }] });
  const pick = (visibleState) => ids(selectCardsForIssue({ issueId: "x.issue", learnerText: "", library: lib, visibleState }));
  assert.ok(pick({ physiologyKnownAt: { values: { respiratoryRate: 26 } } }).includes("X-cond"));
  assert.ok(!pick({ physiologyKnownAt: { values: { respiratoryRate: 20 } } }).includes("X-cond"));
  assert.ok(!pick(null).includes("X-cond"), "no learner-visible state = the condition cannot be shown to hold");
});

test("case_scope narrows a card to its case", () => {
  const lib = structuredClone(fluidsLibrary);
  lib.cards.push({ ...structuredClone(lib.cards[0]), id: "X-scoped", case_scope: ["SOMETHING-ELSE"], retrieval: { issue_ids: ["fluids.fluid_choice"] } });
  assert.ok(!ids(selectCardsForIssue({ issueId: "fluids.fluid_choice", learnerText: "", library: lib, casePresetId: "FLUIDS-01" })).includes("X-scoped"));
});

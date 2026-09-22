import { test } from "node:test";
import assert from "node:assert/strict";
import { selectCardsForIssue } from "./cardRetrieval.js";
import library from "../../content/mentor/app004-library.json" with { type: "json" };

test("a draft (unapproved) card is never selectable even when it matches the mapping or a keyword", () => {
  const draftLibrary = structuredClone(library);
  draftLibrary.cards.push({ id: "K99", kind: "background_reference", statement: "не проверено", review_status: "draft", sourceIds: [] });
  const selected = selectCardsForIssue({ issueId: "open_approach_rationale", learnerText: "K99", library: draftLibrary });
  assert.ok(!selected.some((c) => c.id === "K99"));
});

test("issue -> card mapping stays bounded: an unrelated issue does not pull in the whole library", () => {
  const selected = selectCardsForIssue({ issueId: "open_approach_rationale", learnerText: "", library });
  assert.ok(selected.length < library.cards.length);
  assert.ok(selected.every((c) => c.review_status === "approved_for_training"));
});

test("no issue and no keyword match still returns a bounded set (pedagogical only), never the full library", () => {
  const selected = selectCardsForIssue({ issueId: null, learnerText: "случайный текст без совпадений", library });
  assert.ok(selected.length > 0);
  assert.ok(selected.every((c) => c.kind === "pedagogical"));
});

test("a keyword match narrows to the relevant card, not every card", () => {
  const selected = selectCardsForIssue({ issueId: null, learnerText: "почему боль мигрировала из около пупка?", library });
  assert.deepEqual(selected.map((c) => c.id), ["K01"]);
});

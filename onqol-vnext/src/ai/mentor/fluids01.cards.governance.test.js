// The fluids card package: every card is a faithful extraction of the frozen
// source, promotion is honest, and the mentor's own wording adds no claim.
import { test } from "node:test";
import assert from "node:assert/strict";
import library from "../../content/mentor/fluids01-library.json" with { type: "json" };
import evidence from "../../../docs/evidence/WAVE_B_FLUIDS_CARD_FAITHFULNESS.json" with { type: "json" };
import fluids from "../../content/generated/fluids_01.json" with { type: "json" };
import { checkCardFaithfulness, numbersIn, sha256 } from "./cardFaithfulness.js";
import { buildIssueDefinitions } from "./teachingCandidates.js";

test("every card is a faithful extraction: it has quotes, adds no number and no undeclared term", () => {
  for (const card of library.cards) {
    const check = checkCardFaithfulness(card);
    assert.deepEqual({ id: card.id, newNumbers: check.newNumbers, unexplained: check.unexplainedTerms, hasQuotes: check.hasQuotes }, { id: card.id, newNumbers: [], unexplained: [], hasQuotes: true });
  }
});

test("a paraphrase that drifts is caught: a new number or a new undeclared term fails the check", () => {
  const card = library.cards.find((c) => c.id === "FLU-RESUS-001");
  assert.equal(checkCardFaithfulness({ ...card, statement: card.statement.replace("500", "750") }).ok, false);
  assert.equal(checkCardFaithfulness({ ...card, statement: `${card.statement} Дополнительно назначь диуретик.` }).ok, false);
});

test("the recorded evidence matches the library as it is now, and the source hash is the pinned one", () => {
  assert.equal(evidence.sourceSha256Pinned, evidence.sourceSha256Observed);
  assert.equal(evidence.cards.length, library.cards.length);
  for (const card of library.cards) {
    const recorded = evidence.cards.find((c) => c.id === card.id);
    assert.ok(recorded?.ok, `${card.id} has no passing evidence`);
    assert.equal(recorded.statementSha256, sha256(card.statement), `${card.id}: statement changed after verification`);
    assert.equal(recorded.quotesSha256, sha256(card.source_quotes.join("\n")), `${card.id}: quotes changed after verification`);
    assert.equal(recorded.quotesFound, true);
  }
});

test("promotion is honest: approved cards carry a reviewer and date; the source's own unconfirmed figure stays pending and inert", () => {
  const pending = library.cards.filter((c) => c.review_status !== "approved_for_training");
  assert.deepEqual(pending.map((c) => c.id), ["FLU-RESUS-002"]);
  assert.equal(pending[0].review_status, "pending_review");
  assert.deepEqual(pending[0].reviewed_by, []);
  for (const card of library.cards.filter((c) => c.review_status === "approved_for_training")) {
    assert.ok(card.reviewed_by.length && card.reviewed_at, card.id);
    assert.ok(card.allowed_uses.mentor_teaching === true && card.allowed_uses.safety === false && card.allowed_uses.scoring === false && card.allowed_uses.patient_effect === false, card.id);
    assert.ok(["low", "medium", "high"].includes(card.risk_class), card.id);
    assert.ok(card.source_locator && card.source_artifact && Array.isArray(card.exceptions) && typeof card.constraints === "string", card.id);
  }
});

test("the pending rule and the pending card describe the same withheld claim", () => {
  const rule = fluids.rules.rules.find((r) => r.id === "RULE-FLUIDS-REPEAT-BOLUS-THRESHOLD");
  assert.equal(rule.provenance.review_status, "pending_review");
});

test("mentor wording adds no claim: prompts and cue levels carry no number, and level 4 quotes the approved cards it explains verbatim", () => {
  const cards = new Map(library.cards.map((c) => [c.id, c]));
  for (const issue of fluids.rules.teaching_issues) {
    for (const text of [issue.prompt_ru, issue.scaffold_ru[1], issue.scaffold_ru[2], issue.scaffold_ru[3]]) assert.deepEqual(numbersIn(text), [], `${issue.id}: ${text}`);
    assert.ok(issue.explains.length > 0, issue.id);
    for (const id of issue.explains) {
      const card = cards.get(id);
      assert.equal(card.review_status, "approved_for_training", `${issue.id} explains a non-approved card`);
      assert.ok(issue.scaffold_ru[4].includes(card.statement), `${issue.id} level 4 does not quote ${id}`);
    }
    assert.match(issue.scaffold_ru[4], /\?$/, `${issue.id}: level 4 must hand the decision back`);
    assert.ok(!/верно|правильно|молодец|разумно|отлично|хорошо/i.test(Object.values(issue.scaffold_ru).join(" ") + issue.prompt_ru), `${issue.id}: evaluative wording`);
  }
  assert.ok(Object.keys(buildIssueDefinitions(fluids)).length >= 6);
});

test("every issue a card serves is an issue that can actually be raised, or a documented discussion-only topic", () => {
  const raisable = new Set(fluids.rules.teaching_issues.map((i) => i.id));
  const discussionOnly = new Set(["fluids.initial_assessment", "fluids.cause_search", "fluids.balance_limits", "fluids.hemodynamic_interpretation", "fluids.overall_plan", "fluids.monitoring_plan", "fluids.aki_claim", "fluids.no_response_escalation"]);
  for (const card of library.cards) {
    for (const issueId of card.retrieval.issue_ids ?? []) {
      assert.ok(raisable.has(issueId) || discussionOnly.has(issueId) || issueId.startsWith("RULE-"), `${card.id} -> ${issueId}`);
    }
  }
});

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  REVIEW_PATH,
  SNAPSHOT_PATH,
  buildPilotRuRuntimeReview,
  renderReviewMarkdown,
  renderSnapshotJson,
} from "../../../scripts/buildPilotRuRuntimeCopyReview.mjs";

const ACTIVE_CASE_IDS = new Set(["APP-001", "APP-002", "APP-003", "APP-004"]);
const FORBIDDEN_TECHNICAL_COPY =
  /(серверный контур|серверный интерпретатор|локальный matcher|\bendpoint\b|discharge\s*\/\s*follow-up|evidence-grounded debrief|basic resource|safety-critical)/iu;
const FORBIDDEN_KAZAKH_COPY = /(Сессия алғашқы|Казахская клиническая редакция|ҚАЗ\s*·\s*REVIEW|[әғқңөұүһі])/u;
const INTERNAL_ONLY_SOURCE =
  /(mentorBehaviorSpec|accepted_phrasings|locales\/kk|semanticRouter|fullClinicalTest|alternatives|scoringContract|telemetry|corpus\/)/u;

test("RU review is built only from the scoped active pilot runtime", async () => {
  const review = await buildPilotRuRuntimeReview();
  assert.equal(review.scope.locale, "ru");
  assert.deepEqual(review.scope.case_preset_ids, [...ACTIVE_CASE_IDS]);
  assert.equal(review.scope.cohort, "N=8 residents");
  assert.equal(review.scope.resource_profile, "REFERENCE-FULL");
  assert.equal(review.scope.real_facility_mode, false);
  assert.equal(review.scope.scoring_mode, "formative_only");
  assert.equal(review.scope.production_review_id, "ONQOL-REFERENCE-FULL-20260820");
  assert.deepEqual(Object.keys(review.reachability.case_seeds).sort(), [...ACTIVE_CASE_IDS].sort());

  for (const entry of review.entries) {
    if (entry.case_id) assert.ok(ACTIVE_CASE_IDS.has(entry.case_id), entry.id);
    assert.equal(["deterioration", "complication_workup", "source_control_2"].includes(entry.runtime_state), false, entry.id);
    assert.equal(entry.status, "needs owner review");
  }
  assert.equal(review.entries.some((entry) => /APP-005/u.test(entry.text)), false);
});

test("reviewed learner text contains no KZ leak or forbidden technical jargon", async () => {
  const review = await buildPilotRuRuntimeReview();
  for (const entry of review.entries) {
    assert.doesNotMatch(entry.text, FORBIDDEN_TECHNICAL_COPY, entry.id);
    assert.doesNotMatch(entry.text, FORBIDDEN_KAZAKH_COPY, entry.id);
    assert.equal(entry.source_files.some((file) => INTERNAL_ONLY_SOURCE.test(file)), false, entry.id);
  }
  assert.ok(
    review.entries.some((entry) => entry.text.includes("Медсестра ожидает назначения.")),
    "the reviewed runtime must include the corrected order clarification"
  );
  assert.ok(
    review.entries.some((entry) => entry.text.includes("В сессии используется случайный код.")),
    "the reviewed runtime must include the participant privacy wording"
  );
});

test("RU review Markdown and structured snapshots stay synchronized with runtime", async () => {
  const review = await buildPilotRuRuntimeReview();
  assert.equal(fs.readFileSync(REVIEW_PATH, "utf8"), renderReviewMarkdown(review));
  assert.equal(fs.readFileSync(SNAPSHOT_PATH, "utf8"), renderSnapshotJson(review));
});

// A clinical report must be reproducible and must never be authoritative.

import assert from "node:assert/strict";
import test from "node:test";
import { buildV35Case } from "../v35/createCase.js";
import { createV25Session } from "../v25/engine.js";
import {
  CLINICAL_REPORT_CATEGORIES,
  CLINICAL_REPORT_CATEGORY_IDS,
  clearClinicalReports,
  createClinicalReport,
  exportClinicalReports,
  listClinicalReports,
  saveClinicalReport,
} from "../governance/clinicalReport.js";

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
  };
}

function pilotSession() {
  const { caseData } = buildV35Case({ seed: "report-seed", requestedPresetId: "APP-003", mode: "faculty" });
  const session = createV25Session({ caseData, mode: "reference", seed: "report-seed" });
  return { caseData, session };
}

test("a report carries everything needed to rebuild the disputed moment", () => {
  const { caseData, session } = pilotSession();
  const { ok, report } = createClinicalReport({
    caseData,
    session,
    categoryId: "wrong_patient_fact",
    comment: "СРБ 39 при боли 4 часа выглядит завышенным",
    reporterRole: "resident_year_2",
    reportedAt: "2026-09-01T10:00:00.000Z",
  });

  assert.equal(ok, true);
  assert.equal(report.context.session_id, session.session_id);
  assert.equal(report.context.case_preset_id, "APP-003");
  assert.equal(report.context.content_version, caseData.v35_composition.content_version);
  assert.ok(report.context.effective_seed);
  assert.ok(report.context.clinical_rule_registry_version);
  assert.equal(report.routes_to, "clinical_reviewer");
});

test("a report can never claim runtime or scoring authority", () => {
  const { caseData, session } = pilotSession();
  const { report } = createClinicalReport({
    caseData,
    session,
    categoryId: "wrong_dose_or_threshold",
    comment: "доза выглядит неверной",
  });
  assert.equal(report.changes_runtime, false);
  assert.equal(report.changes_scoring, false);
  assert.equal(report.review_status, "reported");
});

test("identifiers in the reporter's own words are redacted before the file leaves the browser", () => {
  const { caseData, session } = pilotSession();
  const { report } = createClinicalReport({
    caseData,
    session,
    categoryId: "other",
    comment: "пациент ИИН 123456789012 описан неверно",
  });
  assert.doesNotMatch(JSON.stringify(report), /123456789012/);
});

test("a bad report is refused without ending the session", () => {
  const { caseData, session } = pilotSession();
  assert.deepEqual(
    createClinicalReport({ caseData, session, categoryId: "nonexistent", comment: "текст" }).errors,
    ["unknown_category"]
  );
  assert.deepEqual(
    createClinicalReport({ caseData, session, categoryId: "other", comment: " " }).errors,
    ["comment_required"]
  );
});

test("the reporter is a course year, never a name", () => {
  const { caseData, session } = pilotSession();
  const { report } = createClinicalReport({
    caseData,
    session,
    categoryId: "other",
    comment: "замечание",
    reporterRole: "Томирис",
  });
  assert.equal(report.reporter_role, "unspecified");
});

test("the educator's export groups the queue by who has to look at it", () => {
  const storage = memoryStorage();
  const { caseData, session } = pilotSession();
  for (const categoryId of ["wrong_patient_fact", "outdated_rule", "language_or_wording"]) {
    saveClinicalReport(
      createClinicalReport({ caseData, session, categoryId, comment: "замечание" }).report,
      storage
    );
  }
  const exported = exportClinicalReports(storage);
  assert.equal(exported.total, 3);
  assert.equal(exported.counts_by_route.clinical_reviewer, 2);
  assert.equal(exported.counts_by_route.language_reviewer, 1);

  clearClinicalReports(storage);
  assert.deepEqual(listClinicalReports(storage), []);
});

test("clinical reports expire after seven days and are purged on the next app read", () => {
  const storage = memoryStorage();
  const { caseData, session } = pilotSession();
  let now = Date.parse("2026-08-20T10:00:00.000Z");
  saveClinicalReport(
    createClinicalReport({ caseData, session, categoryId: "other", comment: "замечание" }).report,
    storage,
    { now: () => now, retentionMs: 1_000 }
  );
  assert.equal(listClinicalReports(storage, { now: () => now, retentionMs: 1_000 }).length, 1);
  now += 1_001;
  assert.deepEqual(listClinicalReports(storage, { now: () => now, retentionMs: 1_000 }), []);
});

test("every category names an owner, so no report lands in a queue nobody reads", () => {
  assert.equal(CLINICAL_REPORT_CATEGORY_IDS.length, CLINICAL_REPORT_CATEGORIES.length);
  for (const category of CLINICAL_REPORT_CATEGORIES) {
    assert.ok(category.label_ru, category.id);
    assert.ok(category.hint_ru, category.id);
    assert.ok(category.routes_to, category.id);
  }
});

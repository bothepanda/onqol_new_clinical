// The P0 clinical remediation of 19.08.2026, held as executable contract.
//
// Every assertion here replaces a claim the product used to make and could not
// support: a paediatric score offered to adults, an unqualified recurrence
// figure, a pelvic workup owed by every woman of reproductive age, a
// deterministic rectal finding, an unvalidated CRP curve read as fact, and two
// conditional recommendations encoded as hard rules.
//
// The point of the text guards at the bottom is that documentation drifts back.
// A corrected sentence that only lives in a Markdown file is one careless edit
// from returning, so the repository itself is scanned.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildV35Case } from "../v35/createCase.js";
import { CASE_PRESETS, V35_MODIFIERS, PHENOTYPES } from "../v35/phenotypes.js";
import { generatePatient } from "../v35/patientGenerator.js";
import { appendicitisEvidence } from "../evidence/appendicitisEvidence.js";

const STABLE_PRESETS = ["APP-001", "APP-002", "APP-003", "APP-004"];

function caseFor(presetId, seed = `corr-${presetId}`) {
  return buildV35Case({ seed, requestedPresetId: presetId, mode: "faculty" }).caseData;
}

function allActions(caseData) {
  return [
    ...(caseData.expected_actions || []),
    ...(caseData.acceptable_alternatives || []),
    ...(caseData.unnecessary_actions || []),
    ...(caseData.unsafe_actions || []),
  ];
}

function actionById(caseData, id) {
  return allActions(caseData).find((action) => action.id === id);
}

/** Everything this case can put in front of a learner. */
function learnerFacingStrings(caseData) {
  const strings = [caseData.initial_presentation?.text || ""];
  for (const finding of Object.values(caseData.available_findings || {})) {
    strings.push(finding.text || "", finding.title || "");
  }
  for (const action of allActions(caseData)) {
    strings.push(
      action.feedback || "",
      action.feedback_if_done || "",
      action.feedback_if_missed || "",
      action.router_description || ""
    );
  }
  return strings.filter(Boolean);
}

// --- P0.1 adult risk scores -------------------------------------------------

test("the adult slice names AIR and AAS and never suggests the paediatric PAS", () => {
  for (const presetId of STABLE_PRESETS) {
    for (const text of learnerFacingStrings(caseFor(presetId))) {
      assert.doesNotMatch(text, /\bPAS\b/i, `${presetId}: ${text.slice(0, 80)}`);
    }
  }
});

test("naming a score is not a diagnosis, and no numeric cutoff is available or scored", () => {
  const caseData = caseFor("APP-002");
  const risk = actionById(caseData, "risk_stratification");
  assert.ok(risk);
  assert.match(risk.feedback_if_done, /AIR|AAS/);
  // A cutoff would have to be a number in the feedback. There is none.
  assert.doesNotMatch(risk.feedback_if_done, /\d+\s*балл/i);
  assert.ok(!(caseData.critical_omissions || []).includes("risk_stratification"));
});

// --- P0.6 reproductive safety ----------------------------------------------

test("the pregnancy modifier makes pregnancy status expected and nothing else", () => {
  const modifier = V35_MODIFIERS["MOD-PREGNANCY-POSSIBLE"];
  assert.deepEqual([...modifier.enables_action_ids], ["pregnancy_test"]);
  assert.deepEqual(
    [...modifier.conditionally_relevant_action_ids].sort(),
    ["gynecology_consult", "pelvic_gynecologic_screen", "pelvic_ultrasound"]
  );
});

test("every woman of 18-50 owes a pregnancy test, and nobody else owes its omission", () => {
  const presets = CASE_PRESETS.filter((preset) => preset.runtime_status === "learner_active");
  let women = 0;
  let others = 0;
  for (const preset of presets) {
    for (let index = 0; index < 60; index += 1) {
      const patient = generatePatient(preset.case_preset_id, `preg-${preset.case_preset_id}-${index}`);
      const { sex, age } = patient.demographics;
      const inBand = sex === "female" && age >= 18 && age <= 50;
      const enabled = patient.enabled_action_ids.includes("pregnancy_test");
      assert.equal(enabled, inBand, `${preset.case_preset_id}/${index}: ${sex} ${age}`);
      if (inBand) women += 1;
      else others += 1;
    }
  }
  assert.ok(women > 0 && others > 0, "the sample must contain both sides of the band");
});

test("pelvic ultrasound, pelvic examination and gynaecology consultation stay orderable and unrequired", () => {
  for (const presetId of STABLE_PRESETS) {
    const caseData = caseFor(presetId);
    for (const id of ["pelvic_gynecologic_screen", "pelvic_ultrasound", "gynecology_consult"]) {
      const action = actionById(caseData, id);
      assert.ok(action, `${presetId}: ${id} must remain orderable`);
      assert.equal(action.expected_for_this_patient, false, `${presetId}: ${id}`);
      assert.equal(action.eligible_for_scoring, false, `${presetId}: ${id}`);
      assert.equal(action.critical, false, `${presetId}: ${id}`);
      assert.equal(action.score_weight, 0, `${presetId}: ${id}`);
      assert.ok(!(caseData.critical_omissions || []).includes(id), `${presetId}: ${id}`);
    }
  }
});

test("a negative pregnancy test closes pregnancy questions, it does not confirm appendicitis", () => {
  const action = actionById(caseFor("APP-002"), "pregnancy_test");
  assert.match(action.feedback_if_done, /не подтверждает аппендицит/i);
  assert.doesNotMatch(action.feedback_if_done, /беременность исключена/i);
  assert.deepEqual(action.evidence_reference_ids, [
    "acep-pregnancy-test-abdominal-pain",
    "acr-pelvic-pain-reproductive-age",
  ]);
});

// --- P0.8 CRP ---------------------------------------------------------------

test("CRP is answerable and returns no number in any stable preset", () => {
  for (const presetId of STABLE_PRESETS) {
    for (let index = 0; index < 12; index += 1) {
      const caseData = caseFor(presetId, `crp-${presetId}-${index}`);
      const finding = caseData.available_findings.crp;
      assert.ok(finding, presetId);
      assert.match(finding.text, /не моделируется/i, presetId);
      assert.doesNotMatch(finding.text, /\d+\s*мг\/л/i, `${presetId}/${index}: ${finding.text}`);
    }
  }
});

test("CRP is never required, critical or scored, and gates no transition", () => {
  for (const presetId of STABLE_PRESETS) {
    const caseData = caseFor(presetId);
    const crp = actionById(caseData, "crp");
    assert.ok(crp);
    assert.equal(crp.eligible_for_scoring, false, presetId);
    assert.equal(crp.score_weight, 0, presetId);
    assert.equal(crp.critical, false, presetId);
    assert.ok(!(caseData.critical_omissions || []).includes("crp"), presetId);
    for (const transition of caseData.state_transitions || []) {
      assert.ok(!(transition.when_all_done || []).includes("crp"), presetId);
      assert.ok(!(transition.when_any_done || []).includes("crp"), presetId);
    }
  }
});

test("the latent CRP still exists internally, so the physiology stays coherent", () => {
  const patient = generatePatient("APP-002", "crp-internal");
  assert.ok(Number.isFinite(patient.labs.crp));
});

// --- P0.2 and P0.5 conditional recommendations ------------------------------

test("nonoperative management is an option, not an unsafe action", () => {
  for (const presetId of STABLE_PRESETS) {
    const caseData = caseFor(presetId);
    assert.ok(
      !(caseData.unsafe_actions || []).some((action) => action.id === "antibiotic_observation_course"),
      presetId
    );
    const nom = actionById(caseData, "antibiotic_observation_course");
    assert.ok(nom, presetId);
    assert.equal(nom.eligible_for_scoring, false, presetId);
    assert.equal(nom.score_weight, 0, presetId);
    assert.equal(nom.critical, false, presetId);
    assert.equal(nom.penalty, undefined, presetId);
  }
});

test("the NOM answer names the selection conditions instead of a verdict", () => {
  const nom = actionById(caseFor("APP-002"), "antibiotic_observation_course");
  for (const expected of [/наблюдени/i, /переоценк/i, /операции спасения/i, /совместном решении/i, /аппендиколит/i]) {
    assert.match(nom.feedback, expected);
  }
  assert.doesNotMatch(nom.feedback, /это ошибка|неправильно|противопоказан|не показан/i);
  assert.match(nom.feedback, /ни принять, ни назвать ошибкой/i);
  assert.deepEqual(nom.evidence_reference_ids, ["wses-2025-rec-5-1"]);
});

test("postoperative antibiotics after uncomplicated appendectomy carry no penalty and no ban", () => {
  for (const presetId of STABLE_PRESETS) {
    const caseData = caseFor(presetId);
    assert.ok(
      !(caseData.unsafe_actions || []).some((action) => action.id === "postop_antibiotics_uncomplicated"),
      presetId
    );
    const action = actionById(caseData, "postop_antibiotics_uncomplicated");
    assert.ok(action, presetId);
    assert.equal(action.penalty, 0, presetId);
    assert.equal(action.eligible_for_scoring, false, presetId);
    assert.equal(action.critical, false, presetId);
    assert.match(action.feedback, /предлагает не назначать[^.]*рутинно/);
    assert.doesNotMatch(action.feedback, /не показаны|запрещ/i);
  }
});

// --- P0.3 operation timing --------------------------------------------------

test("a stable patient operated within 24 hours is not told that waiting was an error", () => {
  const caseData = caseFor("APP-002");
  const action =
    actionById(caseData, "appendectomy_here") || actionById(caseData, "open_appendectomy_here");
  assert.ok(action, "the case must carry an operative leaf");
  assert.match(action.feedback_if_done, /24 часов/);
  assert.match(action.feedback_if_done, /ошибкой не является/i);
  // The window is a ceiling, not a target - and deterioration still escalates.
  assert.match(action.feedback_if_done, /потолок, а не цель/i);
  assert.match(action.feedback_if_done, /ухудшени/i);
});

// --- P0.4 prophylaxis -------------------------------------------------------

test("prophylaxis teaches the decision boundary and never a local regimen", () => {
  const action = actionById(caseFor("APP-002"), "preop_single_antibiotic_prophylaxis");
  assert.match(action.feedback_if_done, /локальному утверждённому протоколу/i);
  for (const text of [action.feedback_if_done, action.feedback_if_missed]) {
    assert.doesNotMatch(text, /цефтриаксон|метронидазол|амоксициллин|гентамицин|\d+\s*(мг|г)\b/i);
    assert.doesNotMatch(text, /широкого спектра/i);
  }
});

// --- P0.7 DRE evidence attribution -----------------------------------------

test("no phenotype carries a rectal finding, and the DRE source is attributed to Takada", () => {
  for (const phenotype of Object.values(PHENOTYPES)) {
    assert.equal(phenotype.presentation?.rectal_exam_slots, undefined, phenotype.phenotype_id);
  }
  const source = appendicitisEvidence.references.find((entry) => entry.id === "takada-2015-dre");
  assert.ok(source);
  assert.match(source.citation, /Takada T/);
});

// --- repository-wide text guards -------------------------------------------

const REPO_ROOT = new URL("../../..", import.meta.url).pathname;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "legacy-v1", "__tests__"]);
const SCAN_EXTENSIONS = [".js", ".jsx", ".yaml", ".md"];

function scannedFiles(dir = REPO_ROOT, found = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) scannedFiles(path, found);
    else if (SCAN_EXTENSIONS.some((extension) => entry.endsWith(extension))) found.push(path);
  }
  return found;
}

function offenders(pattern) {
  return scannedFiles()
    .filter((path) => pattern.test(readFileSync(path, "utf8")))
    .map((path) => path.replace(REPO_ROOT, ""));
}

test("the unqualified 15-20% recurrence figure is gone from the repository", () => {
  assert.deepEqual(offenders(/15\s*[-–]\s*20\s*%/), []);
});

// The codes may still be NAMED - a withdrawal has to say what it withdraws.
// What must not survive is a sentence that presents them as current.
test("no file still claims K35.0/K35.1/K35.9 as the confirmed Kazakhstan pilot codes", () => {
  const triple = /K35\.0\s*\/\s*K35\.1\s*\/\s*K35\.9/;
  const withdrawn = /withdraw|not reliable|отозв|недостовер/i;
  const claims = [];
  for (const path of scannedFiles()) {
    const lines = readFileSync(path, "utf8").split("\n");
    for (const [index, line] of lines.entries()) {
      if (triple.test(line) && !withdrawn.test(line)) {
        claims.push(`${path.replace(REPO_ROOT, "")}:${index + 1}`);
      }
    }
  }
  assert.deepEqual(claims, []);
});

test("no adult-facing text still offers AIR, AAS and PAS as one interchangeable set", () => {
  assert.deepEqual(offenders(/AIR,?\s*AAS,?\s*(или|or)\s*PAS/i), []);
});

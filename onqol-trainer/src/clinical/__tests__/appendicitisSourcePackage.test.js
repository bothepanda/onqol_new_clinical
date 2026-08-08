import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import YAML from "yaml";
import {
  localeHasNoClinicalRuleSections,
  validateAppendicitisSource,
} from "../diseases/appendicitis/sourceValidation.js";

const here = dirname(fileURLToPath(import.meta.url));
const diseaseDir = join(here, "../diseases/appendicitis");

function readYaml(path) {
  return YAML.parse(readFileSync(path, "utf8"));
}

const core = readYaml(join(diseaseDir, "appendicitis.core.yaml"));
const locales = {
  ru: readYaml(join(diseaseDir, "locales/ru.yaml")),
  kk: readYaml(join(diseaseDir, "locales/kk.yaml")),
};

test("appendicitis v0.2 source package validates all locale text keys", () => {
  const result = validateAppendicitisSource(core, locales);
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.ok(result.textKeys.includes("rec.WSES-R9.1"));
  assert.ok(result.textKeys.includes("kzdelta.KZDELTA-2"));
});

test("locale files do not carry clinical numbers or rules", () => {
  assert.deepEqual(localeHasNoClinicalRuleSections(locales.ru), []);
  assert.deepEqual(localeHasNoClinicalRuleSections(locales.kk), []);
  assert.equal(core.numeric_facts.surgery_window_uncomplicated_selected_for_surgery.max_hours_from_admission, 24);
  assert.equal(core.recommendations.find((item) => item.id === "WSES-R9.1").max_hours_from_admission, 24);
});

test("conditional recommendations are not encoded as absolute bans", () => {
  const conditional = core.recommendations.filter((item) => item.strength === "conditional");
  assert.ok(conditional.length > 0);
  assert.equal(core.scoring_semantics.conditional_recommendation.do_not_encode_as_absolute_ban, true);
  assert.ok(conditional.every((item) => item.absolute_ban !== true));
});

test("periappendicular abscess can enter a guideline-defined NOM branch", () => {
  const abscess = core.recommendations.find((item) => item.id === "WSES-R13.1");
  assert.ok(abscess);
  assert.ok(
    abscess.branches.some((branch) =>
      String(branch.alternative_if_inadequate_laparoscopic_expertise_or_emergency_resources || "").includes(
        "initial_nom"
      )
    )
  );
});

test("operationalized transfer rules are not eligible for scoring before review", () => {
  assert.ok(core.operationalized_rules.length > 0);
  assert.ok(core.operationalized_rules.every((rule) => rule.eligible_for_scoring === false));
});

test("production gate remains closed until independent review", () => {
  assert.equal(core.review.release_gate.production_allowed, false);
  assert.equal(core.independent_review_status, "pending");
  assert.equal(core.translation_status.kk, "draft_clinical_translation");
});

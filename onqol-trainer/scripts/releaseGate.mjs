import process from "node:process";
import { buildV35Case } from "../src/clinical/v35/createCase.js";
import { evaluateReleaseGate } from "../src/clinical/v35/releaseGate.js";

const { caseData } = buildV35Case({
  seed: "onqol-release-gate",
  locale: "ru",
  requestedPresetId: "APP-001",
});
const result = evaluateReleaseGate(caseData, process.env);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.deploy_allowed) process.exitCode = 1;


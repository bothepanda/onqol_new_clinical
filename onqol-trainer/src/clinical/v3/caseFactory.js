import { createV25Case } from "../v25/caseFactory.js";
import { composeV3Case } from "./createCase.js";
import { getDiseaseModule } from "./diseaseModules.js";

/**
 * V3 = V2.5 engine + universal action library + mentor channel.
 *
 * The clinical declarations that used to live here moved to
 * `v3/diseaseModules.js`, where each disease keeps its own. They are re-exported
 * unchanged so existing imports and the reviewer's reading path still work.
 *
 * Case selection now goes through `selectV3Case` (v3/createCase.js). This
 * function stays as the single-case entry point used by tests and by anything
 * that wants appendicitis specifically.
 */
export {
  V3_OPERATIVE_ACTION_IDS,
  V3_MINIMUM_ASSESSMENT,
  V3_BASE_EVIDENCE,
  V3_EXTRA_OPERATIVE_PREREQUISITES,
} from "./diseaseModules.js";

export { selectV3Case } from "./createCase.js";

export function createV3Case(locale = "ru") {
  const baseCase = createV25Case(locale);
  const { caseData } = composeV3Case(baseCase, getDiseaseModule(baseCase));
  return { ...caseData, case_id: "app-acute-v3-001" };
}

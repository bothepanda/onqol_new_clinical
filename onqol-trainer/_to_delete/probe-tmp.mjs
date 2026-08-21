import { readFileSync } from "node:fs";
import { buildV35Case } from "./src/clinical/v35/createCase.js";
import { advanceV25Session, createV25Session } from "./src/clinical/v25/engine.js";
import { replay91baRouter } from "./src/clinical/__tests__/fixtures/replay91baRouter.js";
import { buildMentorBrief } from "./src/clinical/core/mentorBrief.js";
import {
  appendicitisRouterConceptMap,
  resolveConcept,
} from "./src/clinical/diseases/appendicitis/router/conceptRegistry.js";

const fixture = JSON.parse(readFileSync("./src/clinical/__tests__/fixtures/replay-91ba7206.json", "utf8"));
const built = buildV35Case({ seed: fixture.effective_seed, requestedPresetId: fixture.case_preset_id });
const caseData = built.caseData;
let session = createV25Session({ caseData, mode: fixture.mode, seed: fixture.effective_seed });
const turns = fixture.transcript.filter((e) => e.role === "user").map((e) => e.content);

for (const [i, input] of turns.entries()) {
  const result = await advanceV25Session({
    caseData, session, input,
    options: {
      mentor: true,
      actionExtractorLLM: replay91baRouter,
      conceptMap: appendicitisRouterConceptMap,
      conceptRegistry: resolveConcept,
      // no mentorLLM: we want the BRIEF, not the model's reply
    },
  });
  const brief = buildMentorBrief({
    caseData,
    session: result.session,
    plan: result.plan,
    deterministicUpdate: result,
  });
  session = result.session;
  console.log(`\n──── ХОД ${i + 1} ── ${input.slice(0, 70)}`);
  console.log("  completedActions:", (session.completedActions || []).join(", ") || "—");
  const issues = brief?.candidateIssues || [];
  console.log("  candidate_issues:", issues.length ? issues.map((x) => `${x.issue_id}[sev${x.severity}]`).join(", ") : "— пусто —");
  const deferred = brief?.deferredIssues || [];
  console.log("  deferred:", deferred.length ? deferred.map((x) => x.issue_id).join(", ") : "—");
}

// Offline reviewer tool. Input is a locally saved persistence object, not the
// learner's limited transcript. No network, credentials, or truth mutation.
import { readFileSync, writeFileSync } from "node:fs";
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("Usage: node scripts/reviewFlexiblePatient.mjs saved-persistence.json review.json");
const artifact = JSON.parse(readFileSync(input, "utf8"));
if (artifact.schemaVersion !== 1 || !Array.isArray(artifact.patientDialogue) || !Array.isArray(artifact.expectedEvents)) throw new Error("Expected V2 persistence artifact");
const review = { schema: "flexible-patient-2-review", audience: "reviewer_only", sessionId: artifact.start.sessionId,
  contentVersions: artifact.start.contentVersions, responses: artifact.patientDialogue,
  // Existing events are referenced, never a duplicated causal history.
  causalEventReferences: artifact.expectedEvents.filter((e) => e.payload.calibration).map((e) => ({ seq: e.seq, type: e.type, atMinutes: e.atMinutes, calibration: e.payload.calibration.id })) };
writeFileSync(output, JSON.stringify(review, null, 2), { flag: "wx" });
console.log(`Reviewed ${review.responses.length} response records; output is reviewer-only.`);

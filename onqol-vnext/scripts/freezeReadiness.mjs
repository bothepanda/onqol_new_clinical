import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { v3FreezeEligibility } from "./v3Metrics.mjs";
import { v3Corpus } from "./v3Corpus.mjs";
import { PRIVATE_RESIDENT_DIR, RESIDENT_MANIFEST } from "./evidenceGovernance.mjs";

/**
 * Where the candidate stands against the freeze protocol. Read-only: it changes
 * nothing, freezes nothing and never runs the holdout. Every number is read from
 * an artifact, none is asserted here.
 *
 *   node scripts/freezeReadiness.mjs
 */
const root = fileURLToPath(new URL("../", import.meta.url));
const read = (rel) => JSON.parse(readFileSync(path.join(root, rel), "utf8"));
const adjudication = read("docs/evidence/INTERPRETER_V3_GOLD_ADJUDICATION.json");
// The words live in the private store; the tracked manifest carries only keys and hashes,
// which is all readiness needs (a count and the item ids). Either is enough.
const ledgerFile = `${PRIVATE_RESIDENT_DIR}/RESIDENT_TURN_LEDGER.json`;
const manifest = existsSync(path.join(root, RESIDENT_MANIFEST)) ? read(RESIDENT_MANIFEST) : null;
const ledger = existsSync(path.join(root, ledgerFile))
  ? read(ledgerFile)
  : { turns: Object.fromEntries((manifest?.turns ?? []).map((turn) => [turn.turnKey, turn])), sessions: manifest?.sessions ?? {}, target: manifest?.target ?? 60 };
const reviewDir = path.join(root, "docs/evidence/gold-review");
const checks = existsSync(reviewDir) ? readdirSync(reviewDir).filter((n) => n.startsWith("BLIND_REVIEW_CHECK_")).map((n) => JSON.parse(readFileSync(path.join(reviewDir, n), "utf8"))) : [];
const complete = checks.filter((check) => check.ok && check.labelled === check.total);

const required = new Set([...v3Corpus().map((row) => row.id), ...Object.keys(ledger.turns)]);
const covered = new Set(complete.flatMap((check) => check.itemIds ?? []));
const uncovered = [...required].filter((id) => !covered.has(id));
const independentGoldReview = uncovered.length === 0 && complete.length > 0;

const eligibility = v3FreezeEligibility({ adjudication, realPilotTurns: Object.keys(ledger.turns).length, realPilotRequired: ledger.target ?? 60, independentGoldReview, frozen: false });
const blockers = [...eligibility.blockers];
if (!independentGoldReview) blockers.splice(blockers.indexOf("independent_gold_review_missing") >= 0 ? blockers.indexOf("independent_gold_review_missing") : blockers.length, 0, `independent_blind_labels_cover:${required.size - uncovered.length}/${required.size}`);

console.log(JSON.stringify({
  eligibleForFreeze: blockers.filter((b) => !b.startsWith("independent_blind_labels_cover") ).length === 0,
  holdoutVerdict: "NO-GO", holdoutMayRun: false,
  residentTurns: {
    collected: Object.keys(ledger.turns).length, minimumReadinessTurns: ledger.target ?? 60, plannedTurns: manifest?.targets?.plannedTurns ?? { min: 150, max: 250 },
    sessions: Object.keys(ledger.sessions ?? {}).length,
    // 60 is a readiness floor, not a validation target: what can be evaluated is the untouched, participant-grouped split.
    evaluationEligibleTurns: manifest?.counts?.evaluationEligible ?? 0, evaluationParticipants: (manifest?.participants ?? []).filter((p) => p.split === "RESIDENT_EVALUATION").length,
    quarantinedUntilLinkedToAParticipant: manifest?.counts?.quarantinedNoParticipant ?? null, seenByDevelopers: manifest?.counts?.seenByDevelopers ?? null,
  },
  holdout: { manifest: "docs/evidence/INTERPRETER_V3_HOLDOUT_MANIFEST.json", ...(existsSync(path.join(root, "docs/evidence/INTERPRETER_V3_HOLDOUT_MANIFEST.json")) ? (({ fingerprint, status, consumed }) => ({ hash: fingerprint.hash, rows: fingerprint.rows, status, consumed }))(read("docs/evidence/INTERPRETER_V3_HOLDOUT_MANIFEST.json")) : {}) },
  independentBlindLabels: { reviewers: [...new Set(complete.map((c) => c.reviewer))], itemsCovered: required.size - uncovered.length, itemsRequired: required.size },
  adjudication: { decided: Object.values(adjudication.rows).filter((r) => r.decision).length, total: Object.keys(adjudication.rows).length, status: adjudication.status },
  blockers,
  note: "Freeze, and the single holdout run, are separate deliberate steps taken by the owner; this report authorises neither.",
}, null, 1));

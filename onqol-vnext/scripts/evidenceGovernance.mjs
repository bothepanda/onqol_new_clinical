import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * Evidence data governance (owner ruling 2026-09-20).
 *
 * Raw resident exports and sealed system outputs never enter Git. The repository
 * may hold only de-identified / adjudicated evaluation data, hashes and manifests.
 *
 *   private/                          (gitignored)  raw resident exports, the resident-turn ledger
 *                                     (words), the SEALED system-readings file, blind packets that
 *                                     carry resident words, filled reviews before adjudication
 *   docs/evidence/resident-turns/     RESIDENT_TURN_MANIFEST.json only: counts, hashes, keys - no words
 *
 *   node scripts/evidenceGovernance.mjs      fails on any tracked or staged file that breaks the rule
 */
export const PRIVATE_DIR = "private";
export const PRIVATE_RESIDENT_DIR = `${PRIVATE_DIR}/resident-turns`;
export const PRIVATE_EXPORT_DIR = `${PRIVATE_DIR}/resident-exports`;
export const PRIVATE_PARTICIPANT_DIR = `${PRIVATE_DIR}/participants`;
export const PRIVATE_REVIEW_DIR = `${PRIVATE_DIR}/gold-review`;
export const RESIDENT_MANIFEST = "docs/evidence/resident-turns/RESIDENT_TURN_MANIFEST.json";

/** Paths that must never be tracked or staged. */
export const FORBIDDEN_IN_GIT = Object.freeze([
  { pattern: /^private\//, why: "the private store (raw resident data, sealed outputs)" },
  { pattern: /(^|\/)RESIDENT_TURN_LEDGER\.json$/, why: "resident words" },
  { pattern: /(^|\/)RESIDENT_TURN_SYSTEM_READINGS\.json$/, why: "SEALED system readings" },
  { pattern: /(^|\/)resident-exports\//, why: "raw resident session exports" },
  { pattern: /(^|\/)onqol-session-[^/]*\.json$/, why: "a raw learner session export" },
  { pattern: /(^|\/)pilot-failures\//, why: "raw learner session exports" },
  { pattern: /(^|\/)BLIND_PACKET_[^/]*\.json$/, why: "a blind packet (may carry resident words)" },
  { pattern: /(^|\/)BLIND_REVIEW_FILLED[^/]*\.json$/, why: "a filled review before adjudication" },
  { pattern: /(^|\/)(PARTICIPANT_ROSTER|REVIEWER_ROSTER|SESSION_PARTICIPANT_MAP|RESIDENT_SPLIT_PLAN)[^/]*\.json$/, why: "participant / reviewer identity material" },
  { pattern: /(^|\/)(RESIDENT_PACKET|RESIDENT_REVIEW|RESIDENT_ADJUDICATION_WORKING)[^/]*\.json$/, why: "a resident blind packet, an independent reviewer's decisions, or working adjudication" },
]);

/**
 * The same rule by CONTENT, so a raw export, a ledger, sealed readings, a blind
 * packet, a review or a roster is caught whatever it is named and wherever it is
 * put. Schema markers are exact; a raw session export is recognised by its shape
 * plus a resident purpose (synthetic development sessions are not resident data).
 */
export const FORBIDDEN_CONTENT = Object.freeze([
  { pattern: /"schema"\s*:\s*"onqol-resident-turn-ledger-v\d+"/, why: "the resident-turn ledger (resident words)" },
  { pattern: /"schema"\s*:\s*"onqol-resident-turn-system-readings-v\d+"/, why: "SEALED system readings" },
  { pattern: /"schema"\s*:\s*"onqol-(gold|resident)-blind-packet-v\d+"/, why: "a blind packet" },
  { pattern: /"schema"\s*:\s*"onqol-(gold|resident)-(blind-)?review-v\d+"/, why: "an independent reviewer's decisions (reviewer-attributable)" },
  { pattern: /"schema"\s*:\s*"onqol-(participant|reviewer)-roster-v\d+"/, why: "participant / reviewer identity material" },
  { pattern: /"schema"\s*:\s*"onqol-resident-split-plan-v\d+"/, why: "the private split plan (participant assignments)" },
  // Scripted engineering sessions (acceptance / smoke runs) use a learner route but carry a fixed,
  // self-describing session id; anything else with a resident purpose is treated as resident data.
  { test: (text) => text.includes('"export_schema_version"') && /"purpose"\s*:\s*"(learner_pilot|production)"/.test(text) && !/"id"\s*:\s*"(acceptance|synthetic|test|smoke)-/.test(text), why: "a raw resident session export" },
]);

export function findContentViolations(files, readText) {
  const violations = [];
  for (const file of files.map(posix)) {
    if (!/\.(json|jsonl)$/.test(file)) continue;
    let text;
    try { text = readText(file); } catch { continue; } // deleted in the working tree: nothing to inspect
    if (text == null) continue;
    const rule = FORBIDDEN_CONTENT.find((entry) => (entry.pattern ? entry.pattern.test(text) : entry.test(text)));
    if (rule) violations.push({ file, why: rule.why, by: "content" });
  }
  return violations;
}

/**
 * Files that were committed before the ruling. Acknowledged, reported on every run,
 * never silently accepted: removing them from Git history is the owner's decision.
 */
export const LEGACY_TRACKED = Object.freeze({
  "docs/evidence/pilot-failures/onqol-session-session-1788760708621.json":
    "raw learner_pilot session export committed 2026-09-07, before the ruling. Deleted from the working tree; STILL IN HISTORY until private/history-rewrite/run.sh is run (see docs/RESIDENT_COLLECTION_READINESS_2026-09-20.md). Inert once the history is rewritten.",
});

const posix = (file) => String(file).split(path.sep).join("/").replace(/^\.\//, "");

export function findGovernanceViolations(files, { legacy = LEGACY_TRACKED } = {}) {
  const violations = [];
  const acknowledged = [];
  for (const file of files.map(posix)) {
    const rule = FORBIDDEN_IN_GIT.find(({ pattern }) => pattern.test(file));
    if (!rule) continue;
    if (Object.hasOwn(legacy, file)) acknowledged.push({ file, why: rule.why, note: legacy[file] });
    else violations.push({ file, why: rule.why });
  }
  return { violations, acknowledged };
}

/** Is `file` (absolute or relative to `root`) inside the private store? */
export function isPrivatePath(file, root) {
  const relative = posix(path.relative(root, path.resolve(root, file)));
  return relative === PRIVATE_DIR || relative.startsWith(`${PRIVATE_DIR}/`);
}

/** Throws unless `file` is inside the private store. For every output that carries resident words or sealed readings. */
export function assertPrivateOutput(file, root, what = "this output") {
  if (!isPrivatePath(file, root)) {
    throw new Error(`governance: ${what} carries resident words or sealed system output and must be written under ${PRIVATE_DIR}/ (gitignored), not ${posix(path.relative(root, path.resolve(root, file)))}`);
  }
}

function gitList(root, args) {
  try { return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n").filter(Boolean); } catch { return null; }
}

/** Tracked + staged files of the repository, or null when git is unavailable. */
export function trackedAndStaged(root) {
  const tracked = gitList(root, ["ls-files"]);
  if (tracked === null) return null;
  const staged = gitList(root, ["diff", "--cached", "--name-only", "--diff-filter=AM"]) ?? [];
  const prefix = gitList(root, ["rev-parse", "--show-prefix"])?.[0] ?? "";
  return [...new Set([...tracked, ...staged.filter((file) => file.startsWith(prefix)).map((file) => file.slice(prefix.length))])];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const files = trackedAndStaged(root);
  if (files === null) { console.error("governance: git is unavailable, cannot check"); process.exit(2); }
  const { violations, acknowledged } = findGovernanceViolations(files);
  const acknowledgedPaths = new Set(acknowledged.map((entry) => entry.file));
  const byContent = findContentViolations(files.filter((file) => !acknowledgedPaths.has(file)), (file) => readFileSync(path.join(root, file), "utf8"));
  violations.push(...byContent);
  console.log(JSON.stringify({ checkedFiles: files.length, violations, acknowledgedLegacy: acknowledged }, null, 1));
  if (violations.length) process.exit(1);
}

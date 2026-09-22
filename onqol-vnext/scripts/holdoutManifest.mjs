import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { RETIRED_STAGE2_ROW_IDS, stage2Corpus } from "./stage2Corpus.mjs";
import { holdoutFingerprint, splitOfGroup } from "./v3Corpus.mjs";

/**
 * The clean synthetic holdout manifest (data-governance cleanup, 2026-09-20).
 *
 * The previous holdout fingerprint covered 50 rows, 9 of which were built from the
 * words of a raw resident session export. That material is no longer allowed in
 * the repository, so those rows were removed (their ids are RETIRED, never reused)
 * and the fingerprint was regenerated. The old fingerprint is recorded only as
 * "superseded"; nothing was preserved at the expense of the governance rule.
 *
 * What this holdout is: 41 author-written synthetic rows (draft linguistic gold).
 * It has NOT been run and is not frozen. Real resident turns are evaluated through
 * the participant-grouped path (residentSplits.mjs), never through this file.
 *
 *   node scripts/holdoutManifest.mjs --check     verifies the tracked manifest against the corpus
 *   node scripts/holdoutManifest.mjs --write     writes it (refused if a manifest exists and differs)
 *   node scripts/holdoutManifest.mjs --freeze    seals the fingerprint (never runs the holdout; refused once consumed
 *                                                or if the corpus no longer matches the manifest)
 *
 * "Frozen" here means the FINGERPRINT of the holdout rows is sealed. It is not a freeze of the
 * interpreter candidate (code / prompt / schema / registry / metrics), which is a separate step.
 */
export const HOLDOUT_MANIFEST_FILE = "docs/evidence/INTERPRETER_V3_HOLDOUT_MANIFEST.json";
export const SUPERSEDED_FINGERPRINT = { hash: "3427c6999e91821f8ad88a598700a17f04a4a9cb79b046a2005b522cedebf13e", rows: 50, sourceManifests: ["STAGE2_FREEZE_MANIFEST_2026-09-08.json", "STAGE2_FREEZE_MANIFEST_2026-09-19.json", "STAGE2_FREEZE_MANIFEST_2026-09-19-r2.json"] };

export function buildHoldoutManifest({ frozen = null } = {}) {
  const rows = stage2Corpus().filter((row) => splitOfGroup(row.group) === "HOLDOUT");
  const fingerprint = holdoutFingerprint();
  if (fingerprint.rows !== rows.length) throw new Error("holdout_manifest_inconsistent");
  const count = (list, key) => Object.fromEntries([...new Set(list.map(key))].sort().map((value) => [value, list.filter((row) => key(row) === value).length]));
  return {
    schema: "onqol-v3-holdout-manifest-v1",
    status: frozen ? "FROZEN_NOT_RUN" : "CLEAN_NOT_RUN_NOT_FROZEN",
    generatedOn: "2026-09-20",
    scope: "synthetic author-written rows only; no resident language and no participant",
    fingerprint: { recipe: "sha256(JSON.stringify(rows)) over the raw holdout rows in corpus order", rows: fingerprint.rows, hash: fingerprint.hash },
    supersedes: { ...SUPERSEDED_FINGERPRINT, why: "9 of its 50 rows were built from a raw resident session export; removed under the data-governance ruling (raw resident language never lives in the tracked repository)" },
    retiredRowIds: [...RETIRED_STAGE2_ROW_IDS],
    splitRule: "sha256(group) mod 4 === 0 (unchanged); a group is never split",
    groups: new Set(rows.map((row) => row.group)).size,
    rowIds: rows.map((row) => row.id),
    byCategory: count(rows, (row) => row.category),
    byProvenance: count(rows, (row) => row.provenance.kind),
    consumed: false,
    runs: [],
    frozen,
    note: frozen
      ? "Fingerprint frozen, holdout NOT run. Any change to the holdout rows, or to this file, makes it a new holdout with a new fingerprint. The interpreter candidate is a separate freeze."
      : "Not run, not frozen. Freezing is a separate deliberate step by the owner. Any change to this file after a run is a new holdout.",
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const file = path.join(root, HOLDOUT_MANIFEST_FILE);
  const existing = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  let built = buildHoldoutManifest({ frozen: existing?.frozen ?? null });
  if (process.argv.includes("--freeze")) {
    if (!existing) throw new Error("holdout_manifest_missing: write it first");
    if (existing.frozen) throw new Error("holdout_already_frozen");
    if (existing.consumed || existing.runs.length) throw new Error("holdout_already_consumed");
    const current = buildHoldoutManifest();
    const core = (m) => JSON.stringify({ fingerprint: m.fingerprint, rowIds: m.rowIds, retiredRowIds: m.retiredRowIds, supersedes: m.supersedes });
    if (core(existing) !== core(current)) throw new Error("holdout_manifest_does_not_match_the_corpus");
    const sealed = createHash("sha256").update(JSON.stringify({ hash: built.fingerprint.hash, rowIds: built.rowIds })).digest("hex");
    built = buildHoldoutManifest({ frozen: { at: new Date().toISOString(), fingerprintSha256: built.fingerprint.hash, rows: built.fingerprint.rows, sealSha256: sealed, run: false } });
    writeFileSync(file, JSON.stringify(built, null, 2) + "\n");
  } else if (process.argv.includes("--write")) {
    if (existing && JSON.stringify(existing) !== JSON.stringify(built)) throw new Error("holdout_manifest_exists_and_differs: a holdout manifest is never silently replaced");
    writeFileSync(file, JSON.stringify(built, null, 2) + "\n");
  }
  const tracked = JSON.parse(readFileSync(file, "utf8"));
  const ok = JSON.stringify(tracked) === JSON.stringify(built) && (!tracked.frozen || tracked.frozen.fingerprintSha256 === buildHoldoutManifest().fingerprint.hash);
  console.log(JSON.stringify({ file: HOLDOUT_MANIFEST_FILE, status: tracked.status, matchesCorpus: ok, rows: built.fingerprint.rows, hash: built.fingerprint.hash, frozen: tracked.frozen }, null, 1));
  if (!ok) process.exit(1);
}

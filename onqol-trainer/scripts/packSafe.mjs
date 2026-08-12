#!/usr/bin/env node
// Build a shareable archive of this project with no secrets in it.
//
// This exists because a project archive was once handed over with `.env.local`
// inside it. `.gitignore` had always ignored the file, which protects commits
// and does nothing at all for a zip made from the working directory.
//
// The exclusion list is deny-by-default on anything env-shaped: `.env` matches
// as a whole name and as a prefix, so `.env.local`, `.env.production.local` and
// `.env.backup` are all caught. Adding a new secret file that happens not to
// start with `.env` will not be caught - keep secrets in env files.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const name = JSON.parse(readFileSync(resolve(projectRoot, "package.json"), "utf8")).name || "project";
const stamp = new Date().toISOString().slice(0, 10);
const archive = resolve(projectRoot, "..", `onqol-export-${stamp}.zip`);
const manifestPath = resolve(projectRoot, "..", `onqol-export-${stamp}.manifest.json`);

const EXCLUDES = [
  "*.env",
  "*.env.*",
  "*/.env",
  "*/.env.*",
  "*/node_modules/*",
  "*/.git/*",
  "*/dist/*",
  "*/.vite/*",
  "*/coverage/*",
  "*.log",
  "*/.DS_Store",
  "__MACOSX/*",
  "*/.idea/*",
  "*/.vscode/*",
  "*/.codex/*",
  "*/.agents/*",
  "*/.claude/*",
  "*.zip",
  "*.tar",
  "*.tar.gz",
  "*.tgz",
  "*.7z",
];

if (existsSync(archive) || existsSync(manifestPath)) {
  console.error(`Refusing to overwrite ${archive} or its manifest. Remove or rename the old export first.`);
  process.exit(1);
}

const args = ["-r", archive, basename(projectRoot), "-x", ...EXCLUDES];
execFileSync("zip", args, { cwd: resolve(projectRoot, ".."), stdio: "inherit" });

// `.env.example` is the only permitted env-shaped file. It is added explicitly
// after the deny-by-default env exclusion above.
const safeExample = resolve(projectRoot, ".env.example");
if (existsSync(safeExample)) {
  execFileSync("zip", ["-g", archive, `${basename(projectRoot)}/.env.example`], {
    cwd: resolve(projectRoot, ".."),
    stdio: "inherit",
  });
}

// Verify rather than trust: list the archive and fail loudly if anything
// env-shaped survived the exclusion list.
const listing = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" });
const leaked = listing
  .split("\n")
  .filter(Boolean)
  .filter((entry) => {
    const envFile = /(^|\/)\.env(?:\.|$)/.test(entry) && !entry.endsWith("/.env.example");
    const privateDirectory = /(^|\/)(?:\.git|node_modules|dist|coverage|__MACOSX|\.idea|\.vscode|\.codex|\.agents|\.claude)(?:\/|$)/.test(entry);
    const localArtifact = /(^|\/)\.DS_Store$/.test(entry) || /\.(?:zip|tar|tar\.gz|tgz|7z)$/i.test(entry);
    return envFile || privateDirectory || localArtifact;
  });

if (leaked.length > 0) {
  console.error("\nSECRET OR JUNK LEAKED INTO THE ARCHIVE:");
  for (const entry of leaked.slice(0, 20)) console.error(`  ${entry}`);
  console.error(`\nDeleting ${archive}.`);
  execFileSync("rm", ["-f", archive]);
  process.exit(1);
}

const entries = listing.split("\n").filter(Boolean).length;
const digest = createHash("sha256").update(readFileSync(archive)).digest("hex");
const manifest = {
  schema_version: "1.0.0",
  created_at: new Date().toISOString(),
  archive: basename(archive),
  sha256: digest,
  entries,
  allowed_env_example_included: listing.split("\n").includes(`${basename(projectRoot)}/.env.example`),
  forbidden_entries: [],
  verified_absent: [
    "secrets and non-example .env files",
    ".git and worktrees",
    "node_modules",
    "dist and coverage",
    "nested archives",
    "local editor, agent and OS artifacts",
  ],
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
console.log(`\nWrote ${archive}`);
console.log(`Wrote ${manifestPath}`);
console.log(`${entries} entries, no forbidden entries; safe .env.example retained.`);
console.log("Never share .env.local. If a key has ever been in a shared archive, rotate it.");

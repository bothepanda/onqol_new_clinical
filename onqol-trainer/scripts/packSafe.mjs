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
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const name = JSON.parse(readFileSync(resolve(projectRoot, "package.json"), "utf8")).name || "project";
const stamp = new Date().toISOString().slice(0, 10);
const archive = resolve(projectRoot, "..", `onqol-export-${stamp}.zip`);

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
];

if (existsSync(archive)) {
  console.error(`Refusing to overwrite ${archive}. Remove it or rename the old export first.`);
  process.exit(1);
}

const args = ["-r", archive, basename(projectRoot), "-x", ...EXCLUDES];
execFileSync("zip", args, { cwd: resolve(projectRoot, ".."), stdio: "inherit" });

// Verify rather than trust: list the archive and fail loudly if anything
// env-shaped survived the exclusion list.
const listing = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" });
const leaked = listing
  .split("\n")
  .filter((entry) => /(^|\/)\.env(\.|$)/.test(entry) || /(^|\/)node_modules\//.test(entry));

if (leaked.length > 0) {
  console.error("\nSECRET OR JUNK LEAKED INTO THE ARCHIVE:");
  for (const entry of leaked.slice(0, 20)) console.error(`  ${entry}`);
  console.error(`\nDeleting ${archive}.`);
  execFileSync("rm", ["-f", archive]);
  process.exit(1);
}

const entries = listing.split("\n").filter(Boolean).length;
console.log(`\nWrote ${archive}`);
console.log(`${entries} entries, no .env files, no node_modules.`);
console.log("Never share .env.local. If a key has ever been in a shared archive, rotate it.");

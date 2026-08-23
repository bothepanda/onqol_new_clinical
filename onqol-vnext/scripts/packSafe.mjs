#!/usr/bin/env node
// Builds a clean source ZIP for handoff, and FAILS if anything forbidden got
// in (task brief §18).
//
// Why fail rather than filter-and-warn: the whole point of this script is
// that the archive someone else receives cannot contain a secret, a
// half-gigabyte node_modules, or a stale build output. A warning that scrolls
// past is not that guarantee; a non-zero exit is.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "dist-pack");
const ARCHIVE = path.join(OUT_DIR, "onqol-vnext-source.zip");

/**
 * Paths that must never appear in the archive. Checked against the ZIP's own
 * listing after creation - not merely passed as exclude patterns - so a
 * mistake in the exclude list is caught rather than shipped.
 */
const FORBIDDEN = [
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /(^|\/)dist-pack\//,
  /(^|\/)coverage\//,
  /(^|\/)\.git\//,
  /(^|\/)__MACOSX\//,
  /(^|\/)\.DS_Store$/,
  /(^|\/)\.env($|\.)/,
  /\.zip$/,
];

const EXCLUDES = [
  "node_modules/*",
  "dist/*",
  "dist-pack/*",
  "coverage/*",
  ".git/*",
  ".git",
  "__MACOSX/*",
  "*.DS_Store",
  ".DS_Store",
  ".env",
  ".env.*",
  "*.zip",
];

function main() {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  execFileSync("zip", ["-r", "-q", ARCHIVE, ".", "-x", ...EXCLUDES], { cwd: ROOT });

  const listing = execFileSync("zipinfo", ["-1", ARCHIVE], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const offenders = listing.filter((entry) => FORBIDDEN.some((pattern) => pattern.test(entry)));
  if (offenders.length > 0) {
    rmSync(ARCHIVE, { force: true });
    console.error(`pack:safe FAILED — ${offenders.length} forbidden path(s) in the archive:`);
    for (const entry of offenders.slice(0, 20)) console.error(`  ${entry}`);
    process.exit(1);
  }

  // The archive is only useful if it can actually be installed and run.
  const REQUIRED = ["package.json", "package-lock.json", "index.html", "vite.config.js", "src/", "scripts/", "docs/"];
  const missing = REQUIRED.filter((needle) =>
    needle.endsWith("/") ? !listing.some((entry) => entry.startsWith(needle)) : !listing.includes(needle),
  );
  if (missing.length > 0) {
    rmSync(ARCHIVE, { force: true });
    console.error(`pack:safe FAILED — archive is missing required entries: ${missing.join(", ")}`);
    process.exit(1);
  }

  const sizeBytes = statSync(ARCHIVE).size;
  console.log("pack:safe OK");
  console.log(`  archive:         ${path.relative(ROOT, ARCHIVE)}`);
  console.log(`  entries:         ${listing.length}`);
  console.log(`  size:            ${(sizeBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  forbidden paths: 0`);
}

if (!existsSync(path.join(ROOT, "package.json"))) {
  console.error("pack:safe must run from the project root.");
  process.exit(1);
}

main();

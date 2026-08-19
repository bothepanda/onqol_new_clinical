#!/usr/bin/env node
/**
 * Freeze ONQOL_MENTOR_BEHAVIOR_SPEC.md into an importable module.
 *
 * The mentor's system prompt IS the specification, verbatim - not a summary of
 * it. The clinical layer runs in the browser as well as in node, so it cannot
 * read the markdown file at runtime; this script copies it into a module and
 * `mentorBehaviorSpec.test.js` fails the build whenever the two drift apart.
 *
 * Run: npm run spec:sync
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const specPath = fileURLToPath(new URL("../ONQOL_MENTOR_BEHAVIOR_SPEC.md", import.meta.url));
const outPath = fileURLToPath(new URL("../src/clinical/core/mentorBehaviorSpec.js", import.meta.url));

const spec = readFileSync(specPath, "utf8");
const escaped = spec.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");

writeFileSync(
  outPath,
  `// GENERATED FILE - do not edit by hand.
//
// Verbatim copy of ONQOL_MENTOR_BEHAVIOR_SPEC.md, produced by
// scripts/buildMentorSpec.mjs (npm run spec:sync). The mentor's system prompt
// is the specification itself: a paraphrase here would be a second, silently
// diverging behavior contract. mentorBehaviorSpec.test.js asserts the copy is
// identical to the markdown file.

export const MENTOR_BEHAVIOR_SPEC_SOURCE = "ONQOL_MENTOR_BEHAVIOR_SPEC.md";

export const MENTOR_BEHAVIOR_SPEC = \`${escaped}\`;
`,
  "utf8"
);

console.log(`mentorBehaviorSpec.js written (${spec.length} chars from ONQOL_MENTOR_BEHAVIOR_SPEC.md)`);

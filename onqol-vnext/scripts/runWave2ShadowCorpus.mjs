#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runWave2ShadowCorpus } from "../src/tests/wave2ShadowCorpusRunner.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const outputPath = path.join(root, "docs/evidence/WAVE2_SHADOW_CORPUS_METRICS_2026-08-28.json");
const report = await runWave2ShadowCorpus();
mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`wave21:offline OK — ${report.composition.semanticFixtures} semantic fixtures -> ${path.relative(root, outputPath)}`);

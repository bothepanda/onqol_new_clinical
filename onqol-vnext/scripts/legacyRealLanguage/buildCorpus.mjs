import { createHash, createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertPrivateOutput } from "../evidenceGovernance.mjs";
import { CHANNELS, CORPUS_ID, CORPUS_SCHEMA, validateAnnotation } from "./corpusSchema.mjs";

/**
 * Builds legacy_real_language_development.
 *
 *   node scripts/legacyRealLanguage/buildCorpus.mjs stage1    extracted paragraphs -> turns (alias, id, minimal prompt)
 *   node scripts/legacyRealLanguage/buildCorpus.mjs build     turns + annotations -> CORPUS.json, ANNOTATION_REVIEW.md, manifest
 *   node scripts/legacyRealLanguage/buildCorpus.mjs freeze    seal the built corpus (hash) as a development artifact
 *
 * Everything that carries a learner's words is written under private/ (owner ruling
 * 2026-09-20, docs/RESIDENT_TURN_COLLECTION_AND_GOLD_REVIEW_PROTOCOL.md). The only tracked
 * output is docs/evidence/legacy-real-language/CORPUS_MANIFEST.json: counts, hashes and
 * schema, no words.
 *
 * Session aliases are HMAC(salt, source file) with a private salt, so the alias reveals
 * nothing about the file name, and the turn id (`lrd-<alias>-t<NN>`) is stable for as
 * long as the source is. The alias map is private and separate from the corpus.
 */
const root = fileURLToPath(new URL("../../", import.meta.url));
const dir = path.join(root, "private/legacy-real-language");
export const FILES = Object.freeze({
  extracted: path.join(dir, "EXTRACTED_PARAGRAPHS.json"),
  salt: path.join(dir, "ALIAS_SALT.txt"),
  aliasMap: path.join(dir, "SESSION_ALIAS_MAP.json"),
  stage1: path.join(dir, "TURNS_STAGE1.json"),
  annotations: path.join(dir, "annotations.mjs"),
  corpus: path.join(dir, "CORPUS.json"),
  review: path.join(dir, "ANNOTATION_REVIEW.md"),
  freezeSeal: path.join(dir, "FREEZE_SEAL.json"),
  manifest: path.join(root, "docs/evidence/legacy-real-language/CORPUS_MANIFEST.json"),
});
const sha = (value) => createHash("sha256").update(value).digest("hex");
const write = (file, text, { priv = true } = {}) => {
  if (priv) assertPrivateOutput(file, root, "the legacy real-language corpus (learner words)");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
};

/**
 * Minimum preceding context: the question block the learner is answering. That is the last
 * system paragraph with a question mark, any paragraph before it that is part of the same
 * block (also a question, or a lead-in ending with a colon), and everything after it; with no
 * question mark, the last three paragraphs. Capped at 1200 characters from the front. Data
 * dumps (vitals, results) and the legacy system's feedback are not context.
 */
export function precedingPrompt(paragraphs, index) {
  const run = [];
  for (let i = index - 1; i >= 0 && paragraphs[i].role === "system"; i -= 1) run.unshift(paragraphs[i].text);
  const nonEmpty = run.filter((text) => text.trim());
  let q = -1;
  nonEmpty.forEach((text, i) => { if (text.includes("?")) q = i; });
  let start = q < 0 ? Math.max(0, nonEmpty.length - 3) : q;
  while (q >= 0 && start > 0 && (nonEmpty[start - 1].includes("?") || nonEmpty[start - 1].trim().endsWith(":"))) start -= 1;
  let window = nonEmpty.slice(start);
  while (window.length > 1 && window.join("\n").length > 1200) window = window.slice(1);
  return window.join("\n").trim();
}

function stage1() {
  const extracted = JSON.parse(readFileSync(FILES.extracted, "utf8"));
  if (!existsSync(FILES.salt)) write(FILES.salt, randomBytes(16).toString("hex") + "\n");
  const salt = readFileSync(FILES.salt, "utf8").trim();
  const aliasMap = {};
  const turns = [];
  for (const source of extracted.sources) {
    const alias = `LS-${createHmac("sha256", salt).update(source.file).digest("hex").slice(0, 6)}`;
    aliasMap[alias] = { file: source.file, kind: source.kind };
    let ordinal = 0;
    source.paragraphs.forEach((paragraph, index) => {
      if (paragraph.role !== "learner") return;
      ordinal += 1;
      turns.push({
        turnId: `lrd-${alias.slice(3)}-t${String(ordinal).padStart(2, "0")}`,
        sessionAlias: alias,
        ordinalInSession: ordinal,
        sourceKey: `${source.file}#${ordinal}`,
        precedingPrompt: precedingPrompt(source.paragraphs, index),
        rawText: paragraph.text,
        rawTextSha256: sha(paragraph.text),
        sourceRole: paragraph.roleEvidence,
      });
    });
  }
  write(FILES.aliasMap, JSON.stringify({ schema: "onqol-legacy-session-alias-map-v1", note: "private; never publish", aliases: aliasMap }, null, 2) + "\n");
  write(FILES.stage1, JSON.stringify({ schema: "onqol-legacy-real-language-turns-stage1-v1", turns }, null, 1) + "\n");
  console.log(JSON.stringify({ turns: turns.length, sessions: Object.keys(aliasMap).length }));
}

const commandLabel = (c) => {
  const mode = c.expect && c.expect !== "execute" ? ` ⟨${c.expect}⟩` : "";
  const absent = c.absent?.length ? ` [must stay unfilled: ${c.absent.join(", ")}]` : "";
  const alt = [...(c.altTypes?.length ? [`or type ${c.altTypes.join("/")}`] : []), ...(c.anyOf?.length ? [`or params ${c.anyOf.map((p) => JSON.stringify(p)).join(" | ")}`] : [])];
  return `${c.type}${Object.keys(c.params ?? {}).length ? ` ${JSON.stringify(c.params)}` : ""}${mode}${absent}${alt.length ? ` (${alt.join("; ")})` : ""}`;
};

export function renderReview(turns, corpusHash) {
  const byScope = (scope) => turns.filter((t) => t.scope === scope).length;
  const lines = [
    `# ${CORPUS_ID} — annotation review file`,
    "",
    "**DEVELOPMENT data only.** Not holdout, not generalization evidence. Contains learners' own words: keep it out of Git and out of chat exports.",
    "",
    `- turns: ${turns.length} · sessions: ${new Set(turns.map((t) => t.sessionAlias)).size} · IN_SCOPE: ${byScope("IN_SCOPE")} · OUT_OF_CURRENT_SCOPE: ${byScope("OUT_OF_CURRENT_SCOPE")}`,
    `- corpus hash (content of CORPUS.json): \`${corpusHash}\``,
    "- Annotator: model-drafted (Claude), **not yet reviewed by a human or a clinician**. Every label is DRAFT LINGUISTIC intent — what the learner said, in terms of commands the current simulator can represent. It is not a claim that anything is clinically right, and it is not copied from what the legacy ON QOL answered.",
    "- The text between the quote marks is the learner's raw text, byte for byte (typos, slang, mixed RU/EN, punctuation preserved).",
    "- To disagree with a label: write the change in the `Reviewer` line; do not edit the corpus. A change becomes a new, numbered corpus version.",
    "",
    "## Legend",
    "",
    "- **channel** — " + CHANNELS.join(" / "),
    "- **commitment** — the v3A.1 status of the learner's own wording (COMMITTED, TENTATIVE, CONDITIONAL, INTERROGATIVE, FUTURE_PLAN, DECLINED) or NOT_APPLICABLE when there is no action language",
    "- **expected** — the structured commands the interpreter should commit. ⟨clarify⟩ = the incomplete command must appear so the character can ask; ⟨either⟩ = a complete command or the clarification are both right; ⟨optional⟩ = defensible either way; `[must stay unfilled: k]` = the learner did not say k, so it must not be filled in; `or type / or params` = an equally correct reading",
    "- **named but NOT to be committed** — the learner mentions an action in a hedged, conditional, deferred, refused, questioned or purely informational way; executing it would be a false execution",
    "- **disposition** — commands · commands_partial (the rest is unmodeled and must stay unexecuted) · clarify · no_action · unresolved",
    "- **unmodeled** — fragments that have no representation in the current command/registry vocabulary; correct behaviour is *not executing them as something else*",
    "- **confidence** — how sure the annotator is of the label (low = please look first)",
    "",
  ];
  let session = null;
  for (const turn of turns) {
    if (turn.sessionAlias !== session) { session = turn.sessionAlias; lines.push(`## Session ${session}`, ""); }
    lines.push(`### ${turn.turnId} · ${turn.channel}${turn.channelsPresent ? ` (${turn.channelsPresent.join(" + ")})` : ""} · ${turn.scope}`, "");
    lines.push("**System prompt before it (context only):**", "", ...turn.precedingPrompt.split("\n").map((l) => `> ${l}`), "");
    lines.push("**Learner (verbatim):**", "", "```text", turn.rawText, "```", "");
    lines.push(`- commitment: ${turn.commitmentState} · disposition: ${turn.expectedDisposition} · ambiguity: ${turn.ambiguity.level}${turn.ambiguity.note ? ` — ${turn.ambiguity.note}` : ""} · confidence: ${turn.annotationConfidence}`);
    lines.push(`- expected: ${turn.expectedCommands.length ? turn.expectedCommands.map(commandLabel).join("; ") : "(none)"}`);
    if (turn.unmodeledFragments.length) lines.push(`- unmodeled: ${turn.unmodeledFragments.map((f) => `«${f.text}» (${f.kind})`).join("; ")}`);
    if (turn.namedButNotCommitted?.length) lines.push(`- named but NOT to be committed: ${turn.namedButNotCommitted.map((f) => `«${f.text}» (${f.state}${f.type ? `, would be ${f.type}` : ""})`).join("; ")}`);
    lines.push(`- scope: ${turn.scope} — ${turn.scopeReason}${turn.contextDependent ? " · depends on the preceding system question" : ""}`);
    lines.push(`- annotator note: ${turn.annotationNote}`);
    lines.push("- Reviewer: ☐ agree ☐ change → ________", "");
  }
  return lines.join("\n");
}

async function build() {
  const stage = JSON.parse(readFileSync(FILES.stage1, "utf8")).turns;
  const { ANNOTATIONS, PROMPT_OVERRIDES = {} } = await import(`${pathToFileURL(FILES.annotations).href}?t=${Date.now()}`);
  const problems = [];
  const turns = stage.map((turn) => {
    const annotation = ANNOTATIONS[turn.sourceKey];
    if (!annotation) { problems.push(`${turn.sourceKey}:not_annotated`); return null; }
    const { sourceKey, sourceRole, ...kept } = turn;
    const row = {
      ...kept,
      precedingPrompt: PROMPT_OVERRIDES[sourceKey] ?? turn.precedingPrompt,
      ...annotation,
      unmodeledFragments: annotation.unmodeledFragments ?? [],
      annotationStatus: "draft_linguistic",
      annotator: "model-drafted (claude-sonnet-5); human review pending",
      split: "DEVELOPMENT",
      corpus: CORPUS_ID,
    };
    for (const error of validateAnnotation(row)) problems.push(`${turn.sourceKey}:${error}`);
    return row;
  });
  const unknown = Object.keys(ANNOTATIONS).filter((key) => !stage.some((t) => t.sourceKey === key));
  problems.push(...unknown.map((key) => `${key}:annotation_without_turn`));
  if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
  const corpus = { schema: CORPUS_SCHEMA, corpus: CORPUS_ID, evidenceUse: "development_only_not_holdout_not_generalization", turns };
  const body = JSON.stringify(corpus, null, 1) + "\n";
  const corpusHash = sha(JSON.stringify(turns));
  write(FILES.corpus, body);
  write(FILES.review, renderReview(turns, corpusHash) + "\n");
  console.log(JSON.stringify({ turns: turns.length, corpusHash, inScope: turns.filter((t) => t.scope === "IN_SCOPE").length }));
}

async function freeze() {
  const corpus = JSON.parse(readFileSync(FILES.corpus, "utf8"));
  const previousSeal = existsSync(FILES.freezeSeal) ? JSON.parse(readFileSync(FILES.freezeSeal, "utf8")) : null;
  const previousManifest = existsSync(FILES.manifest) ? JSON.parse(readFileSync(FILES.manifest, "utf8")) : null;
  const { AMENDMENT_REASONS = {} } = await import(`${pathToFileURL(FILES.annotations).href}?t=${Date.now()}`);
  const version = process.argv.includes("--version") ? process.argv[process.argv.indexOf("--version") + 1] : "v1";
  const bySource = new Map();
  const stageTurns = JSON.parse(readFileSync(FILES.stage1, "utf8")).turns;
  for (const t of stageTurns) bySource.set(t.turnId, t.sourceKey);
  const turns = corpus.turns;
  const corpusHash = sha(JSON.stringify(turns));
  const count = (key) => turns.reduce((acc, t) => { const value = typeof key === "function" ? key(t) : t[key]; acc[value] = (acc[value] ?? 0) + 1; return acc; }, {});
  const newHashes = Object.fromEntries(turns.map((t) => [t.turnId, sha(JSON.stringify(t))]));
  const amendments = [...(previousManifest?.amendments ?? [])];
  if (previousSeal && previousSeal.corpusHash !== corpusHash) {
    for (const [turnId, hashNow] of Object.entries(newHashes)) {
      if (previousSeal.turnHashes[turnId] === hashNow) continue;
      const reason = AMENDMENT_REASONS[bySource.get(turnId)];
      if (!reason) throw new Error(`unrecorded_amendment: ${turnId} changed after the freeze without a stated reason in AMENDMENT_REASONS`);
      amendments.push({ toVersion: version, turnId, previousTurnHash: previousSeal.turnHashes[turnId], newTurnHash: hashNow, previousCorpusHash: previousSeal.corpusHash, reason, madeAfterBaselineWasMeasured: true, madeToMoveAMetric: false });
    }
  }
  const seal = { schema: "onqol-legacy-real-language-freeze-seal-v1", corpus: CORPUS_ID, version, corpusHash, frozenAt: new Date().toISOString(), turnHashes: newHashes };
  write(FILES.freezeSeal, JSON.stringify(seal, null, 1) + "\n");
  const manifest = {
    schema: "onqol-legacy-real-language-manifest-v1", corpus: CORPUS_ID, version, status: "FROZEN_DEVELOPMENT_ARTIFACT",
    evidenceUse: "development_only: usable for interpreter remediation; NOT holdout; NOT generalization evidence",
    frozenAt: seal.frozenAt, corpusHash,
    counts: { turns: turns.length, sessions: new Set(turns.map((t) => t.sessionAlias)).size, byScope: count("scope"), byChannel: count("channel"), byCommitment: count("commitmentState"), byDisposition: count("expectedDisposition"), byAmbiguity: count((t) => t.ambiguity.level), byConfidence: count("annotationConfidence") },
    annotation: { status: "draft_linguistic", annotator: "model-drafted; human review pending", clinicianAdjudicated: 0 },
    privacy: "raw learner words, alias map and salt live under private/legacy-real-language/ (gitignored); this manifest carries no words",
    amendments,
    previousVersions: [...(previousManifest?.previousVersions ?? []), ...(previousManifest && previousManifest.version !== version ? [{ version: previousManifest.version, corpusHash: previousManifest.corpusHash, frozenAt: previousManifest.frozenAt }] : [])],
  };
  write(FILES.manifest, JSON.stringify(manifest, null, 2) + "\n", { priv: false });
  console.log(JSON.stringify({ frozen: true, corpusHash, turns: turns.length }));
}

const [command] = process.argv.slice(2);
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (command === "stage1") stage1();
  else if (command === "build") await build();
  else if (command === "freeze") await freeze();
  else { console.error("usage: buildCorpus.mjs stage1|build|freeze"); process.exit(2); }
}

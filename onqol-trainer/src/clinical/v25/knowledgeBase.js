import { appendicitisEvidence } from "../evidence/appendicitisEvidence.js";

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "или",
  "при",
  "что",
  "как",
  "для",
  "это",
  "или",
  "без",
  "на",
  "по",
  "в",
  "и",
  "с",
  "у",
  "к",
  "а",
]);

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text) {
  return normalize(text)
    .split(" ")
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function inferYear(text) {
  const match = String(text || "").match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function chunkText(source) {
  const paragraphs = String(source.text || "")
    .split(/\n{2,}|(?<=\.)\s+(?=[A-ZА-Я])/)
    .map((part) => part.trim())
    .filter((part) => part.length > 80);

  const chunks = paragraphs.length ? paragraphs : [String(source.text || "").slice(0, 1000)];
  return chunks.slice(0, 80).map((chunk, index) => ({
    id: `${source.id || source.name}#${index + 1}`,
    source_id: source.id,
    source_name: source.name,
    source_type: source.source_type,
    year: source.year || inferYear(chunk),
    text: chunk,
    tokens: tokenize(chunk),
  }));
}

function builtinSources() {
  return appendicitisEvidence.references.map((reference) => ({
    id: reference.id,
    name: `${reference.name} ${reference.year} ${reference.section}`,
    source_type: reference.name.includes("КП МЗ РК") ? "local_protocol" : "guideline",
    year: reference.year,
    text: [
      reference.citation,
      reference.section,
      reference.recommendation,
      reference.local_note,
    ]
      .filter(Boolean)
      .join("\n"),
    reference,
    builtin: true,
  }));
}

export function createKnowledgeBase() {
  const sources = builtinSources();
  return {
    corpusVersion: "appendicitis-corpus-0.2.0",
    sources,
    chunks: sources.flatMap(chunkText),
  };
}

export function summarizeKnowledgeBase(knowledgeBase) {
  return {
    corpusVersion: knowledgeBase.corpusVersion,
    totalSources: knowledgeBase.sources.length,
    guidelineSources: knowledgeBase.sources.filter((source) => source.source_type === "guideline").length,
    textbookSources: knowledgeBase.sources.filter((source) => source.source_type === "textbook").length,
  };
}

export function retrieveEvidence(knowledgeBase, query, options = {}) {
  const queryTokens = new Set(tokenize(query));
  const limit = options.limit || 5;
  const allowedTypes = options.allowedTypes ? new Set(options.allowedTypes) : null;

  return knowledgeBase.chunks
    .filter((chunk) => !allowedTypes || allowedTypes.has(chunk.source_type))
    .map((chunk) => {
      const overlap = chunk.tokens.filter((token) => queryTokens.has(token)).length;
      const sourceBoost = chunk.source_type === "guideline" ? 1.2 : 1;
      return { ...chunk, score: overlap * sourceBoost };
    })
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score || String(a.source_name).localeCompare(String(b.source_name)))
    .slice(0, limit);
}

export function formatEvidenceCitation(chunk) {
  const year = chunk.year ? `, ${chunk.year}` : "";
  return `${chunk.source_name}${year} [${chunk.source_type}]`;
}

import appendicitisDiseaseCard from "./diseases/appendicitis/appendicitis.core.yaml?raw";
import emergencyCorpusManifest from "./corpus/emergency/corpus_manifest.yaml?raw";
import emergencyRetrievalPolicy from "./corpus/emergency/RETRIEVAL_POLICY.md?raw";
import { appendicitisRouterConceptMap } from "./diseases/appendicitis/router/conceptMap.js";

const emergencyCorpus = Object.freeze({
  manifest: emergencyCorpusManifest,
  policy: emergencyRetrievalPolicy,
});

const browserContentRegistry = Object.freeze({
  "app-acute-basic-001": Object.freeze({
    diseaseCard: appendicitisDiseaseCard,
    retrievalCorpus: emergencyCorpus,
    conceptMap: appendicitisRouterConceptMap,
  }),
});

export function getBrowserContentForCase(caseId) {
  const content = browserContentRegistry[caseId];
  if (!content) throw new Error(`Browser clinical content is not registered for case ${caseId}.`);
  return content;
}


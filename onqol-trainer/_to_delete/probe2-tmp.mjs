import { mentorHeuristics, SEVERITY } from "./src/clinical/core/mentorHeuristics.js";
import { appendicitisMentorRules } from "./src/clinical/diseases/appendicitis/mentorRules.js";

const TOPIC_EXEMPT = new Set([
  "no_contingency_plan", "observation_without_endpoint", "hypothesis_without_management",
  "investigation_without_purpose",
]);

function canEverSpeakLive(h) {
  if (h.severity === SEVERITY.SAFETY_CRITICAL) return "safety";
  if ((h.when.attempted || []).length) return "attempted";
  if ((h.when.attempted_intent || []).length) return "intent";
  if ((h.when.reasoning_all || []).length) return "reasoning";
  if (h.type === "clock") return "clock";
  if (TOPIC_EXEMPT.has(h.id)) return "topic";
  return null;
}

const all = [...mentorHeuristics, ...appendicitisMentorRules];
const live = [], deferredOnly = [];
for (const h of all) (canEverSpeakLive(h) ? live : deferredOnly).push(h);

console.log(`Всего правил: ${all.length}`);
console.log(`Могут прозвучать вживую: ${live.length}`);
console.log(`Только в разборе, всегда: ${deferredOnly.length}\n`);
console.log("=== НИКОГДА не звучат вживую ===");
for (const h of deferredOnly) {
  console.log(`  [sev${h.severity}] ${h.id}`);
  console.log(`        «${(h.mentor_line || "").slice(0, 95)}»`);
}

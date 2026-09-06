#!/usr/bin/env node
/**
 * Scripted APP-004 smoke run (remediation task §25).
 *
 * Drives the case through `core/session/submitLearnerTurn.js` - the SAME
 * orchestration entry point `useSession` calls from the React app - typing
 * ordinary resident Russian, and writes the transcript, the debrief and the
 * full session export to docs/evidence/.
 *
 * Why scripted rather than typed by hand: the previous manual smoke note
 * claimed a pain transition ("4.3 -> 7.6") that the recorded replay does not
 * contain, because the browser session and the regenerated JSON were different
 * seeds. A run whose transcript is produced by the same execution that
 * produces the replay cannot disagree with itself.
 *
 *   node scripts/smokeApp004.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSession } from "../src/core/session/createSession.js";
import { submitLearnerTurn } from "../src/core/session/submitLearnerTurn.js";
import { buildLearnerVisibleState } from "../src/core/state/learnerView.js";
import { renderEvent } from "../src/ai/renderer/renderEvent.js";
import {
  renderStatusSnapshot,
  renderClarification,
  renderUnsupported,
  renderUnavailableResource,
  renderPreopNotReady,
  renderDischargeNotReady,
  renderHospitalPolicyBlock,
  renderOptionNotModeled,
} from "../src/ai/renderer/renderStatus.js";
import { buildDebrief } from "../src/core/replay/buildDebrief.js";
import { exportSession } from "../src/core/replay/exportSession.js";
import { withShared } from "../src/core/content/loadBundle.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const diseaseBundle = JSON.parse(readFileSync(path.join(ROOT, "src/content/generated/appendicitis.json"), "utf8"));
const sharedBundle = JSON.parse(readFileSync(path.join(ROOT, "src/content/generated/shared.json"), "utf8"));
const bundle = withShared(diseaseBundle, sharedBundle);

const SEED = process.argv[2] ?? "app004-post-review-smoke";
const START_ISO = "2026-08-25T09:40:00+05:00";

const TURNS = [
  "осмотрю пациента",
  "живот",
  "опрошу пациента",
  "когда последний раз ел и пил?",
  "ОАК и СРБ",
  "ОАМ",
  "БХАК",
  "БХАК: креатинин, электролиты",
  "кетопрофен 100 мг в/м",
  "УЗИ брюшной полости",
  "переоценю боль и живот через 1 час",
  "КТ ОБП",
  "переоценю боль через 2 часа",
  "что с пациентом сейчас?",
  "думаю, это острый аппендицит. идём на операцию",
  "венозный доступ",
  "антибиотикопрофилактика цефазолин 2 г в/в, антибиотикопрофилактика метронидазол 500 мг в/в",
  "коагулограмма и группа крови",
  "вызываю анестезиолога на осмотр",
  "получаю согласие",
  "переоценю боль через 40 минут",
  "иду лапароскопически",
  "удаляю аппендикс, аспирирую жидкость, дренаж не ставлю",
  "в отделение, vitals каждые 4 часа",
  "можно пить",
  "переоценю боль и живот утром",
  "что с пациентом сейчас?",
  "выписываю",
];

let session = createSession({
  sessionId: "app004-post-review-smoke",
  seed: SEED,
  mode: "reference",
  casePresetId: "APP-004",
  sessionPurpose: "internal_development",
  bundle,
  locale: "ru",
  startIso: START_ISO,
});

const transcript = [];
const arrival = session.events.find((event) => event.type === "PATIENT_ARRIVED");
transcript.push({ atMinutes: 0, role: "env", ...renderEvent({ event: arrival, bundle, patient: session.patient }) });

for (const text of TURNS) {
  const learnerVisibleBefore = buildLearnerVisibleState(session.state);
  transcript.push({ atMinutes: session.state.clock.elapsedMinutes, role: "learner", textRu: text });
  const turn = submitLearnerTurn({ session, text });

  for (const event of turn.timeEvents ?? []) {
    push(renderEvent({ event, bundle, patient: turn.session.patient }), event.atMinutes);
  }
  for (const result of turn.outcomes) {
    if (result.outcome === "STATUS_SNAPSHOT") push(renderStatusSnapshot(learnerVisibleBefore));
    else if (result.outcome === "CLARIFY") push(renderClarification(result.missing, { promptRu: result.clarifyPromptRu, by: result.clarifyBy }));
    else if (result.outcome === "UNSUPPORTED_CONTENT") push(renderUnsupported());
    else if (result.outcome === "UNAVAILABLE_RESOURCE") push(renderUnavailableResource(result.reasonKey));
    else if (result.outcome === "PREOP_NOT_READY") push(renderPreopNotReady(result.missingItems, bundle));
    else if (result.outcome === "DISCHARGE_NOT_READY") push(renderDischargeNotReady(result.blockers));
    else if (result.outcome === "HOSPITAL_POLICY_BLOCK") push(renderHospitalPolicyBlock(result));
    else if (result.outcome === "OPTION_NOT_MODELED") push(renderOptionNotModeled(result));
    else for (const event of result.events ?? []) push(renderEvent({ event, bundle, patient: turn.session.patient }), event.atMinutes);
  }
  if (turn.mentor?.textRu) push({ speakerRu: "Наставник", textRu: turn.mentor.textRu }, undefined, "mentor");

  session = turn.session;
}

function push(rendered, atMinutes, role = "env") {
  if (!rendered?.textRu) return;
  transcript.push({ atMinutes: atMinutes ?? session.state.clock.elapsedMinutes, role, ...rendered });
}

const debrief = buildDebrief({ session, bundle });
const exported = {
  ...exportSession({ session, generatedAtIso: new Date("2026-08-25T12:00:00.000Z").toISOString() }),
  post_review_smoke_transcript: transcript,
  debrief,
};

writeFileSync(path.join(ROOT, "docs/evidence/APP004_POST_REVIEW_SMOKE_REPLAY.json"), JSON.stringify(exported, null, 2));

console.log(`seed: ${SEED}`);
console.log(`content version: ${session.state.session.contentVersions[bundle.disease.disease_id]}`);
console.log(`patient: ${session.patient.demographics.sex}, ${session.patient.demographics.age}, ${session.patient.presentation.painSiteRu}, ${Math.round(session.patient.presentation.onsetHours)} h`);
console.log(`status: ${session.state.session.status} / ${session.state.session.endpoint?.type} at ${session.state.clock.elapsedMinutes} min`);
console.log(`events: ${session.events.length}, learner turns: ${TURNS.length}`);
console.log(`patientTruthApproved: ${session.state.session.patientTruthApproved}`);
console.log("--- transcript ---");
for (const line of transcript) {
  console.log(`[${String(line.atMinutes).padStart(4)}] ${line.role === "learner" ? "РЕЗИДЕНТ" : line.speakerRu}: ${line.textRu}`);
}
console.log("--- simulator limitations ---");
for (const entry of debrief.simulatorLimitations) console.log(`${entry.kind}:${entry.id} (${entry.reviewStatus}) x${entry.occurrences}`);
console.log("--- misses ---");
for (const miss of debrief.importantMisses) console.log(`${miss.kind}: ${miss.pointRu}`);

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderEvent } from "./renderEvent.js";
import { createEvent } from "../../core/events/eventLog.js";
import { EVENT } from "../../core/events/eventTypes.js";
import { generatePatient } from "../../core/patient/patientGenerator.js";
import { withShared } from "../../core/content/loadBundle.js";
import { createSession } from "../../core/session/createSession.js";
import { submitLearnerTurn } from "../../core/session/submitLearnerTurn.js";
import diseaseBundle from "../../content/generated/appendicitis.json" with { type: "json" };
import sharedBundle from "../../content/generated/shared.json" with { type: "json" };

const bundle = withShared(diseaseBundle, sharedBundle);
const patient = generatePatient({ seed: "render-test", bundle, casePresetId: "APP-004" });

test("an abdominal exam renders only the phenotype's declared slot states, in reviewed wording", () => {
  const event = createEvent({ type: EVENT.EXAMINATION_PERFORMED, atMinutes: 10, atIso: "x", payload: { region: "abdomen" } });
  const rendered = renderEvent({ event, bundle, patient });
  assert.ok(rendered.textRu.length > 0);
  // Every declared slot phrase for this phenotype's states must appear.
  for (const [slotId, stateValue] of Object.entries(patient.examSlots)) {
    const slot = bundle.findings.exam_slots.find((s) => s.id === slotId);
    const phrase = slot.states[stateValue];
    if (!phrase) continue;
    const expectedFragment = phrase.split(bundle.findings.localisation_token)[0].trim().slice(0, 8);
    assert.ok(
      rendered.textRu.toLowerCase().includes(expectedFragment.toLowerCase()),
      `missing fragment for ${slotId}`,
    );
  }
});

test("a non-central region request uses the universal normal layer, never 'not modeled'", () => {
  const event = createEvent({ type: EVENT.EXAMINATION_PERFORMED, atMinutes: 10, atIso: "x", payload: { region: "legs" } });
  const rendered = renderEvent({ event, bundle, patient });
  assert.equal(rendered.textRu, bundle.findings.universal_normal_layer.regions.legs_ru);
  assert.ok(!rendered.textRu.toLowerCase().includes("не смоделировано"));
});

test("a CT preliminary report is attributed to the radiologist and states 'preliminarily'", () => {
  const event = createEvent({
    type: EVENT.TEST_PRELIMINARY_REPORTED,
    atMinutes: 45,
    atIso: "x",
    payload: { investigationId: "ct_abdomen", preliminary: "видит свободный газ" },
  });
  const rendered = renderEvent({ event, bundle, patient });
  assert.equal(rendered.speakerRu, "Рентгенолог");
  assert.ok(rendered.textRu.startsWith("Предварительно"));
});

test("a bookkeeping event with no learner-facing prose renders as null, not an empty string", () => {
  const event = createEvent({ type: EVENT.COMMAND_ACCEPTED, atMinutes: 0, atIso: "x", payload: {} });
  assert.equal(renderEvent({ event, bundle, patient }), null);
});

test("a reassessment of the abdomen re-renders the abdominal examination, not the normal-exam layer", () => {
  // Regression: PATIENT_REASSESSED carries region "reassessment", which is
  // not "abdomen", so it used to fall through to the universal normal layer
  // and answer "Клинически значимых изменений нет." to a learner who had
  // explicitly asked to re-examine the abdomen. Found in a manual smoke
  // session because every other test asserted on state, never on prose.
  const rendered = renderEvent({
    event: {
      type: "PATIENT_REASSESSED",
      payload: { region: "reassessment", targets: ["pain", "abdomen_exam"] },
    },
    bundle,
    patient,
  });
  assert.ok(rendered.textRu !== "Клинически значимых изменений нет.");
  assert.match(rendered.textRu, /перистальтика|болезненн|Щёткина/);
});

test("a reassessment names the parameters the learner actually asked for", () => {
  const rendered = renderEvent({
    event: { type: "PATIENT_REASSESSED", payload: { region: "reassessment", targets: ["pain", "vitals"] } },
    bundle,
    patient,
  });
  assert.match(rendered.textRu, /боль/);
  assert.match(rendered.textRu, /витальные показатели/);
});

test("every sentence of an abdominal exam starts with a capital letter", () => {
  const event = createEvent({ type: EVENT.EXAMINATION_PERFORMED, atMinutes: 10, atIso: "x", payload: { region: "abdomen" } });
  const { textRu } = renderEvent({ event, bundle, patient });
  for (const sentence of textRu.split(/(?<=\.)\s+/)) assert.match(sentence, /^[А-ЯЁA-Z]/, sentence);
});

test("a gender-neutral verb form is resolved from the patient's sex", () => {
  const event = createEvent({ type: EVENT.FASTING_HISTORY_OBTAINED, atMinutes: 5, atIso: "x", payload: { fasting: { lastSolidFoodHoursAgo: 9, lastClearLiquidHoursAgo: 1 } } });
  const female = renderEvent({ event, bundle, patient: { ...patient, demographics: { ...patient.demographics, sex: "female" } } }).textRu;
  const male = renderEvent({ event, bundle, patient: { ...patient, demographics: { ...patient.demographics, sex: "male" } } }).textRu;
  assert.match(female, /ела .* пила/);
  assert.match(male, /ел .* пил /);
  assert.doesNotMatch(female + male, /\(а\)/);
});

test("a reassessment names the values measured at that moment, not a pointer", () => {
  const session = createSession({ sessionId: "reassess-values", seed: "reassess-values", mode: "reference", casePresetId: "APP-004", bundle, locale: "ru", startIso: "2026-10-01T10:00:00+05:00", sessionPurpose: "internal_development" });
  const turn = submitLearnerTurn({ session, text: "переоценю боль и витальные через 30 минут" });
  const event = [...(turn.timeEvents ?? []), ...turn.outcomes.flatMap((o) => o.events ?? [])].find((e) => e.type === EVENT.PATIENT_REASSESSED);
  const { state } = turn.session;
  const snapshot = state.observations.vitals.at(-1);
  assert.equal(snapshot.atMinutes, event.atMinutes);

  const text = renderEvent({ event, bundle, patient: turn.session.patient, state }).textRu;
  assert.ok(text.includes(`Боль ${snapshot.values.painScore}/10.`), text);
  assert.match(text, new RegExp(`ЧСС ${snapshot.values.heartRate}`));
  assert.doesNotMatch(text, /см\. текущие показатели/);

  const elsewhere = renderEvent({ event: { ...event, atMinutes: event.atMinutes + 1 }, bundle, patient: turn.session.patient, state }).textRu;
  assert.match(elsewhere, /см\. текущие показатели/, "a snapshot from another moment is never reported as this reassessment");
});

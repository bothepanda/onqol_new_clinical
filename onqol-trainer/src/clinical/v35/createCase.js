// Turning a generated patient into a playable case.
//
// WHAT THIS REPLACES AND WHAT IT DOES NOT
//
// `createV3Case()` builds one fixed patient from cases/acuteAppendicitis.js. It
// stays exactly as it is: it is the regression stand the V2.5 comparison and
// most tests run against, and a moving baseline is not a baseline.
//
// This is a second case FACTORY feeding the same engine - not a second engine.
// Addendum 0: "не создавай параллельный второй движок".
//
// WHERE THE TEXT COMES FROM
//
// Nothing here is written by the machine. Three sources, and only three:
//
//   1. the phenotype's authored story and examination (addendum 4.1);
//   2. numbers drawn inside the authored envelopes (addendum 4.2);
//   3. text carried over unchanged from the reviewed appendicitis card.
//
// Carried-over text is marked `CARRIED_OVER_UNREVIEWED` per field, because a
// haemoglobin that was authored for one fixed patient is not automatically right
// for a generated one. A reviewer needs to see which strings were reasoned about
// and which were inherited.
//
// WHAT A MODIFIER DOES TO A CASE
//
// A patient without MOD-PREGNANCY-POSSIBLE does not have `pregnancy_test`
// scored at zero - the action is REMOVED from the case, along with the pelvic
// screen, the pelvic ultrasound and the ectopic alternative. The differential
// depends on who is in front of you, and that lesson only lands if the required
// work-up genuinely differs.

import { createV25Case } from "../v25/caseFactory.js";
import { composeV3Case } from "../v3/createCase.js";
import { getDiseaseModule } from "../v3/diseaseModules.js";
import { PHENOTYPES } from "./phenotypes.js";
import { selectV35Case } from "./sessionSelector.js";
import { V35_CONTENT_VERSION } from "./manifest.js";

const CARRIED = "CARRIED_OVER_UNREVIEWED";
const GENERATED = "GENERATED_FROM_AUTHORED_RANGE";

/** Actions that exist only when a modifier switches them on. */
const MODIFIER_GATED_ACTION_IDS = Object.freeze([
  "pregnancy_test",
  "pelvic_gynecologic_screen",
  "pelvic_ultrasound",
  "differential_ectopic",
  "gynecology_consult",
]);

/** Russian needs three forms: 21 год, 22 года, 25 лет. */
function yearsWord(age) {
  const tens = age % 100;
  if (tens >= 11 && tens <= 14) return "лет";
  const units = age % 10;
  if (units === 1) return "год";
  if (units >= 2 && units <= 4) return "года";
  return "лет";
}

function handoffText(patient) {
  const { demographics: who, presentation: story, vitals } = patient;
  const female = who.sex === "female";
  return [
    `${female ? "Женщина" : "Мужчина"}, ${who.age} ${yearsWord(who.age)}.`,
    `${female ? "Доставлена" : "Доставлен"} в приёмное отделение.`,
    `Жалобы: ${story.story_ru.charAt(0).toLowerCase()}${story.story_ru.slice(1)}.`,
    `Давность ${story.hours_from_onset} ч. Боль ${story.pain_score} из 10.`,
    // Temperature always to one decimal: "38 °C" reads as a rounded-off number,
    // "38.0 °C" as a measured one.
    `Температура ${vitals.temperature_c.toFixed(1)} °C, ЧСС ${vitals.heart_rate}/мин,`,
    // Systolic only. The diastolic used to be printed as systolic * 0.62, which
    // is plausible for a normotensive patient and wrong exactly where it would
    // matter - see DIASTOLIC_STATUS in patientGenerator.js. A number nobody
    // measured must not appear next to numbers that were.
    `АД сист. ${vitals.systolic_bp} мм рт. ст.,`,
    `ЧД ${vitals.respiratory_rate}/мин.`,
    "С чего начнёшь?",
  ].join(" ");
}

/**
 * Findings for this patient.
 *
 * Every entry declares its provenance. `GENERATED_FROM_AUTHORED_RANGE` means the
 * numbers came from the phenotype envelope; `CARRIED_OVER_UNREVIEWED` means the
 * string is the fixed card's, unchanged and unchecked against this patient.
 */
function buildFindings(baseCase, patient, phenotype, pregnancyPossible) {
  const base = baseCase.available_findings;
  const findings = {};

  const historyLines = [phenotype.presentation.story_ru + "."];
  // Explicit negatives from the reviewed card. Not regenerated: which negatives
  // matter is a clinical statement, not a number.
  historyLines.push("Диареи нет. Дизурии нет.");
  if (pregnancyPossible) {
    historyLines.push("Последняя менструация 24 дня назад, задержки не отмечает.");
  }
  historyLines.push("Аллергий на лекарства не знает.");

  findings.focused_history = {
    title: base.focused_history.title,
    text: historyLines.join(" "),
    provenance: GENERATED,
    review_status: "synthetic_case_fact_needs_external_review",
  };

  findings.abdominal_exam = {
    title: base.abdominal_exam.title,
    text: phenotype.presentation.examination_ru + ".",
    provenance: GENERATED,
    review_status: "synthetic_case_fact_needs_external_review",
  };

  findings.cbc = {
    title: base.cbc.title,
    // Every value here is now this patient's. Haemoglobin and platelets come
    // from the adult population, the white count and neutrophil fraction from
    // the shared inflammatory burden, and the absolute neutrophil count is
    // derived from the two - so the numbers agree with each other rather than
    // being three independent draws pasted into one line.
    text:
      `Hb ${patient.labs.haemoglobin} г/л, ` +
      `лейкоциты ${patient.labs.wbc} x 10^9/л, ` +
      `нейтрофилы ${patient.labs.neutrophil_percent}% ` +
      `(абс. ${patient.labs.absolute_neutrophil_count} x 10^9/л), ` +
      `тромбоциты ${patient.labs.platelets} x 10^9/л.`,
    provenance: GENERATED,
    review_status: "synthetic_case_fact_needs_external_review",
  };

  findings.crp = {
    title: base.crp.title,
    text: `CRP ${patient.labs.crp} мг/л.`,
    provenance: GENERATED,
    review_status: "synthetic_case_fact_needs_external_review",
  };

  for (const id of ["urinalysis", "biochemistry", "abdominal_ultrasound", "ct_abdomen"]) {
    if (!base[id]) continue;
    findings[id] = { ...base[id], provenance: CARRIED };
  }
  // Imaging descriptions are phenotype-specific and authored (addendum 4.3).
  findings.abdominal_ultrasound = {
    ...findings.abdominal_ultrasound,
    text: phenotype.imaging.ultrasound_ru,
    provenance: GENERATED,
  };
  findings.ct_abdomen = {
    ...findings.ct_abdomen,
    text: phenotype.imaging.ct_ru,
    provenance: GENERATED,
  };

  if (pregnancyPossible) {
    findings.pregnancy_test = {
      title: base.pregnancy_test.title,
      // Frozen before the session; requesting the test reveals it, never creates
      // it. `hidden.pregnancy_present` was decided by the generator.
      text: patient.hidden.pregnancy_present ? "Мочевой beta-hCG положительный." : "Мочевой beta-hCG отрицательный.",
      provenance: GENERATED,
      review_status: "synthetic_case_fact_needs_external_review",
    };
    findings.pelvic_gynecologic_screen = { ...base.pelvic_gynecologic_screen, provenance: CARRIED };
    findings.pelvic_ultrasound = { ...base.pelvic_ultrasound, provenance: CARRIED };
  }

  return findings;
}

/** Drop actions whose modifier is absent, everywhere they appear. */
function applyModifierGating(caseData, enabledActionIds) {
  const enabled = new Set(enabledActionIds);
  const drop = MODIFIER_GATED_ACTION_IDS.filter((id) => !enabled.has(id));
  if (drop.length === 0) return { caseData, removedActionIds: [] };

  const dropped = new Set(drop);
  const filter = (list) => (list || []).filter((action) => !dropped.has(action.id));

  return {
    removedActionIds: drop,
    caseData: {
      ...caseData,
      expected_actions: filter(caseData.expected_actions),
      acceptable_alternatives: filter(caseData.acceptable_alternatives),
      unnecessary_actions: filter(caseData.unnecessary_actions),
      unsafe_actions: filter(caseData.unsafe_actions),
      // A critical omission that names a removed action would fail schema
      // validation and, worse, would mark a male learner as having missed a
      // pregnancy test.
      critical_omissions: (caseData.critical_omissions || []).filter((id) => !dropped.has(id)),
      state_transitions: (caseData.state_transitions || []).map((transition) => ({
        ...transition,
        when_all_done: (transition.when_all_done || []).filter((id) => !dropped.has(id)),
      })),
    },
  };
}

/**
 * Build a playable V3.5 case from a generated patient.
 *
 * @param {object} [options]
 * @param {string} options.seed
 * @param {string|null} [options.previousPresetId]
 * @param {string|null} [options.requestedPresetId]  faculty override
 * @param {"learner"|"faculty"} [options.mode]
 * @param {string} [options.locale]
 * @returns {{caseData: object, patient: object, selection: object}}
 */
export function buildV35Case({
  seed,
  previousPresetId = null,
  requestedPresetId = null,
  mode = "learner",
  locale = "ru",
} = {}) {
  if (!seed) throw new Error("buildV35Case requires a seed: sessions must be reproducible.");

  const { preset, patient, selection } = selectV35Case({
    seed,
    previousPresetId,
    requestedPresetId,
    mode,
  });
  const phenotype = PHENOTYPES[preset.phenotype_id];
  const pregnancyPossible = patient.enabled_action_ids.includes("pregnancy_test");

  // Start from the same composition V3 uses, so the core library, the mentor
  // rules and the router dictionary arrive unchanged.
  const baseCase = createV25Case(locale);
  const { caseData: composed } = composeV3Case(baseCase, getDiseaseModule(baseCase));

  const withPatient = {
    ...composed,
    case_id: `app-v35-${preset.case_preset_id.toLowerCase()}`,
    case_version: V35_CONTENT_VERSION,
    product_version: "3.5",
    title: preset.title_ru,
    initial_presentation: { text: handoffText(patient) },
    patient_state: {
      ...composed.patient_state,
      sex: patient.demographics.sex,
      age: patient.demographics.age,
      pregnancy_possible: pregnancyPossible,
      time_from_onset_hours: patient.presentation.hours_from_onset,
      diagnosis_truth: patient.hidden.morphology,
      // Read by createInitialTemporalState, so the vitals on screen are the ones
      // in the handoff the learner just read.
      opening_vitals: {
        heart_rate: patient.vitals.heart_rate,
        temperature_c: patient.vitals.temperature_c,
        systolic_bp: patient.vitals.systolic_bp,
        respiratory_rate: patient.vitals.respiratory_rate,
        pain_score: patient.presentation.pain_score,
      },
    },
    available_findings: buildFindings(baseCase, patient, phenotype, pregnancyPossible),
    hidden_findings: {
      ...composed.hidden_findings,
      operative_finding: {
        ...composed.hidden_findings.operative_finding,
        text: phenotype.imaging.operative_truth_ru,
        provenance: GENERATED,
      },
    },
    // What this case is made of. Frozen with the session, so a reported case can
    // be rebuilt from the log alone.
    v35_composition: Object.freeze({
      ...patient.composition,
      // Hidden fields the snapshot must carry to rebuild the patient: reserve is
      // drawn, not derived, so replaying the seed is the only way back to it.
      physiologic_reserve: patient.hidden.physiologic_reserve,
      inflammatory_burden: patient.hidden.latent_state.inflammatory_burden,
      organ_dysfunction: patient.hidden.latent_state.organ_dysfunction,
      content_version: V35_CONTENT_VERSION,
      requested_seed: selection.requested_seed,
      effective_seed: selection.effective_seed,
    }),
  };

  // Dangerous alternatives are actions too: `differential_ectopic` is a concept
  // the learner names, and it belongs to the case only when the modifier that
  // makes it dangerous is present.
  const { caseData, removedActionIds } = applyModifierGating(withPatient, [
    ...patient.enabled_action_ids,
    ...patient.enabled_dangerous_alternatives,
  ]);

  return {
    patient,
    selection: { ...selection, removed_action_ids: removedActionIds },
    caseData: { ...caseData, v35_removed_action_ids: removedActionIds },
  };
}

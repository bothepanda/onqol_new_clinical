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
// A modifier changes rubric relevance, not the physical universe. Pelvic
// examination and pelvic ultrasound remain orderable when clinically discussed;
// the pregnancy branch controls whether beta-hCG and ectopic reasoning are
// expected for this patient. A non-required action is never silently deleted.

import { createV25Case } from "../v25/caseFactory.js";
import { KZ_RESOURCE_PROFILE_VERSION } from "../v25/scenarioEngine.js";
import { composeV3Case } from "../v3/createCase.js";
import { getDiseaseModule } from "../v3/diseaseModules.js";
import { PHENOTYPES } from "./phenotypes.js";
import { renderExamination, renderRectalExamination } from "./examSlots.js";
import { selectV35Case } from "./sessionSelector.js";
import { V35_CONTENT_VERSION } from "./manifest.js";
import {
  V35_SCORING_CONTRACT_VERSION,
  V35_SCORING_REVIEW_STATUS,
} from "./scoringContract.js";

const CARRIED = "CARRIED_OVER_UNREVIEWED";
const GENERATED = "GENERATED_FROM_AUTHORED_RANGE";
// Text a clinician wrote and signed for this phenotype, not drawn from a range.
const AUTHORED = "OWNER_AUTHORED_SIGNED";
const REWORDED = "reworded_by_owner_20260809_clinical_content_unchanged";

/**
 * Owner's rewording of text carried from the fixed card, 09.08.2026.
 *
 * These live here rather than in cases/acuteAppendicitis.js on purpose: the
 * fixed card is the V2.5/V3 regression stand, and rewording it would move the
 * baseline the comparison is measured against. Only the wording changes - every
 * clinical assertion is the same one the card already made.
 */
const V35_REWORDED_CARRIED = Object.freeze({
  urinalysis: Object.freeze({
    text: "В моче лейкоцитов и нитритов нет, эритроциты 0–1 в поле зрения.",
  }),
  biochemistry: Object.freeze({
    text:
      "Креатинин 72 мкмоль/л, мочевина 4,8 ммоль/л, общий билирубин 12 мкмоль/л, " +
      "АЛТ 22 Ед/л, АСТ 19 Ед/л.",
  }),
  pelvic_gynecologic_screen: Object.freeze({
    text:
      // The last sentence is deliberately NOT softened, owner 09.08.2026:
      // pregnancy changes the diagnostic and imaging pathway in acute abdominal
      // pain, so the screen must be unable to read as a substitute for the test.
      "Патологических выделений и маточного кровотечения нет. При смещении шейки матки " +
      "выраженной болезненности не отмечается. Эти данные не исключают беременность " +
      "и не заменяют тест на β-ХГЧ.",
  }),
});

/** Actions whose rubric relevance is controlled by pregnancy possibility. */
const MODIFIER_EXPECTED_ACTION_IDS = Object.freeze([
  "pregnancy_test",
  "differential_ectopic",
]);

/**
 * Orderable for every patient, expected for none.
 *
 * These used to be dragged into the rubric by MOD-PREGNANCY-POSSIBLE, so every
 * woman of reproductive age owed a pelvic ultrasound and a gynaecology
 * consultation whether or not anything pointed at the pelvis. Reproductive age
 * is not a finding. What makes them relevant is a trigger - a positive or
 * unknown pregnancy result, pelvic findings, bleeding or discharge,
 * instability, or a gynaecologic differential the learner actually stated -
 * and until the case models those triggers, the honest rubric position is that
 * they are available and not required.
 *
 * They are NOT removed: a resident may order any of them at any time and gets
 * the authored result.
 */
const CONDITIONALLY_RELEVANT_ACTION_IDS = Object.freeze([
  "pelvic_gynecologic_screen",
  "pelvic_ultrasound",
  "gynecology_consult",
]);

/**
 * Compose one patient's presentation from the phenotype's authored variants.
 *
 * The phenotype describes what this presentation MAY contain; a patient has one
 * of each. Every fragment is the surgeon's wording - this chooses among them and
 * writes nothing.
 *
 * Driven by a seed so the same session rebuilds the same sentences.
 */
function composePresentation(phenotype, seed) {
  const p = phenotype.presentation;
  let state = hashString(`${phenotype.phenotype_id}:${seed}`);
  const next = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  const pick = (list) => (list && list.length ? list[Math.floor(next() * list.length)] : null);
  const maybe = (list) => (list || []).filter(() => next() < 0.5);

  const site = pick(p.pain_sites_ru);
  const details = [
    ...(p.history_fixed_ru || []),
    ...(p.history_variants_ru ? [pick(p.history_variants_ru)] : []),
    ...maybe(p.history_optional_ru),
  ];
  if (p.history_counted_ru) {
    const { template, singular_ru, range: countRange } = p.history_counted_ru;
    const count = countRange.min + Math.floor(next() * (countRange.max - countRange.min + 1));
    details.push(
      count === 1 && singular_ru
        ? singular_ru
        : template.replace("{n}", count).replace("{раз}", timesWord(count))
    );
  }

  // The examination is nine declared SLOTS plus this phenotype's variant overlay;
  // every word of it lives in examSlots.js. See the header there for why the
  // phenotype stopped carrying prose.
  // Each choice is drawn INDEPENDENTLY. They used to be one overlay picked as a
  // block, which silently correlated unrelated signs: a classic patient could
  // not have a positive Rovsing and a percussion finding at the same time.
  const slotStates = { ...(p.examination_slots || {}) };
  for (const [slotId, states] of Object.entries(p.examination_slot_choices || {})) {
    slotStates[slotId] = pick(states);
  }

  // Imaging reports vary the same way the presentation does: a report that is
  // "не визуализирован" for one patient and diagnostic for the next is the
  // whole point of an equivocal phenotype. Single-string phenotypes fall
  // through unchanged.
  const imaging = phenotype.imaging;
  const ultrasound = imaging.ultrasound_variants_ru
    ? pick(imaging.ultrasound_variants_ru)
    : imaging.ultrasound_ru;

  return {
    ultrasound_ru: ultrasound,
    pain_site_ru: site,
    // The handoff carries the COMPLAINT, not the history. An ambulance crew
    // hands over "pain here, this long"; migration, anorexia and vomiting are
    // what the learner gets by taking a history. Printing all of it in the
    // handoff both duplicated the site ("боль в правой подвздошной области,
    // боль мигрировала в правую подвздошную область") and gave away for free
    // what asking is supposed to earn.
    // Sites carry their own preposition ("в правой подвздошной области",
    // "глубоко внизу живота"), because not every site takes "в".
    complaint_ru: `боль ${site}`,
    // Skip the opening site line when a detail already states it: the classic
    // phenotype's "боль началась около пупка и переместилась..." IS the site,
    // and printing both read as two separate complaints.
    history_ru: sentence(
      details.some((detail) => mentionsSite(detail, site))
        ? details
        : [`боль ${site}`, ...details]
    ),
    details_ru: details,
    examination_ru: [
      renderExamination(slotStates, site),
      ...(p.examination_extra_ru || []).map(
        (line) => line.charAt(0).toUpperCase() + line.slice(1) + "."
      ),
    ]
      .filter(Boolean)
      .join(" "),
    examination_slots: slotStates,
  };
}

function hashString(text) {
  let hash = 2166136261;
  for (const char of String(text)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Does a history fragment already name this pain site? Stem-level, case-folded. */
function mentionsSite(fragment, site) {
  const stem = (text) =>
    String(text)
      .toLowerCase()
      .replace(/ё/g, "е")
      // Russian declines: "подвздошной" vs "подвздошную". Compare on stems.
      .split(/[^а-яa-z]+/)
      .filter((word) => word.length > 4)
      .map((word) => word.slice(0, -2));
  const siteStems = new Set(stem(site));
  return stem(fragment).some((word) => siteStems.has(word));
}

/**
 * Explicit negatives carried from the reviewed card, minus any the phenotype
 * contradicts.
 *
 * The pelvic phenotype reports "дискомфорт при мочеиспускании" and the card's
 * fixed history says "Дизурии нет" - one patient, two opposite statements. The
 * negatives are still the reviewed card's wording; what changes is that one is
 * dropped when the case has already asserted the positive.
 */
const CARRIED_NEGATIVES = Object.freeze([
  Object.freeze({ text: "Диареи нет", contradicted_by: ["диаре", "жидк"] }),
  Object.freeze({
    text: "Нарушений мочеиспускания нет",
    // "тенезм" stays in the stem list although the pelvic phenotype no longer
    // uses the word: the stems gate the negative, and dropping one silently
    // widens what may be asserted.
    contradicted_by: ["мочеиспуск", "дизур", "тенезм", "дефекац"],
  }),
]);

function explicitNegatives(details) {
  const said = details.join(" ").toLowerCase().replace(/ё/g, "е");
  return CARRIED_NEGATIVES.filter(
    (negative) => !negative.contradicted_by.some((stem) => said.includes(stem))
  ).map((negative) => negative.text);
}

/** 1 раз, 2 раза, 5 раз. */
function timesWord(count) {
  const tens = count % 100;
  if (tens >= 11 && tens <= 14) return "раз";
  const units = count % 10;
  if (units >= 2 && units <= 4) return "раза";
  return "раз";
}

/**
 * A measured decimal, Russian style: 8,8 and 13,0 - not 8.8 and 13.
 *
 * Same reasoning as the temperature: a bare "13" reads as a rounded-off number
 * next to a "12,5" that was measured.
 */
function decimal(value) {
  return Number(value).toFixed(1).replace(".", ",");
}

/**
 * Genitive after "в течение": 1 часа, 2 часов, 23 часов.
 *
 * NOT the nominative set (1 час, 2 часа, 5 часов) - "в течение" governs the
 * genitive, so only a count ending in one takes the singular.
 */
function hourWord(count) {
  const tens = count % 100;
  const units = count % 10;
  return units === 1 && tens !== 11 ? "часа" : "часов";
}

/** Join fragments into one sentence, capitalised and full-stopped. */
function sentence(parts) {
  if (!parts.length) return "";
  const joined = parts.join(", ");
  return joined.charAt(0).toUpperCase() + joined.slice(1) + ".";
}

/**
 * The complaint the patient arrives with, for the header.
 *
 * Derived from the phenotype's pain site, because that is what a triage note
 * would say. It must stay at the level of a complaint: naming the region is
 * what the learner can see for themselves, naming the disease is the answer.
 */
function presentationTitle(composed) {
  return composed.pain_site_ru ? `Боль ${composed.pain_site_ru}` : "Боль в животе";
}

/** Russian needs three forms: 21 год, 22 года, 25 лет. */
function yearsWord(age) {
  const tens = age % 100;
  if (tens >= 11 && tens <= 14) return "лет";
  const units = age % 10;
  if (units === 1) return "год";
  if (units >= 2 && units <= 4) return "года";
  return "лет";
}

function handoffText(patient, composed) {
  const { demographics: who, presentation: story, vitals } = patient;
  const female = who.sex === "female";
  return [
    `${female ? "Женщина" : "Мужчина"}, ${who.age} ${yearsWord(who.age)}.`,
    `${female ? "Доставлена" : "Доставлен"} в приёмное отделение.`,
    `Жалобы: ${composed.complaint_ru}.`,
    `Боль беспокоит в течение ${story.hours_from_onset} ${hourWord(story.hours_from_onset)}.`,
    `Интенсивность боли — ${story.pain_score} из 10.`,
    // Temperature always to one decimal: "38 °C" reads as a rounded-off number,
    // "38.0 °C" as a measured one.
    // Decimal comma throughout: the labs already print 13,8 and 4,8, and one
    // line in dot notation reads as a different document.
    `Температура ${vitals.temperature_c.toFixed(1).replace(".", ",")} °C, ЧСС ${vitals.heart_rate}/мин,`,
    // Systolic only. The diastolic used to be printed as systolic * 0.62, which
    // is plausible for a normotensive patient and wrong exactly where it would
    // matter - see DIASTOLIC_STATUS in patientGenerator.js. A number nobody
    // measured must not appear next to numbers that were. Owner's decision,
    // 09.08.2026: do not generate it either - print only what was measured.
    `сАД ${vitals.systolic_bp} мм рт. ст.,`,
    `ЧД ${vitals.respiratory_rate}/мин.`,
    "С чего начнёшь?",
  ].join(" ");
}

/** Did this phenotype author a rectal examination? Owner-signed content only. */
function rectalExamAuthored(phenotype) {
  return Boolean(
    phenotype?.presentation?.rectal_exam_slots &&
      Object.keys(phenotype.presentation.rectal_exam_slots).length
  );
}

/**
 * Findings for this patient.
 *
 * Every entry declares its provenance. `GENERATED_FROM_AUTHORED_RANGE` means the
 * numbers came from the phenotype envelope; `CARRIED_OVER_UNREVIEWED` means the
 * string is the fixed card's, unchanged and unchecked against this patient.
 */
function buildFindings(baseCase, patient, phenotype, pregnancyPossible, composed) {
  const base = baseCase.available_findings;
  const findings = {};

  const historyLines = [composed.history_ru];
  // Explicit negatives from the reviewed card. Which negatives matter is a
  // clinical statement, not a number - so they are carried, not regenerated.
  // A negative the phenotype contradicts is dropped rather than reworded.
  const negatives = explicitNegatives(composed.details_ru || []);
  if (negatives.length) historyLines.push(negatives.join(". ") + ".");
  if (pregnancyPossible) {
    historyLines.push("Последняя менструация была 24 дня назад, задержки не было.");
  }
  historyLines.push("Лекарственную аллергию отрицает.");

  findings.focused_history = {
    title: base.focused_history.title,
    text: historyLines.join(" "),
    provenance: GENERATED,
    review_status: "synthetic_case_fact_needs_external_review",
  };

  findings.abdominal_exam = {
    title: base.abdominal_exam.title,
    text: composed.examination_ru,
    // The slots stay addressable at runtime, not only flattened into the
    // sentence above: a narrow question ("симптом Ровзинга?") should be able to
    // answer from one slot without performing the whole examination.
    slots: composed.examination_slots,
    // Each slot's own sentence, so a narrow answer uses the same authored words
    // as the full examination rather than a second phrasing of them.
    slot_text: Object.fromEntries(
      Object.keys(composed.examination_slots).map((slotId) => [
        slotId,
        renderExamination(
          { [slotId]: composed.examination_slots[slotId] },
          composed.pain_site_ru
        ),
      ])
    ),
    provenance: GENERATED,
    review_status: "synthetic_case_fact_needs_external_review",
  };

  // ПРИ, only where the phenotype authored it. A phenotype that authored
  // nothing gets no finding at all, and the action keeps its
  // `not_authorized_for_patient_variant` flags from the base card - so the
  // learner is told the result is not modelled instead of reading a plausible
  // normal nobody signed.
  const rectalText = renderRectalExamination(phenotype.presentation?.rectal_exam_slots);
  if (rectalText) {
    findings.rectal_exam = {
      title: "Пальцевое ректальное исследование",
      text: rectalText,
      slots: { ...phenotype.presentation.rectal_exam_slots },
      slot_text: Object.fromEntries(
        Object.entries(phenotype.presentation.rectal_exam_slots).map(([slotId, state]) => [
          slotId,
          renderRectalExamination({ [slotId]: state }),
        ])
      ),
      provenance: AUTHORED,
      review_status: "owner_signed_20260818",
    };
  }

  findings.cbc = {
    title: base.cbc.title,
    // Every value here is now this patient's. Haemoglobin and platelets come
    // from the adult population, the white count and neutrophil fraction from
    // the shared inflammatory burden, and the absolute neutrophil count is
    // derived from the two - so the numbers agree with each other rather than
    // being three independent draws pasted into one line.
    text:
      `Гемоглобин ${patient.labs.haemoglobin} г/л, ` +
      `лейкоциты ${decimal(patient.labs.wbc)} × 10^9/л, ` +
      `нейтрофилы ${patient.labs.neutrophil_percent}% ` +
      `(абс. ${decimal(patient.labs.absolute_neutrophil_count)} × 10^9/л), ` +
      `тромбоциты ${patient.labs.platelets} × 10^9/л.`,
    provenance: GENERATED,
    review_status: "synthetic_case_fact_needs_external_review",
  };

  // CRP IS GENERATED AND NOT SHOWN.
  //
  // `patient.labs.crp` still exists: the latent physiology is coherent because
  // inflammatory burden drives white count and CRP together, and removing one
  // of them would destabilise the other. What changed is that the number no
  // longer reaches a learner. The measured distribution over the learner
  // presets is not validated - a median near 39 mg/L in the first six hours,
  // barely moving over the first day - and a review flag does not stop a
  // resident learning that pattern by reading it four times.
  //
  // The honest result is the one that says so. Nothing in the case requires
  // this value: no transition, no diagnosis, no endpoint, no score.
  findings.crp = {
    title: "С-реактивный белок",
    text:
      "С-реактивный белок в этой версии не моделируется: временная кривая и диапазоны ещё не прошли клиническое ревью.",
    modelled: false,
    provenance: AUTHORED,
    review_status: "learner_inactive_pending_reviewed_time_response_model",
  };

  for (const id of ["urinalysis", "biochemistry", "abdominal_ultrasound", "ct_abdomen"]) {
    if (!base[id]) continue;
    // V3.5 rewording, owner 09.08.2026. Applied here and NOT in the fixed card:
    // `createV3Case()` is the regression stand the V2.5 comparison runs against,
    // and a baseline that moves is not a baseline.
    const reworded = V35_REWORDED_CARRIED[id];
    findings[id] = reworded
      ? { ...base[id], ...reworded, provenance: CARRIED, review_status: REWORDED }
      : { ...base[id], provenance: CARRIED };
  }
  // Imaging descriptions are phenotype-specific and authored (addendum 4.3).
  findings.abdominal_ultrasound = {
    ...findings.abdominal_ultrasound,
    text: composed.ultrasound_ru,
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
      text: patient.hidden.pregnancy_present
        ? "Тест мочи на β-ХГЧ положительный."
        : "Тест мочи на β-ХГЧ отрицательный.",
      provenance: GENERATED,
      review_status: "synthetic_case_fact_needs_external_review",
    };
  }

  // Pelvic pain and gynaecologic assessment are not synonyms for pregnancy.
  // These owner-authored results remain available for women outside the
  // pregnancy modifier; the modifier only changes what is expected/scored.
  if (patient.demographics.sex === "female") {
    findings.pelvic_gynecologic_screen = {
      ...base.pelvic_gynecologic_screen,
      ...V35_REWORDED_CARRIED.pelvic_gynecologic_screen,
      provenance: CARRIED,
      review_status: REWORDED,
    };
    findings.pelvic_ultrasound = {
      ...base.pelvic_ultrasound,
      provenance: CARRIED,
      review_status: "synthetic_case_fact_needs_external_review",
    };
  }

  return findings;
}

/** Keep the action universe intact while changing patient-specific relevance. */
function applyModifierGating(caseData, enabledActionIds) {
  const enabled = new Set(enabledActionIds);
  const nonExpected = [
    ...MODIFIER_EXPECTED_ACTION_IDS.filter((id) => !enabled.has(id)),
    // Always, for every patient: conditional relevance is not an obligation.
    ...CONDITIONALLY_RELEVANT_ACTION_IDS,
  ];
  if (nonExpected.length === 0) {
    return { caseData, removedActionIds: [], nonExpectedActionIds: [] };
  }

  const nonExpectedSet = new Set(nonExpected);
  const annotate = (list) => (list || []).map((action) => {
    if (!nonExpectedSet.has(action.id)) return action;
    return {
      ...action,
      available_to_order: true,
      expected_for_this_patient: false,
      eligible_for_scoring: false,
      score_weight: 0,
      critical: false,
      // A conditional action keeps its authored result: it is orderable and
      // answers normally. Only its rubric obligation is removed.
      finding_status:
        action.id === "pregnancy_test" ? "not_authorized_for_patient_variant" : null,
      unavailable_reason_ru:
        action.id === "pregnancy_test"
          ? "Тест на беременность распознан, но для этого варианта пациента результат не авторизован."
          : null,
      relevance: CONDITIONALLY_RELEVANT_ACTION_IDS.includes(action.id)
        ? "conditional_on_findings"
        : "modifier_gated",
    };
  });

  return {
    removedActionIds: [],
    nonExpectedActionIds: nonExpected,
    caseData: {
      ...caseData,
      expected_actions: annotate(caseData.expected_actions),
      acceptable_alternatives: annotate(caseData.acceptable_alternatives),
      unnecessary_actions: annotate(caseData.unnecessary_actions),
      unsafe_actions: annotate(caseData.unsafe_actions),
      critical_omissions: (caseData.critical_omissions || []).filter(
        (id) => !nonExpectedSet.has(id)
      ),
      state_transitions: (caseData.state_transitions || []).map((transition) => ({
        ...transition,
        when_all_done: (transition.when_all_done || []).filter((id) => !nonExpectedSet.has(id)),
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
 * @param {"learner"|"faculty"|"internal_test"} [options.mode]
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
  // One patient's presentation, chosen from the phenotype's authored variants.
  const composed = composePresentation(phenotype, selection.effective_seed);

  // Start from the same composition V3 uses, so the core library, the mentor
  // rules and the router dictionary arrive unchanged.
  const baseCase = createV25Case(locale);
  const { caseData: v3Composed } = composeV3Case(baseCase, getDiseaseModule(baseCase));

  const withPatient = {
    ...v3Composed,
    // ПРИ is orderable in every case and modelled in only one. Clearing the
    // base card's "not modelled" flags where the phenotype authored the slots
    // is what lets the engine hand over the finding; leaving them everywhere
    // else is what keeps the honest non-answer.
    acceptable_alternatives: rectalExamAuthored(phenotype)
      ? (v3Composed.acceptable_alternatives || []).map((action) =>
          action.id === "rectal_exam"
            ? {
                ...action,
                finding_status: null,
                unavailable_reason_ru: null,
                effects_on_case: { reveal: "rectal_exam" },
              }
            : action
        )
      : v3Composed.acceptable_alternatives,
    case_id: `app-v35-${preset.case_preset_id.toLowerCase()}`,
    case_version: V35_CONTENT_VERSION,
    product_version: "3.5",
    scoring_rubric_version: V35_SCORING_CONTRACT_VERSION,
    scoring: {
      ...v3Composed.scoring,
      mode: "formative_only",
      eligible_for_scoring: false,
      review_status: V35_SCORING_REVIEW_STATUS,
      contract_version: V35_SCORING_CONTRACT_VERSION,
      unlock_requires: [
        "independent_clinical_review",
        "pilot_calibration",
        "one_to_one_evidence_trace",
      ],
    },
    // THE TITLE IS A COMPLAINT, NEVER THE DIAGNOSIS.
    //
    // This carried `preset.title_ru` - "Ретроцекальный аппендицит со слабой
    // передней перитонеальной симптоматикой" - which printed the hidden truth
    // at the top of the screen before the learner had done anything. A trainer
    // for diagnostic reasoning that announces the diagnosis is not a trainer.
    //
    // The preset title stays where it belongs: in the faculty preview and the
    // frozen composition, both of which a learner never sees.
    title: presentationTitle(composed),
    // Faculty-facing only. Named so nothing renders it by reaching for `title`.
    faculty_title_ru: preset.title_ru,
    initial_presentation: { text: handoffText(patient, composed) },
    patient_state: {
      ...v3Composed.patient_state,
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
    available_findings: buildFindings(baseCase, patient, phenotype, pregnancyPossible, composed),
    hidden_findings: {
      ...v3Composed.hidden_findings,
      operative_finding: {
        ...v3Composed.hidden_findings.operative_finding,
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
      effective_resource_profile_id: patient.composition.declared_resource_profile_id,
      resource_profile_version: KZ_RESOURCE_PROFILE_VERSION,
      selection_method: selection.selection_method,
      requested_seed: selection.requested_seed,
      effective_seed: selection.effective_seed,
      selection_attempts: Object.freeze(
        selection.attempts.map((attempt) =>
          Object.freeze({
            seed: attempt.seed,
            case_preset_id: attempt.case_preset_id,
            rejected_because: attempt.rejected_because,
            violation_rules: Object.freeze(
              (attempt.violations || []).map((violation) => violation.rule)
            ),
          })
        )
      ),
      // The chosen presentation, so a reported case rebuilds the same sentences.
      pain_site_ru: composed.pain_site_ru,
    }),
  };

  // Dangerous alternatives are actions too: `differential_ectopic` is a concept
  // the learner names, and it belongs to the case only when the modifier that
  // makes it dangerous is present.
  const { caseData, removedActionIds, nonExpectedActionIds } = applyModifierGating(withPatient, [
    ...patient.enabled_action_ids,
    ...patient.enabled_dangerous_alternatives,
  ]);

  return {
    patient,
    selection: {
      ...selection,
      removed_action_ids: removedActionIds,
      non_expected_action_ids: nonExpectedActionIds,
    },
    caseData: {
      ...caseData,
      v35_removed_action_ids: removedActionIds,
      v35_non_expected_action_ids: nonExpectedActionIds,
    },
  };
}

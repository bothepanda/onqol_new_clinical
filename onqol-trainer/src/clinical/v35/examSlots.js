// The abdominal examination, as nine slots and one dictionary of prose.
//
// WHY THIS EXISTS
//
// Until 09.08.2026 each phenotype carried its own examination sentences. The
// owner then wrote a full examination in her own words, and the two overlapped
// almost exactly: the same finding existed twice, once as phenotype prose and
// once as a slot phrase, so switching the slots on would have printed every
// patient's abdomen to them twice.
//
// So the split is: a PHENOTYPE declares STATES, this file owns WORDS. A
// phenotype says `rebound: "положительный локально"`; what a learner reads is
// decided here, once, for every patient in the trainer.
//
// TERMINOLOGY IS RUSSIAN
//
// Owner's instruction, 09.08.2026: no English sign names in the patient text.
// симптом Щёткина-Блюмберга, симптом Ровзинга, псоас-симптом, запирательный
// симптом. The English names stay in this comment and nowhere else.
//
// PENDING, NOT DONE: renaming псоас-симптом to симптом Образцова and
// запирательный симптом to симптом Коупа. The owner's condition, 09.08.2026, is
// that the MANOEUVRES be brought to the MZ RK protocol's definitions at the same
// time - those eponyms name specific techniques, and relabelling the
// international psoas/obturator manoeuvres without changing what is described
// would be wrong. Blocked on NEEDS_SOURCE_VERIFICATION of the protocol text.
//
// WHAT IS NOT DECIDED HERE
//
// Which state a given phenotype takes in a given slot is a clinical statement
// and belongs to the phenotype card. A slot the phenotype leaves UNSPECIFIED is
// not printed at all - it is not quietly filled with a plausible negative. See
// SLOT_REVIEW_STATUS at the bottom for what is signed and what is still blank.

/** A slot the phenotype has not spoken about. Prints nothing. */
export const UNSPECIFIED = "не определено";

/**
 * `{локализация}` is replaced by this patient's pain site, which already
 * carries its own preposition ("в правой подвздошной области", "глубоко внизу
 * живота"). Templates therefore never write "в" in front of it.
 */
export const LOCALISATION_TOKEN = "{локализация}";

/**
 * The nine slots, in the order a physical examination is written up.
 *
 * `group` decides sentence assembly: slots sharing a group are joined into one
 * sentence rather than printed as nine separate ones (owner, 09.08.2026 - the
 * interface should read as a paragraph, not as a checklist).
 */
export const EXAM_SLOTS = Object.freeze([
  Object.freeze({
    id: "contour",
    group: "inspection",
    title_ru: "форма, симметрия, участие в дыхании, вздутие",
    states: Object.freeze({
      обычный: "живот обычной формы, симметричный, не вздут, участвует в акте дыхания",
      вздут: "живот вздут, симметричный, участвует в акте дыхания",
    }),
  }),
  // The owner's table had one slot, "мягкость при пальпации: мягкий / напряжён".
  // Split in two on 09.08.2026 because a patient can be soft AND have local
  // guarding, and one slot could only say one of those. Ordering matters too:
  // tenderness is reported before guarding, the way an examination is written.
  Object.freeze({
    id: "palpation",
    group: "palpation",
    title_ru: "мягкость при пальпации",
    // Only one state: "напряжён" was removed on 09.08.2026 (owner). Muscular
    // resistance is what the `guarding` slot is for, and keeping it in both
    // slots let one patient be told about it twice.
    states: Object.freeze({
      мягкий: "при пальпации живот мягкий",
    }),
  }),
  Object.freeze({
    id: "tenderness",
    group: "palpation",
    title_ru: "болезненность при пальпации",
    states: Object.freeze({
      локальная: `локально болезненный ${LOCALISATION_TOKEN}`,
      "локальная умеренная": `умеренно болезненный ${LOCALISATION_TOKEN}`,
      // Names the abdomen, because the phenotype that uses this state has no
      // `palpation` slot in front of it and the line has to stand on its own.
      разлитая: "живот болезненный во всех отделах",
    }),
  }),
  Object.freeze({
    id: "max_point",
    group: "palpation",
    title_ru: "точка максимальной болезненности",
    states: Object.freeze({
      "точка Мак-Бурнея": "максимальная болезненность определяется в точке Мак-Бурнея",
      // The owner's line ended ", в нижних отделах живота"; dropped, because the
      // patient's own site is already printed and the two disagreed whenever she
      // drew "в надлонной области".
      ниже: "максимальная болезненность определяется ниже точки Мак-Бурнея",
      // Deliberately NOT "латеральнее обычной точки": owner, 09.08.2026 - a
      // learner who has not yet made the diagnosis has no way to know which
      // point is the usual one, and working that out is the exercise.
      "по локализации боли": `максимальная болезненность определяется ${LOCALISATION_TOKEN}`,
    }),
  }),
  Object.freeze({
    id: "guarding",
    group: "guarding",
    title_ru: "защитное напряжение мышц",
    states: Object.freeze({
      локальное: "определяется локальное защитное напряжение мышц",
      распространённое: "определяется напряжение мышц передней брюшной стенки",
      слабое: "защитное напряжение мышц выражено слабо",
      нет: "защитного напряжения мышц нет",
    }),
  }),
  Object.freeze({
    id: "rebound",
    group: "peritoneal",
    title_ru: "симптом Щёткина-Блюмберга",
    // Names only, no manoeuvre descriptions - owner, 10.08.2026. A chart records
    // that the sign was positive; how it is elicited is what the learner is
    // supposed to already know, and spelling it out turned the examination into
    // a textbook.
    states: Object.freeze({
      "положительный локально": `симптом Щёткина-Блюмберга положительный ${LOCALISATION_TOKEN}`,
      сомнительный: "симптом Щёткина-Блюмберга сомнительный",
      отрицательный: "симптом Щёткина-Блюмберга отрицательный",
      "положительный во всех отделах":
        "симптом Щёткина-Блюмберга положительный во всех отделах живота",
    }),
  }),
  Object.freeze({
    id: "rovsing",
    group: "special",
    title_ru: "симптом Ровзинга",
    states: Object.freeze({
      положительный: "симптом Ровзинга положительный",
      отрицательный: "симптом Ровзинга отрицательный",
    }),
  }),
  Object.freeze({
    id: "psoas",
    group: "special",
    title_ru: "псоас-симптом",
    states: Object.freeze({
      положительный: "псоас-симптом положительный",
      отрицательный: "псоас-симптом отрицательный",
    }),
  }),
  Object.freeze({
    id: "obturator",
    group: "special",
    title_ru: "запирательный симптом",
    states: Object.freeze({
      положительный: "запирательный симптом положительный",
      отрицательный: "запирательный симптом отрицательный",
    }),
  }),
  Object.freeze({
    id: "percussion",
    group: "percussion",
    title_ru: "перкуссионная болезненность",
    // Same rule as the named signs: the finding, not the technique.
    states: Object.freeze({
      есть: `перкуссионная болезненность определяется ${LOCALISATION_TOKEN}`,
      нет: "перкуссионной болезненности нет",
      // Added 09.08.2026 (owner): "справа внизу / нет" has no state for a
      // diffuse peritonitis, and forcing that patient into a right-lower-quadrant
      // finding would localise something that is not localised.
      диффузная: "перкуссионная болезненность определяется во всех отделах живота",
    }),
  }),
  Object.freeze({
    id: "peristalsis",
    group: "auscultation",
    title_ru: "перистальтика",
    states: Object.freeze({
      выслушивается: "перистальтика кишечника выслушивается",
      ослаблена: "перистальтика кишечника ослаблена",
      "не выслушивается": "перистальтика кишечника не выслушивается",
    }),
  }),
]);

export const EXAM_SLOT_IDS = Object.freeze(EXAM_SLOTS.map((slot) => slot.id));

const SLOT_BY_ID = new Map(EXAM_SLOTS.map((slot) => [slot.id, slot]));

/** The slot definition, or undefined. */
export function examSlot(id) {
  return SLOT_BY_ID.get(id);
}

/**
 * Render one patient's examination.
 *
 * @param {Object} states   slot id -> state name. Missing or UNSPECIFIED prints nothing.
 * @param {string} site     this patient's pain site, preposition included.
 * @returns {string}
 */
export function renderExamination(states, site) {
  const groups = [];
  for (const slot of EXAM_SLOTS) {
    const state = states[slot.id];
    if (!state || state === UNSPECIFIED) continue;
    const template = slot.states[state];
    if (!template) {
      throw new Error(`Слот "${slot.id}" не знает состояния "${state}"`);
    }
    const text = template.split(LOCALISATION_TOKEN).join(site);
    const last = groups[groups.length - 1];
    if (last && last.group === slot.group) last.parts.push(text);
    else groups.push({ group: slot.group, parts: [text] });
  }
  return groups
    .map(({ parts }) => {
      const joined = parts.join(", ");
      return joined.charAt(0).toUpperCase() + joined.slice(1) + ".";
    })
    .join(" ");
}

/**
 * Which slot states a phenotype may legally claim, per slot.
 *
 * A phenotype naming a state that is not here fails a test rather than printing
 * something nobody wrote.
 */
export function statesFor(slotId) {
  const slot = SLOT_BY_ID.get(slotId);
  return slot ? Object.keys(slot.states) : [];
}

/**
 * Review status of the slot layer.
 *
 * The PROSE is the owner's own, written 09.08.2026 - `owner_authored`.
 *
 * The per-phenotype STATE ASSIGNMENTS are a different question and are tracked
 * on each phenotype card. Where a card leaves a slot UNSPECIFIED, nothing is
 * printed: a plausible negative is still an unreviewed clinical claim, and this
 * project does not ship those.
 */
export const SLOT_REVIEW_STATUS = Object.freeze({
  prose: "owner_authored_20260809",
  state_assignment: "per_phenotype_see_examination_slots",
  eligible_for_scoring: false,
});

// "Хорошо, а чем и как?" — the question the team asks before an order is carried out.
//
// WHY THIS LAYER EXISTS
//
// Replay b9d7a831 (19.08.2026): the learner wrote «обезболю пациента» and the
// patient was medicated — no agent, no dose, no route, nothing recorded. She
// wrote «покапаю пока, посмотрю на динамике» and the observation half ran with
// no monitored parameter and no exit criterion. A named intention is not an
// order. In a real department a nurse asks the rest of it before anything
// reaches the patient, and that question is the teaching.
//
// The mechanism already existed but only for one action: turnPlanner hardcoded
// `needsOperationalization` to the operative approach. This file makes it a
// table any action joins by adding a row.
//
// WHAT THIS LAYER IS NOT
//
// It transcribes, it does not validate. Asking "чем" is not teaching which drug;
// recording "кеторолак 30 мг в/в" is not approving it. No slot carries a range,
// a correct answer, or a weight. Whether a transcribed order may be applied to
// the patient stays with parameterSafety.js and the governance policy — this
// layer only decides whether the order is *stated completely enough to be an
// order at all*.
//
// Because slot prompts are learner-facing clinical text, the registry is
// learner-facing: see OPERATIONALIZATION_REVIEW_SOURCE for what was reviewed.

/** Reusable slot vocabulary. A slot is a question fragment plus a recogniser. */
export const ORDER_SLOT = Object.freeze({
  AGENT: "agent",
  DOSE: "dose",
  ROUTE: "route",
  SOLUTION: "solution",
  VOLUME: "volume",
  RATE: "rate",
  TIMING: "timing",
  MONITORED: "monitored",
  INTERVAL: "interval",
  ENDPOINT: "endpoint",
  DESTINATION: "destination",
  ESCORT: "escort",
  QUESTION: "question",
  CONTRAST: "contrast",
  APPROACH: "approach",
});

/**
 * Wording reviewed in Russian on 20.08.2026 (CDR-11, CDR-17): see
 * OPERATIONALIZATION_REVIEW_SOURCE. That review covers how these prompts read to
 * a resident and which slots may stop an order - nothing more. The Kazakh locale
 * is out of scope and stays disabled in the pilot.
 */
export const OPERATIONALIZATION_REVIEW_STATUS = "reviewed_ru_language_2026_08_20";
export const OPERATIONALIZATION_VERSION = "operationalization-v1.0";
/** The review this status refers to, so the string is never self-certifying. */
export const OPERATIONALIZATION_REVIEW_SOURCE = Object.freeze({
  document: "RU_LANGUAGE_REVIEW_CDR11_CDR17.md",
  scope: "learner-facing wording and which slots block execution (CDR-11, CDR-17)",
  reviewed_by: "Каукенова Б.Н., MD",
  reviewed_at: "2026-08-20",
  // Deliberately narrow: a language and product review, not a clinical approval.
  // Nothing in this file gained the right to teach, score or judge a value.
  grants: "learner_facing_wording_only",
});

const SLOT_DEFINITIONS = Object.freeze({
  [ORDER_SLOT.AGENT]: {
    fragment_ru: "чем именно",
    patterns: [
      /(кеторолак|кетопрофен|парацетамол|ибупрофен|метамизол|анальгин|трамадол|морфин|промедол|фентанил|нефопам|дротаверин|но-шпа|омнопон)/iu,
      /(цефазолин|цефуроксим|цефтриаксон|метронидазол|амоксициллин|ампициллин|сульбактам|клавулан|гентамицин|ципрофлоксацин|эртапенем)/iu,
      /(нпвс|опиоид|анальгетик|антибиотик|противорвотн[\wа-яё]*|ондансетрон|метоклопрамид|церукал)/iu,
    ],
    from_parameter: (entry) => entry?.drug_name || null,
  },
  [ORDER_SLOT.DOSE]: {
    fragment_ru: "в какой дозе",
    patterns: [
      /\d+(?:[.,]\d+)?\s*(?:мг|mg|г\b|мкг|ме\b|ед\b|единиц)/iu,
      /(?:из\s+расч[её]та\s+)?\d+(?:[.,]\d+)?\s*(?:мг|мл)\s*(?:\/|на)\s*кг/iu,
    ],
    from_parameter: (entry) =>
      entry?.dose_value !== null && entry?.dose_value !== undefined
        ? `${entry.dose_value}${entry.dose_unit ? ` ${entry.dose_unit}` : ""}`
        : null,
  },
  [ORDER_SLOT.ROUTE]: {
    fragment_ru: "каким путём",
    patterns: [
      /(в\/в|в\/м|в\/к|внутривенн[\wа-яё]*|внутримышечн[\wа-яё]*|подкожн[\wа-яё]*|ректальн[\wа-яё]*|перорал[\wа-яё]*|внутрь|через\s+рот|per\s*os|\biv\b|\bim\b)/iu,
    ],
    from_parameter: (entry) => entry?.route || null,
  },
  [ORDER_SLOT.SOLUTION]: {
    fragment_ru: "какой раствор",
    patterns: [
      /(na\s*cl|natrium\s*chlorid[\wа-яё]*|натри[яйю]\s*хлорид[\wа-яё]*|физ(?:\.|иологическ[\wа-яё]*)?\s*раствор|физраствор|0[.,]9\s*%)/iu,
      /(рингер[\wа-яё]*|ringer|лактат[\wа-яё]*|стерофундин|sterofundin|плазмалит|plasmalyte|ацесоль|дисоль|трисоль)/iu,
      /(глюкоз[\wа-яё]*|декстроз[\wа-яё]*|5\s*%\s*глюкоз[\wа-яё]*)/iu,
      /(кристаллоид[\wа-яё]*|коллоид[\wа-яё]*|солевой\s+раствор)/iu,
    ],
    from_parameter: (entry) => entry?.fluid_type || null,
  },
  [ORDER_SLOT.VOLUME]: {
    fragment_ru: "какой объём",
    patterns: [
      /\d+(?:[.,]\d+)?\s*(?:мл|ml|литр[\wа-яё]*|л(?![а-яё]))/iu,
      /(?:из\s+расч[её]та\s+)?\d+(?:[.,]\d+)?\s*мл\s*(?:\/|на)\s*кг/iu,
    ],
    from_parameter: (entry) =>
      entry?.volume_ml !== null && entry?.volume_ml !== undefined
        ? `${entry.volume_ml} мл`
        : null,
  },
  [ORDER_SLOT.RATE]: {
    fragment_ru: "с какой скоростью",
    patterns: [
      /(open\s*wide|стру[её]н[\wа-яё]*|болюс[\wа-яё]*|быстро|самот[её]ком|под\s+давлением)/iu,
      /\d+\s*(?:мл\s*\/\s*ч|мл\s+в\s+час|кап[\wа-яё]*\s*(?:\/|в)\s*мин)/iu,
      /(?:за|в\s+течение|потом)\s+\d+\s*(?:мин[\wа-яё]*|час[\wа-яё]*)/iu,
    ],
    from_parameter: (entry) => entry?.rate || null,
  },
  [ORDER_SLOT.TIMING]: {
    fragment_ru: "когда именно",
    patterns: [
      /(до\s+разрез[\wа-яё]*|перед\s+операци[\wа-яё]*|за\s+\d+\s*мин[\wа-яё]*\s+до|после\s+операци[\wа-яё]*|сейчас|немедленно|сразу|при\s+поступлени[\wа-яё]*)/iu,
      /(натощак|с\s+этого\s+момента|с\s+момента)/iu,
    ],
    from_parameter: (entry) => entry?.timing || null,
  },
  [ORDER_SLOT.MONITORED]: {
    fragment_ru: "что контролируешь",
    patterns: [
      /(чсс|пульс|(?<![а-яё])ад(?![а-яё])|давлени[\wа-яё]*|температур[\wа-яё]*|\bчд\b|сатураци[\wа-яё]*|диурез|мочеотделени[\wа-яё]*)/iu,
      /(бол[ьи][\wа-яё]*|живот[\wа-яё]*|перитонеальн[\wа-яё]*|щ[её]ткин[\wа-яё]*|напряжени[\wа-яё]*|симптоматик[\wа-яё]*)/iu,
      /(лейкоцит[\wа-яё]*|оак(?![а-яё])|срб|crp|анализ[\wа-яё]*\s+в\s+динамике)/iu,
    ],
    from_parameter: () => null,
  },
  [ORDER_SLOT.INTERVAL]: {
    fragment_ru: "как часто",
    patterns: [
      /(кажд[\wа-яё]*\s+(?:\d+\s*)?(?:час|мин|полчас)[\wа-яё]*|через\s+(?:\d+\s*)?(?:час|мин)[\wа-яё]*|\d+\s*раз[\wа-яё]*\s+в\s+(?:час|сутки|день)|почасов[\wа-яё]*|ежечасн[\wа-яё]*|в\s+динамике\s+через)/iu,
    ],
    from_parameter: () => null,
  },
  [ORDER_SLOT.ENDPOINT]: {
    fragment_ru: "при каких изменениях звать вас",
    patterns: [
      /(если\s+[а-яё]+|при\s+(?:нарастани[\wа-яё]*|ухудшени[\wа-яё]*|появлени[\wа-яё]*|сохранени[\wа-яё]*|отсутстви[\wа-яё]*)|тогда\s+[а-яё]+|то\s+(?:вызываю|беру|оперирую|перевожу))/iu,
      /(критери[\wа-яё]*\s+(?:выхода|пересмотра)|триггер|триггер[\wа-яё]*|порог[\wа-яё]*)/iu,
      /(эскалац|позвать|звать|вызвать|немедленно\s+сообщ)/iu,
      /(при\s+(?:гипотони|тахикард|лихорад|олигур|кровотеч|нарушени[\wа-яё]*\s+сознани)|с[аa]д\s*(?:ниже|<)|чсс\s*(?:выше|>)|сатураци[яи]\s*(?:ниже|<)|бол[ьи]\s*\d+\s*\/\s*10)/iu,
    ],
    from_parameter: () => null,
  },
  [ORDER_SLOT.DESTINATION]: {
    fragment_ru: "куда именно",
    patterns: [
      /(в\s+(?:орит|реанимаци[\wа-яё]*|операционн[\wа-яё]*|палат[\wа-яё]*|хирургическ[\wа-яё]*\s+отделени[\wа-яё]*|стационар|областн[\wа-яё]*|республиканск[\wа-яё]*|центр[\wа-яё]*))/iu,
    ],
    from_parameter: () => null,
  },
  [ORDER_SLOT.ESCORT]: {
    fragment_ru: "кто сопровождает",
    patterns: [/(сопровожд[\wа-яё]*|с\s+врач[\wа-яё]*|с\s+фельдшер[\wа-яё]*|бригад[\wа-яё]*|реанимобил[\wа-яё]*)/iu],
    from_parameter: () => null,
  },
  [ORDER_SLOT.QUESTION]: {
    fragment_ru: "с каким вопросом",
    patterns: [
      /(вопрос[\wа-яё]*|уточнить|исключить|подтвердить|оценить|нужн[\wа-яё]*\s+ли|показан[\wа-яё]*\s+ли|для\s+решени[\wа-яё]*)/iu,
    ],
    from_parameter: () => null,
  },
  [ORDER_SLOT.CONTRAST]: {
    fragment_ru: "с контрастом или без",
    patterns: [/(с\s+контраст[\wа-яё]*|без\s+контраст[\wа-яё]*|нативн[\wа-яё]*|внутривенн[\wа-яё]*\s+контраст[\wа-яё]*)/iu],
    from_parameter: () => null,
  },
  [ORDER_SLOT.APPROACH]: {
    fragment_ru: "каким доступом",
    patterns: [/(лапароскопическ[\wа-яё]*|лапароскопи[\wа-яё]*|открыт[\wа-яё]*|лапаротом[\wа-яё]*|конверси[\wа-яё]*)/iu],
    from_parameter: () => null,
  },
});

/**
 * Which actions must be operationalized before they are carried out.
 *
 * `required` — the order is not an order until these are stated.
 * `recorded`  — transcribed verbatim when named, never demanded. Kept separate
 *               so that asking never turns into teaching a molecule or a dose
 *               the pilot has no approved rule for (CDR-07, P0.4).
 */
export const OPERATIONALIZATION_CONTRACTS = Object.freeze([
  {
    action_id: "analgesia",
    label_ru: "обезболивание",
    asker_ru: "Медсестра ожидает назначения.",
    // The dose is required as of 20.08.2026, by owner decision and against the
    // language review's own recommendation, which had accepted "agent + route"
    // for pilot 1.
    //
    // ASKING IS NOT TEACHING. This layer transcribes; it does not check. Once
    // the resident names a number the order is closed whatever the number is:
    // nothing here compares it to a rule, corrects it, or scores it, and no
    // approved analgesic rule exists in the pilot for it to be compared against
    // (owner decision 3). If parameterSafety has no reviewed rule for the drug
    // it records the parameter, withholds it from the patient and says so once
    // - which is a statement about the pilot's coverage, not about the number.
    required: [ORDER_SLOT.AGENT, ORDER_SLOT.DOSE, ORDER_SLOT.ROUTE],
    recorded: [ORDER_SLOT.TIMING],
  },
  {
    action_id: "iv_fluids",
    label_ru: "инфузия",
    asker_ru: "Медсестра ожидает назначения.",
    required: [ORDER_SLOT.SOLUTION, ORDER_SLOT.VOLUME, ORDER_SLOT.RATE],
    recorded: [ORDER_SLOT.TIMING],
  },
  {
    action_id: "active_observation",
    label_ru: "активное наблюдение",
    asker_ru: "Палатная сестра уточняет",
    // Two slots, not three (CDR-17, 20.08.2026). "What am I watching" plus "when
    // do you call me" IS the content of observation; a resident who names both
    // has thought it through, and the frequency is then a detail worth recording
    // rather than demanding. Three demands in one breath read as an
    // interrogation, and observation is exactly where session TS-01 stalled.
    required: [ORDER_SLOT.MONITORED, ORDER_SLOT.ENDPOINT],
    recorded: [ORDER_SLOT.INTERVAL],
  },
  {
    action_id: "serial_reexamination",
    label_ru: "повторный осмотр",
    asker_ru: "Палатная сестра уточняет",
    required: [ORDER_SLOT.MONITORED, ORDER_SLOT.INTERVAL],
    recorded: [ORDER_SLOT.ENDPOINT],
  },
  {
    action_id: "npo",
    label_ru: "голод",
    asker_ru: "Палатная сестра уточняет",
    required: [],
    recorded: [],
  },
  {
    action_id: "preop_single_antibiotic_prophylaxis",
    label_ru: "антибиотикопрофилактика",
    asker_ru: "Медсестра ожидает назначения.",
    // Transcription only. "Одна доза до разреза" is already taught by the
    // approved rules and gated as a prerequisite before the incision; demanding
    // the agent or the dose here would teach a molecule the pilot has not
    // approved (P0.4, CDR-07).
    required: [],
    recorded: [ORDER_SLOT.AGENT, ORDER_SLOT.DOSE, ORDER_SLOT.ROUTE, ORDER_SLOT.TIMING],
  },
  {
    action_id: "antibiotic_observation_course",
    label_ru: "курс антибиотика",
    asker_ru: "Медсестра ожидает назначения.",
    required: [],
    recorded: [ORDER_SLOT.AGENT, ORDER_SLOT.DOSE, ORDER_SLOT.ROUTE, ORDER_SLOT.INTERVAL],
  },
  {
    action_id: "surgical_consult",
    label_ru: "консультация хирурга",
    asker_ru: "Ответственный хирург берёт трубку",
    required: [],
    recorded: [ORDER_SLOT.TIMING],
  },
  {
    action_id: "gynecology_consult",
    label_ru: "консультация гинеколога",
    asker_ru: "Гинеколог берёт трубку",
    required: [],
    recorded: [ORDER_SLOT.TIMING],
  },
  {
    action_id: "ct_abdomen",
    label_ru: "КТ брюшной полости",
    // Transcription only: an unpurposed test is deliberately allowed to run and
    // is named in the debrief instead (contract 9). Gating it here would be a
    // second, contradictory rule.
    asker_ru: "Рентген-лаборант уточняет",
    required: [],
    recorded: [ORDER_SLOT.CONTRAST],
  },
  {
    action_id: "transfer_before_source_control",
    label_ru: "перевод",
    asker_ru: "Принимающий стационар уточняет",
    required: [ORDER_SLOT.DESTINATION, ORDER_SLOT.ESCORT],
    recorded: [ORDER_SLOT.TIMING],
  },
  {
    action_id: "discharge_and_followup",
    label_ru: "выписка и наблюдение",
    asker_ru: "Пациентка спрашивает перед уходом",
    required: [],
    recorded: [ORDER_SLOT.AGENT],
  },
  {
    action_id: "call_intensive_care",
    label_ru: "вызов реаниматолога",
    asker_ru: "Реаниматолог берёт трубку",
    required: [],
    recorded: [ORDER_SLOT.TIMING],
  },
  {
    action_id: "call_senior_surgeon",
    label_ru: "вызов старшего хирурга",
    asker_ru: "Старший хирург берёт трубку",
    required: [],
    recorded: [ORDER_SLOT.TIMING],
  },
].map((contract) =>
  Object.freeze({
    recorded: [],
    // Nothing here scores. Repeated per row so a copied row keeps the property.
    eligible_for_scoring: false,
    review_status: OPERATIONALIZATION_REVIEW_STATUS,
    ...contract,
  })
));

export const operationalizationById = new Map(
  OPERATIONALIZATION_CONTRACTS.map((contract) => [contract.action_id, contract])
);

/** Learner-facing name of an order, for the lines that report it back. */
export function orderLabel(actionId) {
  return operationalizationById.get(actionId)?.label_ru || actionId;
}

export function operationalizationFor(actionId) {
  return operationalizationById.get(actionId) || null;
}

function slotPresentInText(slot, text) {
  const definition = SLOT_DEFINITIONS[slot];
  if (!definition) return null;
  for (const pattern of definition.patterns) {
    const match = String(text || "").match(pattern);
    if (match) return match[0].trim();
  }
  return null;
}

function slotFromParameters(slot, parameters, actionId) {
  const definition = SLOT_DEFINITIONS[slot];
  if (!definition?.from_parameter) return null;
  for (const entry of parameters || []) {
    if (entry?.concept_id && entry.concept_id !== actionId) continue;
    const value = definition.from_parameter(entry);
    if (value) return String(value);
  }
  return null;
}

/**
 * Which slots this turn's text fills for one action, merged with what earlier
 * turns already filled.
 *
 * The merge is what stops the loop in replay b9d7a831: a learner who answers
 * across two messages has answered, and must not be asked the same thing again.
 */
export function readOrderSlots({
  actionId,
  text = "",
  parameters = [],
  previouslyFilled = {},
}) {
  const contract = operationalizationFor(actionId);
  if (!contract) return null;

  const filled = { ...previouslyFilled };
  for (const slot of [...contract.required, ...contract.recorded]) {
    if (filled[slot]) continue;
    const value = slotFromParameters(slot, parameters, actionId) || slotPresentInText(slot, text);
    if (value) filled[slot] = value;
  }

  const missing = contract.required.filter((slot) => !filled[slot]);
  return {
    action_id: actionId,
    filled,
    missing,
    complete: missing.length === 0,
    review_status: OPERATIONALIZATION_REVIEW_STATUS,
    eligible_for_scoring: false,
  };
}

function joinFragments(fragments) {
  if (fragments.length <= 1) return fragments.join("");
  return `${fragments.slice(0, -1).join(", ")} и ${fragments[fragments.length - 1]}`;
}

function capitalize(text) {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/**
 * One question for the whole turn, even when two orders are incomplete.
 *
 * Replay b9d7a831 turn 4 held two half-orders — an infusion and an observation —
 * and the mentor asked about one, deferring the other to the debrief the learner
 * never reached. A supervisor asks about both in one breath.
 */
export function operationalizationQuestion(states = []) {
  const incomplete = states.filter((state) => state && !state.complete && state.missing.length);
  if (!incomplete.length) return "";

  const parts = incomplete.map((state) => {
    const contract = operationalizationFor(state.action_id);
    const fragments = state.missing
      .map((slot) => SLOT_DEFINITIONS[slot]?.fragment_ru)
      .filter(Boolean);
    const asker = /[.!?]$/u.test(contract.asker_ru)
      ? contract.asker_ru
      : `${contract.asker_ru}.`;
    return `${asker} ${capitalize(joinFragments(fragments))}?`;
  });

  return parts.join(" ");
}

/** Verbatim record of what was ordered. Transcription only: nothing is judged. */
export function orderRecord(state, verbatim) {
  if (!state) return null;
  return {
    action_id: state.action_id,
    slots: state.filled,
    verbatim: verbatim || null,
    complete: state.complete,
    review_status: OPERATIONALIZATION_REVIEW_STATUS,
    parameters_validated: false,
    eligible_for_scoring: false,
    operationalization_version: OPERATIONALIZATION_VERSION,
  };
}

const REPAIR_RE =
  /(я\s+же\s+(?:написал|сказал|говорил)\w*|уже\s+(?:написал|сказал|ответил)\w*|повторяю|выше\s+написал\w*|только\s+что\s+сказал\w*)/iu;

/**
 * "я же написала!" is a repair move, not an unparsed action.
 *
 * Answering it with "Не распознано" is what ended replay b9d7a831. The caller
 * uses this to replay what was recorded instead of asking again.
 */
export function isRepairMove(text) {
  return REPAIR_RE.test(String(text || ""));
}

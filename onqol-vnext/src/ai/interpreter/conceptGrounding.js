import { COMMAND } from "../../core/commands/commandTypes.js";
import {
  CHEMISTRY_ANALYTE_SYNONYMS,
  DISPOSITION_SYNONYMS,
  DRUG_SYNONYMS,
  FLUID_SYNONYMS,
  IMAGING_CATEGORY_TERMS,
  IMAGING_MODALITY_TERMS,
  MONITORING_TARGETS,
  REGION_SYNONYMS,
  STAFF_SYNONYMS,
  TEST_SYNONYMS,
} from "./vocabulary.js";
import { containsAny, containsNearToken, containsWholePhrase, normalizeText } from "./textMatch.js";

/** Does the text name an imaging modality (UZI, CT, X-ray, MRI)? One definition for the deterministic pass and candidate validation. */
export function mentionsImagingModality(text) {
  const normalized = normalizeText(text);
  return IMAGING_MODALITY_TERMS.some((term) => containsWholePhrase(normalized, term));
}

/** Does the text ask for imaging in general («визуализация», «снимок») without a modality? */
export function mentionsImagingCategory(text) {
  const normalized = normalizeText(text);
  return IMAGING_CATEGORY_TERMS.some((term) => containsWholePhrase(normalized, term));
}

/**
 * Data-driven concept metadata for semantic-language matching.
 *
 * Nothing in here is control flow. `groundConcept` below is one generic
 * function over these tables, so widening coverage means editing DATA, never
 * adding a per-concept branch to modelConceptValidation.js. The tables hold
 * generic clinical-workflow language; no disease-specific term belongs here.
 *
 * Grounding is EVIDENCE about the learner's words, not proof of what the model
 * understood. Whether a missing lexical match blocks a candidate is a policy
 * decision made per concept kind (GROUNDING_MODE) and per command class
 * (promotionPolicy.js), not here.
 */

// Summoning language shared by the deterministic pass and candidate validation (a role noun alone is not a request).
export const STAFF_REQUEST_CUES = /позов|позва|вызов|вызыва|оповест|уведом|пригласи|приглаш|позвон|консультаци|консультир|(?:^|\s)зову|(?:^|\s)зовем|(?:^|\s)зови|нужен |нужна |нужны |сюда|подключ|к пациент|на осмотр|подтянит/;

export const TOPIC_ANCHORS = Object.freeze({
  pain: ["боль", "болит", "ауыру", "pain"],
  onset: ["когда нач", "начал", "бастал", "onset", "start"],
  nausea_vomiting: ["тошнот", "рвот", "құсу", "nause", "vomit"],
  urinary: ["моч", "дизур", "зәр", "urin"],
  gynecologic: ["месячн", "менстру", "берем", "гинек", "pregnan"],
  allergies: ["аллерг", "allerg"],
  medications: ["приним", "лекар", "препарат", "medication"],
  // «ел» / «пил» as bare substrings sat inside «посмотрел», «опросил»: whole phrases only.
  fasting: ["когда ел", "когда пил", "последний раз ел", "последний раз пил", "что ел", "что пил", "прием пищи", "приём пищи", "натощак", "fasting"],
});

/**
 * Stems showing that the KIND of action is evident in the learner's words. A
 * candidate whose kind is not evident is never turned into a clarification: the
 * learner is not asked a question about something they did not say.
 */
export const TYPE_ANCHORS = Object.freeze({
  [COMMAND.TAKE_HISTORY]: ["опрос", "расспрос", "расспрош", "анамнез", "жалоб", "истори", "сұра", "жина"],
  [COMMAND.EXAMINE]: ["осмотр", "осматр", "пальп", "пощуп", "қара", "смотр"],
  [COMMAND.REQUEST_STATUS]: ["что с пациент", "как пациент", "текущее состояние", "витальн", "состояние пациент", "что с ним", "что с ней", "как он", "как она"],
  [COMMAND.WAIT]: ["жду", "подожд", "дожд", "ожида", "wait"],
  [COMMAND.ORDER_TEST]: [
    "анализ", "оак", "бхак", "срб", "оам", "хгч", "узи", "кт", "кров", "мочу", "исследов", "обследов",
    "проверь", "проверить", "провер", "глян", "посмотр", "сдать", "возьм", "нужен", "нужна", "нужно", "закаж", "назнач",
    "ультразвук", "сонограф", "томограф", "рентген",
    // Imaging in general is an investigation request too (the single definition in vocabulary.js).
    ...IMAGING_CATEGORY_TERMS,
  ],
  [COMMAND.ORDER_MEDICATION]: ["назнач", "ввести", "дать", "обезбол"],
  [COMMAND.ORDER_INFUSION]: ["инфуз", "прокап", "раствор", "физраствор", "кристаллоид"],
  [COMMAND.STOP_INFUSION]: ["останов", "прекращ", "прекрат", "стоп", "хватит", "не буду больше"],
  [COMMAND.ORDER_PROCEDURE]: ["процедур", "установ", "постав"],
  [COMMAND.PRESCRIBE_MONITORING]: ["монитор", "каждые", "контрол"],
  [COMMAND.REASSESS]: ["переоцен", "повторн"],
  [COMMAND.CALL_STAFF]: ["вызов", "вызвать", "позов", "консультац"],
  [COMMAND.SET_NPO]: ["npo", "нпо", "голод", "ничего не есть", "не корм", "ничего внутрь", "ничего не давать", "нулевой стол", "не пить"],
  [COMMAND.ASK_FASTING_HISTORY]: ["когда ел", "когда пил", "прием пищи", "приём пищи"],
  [COMMAND.ESTABLISH_IV_ACCESS]: ["вен", "в/в доступ", "катетер", "доступ", "капельниц"],
  [COMMAND.REQUEST_ANESTHESIA_REVIEW]: ["анестезиолог"],
  [COMMAND.GIVE_ANTIBIOTIC_PROPHYLAXIS]: ["антибиотикопрофилактик", "профилактик"],
  [COMMAND.COMMIT_MANAGEMENT_PLAN]: ["операц", "оперир", "наблюден"],
  [COMMAND.DISPOSITION]: ["отделение", "палату", "орит", "реанимац", "домой"],
  [COMMAND.TRANSFER]: ["перевод", "перевож", "перевести", "транспортир"],
});

/**
 * Extra ways of NAMING a concept, on top of the reviewed vocabulary.
 * They cover naming, never category words ("воспаление", "визуализация"),
 * which are genuinely ambiguous and must stay a clarification.
 */
const EXTRA_ALIASES = Object.freeze({
  test: {
    cbc: ["общий анализ крови", "general blood count", "клеточный состав крови", "гемограмм"],
    crp: ["c-reactive", "c reactive", "реактивный белок", "реактивного белка"],
    urinalysis: ["анализ мочи", "моча", "мочу", "мочи"],
    betahcg: ["бета хгч", "beta hcg"],
    lactate: ["лактат"],
    abg: ["кщс", "газы крови", "кислотно"],
    troponin: ["тропонин"],
  },
  region: {
    general: ["пациент", "целиком", "общий осмотр", "полный осмотр", "физикалық", "қарап", "жалпы"],
    cardiorespiratory: ["сердц", "легк", "дых", "аускульт"],
    extremities: ["конечност", "рук", "ног"],
  },
  role: { surgeon: ["хирург"], anesthesiologist: ["анестезиолог"], gynecologist: ["гинеколог"] },
  destination: {
    observation: ["наблюден"],
    surgical_ward: ["хирургическое отделение", "отделение", "палату"],
    icu: ["орит", "реанимац"],
    other_facility: ["другой стационар", "другую больницу"],
    home: ["домой", "выпис"],
  },
});

const FIXED_ANCHORS = Object.freeze({
  fluid: ["физраствор", "раствор", "кристаллоид", "инфуз"],
});

/**
 * Imaging is named by modality + region in any word order ("брюшную полость
 * ультразвуком"), so it grounds through a composite rule rather than one alias.
 */
const COMPOSITE_GROUNDING = Object.freeze({
  test: {
    ultrasound_abdomen: { modality: ["ультразвук", "сонограф", "узи"], region: ["живот", "брюшн", "обп"] },
    ct_abdomen: { modality: ["томограф", "компьютерн", "мскт"], region: ["живот", "брюшн", "обп"] },
    // Recognised but not modeled (concepts.yaml#recognized_unmodeled_tests). Named,
    // so it is reported as a simulator limitation instead of being read as the
    // abdominal study it is not.
    pelvic_ultrasound: { modality: ["ультразвук", "сонограф", "узи"], region: ["таз", "омт", "трансвагин"] },
  },
});

/** A qualifier that contradicts the chosen concept: "малого таза" is never the abdominal study. */
const EXCLUSIONS = Object.freeze({
  test: { ultrasound_abdomen: ["таз", "омт"], ct_abdomen: ["омт", "огк", "таз", "грудн", "голов"], lactate: ["рингер", "хартман"] },
});
/**
 * Concepts whose exclusion leaves NO modeled alternative: «КТ ОМТ» is a pelvic CT, which the registry does not model
 * (unlike pelvic ULTRASOUND, which has its own recognised id). There is nothing to ask the learner to choose between,
 * so the candidate is rejected and the fragment stays unresolved.
 */
export const EXCLUSION_HAS_NO_ALTERNATIVE = Object.freeze(new Set(["ct_abdomen"]));

/** Studies that exist in ordinary clinical language but have no modeled result in the registry. */
const UNMODELED_STUDY_TERMS = Object.freeze(["рентген", "рентгенограф", "мрт", "магнитно-резонанс", "пэт", "эхокг", "эхокардиограф", "экг", "электрокардиограф", "флюорограф", "маммограф", "ангиограф", "эндоскоп", "колоноскоп", "фгдс", "гастроскоп"]);
const containsWholePhraseAny = (evidence, terms) => terms.some((term) => containsWholePhrase(evidence, term));

/** Words that name a CATEGORY of concepts, so no single concept is evidenced. */
const CATEGORY_TERMS = Object.freeze({
  test: ["воспал", "инфекц", "маркер", "визуализ", "лаборатор", "обследован", "диагностик", "все анализ", "все исследован", "все что есть", "всё что есть", "полный набор"],
});

/**
 * How a missing lexical match is treated for a concept kind when the command
 * class is promoted: "semantic" accepts an allowlisted choice with verbatim
 * evidence (unless a category term or an exclusion applies); "strict" always
 * needs an alias in the learner's words. Identity of drugs, fluids,
 * procedures, destinations and staff is never left to the model's judgement.
 */
export const GROUNDING_MODE = Object.freeze({
  test: "semantic", region: "semantic", topic: "semantic",
  drug: "strict", fluid: "strict", procedure: "strict", role: "strict", destination: "strict",
  intent: "strict", approach: "strict", choice: "strict", type: "strict",
});

const CONCEPT_PARAMS = Object.freeze([
  ["testId", "test"], ["drugId", "drug"], ["fluidId", "fluid"], ["region", "region"], ["topic", "topic"],
  ["role", "role"], ["destination", "destination"], ["to", "destination"],
]);

export const CONCEPT_PARAM_KEYS = Object.freeze([
  "testId", "drugId", "fluidId", "procedureId", "region", "role", "destination", "to", "intent", "approach", "choice", "topic",
]);

/** Which concept an action item is about, as { kind, id, paramKey }. */
export function describeConcept(item) {
  const params = item.params ?? {};
  for (const [key, kind] of CONCEPT_PARAMS) if (params[key]) return { kind, id: params[key], paramKey: key };
  if (params.intent === "operative" || params.intent === "observation") return { kind: "intent", id: params.intent, paramKey: "intent" };
  if (params.approach) return { kind: "approach", id: params.approach, paramKey: "approach" };
  if (params.choice) return { kind: "choice", id: params.choice, paramKey: "choice" };
  if (params.procedureId) return { kind: "procedure", id: params.procedureId, paramKey: "procedureId" };
  return { kind: "type", id: item.type, paramKey: null };
}

export function conceptAnchors(item) {
  const { kind, id } = describeConcept(item);
  switch (kind) {
    case "test": return [...aliasesFor(TEST_SYNONYMS, id), ...(EXTRA_ALIASES.test[id] ?? [])];
    case "drug": return aliasesFor(DRUG_SYNONYMS, id);
    case "fluid": return [...aliasesFor(FLUID_SYNONYMS, id), ...FIXED_ANCHORS.fluid];
    case "region": return [...aliasesFor(REGION_SYNONYMS, id), ...(EXTRA_ALIASES.region[id] ?? [])];
    case "topic": return TOPIC_ANCHORS[id] ?? [];
    case "role": return [...aliasesFor(STAFF_SYNONYMS, id), ...(EXTRA_ALIASES.role[id] ?? [])];
    case "destination": return [...aliasesFor(DISPOSITION_SYNONYMS, id), ...(EXTRA_ALIASES.destination[id] ?? [])];
    case "intent": return id === "operative" ? ["операц", "оперир"] : ["наблюден", "наблюда"];
    case "approach": return [id, "лапар", "открыт"];
    case "choice": return [id];
    case "procedure": return [id];
    default: return TYPE_ANCHORS[item.type] ?? [];
  }
}

/**
 * Grounding of an action's concept in the learner's evidence text:
 *   lexical    an alias for the chosen concept is present
 *   composite  modality + region are both present (imaging)
 *   excluded   a qualifier contradicts the chosen concept
 *   category   only category language is present, no single concept is named
 *   unmatched  nothing in the words supports the choice
 *   contradicted  the words name a DIFFERENT concept of the same kind (or a
 *                 different imaging modality) and never the chosen one
 * `evidence` must already be normalized (normalizeText).
 */
export function groundConcept(item, evidence) {
  const concept = describeConcept(item);
  const anchors = conceptAnchors(item);
  const excluded = containsAny(evidence, EXCLUSIONS[concept.kind]?.[concept.id] ?? []);
  if (!excluded && anchors.length > 0 && containsAny(evidence, anchors)) return { ...concept, status: "lexical" };
  const composite = COMPOSITE_GROUNDING[concept.kind]?.[concept.id];
  if (!excluded && composite && containsAny(evidence, composite.modality) && containsAny(evidence, composite.region)) {
    return { ...concept, status: "composite" };
  }
  if (excluded) return { ...concept, status: "excluded" };
  if (namesAnotherConcept(concept, evidence)) return { ...concept, status: "contradicted" };
  if (containsAny(evidence, CATEGORY_TERMS[concept.kind] ?? [])) return { ...concept, status: "category" };
  return { ...concept, status: "unmatched" };
}

/**
 * Does the evidence name another concept of the same kind, or another imaging
 * modality, while not naming the chosen one? Only the kinds whose grounding is
 * relaxed need this: it stops the model from choosing "ultrasound" for words
 * that literally say "общий анализ крови". Short aliases match as whole words.
 */
function namesAnotherConcept({ kind, id }, evidence) {
  // A study the registry does not model (X-ray, MRI, ECG, echo, PET ...) named in the evidence is never the
  // modeled study the model chose instead: «рентген ОГК» is not a CT. Own-modality words are checked first, so
  // «КТ вместо рентгена» style wording is left to the ordinary rules.
  if (kind === "test" && containsWholePhraseAny(evidence, UNMODELED_STUDY_TERMS)) {
    const own = COMPOSITE_GROUNDING.test[id]?.modality ?? [];
    if (!containsAny(evidence, own)) return true;
  }
  const index = aliasIndex(kind);
  if (index) {
    for (const [otherId, aliases] of Object.entries(index)) {
      if (otherId !== id && aliases.some((alias) => containsWholePhrase(evidence, alias))) return true;
    }
  }
  const rules = COMPOSITE_GROUNDING[kind];
  if (rules && rules[id]) {
    const ownModality = containsAny(evidence, rules[id].modality);
    return !ownModality && Object.entries(rules).some(([otherId, rule]) => otherId !== id && containsAny(evidence, rule.modality));
  }
  return false;
}

function aliasIndex(kind) {
  if (kind === "test") return indexOf(TEST_SYNONYMS, EXTRA_ALIASES.test);
  if (kind === "region") return indexOf(REGION_SYNONYMS, EXTRA_ALIASES.region);
  // Topics are deliberately absent: they overlap in ordinary speech ("аллергия на
  // лекарства" is about allergies AND medications), so naming a neighbour proves nothing.
  return null;
}

function indexOf(dictionary, extra) {
  const ids = new Set([...Object.values(dictionary), ...Object.keys(extra)]);
  return Object.fromEntries([...ids].map((id) => [id, [...aliasesFor(dictionary, id), ...(extra[id] ?? [])]]));
}

export function typeEvident(type, evidence) {
  const anchors = TYPE_ANCHORS[type] ?? [];
  return containsAny(evidence, anchors) || containsNearToken(evidence, anchors);
}

export function analyteAliases(id) { return aliasesFor(CHEMISTRY_ANALYTE_SYNONYMS, id); }
export function targetAliases(id) { return aliasesFor(MONITORING_TARGETS, id); }

function aliasesFor(dictionary, id) {
  return [...new Set([
    ...Object.entries(dictionary).filter(([, value]) => value === id).map(([key]) => normalizeText(key)),
    normalizeText(id),
    normalizeText(String(id).replaceAll("_", " ")),
  ])];
}

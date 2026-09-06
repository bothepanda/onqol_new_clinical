import { COMMAND } from "../../core/commands/commandTypes.js";
import { DIFFERENTIAL_STATUSES } from "../../core/reasoning/reasoningState.js";
import {
  CHEMISTRY_ANALYTE_SYNONYMS,
  DISPOSITION_SYNONYMS,
  DRUG_SYNONYMS,
  MONITORING_TARGETS,
  REGION_SYNONYMS,
  STAFF_SYNONYMS,
  TEST_SYNONYMS,
} from "./vocabulary.js";

const NON_MODEL_ACTION_TYPES = new Set([COMMAND.STATE_REASONING, COMMAND.ANSWER_MENTOR]);

const PARAMETER_SCHEMAS = Object.freeze({
  [COMMAND.TAKE_HISTORY]: [], [COMMAND.REQUEST_STATUS]: [], [COMMAND.REPEAT_LAST]: [],
  [COMMAND.END_CASE]: [], [COMMAND.SET_NPO]: [], [COMMAND.ASK_FASTING_HISTORY]: [],
  [COMMAND.ESTABLISH_IV_ACCESS]: [], [COMMAND.REQUEST_ANESTHESIA_REVIEW]: [],
  [COMMAND.OBTAIN_CONSENT]: [], [COMMAND.DISCHARGE]: [],
  [COMMAND.ASK_PATIENT]: ["topic"], [COMMAND.EXAMINE]: ["region"],
  [COMMAND.WAIT]: ["afterMinutes", "untilNextPending"],
  [COMMAND.ORDER_TEST]: ["testId", "analytes"],
  [COMMAND.ORDER_MEDICATION]: ["drugId", "dose", "doseMg", "route"],
  [COMMAND.ORDER_INFUSION]: ["fluidId", "volumeMl", "durationMinutes", "bolus"],
  [COMMAND.ORDER_PROCEDURE]: ["procedureId"],
  [COMMAND.PRESCRIBE_MONITORING]: ["targets", "intervalMinutes"],
  [COMMAND.ORDER_ORAL_INTAKE]: ["level"], [COMMAND.REASSESS]: ["targets", "afterMinutes"],
  [COMMAND.CALL_STAFF]: ["role"], [COMMAND.COMMIT_MANAGEMENT_PLAN]: ["intent"],
  [COMMAND.GIVE_ANTIBIOTIC_PROPHYLAXIS]: ["drugId", "dose", "doseMg", "route"],
  [COMMAND.MOVE_PATIENT]: ["to"], [COMMAND.START_PROCEDURE]: ["approach"],
  [COMMAND.OPERATIVE_DECISION]: ["decisionId", "choice"],
  [COMMAND.DISPOSITION]: ["destination"], [COMMAND.TRANSFER]: ["destination"],
});

const HIGH_RISK_ACTIONS = new Set([
  COMMAND.ORDER_PROCEDURE,
  COMMAND.START_PROCEDURE,
  COMMAND.OPERATIVE_DECISION,
  COMMAND.COMMIT_MANAGEMENT_PLAN,
  COMMAND.DISPOSITION,
  COMMAND.TRANSFER,
  COMMAND.MOVE_PATIENT,
  COMMAND.DISCHARGE,
]);

const TENTATIVE_PATTERNS = [
  /возможн/i, /можно/i, /вероятн/i, /потенциальн/i, /если потребуется/i,
  /если понадобится/i, /рассмотр/i, /думаю о/i, /ойланып көру/i, /мүмкін/i,
  /\bpossibly\b/i, /\bpotentially\b/i, /\bconsider(?:ing)?\b/i, /if (?:needed|required)/i,
];
const EXPLICIT_COMMITMENT_PATTERNS = [
  /реш(?:ил|ила|аю|аем)/i, /точно/i, /все же/i, /всё же/i,
  /начина(?:ю|ем)/i, /выполня(?:ю|ем)/i, /провож(?:у|аем)/i,
  /перевож(?:у|им)/i, /перевести/i, /оперир(?:ую|уем|овать)/i,
  /\bcommitting\b/i, /\bproceed(?:ing)?\b/i, /\bwill (?:perform|transfer|discharge)\b/i,
];

const TOPIC_ANCHORS = Object.freeze({
  pain: ["боль", "болит", "ауыру", "pain"],
  onset: ["когда нач", "начал", "бастал", "onset", "start"],
  nausea_vomiting: ["тошнот", "рвот", "құсу", "nause", "vomit"],
  urinary: ["моч", "дизур", "зәр", "urin"],
  gynecologic: ["месячн", "менстру", "берем", "гинек", "pregnan"],
  allergies: ["аллерг", "allerg"],
  medications: ["приним", "лекар", "препарат", "medication"],
  fasting: ["ел", "пил", "прием пищи", "приём пищи", "натощак", "fasting"],
});

const TYPE_ANCHORS = Object.freeze({
  [COMMAND.TAKE_HISTORY]: ["опрос", "расспрос", "расспрош", "анамнез", "жалоб", "истори", "сұра", "жина"],
  [COMMAND.EXAMINE]: ["осмотр", "осматр", "пальп", "пощуп", "қара"],
  [COMMAND.REQUEST_STATUS]: ["что с пациент", "как пациент", "текущее состояние", "витальн"],
  [COMMAND.WAIT]: ["жду", "подожд", "ожида", "wait"],
  [COMMAND.ORDER_TEST]: ["анализ", "оак", "бхак", "срб", "оам", "хгч", "узи", "кт"],
  [COMMAND.ORDER_MEDICATION]: ["назнач", "ввести", "дать", "обезбол"],
  [COMMAND.ORDER_INFUSION]: ["инфуз", "прокап", "раствор", "физраствор", "кристаллоид"],
  [COMMAND.ORDER_PROCEDURE]: ["процедур", "установ", "постав"],
  [COMMAND.PRESCRIBE_MONITORING]: ["монитор", "каждые", "контрол"],
  [COMMAND.REASSESS]: ["переоцен", "повторн"],
  [COMMAND.CALL_STAFF]: ["вызов", "вызвать", "позов", "консультац"],
  [COMMAND.SET_NPO]: ["npo", "голод", "ничего не есть", "не корм", "ничего внутрь"],
  [COMMAND.ASK_FASTING_HISTORY]: ["когда ел", "когда пил", "прием пищи", "приём пищи"],
  [COMMAND.ESTABLISH_IV_ACCESS]: ["вен", "в/в доступ", "катетер"],
  [COMMAND.REQUEST_ANESTHESIA_REVIEW]: ["анестезиолог"],
  [COMMAND.GIVE_ANTIBIOTIC_PROPHYLAXIS]: ["антибиотикопрофилактик", "профилактик"],
  [COMMAND.COMMIT_MANAGEMENT_PLAN]: ["операц", "оперир", "наблюден"],
  [COMMAND.DISPOSITION]: ["отделение", "палату", "орит", "реанимац", "домой"],
  [COMMAND.TRANSFER]: ["перевод", "перевож", "перевести", "транспортир"],
});

export function buildModelAllowlist({ bundle, turnContext = {} }) {
  const interaction = bundle.shared?.interaction ?? {};
  return {
    commandTypes: Object.values(COMMAND).filter((type) => !NON_MODEL_ACTION_TYPES.has(type)),
    parameterSchemas: PARAMETER_SCHEMAS,
    tests: Object.keys(bundle.trajectories?.investigation_timing ?? {}),
    chemistryAnalytes: [...new Set(Object.values(CHEMISTRY_ANALYTE_SYNONYMS))],
    drugs: Object.keys(bundle.shared?.medications?.medications ?? {}),
    fluids: interaction.fluid_ids ?? ["crystalloid"],
    procedures: interaction.procedure_ids ?? [],
    regions: interaction.examination_regions ?? ["abdomen", "general", "cardiorespiratory", "extremities"],
    patientQuestionTopics: interaction.patient_question_topics ?? [],
    reasoningConceptIds: interaction.reasoning_concept_ids ?? [],
    staffRoles: interaction.staff_roles ?? ["surgeon", "anesthesiologist", "gynecologist"],
    destinations: interaction.destinations ?? ["observation", "surgical_ward", "icu", "other_facility", "home"],
    managementIntents: interaction.management_intents ?? ["operative", "nonoperative", "observation"],
    routes: interaction.routes ?? ["iv", "im", "oral"],
    operativeChoices: (turnContext.pendingDecisionOptions ?? []).map((option) => option.id),
  };
}

export function validateModelConcepts({ output, allowlist, rawText, openClarification }) {
  const errors = [];
  const actionValidation = [];
  const commandTypes = new Set(allowlist.commandTypes);

  for (const [index, item] of output.clinicalActions.entries()) {
    const actionErrors = [];
    if (!commandTypes.has(item.type)) actionErrors.push("type_not_allowlisted");
    const allowedParams = new Set(allowlist.parameterSchemas[item.type] ?? []);
    for (const key of Object.keys(item.params)) if (!allowedParams.has(key)) actionErrors.push(`params.${key}_not_allowlisted`);
    validateKnownIds(item, allowlist, actionErrors);
    if (item.params.analytes !== undefined) {
      if (item.params.testId !== "chemistry") actionErrors.push("params.analytes_not_allowed_for_test");
      if (!Array.isArray(item.params.analytes) || item.params.analytes.some((id) => !allowlist.chemistryAnalytes.includes(id))) {
        actionErrors.push("params.analytes_unknown");
      }
    }
    validateEvidenceSpans(item, rawText, actionErrors);
    validateLexicalGrounding(item, actionErrors);
    if (tentativePromotion(item)) actionErrors.push("tentative_not_committed");
    actionValidation.push({ index, eligibleForBinding: actionErrors.length === 0, errors: actionErrors });
    errors.push(...actionErrors.map((error) => `clinicalActions[${index}].${error}`));
  }

  const questionTopics = new Set(allowlist.patientQuestionTopics);
  for (const [index, question] of output.patientQuestions.entries()) {
    if (!questionTopics.has(question.topic)) errors.push(`patientQuestions[${index}].topic_unknown`);
    for (const span of question.evidenceSpans) {
      if (!containsNormalized(rawText, span)) errors.push(`patientQuestions[${index}].evidence_not_verbatim`);
      if (!containsAny(normalize(span), TOPIC_ANCHORS[question.topic] ?? [])) errors.push(`patientQuestions[${index}].topic_anchor_missing`);
    }
  }

  for (const [field, issues] of [["ambiguities", output.ambiguities], ["unresolvedFragments", output.unresolvedFragments]]) {
    for (const [index, issue] of issues.entries()) {
      if (!containsNormalized(rawText, issue.evidenceSpan)) errors.push(`${field}[${index}].evidence_not_verbatim`);
    }
  }

  const inventions = detectParameterInventions({ output, rawText, openClarification });
  for (const issue of inventions.highRisk) {
    const validation = actionValidation[issue.index];
    if (validation && !validation.errors.includes(issue.kind)) {
      validation.errors.push(issue.kind);
      validation.eligibleForBinding = false;
      errors.push(`clinicalActions[${issue.index}].${issue.kind}`);
    }
  }
  return { ok: errors.length === 0, errors, actionValidation, inventions };
}

export function validateNormalizedReasoning({ normalizedReasoning, allowlist }) {
  const errors = [];
  const reasoningIds = new Set(allowlist.reasoningConceptIds);
  const workingId = normalizedReasoning.workingDiagnosis?.conceptId;
  if (workingId && !reasoningIds.has(workingId)) errors.push("reasoning.workingDiagnosis.conceptId_not_allowlisted");
  for (const item of normalizedReasoning.differential?.items ?? []) {
    if (!reasoningIds.has(item.conceptId)) errors.push(`reasoning.differential.${item.conceptId}_not_allowlisted`);
    if (!DIFFERENTIAL_STATUSES.includes(item.status)) errors.push(`reasoning.differential.${item.conceptId}_status_invalid`);
  }
  return { ok: errors.length === 0, errors };
}

function validateKnownIds(item, allowlist, errors) {
  const checks = [
    ["testId", allowlist.tests], ["drugId", allowlist.drugs], ["fluidId", allowlist.fluids],
    ["procedureId", allowlist.procedures], ["region", allowlist.regions], ["topic", allowlist.patientQuestionTopics],
    ["role", allowlist.staffRoles], ["destination", allowlist.destinations], ["to", allowlist.destinations],
    ["intent", allowlist.managementIntents], ["route", allowlist.routes], ["choice", allowlist.operativeChoices],
  ];
  for (const [key, values] of checks) {
    if (item.params[key] != null && !new Set(values).has(item.params[key])) errors.push(`params.${key}_unknown`);
  }
}

function validateEvidenceSpans(item, rawText, errors) {
  for (const span of item.evidenceSpans) if (!containsNormalized(rawText, span)) errors.push("evidence_not_verbatim");
}

function validateLexicalGrounding(item, errors) {
  const evidence = normalize(item.evidenceSpans.join(" "));
  const anchors = conceptAnchors(item);
  if (!anchors.length || !containsAny(evidence, anchors)) errors.push("lexical_anchor_missing");
  if (item.params.analytes && item.params.analytes.some((id) => !containsAny(evidence, aliasesFor(CHEMISTRY_ANALYTE_SYNONYMS, id)))) {
    errors.push("params.analytes_not_grounded");
  }
  if (item.params.targets && item.params.targets.some((id) => !containsAny(evidence, aliasesFor(MONITORING_TARGETS, id)))) {
    errors.push("params.targets_not_grounded");
  }
}

function conceptAnchors(item) {
  const { params } = item;
  if (params.testId) return testAnchors(params.testId);
  if (params.drugId) return aliasesFor(DRUG_SYNONYMS, params.drugId);
  if (params.fluidId) return ["физраствор", "раствор", "кристаллоид", "инфуз"];
  if (params.region) return regionAnchors(params.region);
  if (params.topic) return TOPIC_ANCHORS[params.topic] ?? [];
  if (params.role) return roleAnchors(params.role);
  if (params.destination || params.to) return destinationAnchors(params.destination ?? params.to);
  if (params.intent === "operative") return ["операц", "оперир"];
  if (params.intent === "observation") return ["наблюден", "наблюда"];
  if (params.approach) return [params.approach, "лапар", "открыт"];
  if (params.choice) return [params.choice];
  if (params.procedureId) return [params.procedureId];
  return TYPE_ANCHORS[item.type] ?? [];
}

function regionAnchors(id) {
  const authored = aliasesFor(REGION_SYNONYMS, id);
  const extra = {
    general: ["пациент", "целиком", "общий осмотр", "полный осмотр", "физикалық", "қарап", "жалпы"],
    cardiorespiratory: ["сердц", "легк", "дых", "аускульт"],
    extremities: ["конечност", "рук", "ног"],
  };
  return [...authored, ...(extra[id] ?? [])];
}

function testAnchors(id) {
  const extra = {
    cbc: ["общий анализ крови", "general blood count"],
    crp: ["c-reactive", "c reactive"],
    urinalysis: ["анализ мочи", "моча"],
    betahcg: ["бета хгч", "beta hcg"],
  };
  return [...aliasesFor(TEST_SYNONYMS, id), ...(extra[id] ?? [])];
}

function roleAnchors(id) {
  const authored = aliasesFor(STAFF_SYNONYMS, id);
  const extra = { surgeon: ["хирург"], anesthesiologist: ["анестезиолог"], gynecologist: ["гинеколог"] };
  return [...authored, ...(extra[id] ?? [])];
}

function destinationAnchors(id) {
  const authored = aliasesFor(DISPOSITION_SYNONYMS, id);
  const extra = {
    observation: ["наблюден"], surgical_ward: ["хирургическое отделение", "отделение", "палату"],
    icu: ["орит", "реанимац"], other_facility: ["другой стационар", "другую больницу"], home: ["домой", "выпис"],
  };
  return [...authored, ...(extra[id] ?? [])];
}

function tentativePromotion(item) {
  if (!HIGH_RISK_ACTIONS.has(item.type)) return false;
  const evidence = normalize(item.evidenceSpans.join(" "));
  return TENTATIVE_PATTERNS.some((pattern) => pattern.test(evidence)) && !EXPLICIT_COMMITMENT_PATTERNS.some((pattern) => pattern.test(evidence));
}

export function detectParameterInventions({ output, rawText, openClarification }) {
  const text = normalize(rawText);
  const inherited = openClarification?.params ?? {};
  const highRisk = [];
  let numericCount = 0;
  for (const [index, action] of output.clinicalActions.entries()) {
    for (const span of action.evidenceSpans) if (!containsNormalized(rawText, span)) highRisk.push({ index, kind: "evidence_not_verbatim" });
    for (const [key, value] of Object.entries(action.params)) {
      if (value == null) continue;
      if (["dose", "doseMg", "volumeMl", "durationMinutes", "intervalMinutes", "afterMinutes"].includes(key)) {
        const numbers = String(value).match(/\d+(?:[.,]\d+)?/g) ?? [];
        if (numbers.some((number) => !numericParameterExpressed({ key, number, value, text })) && inherited[key] !== value) {
          numericCount += 1;
          highRisk.push({ index, kind: "invented_numeric_parameter", key });
        }
        if (key === "dose" && doseUnitExpressed(String(value)) && !doseUnitExpressed(text) && inherited[key] !== value) highRisk.push({ index, kind: "invented_dose_unit", key });
      }
      if (key === "route" && !routeExpressed(text, value) && inherited.route !== value) highRisk.push({ index, kind: "invented_route", key });
    }
    if (tentativePromotion(action)) highRisk.push({ index, kind: "tentative_not_committed" });
  }
  return { highRisk: uniqueIssues(highRisk), inventedNumericParameterCount: numericCount };
}

function routeExpressed(text, route) {
  const patterns = { iv: /в\s*\/\s*в|внутривен|\biv\b/, im: /в\s*\/\s*м|внутримыш|\bim\b/, oral: /внутрь|перорал|\bpo\b/ };
  return patterns[route]?.test(text) === true;
}
function doseUnitExpressed(text) { return /(?:^|\s|\d)(?:мг|mg|г|g)(?:$|\s|[.,;])/i.test(text); }
function numericParameterExpressed({ key, number, value, text }) {
  if (text.includes(number.replace(".", ",")) || text.includes(number.replace(",", "."))) return true;
  if (key === "doseMg" && doseUnitExpressed(text)) {
    const match = /(\d+(?:[.,]\d+)?)\s*(мг|mg|г|g)(?:$|\s|[.,;])/i.exec(text);
    if (match) return Number(value) === (/^(г|g)$/i.test(match[2]) ? Number(match[1].replace(",", ".")) * 1000 : Number(match[1].replace(",", ".")));
  }
  if (["durationMinutes", "intervalMinutes", "afterMinutes"].includes(key)) {
    const hours = /(\d+(?:[.,]\d+)?)?\s*(?:час|ч\b|hour)/i.exec(text);
    if (hours) return Number(value) === Number((hours[1] ?? "1").replace(",", ".")) * 60;
    const minutes = /(\d+(?:[.,]\d+)?)\s*(?:мин|minute)/i.exec(text);
    if (minutes) return Number(value) === Number(minutes[1].replace(",", "."));
  }
  return false;
}

function aliasesFor(dictionary, id) {
  return [...new Set([
    ...Object.entries(dictionary).filter(([, value]) => value === id).map(([key]) => normalize(key)),
    normalize(id),
    normalize(String(id).replaceAll("_", " ")),
  ])];
}
function containsAny(text, anchors) { return anchors.some((anchor) => text.includes(normalize(anchor))); }
function containsNormalized(text, span) { const normalized = normalize(span); return Boolean(normalized) && normalize(text).includes(normalized); }
function normalize(value) { return String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/\u00a0/g, " ").replace(/\s+/g, " "); }
function uniqueIssues(items) { const seen = new Set(); return items.filter((item) => { const key = JSON.stringify(item); if (seen.has(key)) return false; seen.add(key); return true; }); }

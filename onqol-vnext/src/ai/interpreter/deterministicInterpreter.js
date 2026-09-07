import { createCommand, COMMAND } from "../../core/commands/commandTypes.js";
import {
  TEST_SYNONYMS,
  REGION_SYNONYMS,
  FOCUSED_HISTORY_PATTERNS,
  APPROACH_SYNONYMS,
  DRUG_SYNONYMS,
  CHEMISTRY_ANALYTE_SYNONYMS,
  STAFF_SYNONYMS,
  PREOP_PATTERNS,
  DISPOSITION_SYNONYMS,
  MONITORING_TARGETS,
  STATUS_QUERY_PATTERNS,
  STUCK_PATTERNS,
  DISCHARGE_PATTERNS,
  TRANSFER_PATTERNS,
} from "./vocabulary.js";

/**
 * Learner free text -> zero or more explicit commands (Core Runtime Spec
 * §48-49) plus a top-level conversation intent (task brief §10).
 *
 * DETERMINISTIC FALLBACK, NOT A FULL NLU. This module resolves the exact
 * vocabulary the product contracts name by example - abbreviations
 * ("ОАК", "КТ ОБП"), the specific status-query phrasings, "живот" as a
 * sufficient abdominal-exam request, compound turns split on commas/"и" - so
 * the behavioral regression suite is real and passes without a network call.
 * It does not tolerate arbitrary typos or paraphrase outside this vocabulary;
 * the seam for a real LLM-backed interpreter is `ai/tasks/interpreter.js`,
 * which calls this first and only escalates to the provider for what it
 * cannot resolve.
 *
 * CONTEXT-SENSITIVE (task brief §4.2): the same words mean different things
 * at different points in the case, so interpretation consults
 * `turnContext` - the pending operative decision and its content-supplied
 * phrasings, an open mentor question, whether an operative plan is already
 * committed - before generic fragment routing. No disease-specific operation
 * name appears in this file or in `vocabulary.js`; operative choices are
 * matched against content's own `matches_ru`.
 *
 * INVARIANT the whole module holds itself to: never invent a parameter. A
 * command this file cannot fill in fully is emitted with the parameter
 * missing, so `core/commands/commandTypes.js#validateCommand` returns CLARIFY
 * and a hospital character asks for it - never guessed.
 */
export function interpretDeterministically({ text, turnContext = {}, idPrefix = "cmd", bundle = null }) {
  const raw = text.trim();
  const normalized = normalize(raw);
  const reasoningCommand = buildReasoningCommand({ raw, normalized, turnContext, idPrefix, bundle });

  if (matchesAny(normalized, STUCK_PATTERNS)) {
    return { intent: "MENTOR_ANSWER", commands: [], mentorSignal: "STUCK", rawText: raw };
  }

  // An operative decision is pending: the learner's words are most likely an
  // answer to "what do you do?", matched against the CONTENT's phrasings for
  // that specific decision. Checked before the mentor-question branch because
  // an intraoperative decision is a clinical action with consequences, not
  // conversation.
  const operativeCommand = matchPendingOperativeDecision(normalized, turnContext, idPrefix, raw);
  if (operativeCommand) {
    return { intent: "CLINICAL_ACTION", commands: [operativeCommand], rawText: raw };
  }

  if (matchesAny(normalized, STATUS_QUERY_PATTERNS)) {
    return { intent: "REQUEST_CURRENT_STATUS", commands: [command(idPrefix, 0, COMMAND.REQUEST_STATUS, {}, raw)], rawText: raw };
  }

  if (/^повтори/.test(normalized)) {
    return { intent: "REPEAT_REQUEST", commands: [command(idPrefix, 0, COMMAND.REPEAT_LAST, {}, raw)], rawText: raw };
  }

  if (/заверш(и|ить) кейс|закончить кейс/.test(normalized)) {
    return { intent: "CONVERSATION_MANAGEMENT", commands: [command(idPrefix, 0, COMMAND.END_CASE, {}, raw)], rawText: raw };
  }

  const waitParams = matchWaitRequest(normalized);
  if (waitParams) {
    return { intent: "CLINICAL_ACTION", commands: compactCommands(reasoningCommand, command(idPrefix, 0, COMMAND.WAIT, waitParams, raw)), rawText: raw };
  }

  // Reassessment is checked on the WHOLE turn, before fragment splitting: its
  // targets are frequently a list joined by "и" ("боль и витальные через
  // час"), and splitting that into separate fragments first would scatter one
  // reassessment request into an incomplete REASSESS plus orphaned target
  // words that match nothing (Contract §12 - reassessment targets are one
  // request, not several parallel orders).
  if (/переоцен/.test(normalized)) {
    const targets = extractReassessTargets(normalized);
    const afterMinutes = extractDurationMinutes(normalized);
    const params = {};
    if (targets.length) params.targets = targets;
    if (afterMinutes != null) params.afterMinutes = afterMinutes;
    return { intent: "CLINICAL_ACTION", commands: compactCommands(reasoningCommand, command(idPrefix, 0, COMMAND.REASSESS, params, raw)), rawText: raw };
  }

  // Monitoring prescription is likewise one order with a target list, not
  // several parallel orders ("vitals каждые 4 часа").
  //
  // But it must NOT swallow a compound turn: "в отделение, vitals каждые 4
  // часа" is a disposition AND a monitoring plan, and taking this shortcut
  // on the whole turn silently dropped the disposition - the patient stayed
  // in the ED with a ward monitoring plan. So the shortcut yields to
  // fragment splitting whenever the turn also names a destination.
  if (isMonitoringPhrase(normalized) && !findSynonym(normalized, DISPOSITION_SYNONYMS)) {
    return { intent: "CLINICAL_ACTION", commands: compactCommands(reasoningCommand, command(idPrefix, 0, COMMAND.PRESCRIBE_MONITORING, monitoringParams(normalized), raw)), rawText: raw };
  }

  // A biochemistry order with its analyte list is ONE order, not one per
  // comma: «БХАК: креатинин, электролиты, билирубин» must not split into three
  // chemistry orders that overwrite each other in `state.investigations`. Same
  // reasoning as the reassessment shortcut above - a parameter list joined by
  // commas belongs to a single request (matrix V07).
  if (isChemistryOrderPhrase(normalized)) {
    const analytes = extractChemistryAnalytes(normalized);
    const params = { testId: "chemistry" };
    if (analytes.length) params.analytes = analytes;
    return { intent: "CLINICAL_ACTION", commands: compactCommands(reasoningCommand, command(idPrefix, 0, COMMAND.ORDER_TEST, params, raw)), rawText: raw };
  }

  // Split a compound turn into fragments (Core Runtime Spec §9): commas and the
  // conjunction "и" between clinical fragments, not inside a single dose
  // phrase like "2,2 г".
  const fragments = splitFragments(raw);
  const fragmentResults = fragments.map((fragment, index) => interpretFragment(fragment, idPrefix, index, turnContext));
  const commands = mergeDuplicateTestOrders(compactCommands(reasoningCommand, ...fragmentResults.flat()));
  const unmatchedFragments = fragments.filter((fragment, index) => fragmentResults[index].length === 0 && !isReasoningText(normalize(fragment)));

  // An open STAFF clarification is answered by the answer (Contract §8.2,
  // §10, PBC-8).
  //
  // The nurse asked "Уточните путь введения", the learner typed "в/м", and
  // nothing happened: the question was asked but the answer had nowhere to
  // go, so the only way to make an order execute was to retype the whole
  // thing. That is precisely the "learn which sequence of phrases makes the
  // simulator advance" failure §28 names as the anti-goal - and it applied to
  // every clarification in the product, not just this one.
  //
  // Checked only when the turn produced NO command of its own, so a learner
  // who ignores the question and orders something else is not overridden.
  // The original command's already-supplied parameters are preserved and only
  // the missing ones are filled, from the learner's own words - nothing is
  // guessed here any more than anywhere else in this file, and a still-
  // incomplete answer simply comes back as another CLARIFY.
  if (commands.length === 0) {
    const completed = completeFromClarification(normalized, raw, turnContext, idPrefix);
    if (completed) {
      return { intent: "CLINICAL_ACTION", commands: [completed], rawText: raw, answeredClarification: true };
    }
  }

  // An open mentor question does NOT swallow real clinical actions.
  //
  // The mentor asks "Что нужно сделать до операции?" and the learner replies
  // "нулевой стол, венозный доступ, антибиотикопрофилактика" - that is
  // simultaneously an answer to the mentor AND four orders that must
  // actually execute (Contract §7.5: "execute what was said"; Mentor Spec
  // §12: a compound turn may carry more than one effect). Routing the whole
  // turn to MENTOR_ANSWER because a question was open meant the learner
  // answered correctly and nothing happened to the patient.
  if (turnContext.openMentorQuestion && commands.length === 0) {
    return { intent: "MENTOR_ANSWER", commands: [], mentorSignal: "ATTEMPT", rawText: raw };
  }

  if (commands.length === 0) {
    return { intent: "CLINICAL_REASONING", commands: [], rawText: raw, unmatchedFragments };
  }

  const onlyReasoning = commands.every((item) => item.type === COMMAND.STATE_REASONING);
  return {
    intent: onlyReasoning ? "CLINICAL_REASONING" : "CLINICAL_ACTION",
    commands,
    rawText: raw,
    unmatchedFragments,
    answeredMentorQuestion: Boolean(turnContext.openMentorQuestion),
  };
}

function compactCommands(...commands) {
  const present = commands.filter(Boolean);
  return [
    ...present.filter((item) => item.type !== COMMAND.STATE_REASONING),
    ...present.filter((item) => item.type === COMMAND.STATE_REASONING),
  ];
}

function buildReasoningCommand({ raw, normalized, turnContext, idPrefix, bundle }) {
  const allowed = new Set(bundle?.shared?.interaction?.reasoning_concept_ids ?? []);
  const mentions = conceptMentions(normalized, bundle).filter((item) => allowed.has(item.conceptId));
  const delta = { text: raw, evidenceSpans: [] };
  let stated = false;

  const stability = /гемодинамическ[а-яё]*\s+(не)?стабил|пациент\s+(не)?стабил/.exec(normalized);
  if (stability) {
    const unstable = /нестабил/.test(stability[0]);
    delta.stability = { stated: true, learnerAssessment: unstable ? "unstable" : "stable" };
    delta.evidenceSpans.push(stability[0]);
    stated = true;
  }

  const differentialCue = /дифференц|дифференциальн|из диф|в диф/.test(normalized);
  if (differentialCue && mentions.length) {
    delta.differential = {
      stated: true,
      ranked: /на первом месте|в первую очередь|наиболее вероят/.test(normalized),
      items: mentions.map((item, index) => ({ conceptId: item.conceptId, status: "active", rank: /на первом месте|в первую очередь/.test(normalized) ? index + 1 : null })),
    };
    delta.evidenceSpans.push(...mentions.map((item) => item.span));
    stated = true;
  }

  const workingCue = /рабоч[а-яё]* диагноз|думаю|наиболее вероят|вероятнее всего|подозреваю|считаю/.test(normalized);
  const working = mentions.find((item) => !isNegatedConcept(normalized, item.start));
  if (workingCue && working && !differentialCue) {
    delta.workingDiagnosis = {
      stated: true,
      conceptId: working.conceptId,
      uncertaintyExpressed: /думаю|вероят|подозреваю|возможн|не уверен/.test(normalized),
    };
    delta.evidenceSpans.push(working.span);
    stated = true;
  }

  // A bare REASSESS command already records the clinical action. The
  // reasoning channel is added only when the learner explicitly states an
  // observation plan (or answers a mentor question about reassessment), so
  // ordinary reassessment turns keep their established one-command shape.
  if (/наблюда/.test(normalized)) {
    delta.observation = {
      active: /наблюда/.test(normalized) ? true : null,
      goalStated: /боль|витальн|давлен|чсс|температур|живот/.test(normalized),
      reassessmentIntervalStated: /через\s+\d+|через\s+(час|полчаса)|утром/.test(normalized),
      escalationCriteriaStated: /если|при ухудш/.test(normalized),
    };
    delta.reassessment = { stated: /переоцен|повторно оцен/.test(normalized) };
    delta.evidenceSpans.push(raw);
    stated = true;
  }

  if (/если .*ухудш|если станет хуже|при ухудш|пересмотр[а-яё]* тактик|позов[а-яё]* старш/.test(normalized)) {
    delta.contingency = {
      stated: true,
      specificity: /пересмотр|позов|вызов/.test(normalized) ? "specific" : "vague",
      triggerConceptIds: /ухудш|станет хуже/.test(normalized) ? ["clinical_deterioration"] : [],
    };
    delta.evidenceSpans.push(raw);
    stated = true;
  }

  if (/позов[а-яё]*|вызов[а-яё]*|консультац/.test(normalized)) {
    delta.consultation = {
      ownAssessmentStated: /сначала|до прихода|сам|сама/.test(normalized),
      consultationQuestionStated: /по поводу|вопрос|для решени/.test(normalized),
    };
    delta.evidenceSpans.push(raw);
    stated = true;
  }

  if (/потому что|так как|учитывая|в связи с/.test(normalized)) {
    delta.management = { planStated: true, rationaleStated: true };
    delta.evidenceSpans.push(raw);
    stated = true;
  }

  if (/планирую|намерен|тактика/.test(normalized)) {
    const destination = /домой|выпис/.test(normalized) ? "home"
      : /операцион/.test(normalized) ? "or"
        : /реанимац|орит/.test(normalized) ? "icu"
          : /наблюден/.test(normalized) ? "observation"
            : /перевод.*стационар|друг.*стационар/.test(normalized) ? "transfer"
              : /отделени|палат/.test(normalized) ? "ward" : null;
    if (destination) {
      delta.disposition = { stated: true, destination };
      delta.evidenceSpans.push(raw);
      stated = true;
    }
  }

  const expects = new Set(turnContext.openMentorQuestion?.expects ?? []);
  if (expects.has("contingency") && raw && !stated) {
    delta.contingency = { stated: true, specificity: raw.length > 12 ? "specific" : "vague", triggerConceptIds: [] };
    delta.evidenceSpans.push(raw);
    stated = true;
  }
  if (expects.has("reassessment") && raw && !stated) {
    delta.reassessment = { stated: true };
    delta.evidenceSpans.push(raw);
    stated = true;
  }

  if (!stated) return null;
  delta.evidenceSpans = [...new Set(delta.evidenceSpans.filter(Boolean))];
  return command(idPrefix, "reasoning", COMMAND.STATE_REASONING, delta, raw);
}

function conceptMentions(normalized, bundle) {
  const mentions = [];
  const synonyms = bundle?.shared?.interaction?.reasoning_concept_synonyms_ru ?? {};
  for (const [phrase, conceptId] of Object.entries(synonyms)) {
    let start = normalized.indexOf(phrase);
    while (start >= 0) {
      if (!mentions.some((item) => item.conceptId === conceptId)) mentions.push({ conceptId, span: phrase, start });
      start = normalized.indexOf(phrase, start + phrase.length);
    }
  }
  return mentions.sort((a, b) => a.start - b.start);
}

function isNegatedConcept(normalized, start) {
  const prefix = normalized.slice(Math.max(0, start - 24), start);
  return /(?:не|исключаю|исключить|нет данных за)\s*$/.test(prefix);
}

function isReasoningText(normalized) {
  return /рабоч[а-яё]* диагноз|думаю|наиболее вероят|дифференц|гемодинамическ|пересмотр[а-яё]* тактик|при ухудш|если станет хуже/.test(normalized);
}

function interpretFragment(fragment, idPrefix, index, turnContext) {
  const normalized = normalize(fragment);
  const results = [];

  // "осмотрю пациента" (no region) vs "живот" / "оосмотрю живот" (region named).
  if (/осмотр|смотрю/.test(normalized) || Object.keys(REGION_SYNONYMS).some((k) => normalized === k)) {
    // "осмотр анестезиолога" is a preop consult request, not a physical exam
    // the learner performs - checked before the region lookup so it is not
    // mis-read as an examination with a missing region.
    if (matchesAny(normalized, PREOP_PATTERNS.REQUEST_ANESTHESIA_REVIEW)) {
      results.push(command(idPrefix, index, COMMAND.REQUEST_ANESTHESIA_REVIEW, {}, fragment));
      return results;
    }
    const region = findSynonym(normalized, REGION_SYNONYMS);
    results.push(command(idPrefix, index, COMMAND.EXAMINE, region ? { region } : {}, fragment));
    return results;
  }

  if (/анамнез|собер[уи] историю|опрос|опрош|распрос|распрош/.test(normalized)) {
    results.push(command(idPrefix, index, COMMAND.TAKE_HISTORY, {}, fragment));
    return results;
  }

  const focusedHistoryTopic = matchFocusedHistoryTopic(normalized);
  if (focusedHistoryTopic) {
    results.push(command(idPrefix, index, COMMAND.ASK_PATIENT, { topic: focusedHistoryTopic }, fragment));
    return results;
  }

  // Matrix PR02: "когда последний раз ел и пил?" is a question to the patient,
  // and it is what completes the fasting ASSESSMENT. Checked before SET_NPO so
  // it is not swallowed by the nil-by-mouth patterns.
  if (matchesAny(normalized, PREOP_PATTERNS.ASK_FASTING_HISTORY)) {
    results.push(command(idPrefix, index, COMMAND.ASK_FASTING_HISTORY, {}, fragment));
    return results;
  }

  // Matrix PO05: early oral intake. Checked before SET_NPO because "можно
  // пить" and "ничего внутрь" are opposites and the negative patterns are
  // broader.
  if (matchesAny(normalized, PREOP_PATTERNS.ORDER_ORAL_INTAKE)) {
    results.push(command(idPrefix, index, COMMAND.ORDER_ORAL_INTAKE, { level: /дие|стол/.test(normalized) ? "diet_as_tolerated" : "liquids" }, fragment));
    return results;
  }

  // ---- Preoperative actions (task brief §4.1) ------------------------------
  // Checked before the generic drug matcher: "антибиотикопрофилактика
  // цефазолин 2 г" is a prophylaxis action, not an ordinary medication order.
  if (matchesAny(normalized, PREOP_PATTERNS.GIVE_ANTIBIOTIC_PROPHYLAXIS)) {
    const drugId = findSynonym(normalized, DRUG_SYNONYMS);
    const params = {};
    if (drugId) params.drugId = drugId;
    const doseMatch = /(\d+(?:[.,]\d+)?)\s*(мг|г)/i.exec(fragment);
    if (doseMatch) {
      params.dose = `${doseMatch[1]}${doseMatch[2]}`;
      params.doseMg = doseMatch[2].toLowerCase() === "г" ? Number(doseMatch[1].replace(",", ".")) * 1000 : Number(doseMatch[1].replace(",", "."));
      if (/мг\s*\/\s*кг/i.test(fragment)) params.doseMgPerKg = Number(doseMatch[1].replace(",", "."));
    }
    // Matrix AB03: drug, dose AND route are all required, so the route has to
    // be read here too - otherwise a learner who stated it would still be asked.
    const routeMatch = ROUTE_PATTERN.exec(normalized);
    if (routeMatch) params.route = normalizeRoute(routeMatch[1]);
    results.push(command(idPrefix, index, COMMAND.GIVE_ANTIBIOTIC_PROPHYLAXIS, params, fragment));
    return results;
  }

  if (matchesAny(normalized, PREOP_PATTERNS.REQUEST_ANESTHESIA_REVIEW)) {
    results.push(command(idPrefix, index, COMMAND.REQUEST_ANESTHESIA_REVIEW, {}, fragment));
    return results;
  }

  if (matchesAny(normalized, PREOP_PATTERNS.SET_NPO)) {
    results.push(command(idPrefix, index, COMMAND.SET_NPO, {}, fragment));
    return results;
  }

  if (matchesAny(normalized, PREOP_PATTERNS.ESTABLISH_IV_ACCESS)) {
    results.push(command(idPrefix, index, COMMAND.ESTABLISH_IV_ACCESS, {}, fragment));
    return results;
  }

  if (/соглас/.test(normalized)) {
    results.push(command(idPrefix, index, COMMAND.OBTAIN_CONSENT, {}, fragment));
    return results;
  }

  // ---- Endpoints ----------------------------------------------------------
  if (matchesAny(normalized, TRANSFER_PATTERNS)) {
    results.push(command(idPrefix, index, COMMAND.TRANSFER, { destination: "other_facility" }, fragment));
    return results;
  }

  if (matchesAny(normalized, DISCHARGE_PATTERNS)) {
    results.push(command(idPrefix, index, COMMAND.DISCHARGE, {}, fragment));
    return results;
  }

  // ---- Disposition --------------------------------------------------------
  const destination = findSynonym(normalized, DISPOSITION_SYNONYMS);
  if (destination) {
    results.push(command(idPrefix, index, COMMAND.DISPOSITION, { destination }, fragment));
    return results;
  }

  if (isMonitoringPhrase(normalized)) {
    results.push(command(idPrefix, index, COMMAND.PRESCRIBE_MONITORING, monitoringParams(normalized), fragment));
    return results;
  }

  // A single fragment may name SEVERAL investigations with no comma or "и"
  // between them - "оак оам узи обп", "узи обп + узи омт". `collectTestIds` finds
  // every distinct test the fragment names (longest phrase first, matched
  // spans not reused, so "узи органов малого таза" does not also count as bare "узи"),
  // and each becomes its own ORDER_TEST. `mergeDuplicateTestOrders` dedups
  // across the whole turn afterwards (wave §8/§20-C,D).
  const testIds = collectTestIds(normalized);
  for (const [position, testId] of testIds.entries()) {
    const params = { testId };
    // Matrix V07: "БХАК: креатинин, электролиты" carries its own analyte list;
    // bare "БХАК" does not, and the lab asks. The interpreter never fills the
    // list in - an empty list stays empty and becomes a CLARIFY.
    if (testId === "chemistry") {
      const analytes = extractChemistryAnalytes(normalized);
      if (analytes.length) params.analytes = analytes;
    }
    results.push(command(idPrefix, position === 0 ? index : `${index}t${position}`, COMMAND.ORDER_TEST, params, fragment));
  }
  const testId = testIds[0];

  // A bare analyte name ("креатинин") with no "БХАК" in front of it is still a
  // biochemistry order for that analyte. If the same fragment also says "СРБ",
  // keep BOTH orders instead of returning after the first recognized test.
  const bareAnalytes = extractChemistryAnalytes(normalized);
  if (bareAnalytes.length && testId !== "chemistry") {
    results.push(command(idPrefix, `${index}b`, COMMAND.ORDER_TEST, { testId: "chemistry", analytes: bareAnalytes }, fragment));
  }
  if (results.length) return results;

  const staffRole = findSynonym(normalized, STAFF_SYNONYMS);
  if (staffRole || /позв(и|ать)|вызов|вызыва/.test(normalized)) {
    results.push(command(idPrefix, index, COMMAND.CALL_STAFF, staffRole ? { role: staffRole } : {}, fragment));
    return results;
  }

  const medicationMatch = matchMedication(normalized, fragment);
  if (medicationMatch) {
    results.push(command(idPrefix, index, COMMAND.ORDER_MEDICATION, medicationMatch, fragment));
    return results;
  }

  if (/прокапа|инфузи|раствор|физраствор|кристаллоид/.test(normalized)) {
    const infusion = matchInfusion(normalized);
    results.push(command(idPrefix, index, COMMAND.ORDER_INFUSION, infusion, fragment));
    return results;
  }

  // An access word means "start the operation" only once an operative plan
  // exists AND preop readiness has been reached; before that the same word is
  // the learner naming an intended approach as part of planning (task brief
  // §4.2). Without the state check, "лапароскопическая аппендэктомия" said
  // while still in the ED would try to open the abdomen.
  const approach = findSynonym(normalized, APPROACH_SYNONYMS);
  if (approach && (/(иду|идем|операц|доступ|начина)/.test(normalized) || turnContext.preopReady)) {
    results.push(command(idPrefix, index, COMMAND.START_PROCEDURE, { approach }, fragment));
    return results;
  }

  if (/на операцию|оперировать буду|показана операция|идем оперировать|беру в операционную/.test(normalized)) {
    results.push(command(idPrefix, index, COMMAND.COMMIT_MANAGEMENT_PLAN, { intent: "operative" }, fragment));
    return results;
  }

  // A clinically-actionable analgesia intent with no drug named - "обезболить",
  // "дать анальгетик", "снять боль". The learner clearly asked for analgesia;
  // drug, dose and route are simply absent, so this is an ORDER_MEDICATION that
  // validateCommand turns into a CLARIFY and a hospital character asks which
  // drug. The interpreter never picks the analgesic (wave §10/§20-F).
  if (/обезбол|снять боль|купир[а-яё]* бол|анальгез|анальгетик|аналгез|аналгет/.test(normalized)
      && !matchesAny(normalized, PREOP_PATTERNS.REQUEST_ANESTHESIA_REVIEW)) {
    results.push(command(idPrefix, index, COMMAND.ORDER_MEDICATION, { intent: "analgesia" }, fragment));
    return results;
  }

  return results; // unmatched fragment: contributes nothing, not a guess
}

/**
 * One investigation ordered once, however many fragments named part of it.
 *
 * A bare analyte list splits on "и" like any other compound turn, so
 * «креатинин и электролиты» produced TWO chemistry orders - and because
 * `state.investigations` is keyed by investigation id, the second overwrote
 * the first, so the learner saw two identical confirmations and got back one
 * analyte. Contract §8.1 is about several DIFFERENT orders running in
 * parallel; it is not a licence to turn one order into two.
 *
 * Merging afterwards rather than widening the pre-split shortcut is the safe
 * direction: a turn like «кетопрофен 100 мг, глюкоза» keeps both commands,
 * where treating the whole turn as one chemistry order would have swallowed
 * the drug.
 */
function mergeDuplicateTestOrders(commands) {
  const indexByTestId = new Map();
  const merged = [];
  for (const command of commands) {
    if (command.type !== COMMAND.ORDER_TEST) {
      merged.push(command);
      continue;
    }
    const existingIndex = indexByTestId.get(command.params.testId);
    if (existingIndex === undefined) {
      indexByTestId.set(command.params.testId, merged.length);
      merged.push(command);
      continue;
    }
    const existing = merged[existingIndex];
    const analytes = [...new Set([...(existing.params.analytes ?? []), ...(command.params.analytes ?? [])])];
    merged[existingIndex] = createCommand({
      id: existing.id,
      type: existing.type,
      params: { ...existing.params, ...command.params, ...(analytes.length ? { analytes } : {}) },
      sourceText: [existing.sourceText, command.sourceText].filter(Boolean).join(", "),
    });
  }
  return merged;
}

/**
 * Re-issuing the command a hospital character is waiting on an answer for.
 *
 * `turnContext.openClarification` carries the ORIGINAL command's type and
 * parameters plus the list of what was missing (persisted on world state by
 * the CLARIFICATION_REQUESTED event - see `worldState.js`). This fills only
 * the missing keys, from this turn's text, using the same extractors the
 * ordinary path uses. Everything the learner already said the first time is
 * preserved, so "кетопрофен 100 мг" + "в/м" is one complete order, not a
 * second order that lost the dose.
 *
 * Returns null when the answer contains nothing that resolves any missing
 * parameter, so an unrelated reply falls through to the normal handling
 * rather than being forced into a command the learner did not make.
 */
function completeFromClarification(normalized, raw, turnContext, idPrefix) {
  const open = turnContext.openClarification;
  if (!open?.commandType) return null;

  const filled = { ...(open.params ?? {}) };
  let resolvedAny = false;
  for (const key of open.missing ?? []) {
    const patch = extractMissingParam(key, normalized, raw);
    if (patch === undefined) continue;
    Object.assign(filled, patch);
    resolvedAny = true;
  }
  if (!resolvedAny) return null;

  return createCommand({ id: `${idPrefix}-c0`, type: open.commandType, params: filled, sourceText: raw });
}

/**
 * One missing parameter, read out of the learner's answer.
 *
 * Keyed by the same parameter names `commandTypes.js#REQUIRED_PARAMS` uses,
 * so a command type that gains a required parameter gains a clarification
 * answer path here by adding one case - not by special-casing a command.
 */
function extractMissingParam(key, normalized, raw) {
  switch (key) {
    case "route": {
      const match = ROUTE_PATTERN.exec(normalized);
      return match ? { route: normalizeRoute(match[1]) } : undefined;
    }
    case "dose": {
      const match = /(\d+(?:[.,]\d+)?)\s*(мг|г)/i.exec(raw);
      if (!match) return undefined;
      const value = Number(match[1].replace(",", "."));
      return { dose: `${match[1]}${match[2]}`, doseMg: match[2].toLowerCase() === "г" ? value * 1000 : value };
    }
    case "drugId": {
      const drugId = findSynonym(normalized, DRUG_SYNONYMS);
      return drugId ? { drugId } : undefined;
    }
    case "region": {
      const region = findSynonym(normalized, REGION_SYNONYMS);
      return region ? { region } : undefined;
    }
    case "targets": {
      const targets = extractReassessTargets(normalized);
      return targets.length ? { targets } : undefined;
    }
    case "analytes": {
      const analytes = extractChemistryAnalytes(normalized);
      return analytes.length ? { analytes } : undefined;
    }
    case "testId": {
      const testId = findSynonym(normalized, TEST_SYNONYMS);
      return testId ? { testId } : undefined;
    }
    case "role": {
      const role = findSynonym(normalized, STAFF_SYNONYMS);
      return role ? { role } : undefined;
    }
    case "destination": {
      const destination = findSynonym(normalized, DISPOSITION_SYNONYMS);
      return destination ? { destination } : undefined;
    }
    case "approach": {
      const approach = findSynonym(normalized, APPROACH_SYNONYMS);
      return approach ? { approach } : undefined;
    }
    case "volumeMl": {
      const match = /(\d{2,4})\s*мл/.exec(normalized);
      return match ? { volumeMl: Number(match[1]) } : undefined;
    }
    case "durationMinutes_or_bolus": {
      if (/болюс/.test(normalized)) return { bolus: true };
      const minutes = /(\d+)\s*минут/.exec(normalized);
      if (minutes) return { durationMinutes: Number(minutes[1]) };
      const hours = /(?:за\s*)?(\d+)?\s*час/.exec(normalized);
      return hours ? { durationMinutes: Number(hours[1] ?? 1) * 60 } : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * Matching a learner turn against the pending operative decision's own
 * content-supplied phrasings.
 *
 * `turnContext.pendingDecisionOptions` comes straight from
 * `operative.yaml`'s `decisions[<pending>].options[].matches_ru`. The best
 * match is the option whose phrases the turn covers most fully, so
 * "удалю аппендикс, аспирирую жидкость из малого таза" prefers the
 * appendectomy-plus-aspiration option over the appendectomy-only one whose
 * phrase it also contains.
 */
function matchPendingOperativeDecision(normalized, turnContext, idPrefix, raw) {
  const { pendingDecisionId, pendingDecisionOptions } = turnContext;
  if (!pendingDecisionId || !pendingDecisionOptions?.length) return null;

  const turnWords = normalized.split(/[\s,;.]+/).filter(Boolean);

  let best = null;
  for (const option of pendingDecisionOptions) {
    let score = 0;
    for (const phrase of option.matches_ru ?? []) {
      const phraseWords = normalize(phrase).split(/[\s,]+/).filter(Boolean);
      if (phraseWords.every((word) => wordPresentAndNotNegated(turnWords, word, phraseWords))) score += phraseWords.length;
    }
    if (score > 0 && (!best || score > best.score)) best = { option, score };
  }
  if (!best) return null;

  return command(idPrefix, 0, COMMAND.OPERATIVE_DECISION, { decisionId: pendingDecisionId, choice: best.option.id }, raw);
}

const NEGATIONS = new Set(["не", "без", "нет"]);
const STEM_LENGTH = 4;

/** Crude Russian stem: enough to let "удалю" match "удаляю" and "удалил". */
function stemOf(word) {
  return word.length > STEM_LENGTH ? word.slice(0, STEM_LENGTH) : word;
}

/**
 * Is this content word present in the turn, and NOT negated?
 *
 * "удаляю аппендикс, аспирирую жидкость из малого таза, дренаж не ставлю"
 * used to select the place-a-drain option, because the option's phrase
 * "дренаж" appears in the sentence - matching the literal word while
 * ignoring the "не" that reverses it. Recording the opposite of what a
 * surgeon said is the worst possible interpreter failure, so negation is
 * checked in a window on BOTH sides: Russian puts the negation before the
 * verb ("не ставлю дренаж") or after the noun ("дренаж не ставлю").
 */
function wordPresentAndNotNegated(turnWords, contentWord, phraseWords = []) {
  // A negation that is PART OF THE AUTHORED PHRASE is not a reversal - it is
  // the phrase. "ничего не делаю, ушиваю" and "закрываю без аппендэктомии" are
  // real options in `operative.yaml`, and vetoing them because they contain
  // "не"/"без" made them unmatchable: the learner said exactly the authored
  // words and the interpreter returned nothing at all. Only negations the
  // learner added ON TOP of the phrase reverse it.
  const expectedNegations = new Set(phraseWords.filter((word) => NEGATIONS.has(word)));
  const stem = stemOf(contentWord);
  for (let index = 0; index < turnWords.length; index += 1) {
    if (stemOf(turnWords[index]) !== stem) continue;
    // ASYMMETRIC WINDOW, and narrower after the word than before it.
    //
    // Russian puts the negation before the verb ("не ставлю дренаж" - two words
    // ahead of the noun) or straight after the noun ("дренаж не ставлю"). A
    // symmetric +/-2 window covers both, but it also reached backwards past the
    // previous clause: in "аспирирую жидкость, дренаж не ставлю" it vetoed
    // "жидкость" because a "не" two words later belonged to a different verb,
    // so the aspiration option lost to plain appendectomy. Two words back, one
    // word forward covers the real grammar without that spill.
    const window = turnWords.slice(Math.max(0, index - 2), index + 2);
    if (window.some((word) => NEGATIONS.has(word) && !expectedNegations.has(word))) continue;
    return true;
  }
  return false;
}

/**
 * Is this whole turn a biochemistry order and nothing else?
 *
 * Deliberately narrow: it must NAME biochemistry, and it must not also contain
 * another investigation, so «ОАК, ОАМ и БХАК» still splits into three separate
 * orders while «БХАК: креатинин, электролиты» stays one.
 */
function isChemistryOrderPhrase(normalized) {
  if (findSynonym(normalized, TEST_SYNONYMS) !== "chemistry") return false;
  const otherTests = Object.entries(TEST_SYNONYMS).filter(
    ([phrase, testId]) => testId !== "chemistry" && containsWholeWordPhrase(normalized, phrase),
  );
  return otherTests.length === 0;
}

/**
 * Which biochemistry values the learner actually named (matrix V07).
 *
 * WHOLE-WORD matching, not `includes`. A plain substring search read "аст"
 * inside "физраствора" and turned «500 мл физраствора за час» into a
 * biochemistry order for transaminases - the same class of bug that once read
 * "кт" inside "аппендэктомию" as a CT request. Cyrillic `\b` does not work in a
 * non-unicode JS regex, so boundaries go through `containsWholeWordPhrase`.
 */
function extractChemistryAnalytes(normalized) {
  const found = [];
  for (const [phrase, analyteId] of Object.entries(CHEMISTRY_ANALYTE_SYNONYMS)) {
    if (containsWholeWordPhrase(normalized, phrase) && !found.includes(analyteId)) found.push(analyteId);
  }
  return found;
}

function matchMedication(normalized, original) {
  const drugId = findSynonym(normalized, DRUG_SYNONYMS);
  if (!drugId) return null;
  const doseMatch = /(\d+(?:[.,]\d+)?)\s*(мг|г|мл)/i.exec(original);
  const routeMatch = ROUTE_PATTERN.exec(normalized);
  const params = { drugId };
  if (doseMatch) params.dose = `${doseMatch[1]}${doseMatch[2]}`;
  if (doseMatch && doseMatch[2].toLowerCase() === "мг") params.doseMg = Number(doseMatch[1].replace(",", "."));
  if (doseMatch && doseMatch[2].toLowerCase() === "г") params.doseMg = Number(doseMatch[1].replace(",", ".")) * 1000;
  if (doseMatch && /мг\s*\/\s*кг/i.test(original)) params.doseMgPerKg = Number(doseMatch[1].replace(",", "."));
  if (routeMatch) params.route = normalizeRoute(routeMatch[1]);
  return params;
}

/**
 * Route of administration.
 *
 * `\b` around a Cyrillic alternation never matches (see vocabulary.js's note),
 * which previously made every "кетопрофен 100 мг в/м" come back as a nurse
 * clarification for a route the learner had actually stated. Explicit
 * whitespace/punctuation boundaries instead. Not a module-level regex with /g -
 * `lastIndex` would carry between calls.
 */
const ROUTE_PATTERN = /(?:^|\s)(в\/в|в\/м|п\/к|внутривенно|внутримышечно|подкожно|перорально|per\s?os)(?=\s|$|[.,;])/i;

function matchInfusion(normalized) {
  const fluidId = /кристаллоид|физраствор|физ\.\s?раствор|nacl|натрия хлорид/.test(normalized) ? "crystalloid" : undefined;
  const volumeMatch = /(\d{2,4})\s*мл/.exec(normalized);
  const durationMatch = /за\s*(\d+)?\s*час/.exec(normalized) || /(\d+)\s*час/.exec(normalized);
  const isBolus = /болюс/.test(normalized);
  const params = {};
  if (fluidId) params.fluidId = fluidId;
  if (volumeMatch) params.volumeMl = Number(volumeMatch[1]);
  if (isBolus) params.bolus = true;
  else if (durationMatch) params.durationMinutes = Number(durationMatch[1] ?? 1) * 60;
  return params;
}

/** "через час" -> 60, "через 2 часа" -> 120. Returns null when unstated. */
function extractDurationMinutes(normalized) {
  const minutesMatch = /через\s*(\d+)\s*минут/.exec(normalized);
  if (minutesMatch) return Number(minutesMatch[1]);
  const hoursMatch = /через\s*(\d+)?\s*час/.exec(normalized);
  if (hoursMatch) return Number(hoursMatch[1] ?? 1) * 60;
  // "переоценю утром" - a natural way to say "next morning" (task brief's own
  // example journey uses it). Resolved to a fixed 8-hour interval rather than
  // to a wall-clock hour, so it cannot silently rewind the clock.
  if (/утром|наутро|завтра/.test(normalized)) return 8 * 60;
  return null;
}

/** Natural waiting language, distinct from a scheduled reassessment. */
function matchWaitRequest(normalized) {
  const mentionsResults = /резул/.test(normalized);
  const waitVerb = /подожд|ожида|(?:^|\s)жду(?:\s|$)|дожд/.test(normalized);
  const receiveResults = /получ[а-яё]*.*резул/.test(normalized);
  if (!waitVerb && !receiveResults) return null;

  const minutes = /(?:через|на|за)?\s*(\d+)\s*минут/.exec(normalized);
  if (minutes) return { afterMinutes: Number(minutes[1]) };
  const hours = /(?:через|на|за)?\s*(\d+)?\s*час/.exec(normalized);
  if (hours) return { afterMinutes: Number(hours[1] ?? 1) * 60 };
  if (mentionsResults) return { untilNextPending: true };
  return null;
}

function matchFocusedHistoryTopic(normalized) {
  for (const [topic, patterns] of Object.entries(FOCUSED_HISTORY_PATTERNS)) {
    if (matchesAny(normalized, patterns)) return topic;
  }
  return null;
}

function isMonitoringPhrase(normalized) {
  return /монитор|наблюдени[а-яё]* каждые|контрол[а-яё]* каждые|каждые \d+ час|vitals/.test(normalized) && !/переоцен/.test(normalized);
}

function monitoringParams(normalized) {
  const params = {};
  const targets = extractMonitoringTargets(normalized);
  if (targets.length) params.targets = targets;
  const everyMinutes = extractEveryMinutes(normalized);
  if (everyMinutes != null) params.everyMinutes = everyMinutes;
  return params;
}

/** "каждые 4 часа" -> 240. Returns null when unstated. */
function extractEveryMinutes(normalized) {
  const hoursMatch = /каждые\s*(\d+)\s*час/.exec(normalized);
  if (hoursMatch) return Number(hoursMatch[1]) * 60;
  const minutesMatch = /каждые\s*(\d+)\s*минут/.exec(normalized);
  if (minutesMatch) return Number(minutesMatch[1]);
  return null;
}

function extractReassessTargets(normalized) {
  const known = { боль: "pain", витальн: "vitals", живот: "abdomen_exam", диурез: "urine_output", сознание: "mental_status" };
  const targets = [];
  for (const [key, value] of Object.entries(known)) {
    if (normalized.includes(key)) targets.push(value);
  }
  return targets;
}

function extractMonitoringTargets(normalized) {
  const targets = [];
  for (const [key, value] of Object.entries(MONITORING_TARGETS)) {
    if (normalized.includes(key)) targets.push(value);
  }
  // "vitals каждые 4 часа" - the learner named a cadence but no parameter;
  // vital signs are what "monitoring" means by default in that phrasing, and
  // this is a UI/vocabulary default, not an invented clinical parameter.
  if (targets.length === 0 && /vitals|монитор/.test(normalized)) targets.push("vitals");
  return targets;
}

function normalizeRoute(text) {
  const value = text.toLowerCase();
  if (value.startsWith("в/в") || value.startsWith("внутривенно")) return "iv";
  if (value.startsWith("в/м") || value.startsWith("внутримышечно")) return "im";
  if (value.startsWith("п/к") || value.startsWith("подкожно")) return "sc";
  return "oral";
}

/**
 * Resolving a synonym table against a turn, on WHOLE-WORD boundaries.
 *
 * A plain `normalized.includes(phrase)` is wrong in a way that is easy to
 * miss and expensive when it bites: "аппендэктомию" contains the substring
 * "кт", so a naive lookup read "иду на лапароскопическую аппендэктомию" as
 * an order for a CT scan. Matching on word boundaries is what these
 * abbreviation tables actually mean, and `\b` cannot express that for
 * Cyrillic (see the note in `vocabulary.js`), so boundaries are checked
 * against an explicit word-character class instead.
 *
 * Longest phrase first, so "узи брюшной полости" wins over "узи", and
 * "в хирургическое отделение" over "в отделение".
 */
function findSynonym(normalized, table) {
  if (table[normalized]) return table[normalized];
  const entries = Object.entries(table).sort((a, b) => b[0].length - a[0].length);
  for (const [phrase, value] of entries) {
    if (containsWholeWordPhrase(normalized, phrase)) return value;
  }
  return undefined;
}

/**
 * Every distinct investigation a fragment names, in order of first mention.
 *
 * Longest phrases are claimed first and their character span is marked used,
 * so "узи органов малого таза" is claimed as pelvic ultrasound and the "узи" inside it
 * is NOT independently counted as an abdominal study. This is what lets one
 * space- or "+"-separated fragment ("оак оам узи обп", "узи обп + узи омт") produce
 * several independent orders instead of only the first match.
 */
function collectTestIds(normalized) {
  const entries = Object.entries(TEST_SYNONYMS).sort((a, b) => b[0].length - a[0].length);
  const claimed = []; // [start, end) spans already consumed by a longer phrase
  const hits = []; // { testId, start }
  for (const [phrase, testId] of entries) {
    for (const start of wholeWordOccurrences(normalized, phrase)) {
      const end = start + phrase.length;
      if (claimed.some(([s, e]) => start < e && end > s)) continue;
      claimed.push([start, end]);
      hits.push({ testId, start });
    }
  }
  const seen = new Set();
  return hits
    .sort((a, b) => a.start - b.start)
    .map((hit) => hit.testId)
    .filter((testId) => (seen.has(testId) ? false : seen.add(testId)));
}

/** Start indices of every whole-word occurrence of `phrase` in `text`. */
function wholeWordOccurrences(text, phrase) {
  const allowInflection = phrase.length >= STEM_MATCH_MIN_LENGTH;
  const starts = [];
  let index = text.indexOf(phrase);
  while (index !== -1) {
    const before = index === 0 ? "" : text[index - 1];
    const afterIndex = index + phrase.length;
    const after = afterIndex >= text.length ? "" : text[afterIndex];
    const boundedLeft = before === "" || !WORD_CHAR.test(before);
    const boundedRight = after === "" || !WORD_CHAR.test(after) || (allowInflection && CYRILLIC_LETTER.test(after));
    if (boundedLeft && boundedRight) starts.push(index);
    index = text.indexOf(phrase, index + 1);
  }
  return starts;
}

const WORD_CHAR = /[a-zа-яё0-9]/;
const CYRILLIC_LETTER = /[а-яё]/;

/**
 * Minimum key length before a table entry is treated as a STEM that may
 * carry a Russian inflectional ending ("лапароскопическ" matching
 * "лапароскопическую"). Below it, an entry must match as a whole word.
 *
 * The threshold exists because the two failure modes pull in opposite
 * directions: abbreviations are short and must never match inside a longer
 * word ("кт" inside "аппендэктомию" ordered a CT scan the learner never
 * asked for), while ordinary clinical words are long and inflect heavily, so
 * demanding an exact whole-word match would mean enumerating six case
 * endings per term and still missing one.
 */
const STEM_MATCH_MIN_LENGTH = 5;

function containsWholeWordPhrase(text, phrase) {
  const allowInflection = phrase.length >= STEM_MATCH_MIN_LENGTH;
  let index = text.indexOf(phrase);
  while (index !== -1) {
    const before = index === 0 ? "" : text[index - 1];
    const afterIndex = index + phrase.length;
    const after = afterIndex >= text.length ? "" : text[afterIndex];
    const boundedLeft = before === "" || !WORD_CHAR.test(before);
    const boundedRight = after === "" || !WORD_CHAR.test(after) || (allowInflection && CYRILLIC_LETTER.test(after));
    if (boundedLeft && boundedRight) return true;
    index = text.indexOf(phrase, index + 1);
  }
  return false;
}

function matchesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function normalize(text) {
  return text.trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
}

function splitFragments(text) {
  // `\b` does not recognize Cyrillic word boundaries in a non-unicode JS
  // regex (Cyrillic letters fall outside `\w`), so a naive `\bи\b` silently
  // never matches - discovered via a determinism check while writing this
  // file's tests. Whitespace-bounded matching is what "и" as a standalone
  // conjunction actually needs.
  // "+" and " плюс " are compound-turn separators too: "узи обп + узи омт",
  // "цефазолин 2 г + метронидазол 500 мг". "+" never occurs inside a dose or
  // number phrase, so splitting on it is unconditional like "," and ";".
  return text
    .split(/[,;+]|(?:^|\s)и(?=\s)|(?:^|\s)плюс(?=\s)/i)
    .map((fragment) => fragment.trim())
    .filter(Boolean);
}

/**
 * Command ids must be a pure function of (turn, position) - NOT of a
 * module-level counter.
 *
 * A process-global counter made ids depend on how many turns had been
 * interpreted anywhere in the process, so replaying the same seed in a
 * fresh process produced the same clinical events with different command
 * ids, and two sessions in one process diverged outright. Since `cause.
 * commandId` is what the replay/debrief trail joins on, that quietly broke
 * the determinism guarantee the export claims (Core Runtime Spec §42). Caught
 * by `replayIntegrity.test.js` playing the same seed twice in one process.
 */
function command(idPrefix, index, type, params, sourceText) {
  return createCommand({ id: `${idPrefix}-c${index}`, type, params, sourceText });
}

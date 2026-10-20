import { createCommand, COMMAND } from "../../core/commands/commandTypes.js";
import {
  TEST_SYNONYMS,
  REGION_SYNONYMS,
  FOCUSED_HISTORY_PATTERNS,
  APPROACH_SYNONYMS,
  DRUG_SYNONYMS,
  FLUID_SYNONYMS,
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
import { STAFF_REQUEST_CUES, mentionsImagingCategory, mentionsImagingModality } from "./conceptGrounding.js";
import { COMMITMENT, analyzeClauses, clauseWithheldForEveryKind, isGateExempt, assessSequence, isCommitmentClause, judgeClauseCommand, orderBySequence, partitionByCommitment, summarizeWithheld } from "./commitmentPolicy.js";
import { CLAUSE_CHANNEL, clausesByGroup } from "./clauseParser.js";
import { buildConversationFrame, isExpectationAnswer, resolveFrameReply } from "./conversationContext.js";
import { DEFAULT_PROMOTION_POLICY } from "./promotionPolicy.js";
import { LEXICON_TOKENS } from "./semanticConsultationPolicy.js";
import { HIGH_RISK_PARAMETER_KEYS } from "./deterministicParameterBinder.js";
import { NEUTRAL_TOKEN, locateRanges, rangesOverlap, tokenize } from "./textMatch.js";

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
export function interpretDeterministically(input) {
  const result = applyCommitmentGate(interpretRaw(input));
  return { ...result, clauses: describeClauses({ result, turnContext: input.turnContext ?? {} }) };
}

/**
 * The single execution gate (commitmentPolicy.js). A command the learner named
 * but did not commit to (hedge, condition, question, deferral, refusal) is
 * WITHHELD: recorded with the reason and never executed. It is not rewritten
 * into another command. Control intents that carry no command are untouched.
 *
 * The clause-first fragment path (`readTurnByClauses`) has already judged every command in the clause it
 * came from (`result.clauseGated`); the whole-turn shortcuts (reassessment, monitoring, chemistry, a stated
 * wait) return one command over several clauses, which is judged by the words it was read from.
 */
function applyCommitmentGate(result) {
  const commands = result.commands ?? [];
  if (commands.length === 0 && !(result.withheldCommands ?? []).length) return result;
  const partition = result.clauseGated
    ? { committed: commands, withheld: [], preWithheld: result.withheldCommands ?? [] }
    : { ...partitionByCommitment({ rawText: result.rawText ?? "", commands }), preWithheld: [] };
  const { committed: gated, withheld } = partition;
  // A stated «сначала X, затем Y» is recorded and executed in that order.
  const sequence = assessSequence({ rawText: result.rawText ?? "", commands: gated });
  const committed = orderBySequence(gated, sequence);
  const rest = Object.fromEntries(Object.entries(result).filter(([key]) => key !== "clauseGated"));
  const ordered = { ...rest, commands: committed, ...(sequence ? { commandSequence: sequence } : {}) };
  const allWithheld = [...partition.preWithheld, ...summarizeWithheld(withheld)];
  if (allWithheld.length === 0) return ordered;
  const onlyReasoning = committed.every((item) => item.type === COMMAND.STATE_REASONING);
  return {
    ...ordered,
    intent: committed.length === 0 || (onlyReasoning && result.intent === "CLINICAL_ACTION") ? "CLINICAL_REASONING" : result.intent,
    // A hedge / condition / deferral clause ("если станет хуже", "может быть") that
    // governs a withheld command is not an unrecognised request.
    unmatchedFragments: (result.unmatchedFragments ?? []).filter((fragment) => !isCommitmentClause(fragment)),
    withheldCommands: allWithheld,
  };
}

function interpretRaw({ text, turnContext = {}, idPrefix = "cmd", bundle = null }) {
  const raw = text.trim();
  const normalized = normalize(raw);
  const reasoningCommand = buildReasoningCommand({ raw, normalized, turnContext, idPrefix, bundle });

  if (matchesAny(normalized, STUCK_PATTERNS)) {
    return { intent: "MENTOR_ANSWER", commands: [], mentorSignal: "STUCK", rawText: raw };
  }

  // A question ABOUT an investigation or drug ("Почему здесь нужна КТ?",
  // "объясни смысл СРБ") names the concept without ordering it. Reading it as
  // an order put an unrequested CT/CRP on the patient. It is routed to the
  // mentor path with no commands, and `explanationRequest` tells the hybrid
  // layer not to hand it to the model as an unresolved action either.
  if (isExplanationRequest(normalized)) {
    return { intent: "CLINICAL_REASONING", commands: [], rawText: raw, unmatchedFragments: [], explanationRequest: true };
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

  // REPEAT_LAST and END_CASE are explicit conversation controls. They are read
  // from the learner's control phrase ONLY: «повторите ОАК» is a repeat-the-test
  // order, not a request to repeat the last message, and neither control is ever
  // inferred from clinical semantics (interpreter v3A.1, promotionPolicy.js).
  if (REPEAT_CONTROL.test(normalized)) {
    return { intent: "REPEAT_REQUEST", commands: [command(idPrefix, 0, COMMAND.REPEAT_LAST, {}, raw)], rawText: raw };
  }

  if (END_CASE_CONTROL.test(normalized)) {
    return { intent: "CONVERSATION_MANAGEMENT", commands: [command(idPrefix, 0, COMMAND.END_CASE, {}, raw)], rawText: raw };
  }

  const waitParams = matchWaitRequest(normalized);
  if (waitParams) {
    return { intent: "CLINICAL_ACTION", commands: compactCommands(reasoningCommand, command(idPrefix, 0, COMMAND.WAIT, waitParams, sentenceCarrying(raw, (sentence) => matchWaitRequest(sentence) != null))), rawText: raw };
  }

  // Reassessment is checked on the WHOLE turn, before fragment splitting: its
  // targets are frequently a list joined by "и" ("боль и витальные через
  // час"), and splitting that into separate fragments first would scatter one
  // reassessment request into an incomplete REASSESS plus orphaned target
  // words that match nothing (Contract §12 - reassessment targets are one
  // request, not several parallel orders).
  if ((/переоцен/.test(normalized) || isMeasurePhrase(normalized)) && !turnHasOtherActions(raw, turnContext, (n) => /переоцен/.test(n) || isMeasurePhrase(n), splitReassessClause)) {
    const targets = extractReassessTargets(normalized);
    const afterMinutes = extractDurationMinutes(normalized);
    const params = {};
    if (targets.length) params.targets = targets;
    if (afterMinutes != null) params.afterMinutes = afterMinutes;
    return { intent: "CLINICAL_ACTION", commands: compactCommands(reasoningCommand, command(idPrefix, 0, COMMAND.REASSESS, params, sentenceCarrying(raw, (sentence) => /переоцен/.test(sentence)))), rawText: raw };
  }

  // Monitoring prescription is likewise one order with a target list, not
  // several parallel orders ("vitals каждые 4 часа").
  //
  // But it must NOT swallow a compound turn: "в отделение, vitals каждые 4
  // часа" is a disposition AND a monitoring plan, and taking this shortcut
  // on the whole turn silently dropped the disposition - the patient stayed
  // in the ED with a ward monitoring plan. So the shortcut yields to
  // fragment splitting whenever the turn also names a destination.
  if (isMonitoringPhrase(normalized) && !findSynonym(normalized, DISPOSITION_SYNONYMS) && !turnHasOtherActions(raw, turnContext, isMonitoringPhrase)) {
    const monitoring = monitoringParams(normalized);
    if (prescribesMonitoring(monitoring)) return { intent: "CLINICAL_ACTION", commands: compactCommands(reasoningCommand, command(idPrefix, 0, COMMAND.PRESCRIBE_MONITORING, monitoring, sentenceCarrying(raw, isMonitoringPhrase))), rawText: raw };
  }

  // A biochemistry order with its analyte list is ONE order, not one per
  // comma: «БХАК: креатинин, электролиты, билирубин» must not split into three
  // chemistry orders that overwrite each other in `state.investigations`. Same
  // reasoning as the reassessment shortcut above - a parameter list joined by
  // commas belongs to a single request (matrix V07).
  if (isChemistryOrderPhrase(normalized) && !turnHasOtherActions(raw, turnContext, isChemistryOrderPhrase)) {
    const analytes = extractChemistryAnalytes(normalized);
    const params = { testId: "chemistry" };
    if (analytes.length) params.analytes = analytes;
    return { intent: "CLINICAL_ACTION", commands: compactCommands(reasoningCommand, command(idPrefix, 0, COMMAND.ORDER_TEST, params, sentenceCarrying(raw, isChemistryOrderPhrase))), rawText: raw };
  }

  // Split a compound turn into fragments (Core Runtime Spec §9): commas and the
  // conjunction "и" between clinical fragments, not inside a single dose
  // phrase like "2,2 г".
  // Duplicate test orders are merged WITHIN a sentence only («глюкоза, билирубин»
  // is one chemistry order), never across sentences: «Думаю про КТ. Назначаю КТ.»
  // holds a hedge and an order, and merging them would judge the order by the
  // hedge's words. Commitment is clause-local (commitmentPolicy.js).
  const frame = buildConversationFrame(turnContext);
  const read = readTurnByClauses({ raw, turnContext, idPrefix, frame });
  const commands = dropRedundantAnalgesiaIntent(compactCommands(reasoningCommand, ...read.committedByGroup.flat()));
  const withheldCommands = summarizeWithheld(read.withheld);
  // The clause that stated a recognised hypothesis IS the reasoning just
  // recorded, not an unread request.
  const statedConcepts = reasoningCommand ? conceptMentions(normalized, bundle) : [];
  const unmatchedFragments = statedConcepts.length
    ? read.unmatched.filter((fragment) => conceptMentions(normalize(fragment), bundle).length === 0)
    : read.unmatched;

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
  if (commands.length === 0 && withheldCommands.length === 0) {
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
  if (turnContext.openMentorQuestion && commands.length === 0 && withheldCommands.length === 0) {
    return { intent: "MENTOR_ANSWER", commands: [], mentorSignal: "ATTEMPT", rawText: raw };
  }

  if (commands.length === 0 && withheldCommands.length === 0) {
    return { intent: "CLINICAL_REASONING", commands: [], rawText: raw, unmatchedFragments, ...(read.resolutions.length ? { contextResolutions: read.resolutions } : {}) };
  }

  const onlyReasoning = commands.every((item) => item.type === COMMAND.STATE_REASONING);
  return {
    intent: onlyReasoning && withheldCommands.length === 0 ? "CLINICAL_REASONING" : "CLINICAL_ACTION",
    commands,
    rawText: raw,
    unmatchedFragments,
    answeredMentorQuestion: Boolean(turnContext.openMentorQuestion),
    clauseGated: true,
    ...(withheldCommands.length ? { withheldCommands } : {}),
    ...(read.resolutions.length ? { contextResolutions: read.resolutions } : {}),
  };
}

/**
 * The turn read clause by clause (interpreter v3B).
 *
 *   1. segment into clauses and annotate each with its own cues (commitmentPolicy.analyzeClauses);
 *   2. read every clause on its own - first against the preceding system question when the reply is
 *      elliptical (conversationContext.js), then like any fragment;
 *   3. judge each command's commitment in the clause it came from; only then
 *   4. merge duplicate investigation orders among the COMMITTED commands of one sentence.
 *
 * Merging after judging is the point: «Возможно, КТ — но я решил, делаем КТ обп» holds a hedged CT
 * and a decided CT, and they are two readings with two verdicts, not one command judged by the words
 * of both. A clause that yields nothing is unmatched unless it is reasoning, courtesy or a cue-only
 * clause that governs a neighbour.
 */
function readTurnByClauses({ raw, turnContext, idPrefix, frame }) {
  const { clauses } = analyzeClauses(raw);
  const readings = [];
  const answered = new Set(); // questions of the frame this turn has already answered
  for (const clause of clauses) {
    const reading = readClause({ clause, frame, turnContext, idPrefix });
    const key = reading.resolution ? `${reading.resolution.via}:${reading.resolution.questionIndex}` : null;
    if (key && answered.has(key)) {
      // «нет, не нужна»: two clauses, one answer. The question is answered once; the repetition is consumed, not re-read.
      readings.push({ commands: [], forced: null, resolution: null, consumed: true });
      continue;
    }
    if (key) answered.add(key);
    readings.push(reading.commands.length ? reading : readEllipsis({ clause, previous: clauses[clause.index - 1], previousReading: readings[clause.index - 1], turnContext, idPrefix }) ?? reading);
  }
  const carriers = new Set(readings.flatMap((reading, index) => (reading.commands.some((item) => !isGateExempt(item.type)) ? [index] : [])));

  const committed = new Map(); // clause index -> commands
  const withheld = [];
  readings.forEach((reading, index) => {
    for (const item of reading.commands) {
      const verdict = reading.forced ?? judgeClauseCommand({ clauses, carriers, indexes: [index], type: item.type });
      if (verdict.status === COMMITMENT.COMMITTED) committed.set(index, [...(committed.get(index) ?? []), item]);
      else withheld.push({ command: item, commitment: verdict });
    }
  });

  const committedByGroup = clausesByGroup(clauses).map((group) => mergeDuplicateTestOrders(group.flatMap((clause) => committed.get(clause.index) ?? [])));
  // A clause the gate would withhold whatever was read from it (its own hedge / condition / deferral, or one that governs it)
  // is a deliberation, not an unrecognised request.
  const unmatched = clauses.filter((clause, index) => readings[index].commands.length === 0 && !readings[index].consumed
    && !isReasoningText(clause.text) && !isAddressOrCourtesy(clause.text) && !isNonActionByContext(clause, frame)
    && !clauseWithheldForEveryKind({ clauses, carriers, index })).map((clause) => clause.raw);
  return { committedByGroup, withheld, unmatched, resolutions: readings.flatMap((reading) => (reading.resolution ? [reading.resolution] : [])) };
}

/**
 * Verb ellipsis in coordination: «реаниматолога вызываю и старшего» - the second conjunct is a bare object that shares the
 * first clause's verb. Splitting at «и» orphaned it. A clause that read as nothing, is made only of lexicon / literal words
 * (no verb of its own), and sits in the same sentence as a clause that read as a command, is read again together with the
 * previous clause's OWN non-lexicon words (its verb). Both halves are the learner's words; the result counts only when it is
 * the same command type as the clause it borrows from, so the borrowed verb can never turn a noun into a different act.
 */
function readEllipsis({ clause, previous, previousReading, turnContext, idPrefix }) {
  if (!previous || !previousReading || previous.sentence !== clause.sentence) return null;
  const borrowed = previousReading.commands.filter((item) => !isGateExempt(item.type));
  if (borrowed.length === 0 || previousReading.resolution) return null;
  const tokens = tokenize(clause.text);
  if (tokens.length === 0 || tokens.length > 3 || !tokens.every((token) => NEUTRAL_TOKEN.test(token) || isLexical(token))) return null;
  const verbWords = tokenize(previous.text).filter((token) => !NEUTRAL_TOKEN.test(token) && !isLexical(token));
  if (verbWords.length === 0 || verbWords.length > 2) return null;
  const probed = interpretFragment(`${verbWords.join(" ")} ${clause.text}`, idPrefix, clause.index, turnContext)
    .filter((item) => borrowed.some((own) => own.type === item.type));
  if (probed.length === 0) return null;
  return { commands: probed.map((item) => createCommand({ id: item.id, type: item.type, params: item.params, sourceText: clause.raw })), forced: null, resolution: null };
}

/** A word the reviewed lexicon knows: exactly, or as an inflection of a stem of five letters or more (the matcher's own rule). */
function isLexical(token) {
  if (LEXICON_TOKENS.has(token)) return true;
  for (const known of LEXICON_TOKENS) if (known.length >= 5 && token.startsWith(known)) return true;
  return false;
}

/** A nominal answer to a question that asked for reasoning or expectation is a mentor answer, not an unread action. */
function isNonActionByContext(clause, frame) {
  return isExpectationAnswer({ frame, replyText: clause.raw });
}

/**
 * One clause -> its commands. An elliptical reply is read against the question that was just asked BEFORE generic
 * routing (Mentor Spec §11); everything the frame does not explain is read like any fragment.
 */
function readClause({ clause, frame, turnContext, idPrefix }) {
  const viaFrame = readViaFrame({ clause, frame, turnContext, idPrefix });
  if (viaFrame) return viaFrame;
  return { commands: interpretFragment(clause.raw, idPrefix, clause.index, turnContext), forced: null, resolution: null };
}

/** Parameters the learner never gave when the identity of an act comes from the question's own words. */
const QUESTION_BORNE_PARAMS = new Set([...HIGH_RISK_PARAMETER_KEYS, "bolus", "afterMinutes", "everyMinutes", "intervalMinutes"]);

function readViaFrame({ clause, frame, turnContext, idPrefix }) {
  const resolution = resolveFrameReply({ frame, replyText: clause.raw });
  if (!resolution) return null;
  const probed = resolution.probeTexts.flatMap((probe) => interpretFragment(probe, idPrefix, clause.index, turnContext));
  let usable;
  if (resolution.identitySource === "learner") {
    // The learner's own word names the act; the question only supplied the slot it fills.
    usable = probed.filter((item) => (resolution.slotTypes ?? []).includes(item.type));
  } else {
    // The question's word names the act: the learner agreed to something they did not say. Never a
    // protected type, never a dose / route / volume / duration the question carried.
    usable = probed.filter((item) => !DEFAULT_PROMOTION_POLICY.isProtected(item.type) && !isGateExempt(item.type))
      .map((item) => createCommand({ id: item.id, type: item.type, params: Object.fromEntries(Object.entries(item.params).filter(([key]) => !QUESTION_BORNE_PARAMS.has(key))), sourceText: item.sourceText }));
  }
  if (usable.length === 0) return null;
  const commands = usable.map((item) => createCommand({ id: item.id, type: item.type, params: item.params, sourceText: clause.raw }));
  return {
    commands,
    forced: resolution.polarity === "negate" ? { status: COMMITMENT.DECLINED, cues: ["frame:negated_answer"], scope: "clause" } : null,
    resolution: { clauseId: clause.id, via: resolution.via, questionIndex: resolution.questionIndex, identitySource: resolution.identitySource, ...(resolution.polarity ? { polarity: resolution.polarity } : {}) },
  };
}

/**
 * What each clause of the read turn came to, for the consultation policy and for telemetry: its
 * channel, its commitment, the commands it produced (or was withheld from) and whether nothing at
 * all was read from it. Descriptive only - the gate has already decided.
 */
function describeClauses({ result, turnContext }) {
  const raw = result.rawText ?? "";
  if (!raw) return [];
  const { clauses } = analyzeClauses(raw);
  const frame = buildConversationFrame(turnContext);
  const rawTokens = tokenize(raw);
  const covering = (item) => {
    const span = locateRanges(rawTokens, [item.sourceText ?? ""]);
    return (clause) => (span ? rangesOverlap([clause.range], span) : false);
  };
  const executed = (result.commands ?? []).filter((item) => !isGateExempt(item.type));
  const withheld = result.withheldCommands ?? [];
  // The clauses that carry a command (committed or withheld): a cue-only clause next to them governs, it is not itself unread.
  const carriers = new Set(clauses.filter((clause) => [...executed, ...withheld].some((item) => covering(item)(clause))).map((clause) => clause.index));
  const resolutions = new Map((result.contextResolutions ?? []).map((item) => [item.clauseId, item]));
  return clauses.map((clause) => {
    const mine = executed.filter((item) => covering(item)(clause));
    const held = withheld.filter((item) => covering(item)(clause));
    const text = clause.text;
    let channel = CLAUSE_CHANNEL.UNRESOLVED;
    const types = [...mine, ...held].map((item) => item.type);
    if (types.some((type) => [COMMAND.REPEAT_LAST, COMMAND.END_CASE].includes(type)) || ["REPEAT_REQUEST", "CONVERSATION_MANAGEMENT"].includes(result.intent)) channel = CLAUSE_CHANNEL.CONVERSATION_MANAGEMENT;
    else if (types.length && types.every((type) => [COMMAND.ASK_PATIENT, COMMAND.TAKE_HISTORY, COMMAND.ASK_FASTING_HISTORY].includes(type))) channel = CLAUSE_CHANNEL.PATIENT_QUESTION;
    else if (types.length) channel = CLAUSE_CHANNEL.CLINICAL_ACTION;
    else if (isNonActionByContext(clause, frame)) channel = CLAUSE_CHANNEL.MENTOR_ANSWER;
    else if (isReasoningText(text) || isAddressOrCourtesy(text) || clauseWithheldForEveryKind({ clauses, carriers, index: clause.index })) channel = CLAUSE_CHANNEL.CLINICAL_REASONING;
    const commitment = held.length ? held[0].commitment : mine.length ? { status: COMMITMENT.COMMITTED, cues: [], scope: "clause" } : null;
    return {
      id: clause.id, index: clause.index, text: clause.raw, range: clause.range, sentence: clause.sentence,
      channel, commitment,
      commandIds: mine.map((item) => item.id), withheldIds: held.map((item) => item.id),
      unresolved: channel === CLAUSE_CHANNEL.UNRESOLVED,
      structural: mine.length > 0 && isWholeClauseForm(text),
      ...(resolutions.has(clause.id) ? { context: resolutions.get(clause.id) } : {}),
    };
  });
}

/**
 * A clause that is, in its entirety, a structural form the matcher anchors on (the name of an operation, a bare
 * examination region): everything in it is accounted for, whatever the lexicon size.
 */
function isWholeClauseForm(text) {
  const bare = text.replace(/[.!?]+$/, "");
  return OPERATION_NOUN.test(text) || Object.keys(REGION_SYNONYMS).some((key) => bare === key);
}

/** «обезбол - анальгин»: the intent «obezbolit» and the drug it names are one order; the drug wins and nothing is asked. */
function dropRedundantAnalgesiaIntent(commands) {
  const named = commands.some((c) => c.type === COMMAND.ORDER_MEDICATION && c.params?.drugId);
  return named ? commands.filter((c) => !(c.type === COMMAND.ORDER_MEDICATION && c.params?.intent === "analgesia" && !c.params?.drugId)) : commands;
}

/**
 * A whole-turn shortcut (reassessment, monitoring, biochemistry) exists so ONE request that spans commas stays one
 * command («боль и витальные через час»). It must never swallow a turn that also asks for something else: it then
 * yields to the fragment path, which reads every fragment. `own` recognises a fragment that belongs to the
 * shortcut's request; `splitClause` may cut such a fragment into its own clause and a head that is a separate act
 * («госпитализация в ОРИТ с переоценкой через 48 часов»).
 */
function turnHasOtherActions(raw, turnContext, own, splitClause = null) {
  return splitFragments(raw).flat().some((fragment) => {
    const cut = own(normalize(fragment)) && splitClause ? splitClause(fragment) : null;
    const rest = cut ? cut.head : own(normalize(fragment)) ? "" : fragment;
    return rest.trim() !== "" && interpretFragment(rest, "probe", 0, turnContext).length > 0;
  });
}

const REASSESS_CLAUSE = /(?:с\s+)?переоцен[\s\S]*$/i;
function splitReassessClause(fragment) {
  const match = REASSESS_CLAUSE.exec(fragment);
  return match ? { head: fragment.slice(0, match.index).replace(/[\s,]+$/, ""), clause: match[0] } : null;
}

// The control phrase the learner UI itself tells the learner to type («конец кейса»), plus the verb forms.
// Whole-phrase forms only: «конец кейса» inside a sentence about a case is still a control, a clinical
// statement that merely mentions a case is not.
const END_CASE_CONTROL = /(?:^|[\s.,!?])(?:конец кейса|заверш[а-яё]* (?:кейс|сессию)|законч[а-яё]* (?:кейс|сессию))(?=$|[\s.,!?])/;

// "повтори", "повторите, пожалуйста", "повтори последнее", "повтори ещё раз" - and nothing else.
const REPEAT_CONTROL = /^повтори(?:те)?(?:[\s,.!?]+(?:пожалуйста|еще раз|последн[а-яе]*|что ты сказал[а-яе]*|что вы сказали|это|вопрос|ответ|сообщение))*[\s.,!?]*$/;

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

  // «это перегрузка объёмом», «похоже на гиповолемию»: a plain assertion
  // naming a recognised hypothesis is a stated working diagnosis too.
  const workingCue = /рабоч[а-яе]* диагноз|думаю|наиболее вероят|вероятнее всего|подозреваю|считаю|(?:^|[^а-яе])это |похоже на|похоже,|картина /.test(normalized);
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

// A bare form of address or courtesy ("Коллеги,", "Пожалуйста") carries no
// clinical content, so it is neither a command nor an "unrecognised" fragment.
function isAddressOrCourtesy(normalized) {
  return /^(?:(?:уважаемые |дорогие )?коллеги|пожалуйста|будьте добры|прошу|доктор|сестра|медсестра|спасибо|итак|так|если можно|если не сложно|если не затруднит|если вас не затруднит)[\s!.,]*$/.test(normalized);
}

function isReasoningText(normalized) {
  return /рабоч[а-яё]* диагноз|думаю|наиболее вероят|дифференц|гемодинамическ|пересмотр[а-яё]* тактик|при ухудш|если станет хуже/.test(normalized);
}

function interpretFragment(fragment, idPrefix, index, turnContext) {
  const normalized = normalize(fragment);
  const results = [];

  // A reassessment clause inside a fragment that also names another act: read the act, then the reassessment.
  if (/переоцен/.test(normalized)) {
    const cut = splitReassessClause(fragment);
    if (cut) {
      const clause = normalize(cut.clause);
      const targets = extractReassessTargets(clause);
      const afterMinutes = extractDurationMinutes(clause);
      const params = {};
      if (targets.length) params.targets = targets;
      if (afterMinutes != null) params.afterMinutes = afterMinutes;
      return [...(cut.head ? interpretFragment(cut.head, idPrefix, index, turnContext) : []), command(idPrefix, cut.head ? `${index}r` : index, COMMAND.REASSESS, params, cut.clause)];
    }
  }

  // Taking a measurement ("измеряю давление и пульс", "оцениваю диурез") is an
  // observation of the current state: it reads the same way as a reassessment
  // and refreshes what the learner has actually been shown. A cadence
  // («каждый час») makes it a monitoring prescription instead, handled below.
  if (!mentionsImagingModality(normalized) && isMeasurePhrase(normalized)) {
    const targets = extractReassessTargets(normalized);
    if (targets.length) return [command(idPrefix, index, COMMAND.REASSESS, { targets }, fragment)];
  }

  // An explicit imaging-modality word means the fragment is about a STUDY, so it
  // is never a physical examination: «осмотрите живот ультразвуком» is not a
  // palpation. The exam path is skipped and the fragment falls through to the
  // investigation matching below (interpreter v3A.1).
  const imaging = mentionsImagingModality(normalized);

  // "осмотрю пациента" (no region) vs "живот" / "оосмотрю живот" (region named).
  // A generic examining verb («осматриваю», «оцениваю», «выслушиваю»,
  // «пальпирую») counts only together with a named body region, so
  // «оцениваю лёгкие» is an examination while «оцениваю ситуацию» is not.
  const namedRegion = findSynonym(normalized, REGION_SYNONYMS);
  const examVerbWithRegion = namedRegion != null && /осматр|аускульт|выслуш|пальп|перкут|оцени|оценю|провер/.test(normalized);
  if (!imaging && (examVerbWithRegion || /осмотр|смотрю|пальцев[а-яё]* исследов|ректальн[а-яё]* исследов|неврологическ[а-яё]* (?:статус|состояни)/.test(normalized) || Object.keys(REGION_SYNONYMS).some((k) => normalized.replace(/[.!?]+$/, "") === k))) {
    // "осмотр анестезиолога" is a preop consult request, not a physical exam
    // the learner performs - checked before the region lookup so it is not
    // mis-read as an examination with a missing region.
    if (matchesAny(normalized, PREOP_PATTERNS.REQUEST_ANESTHESIA_REVIEW)) {
      results.push(command(idPrefix, index, COMMAND.REQUEST_ANESTHESIA_REVIEW, {}, fragment));
      return results;
    }
    const region = namedRegion;
    results.push(command(idPrefix, index, COMMAND.EXAMINE, region ? { region } : {}, fragment));
    return results;
  }

  // Left-bounded: "опрос" inside «вопрос» or «попросил» is not a history-taking
  // request (the Cyrillic substring trap; `\b` cannot express this).
  if (/анамнез|собер[уи] историю|(?:^|[^а-яё])опрос|(?:^|[^а-яё])опрош|(?:^|[^а-яё])расспрос|(?:^|[^а-яё])расспрош/.test(normalized)) {
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
    const monitoring = monitoringParams(normalized);
    if (prescribesMonitoring(monitoring)) results.push(command(idPrefix, index, COMMAND.PRESCRIBE_MONITORING, monitoring, fragment));
    return results;
  }

  // A single fragment may name SEVERAL investigations with no comma or "и"
  // between them - "оак оам узи обп", "узи обп + узи омт". `collectTestIds` finds
  // every distinct test the fragment names (longest phrase first, matched
  // spans not reused, so "узи органов малого таза" does not also count as bare "узи"),
  // and each becomes its own ORDER_TEST. `mergeDuplicateTestOrders` dedups
  // across the whole turn afterwards (wave §8/§20-C,D).
  // «КТ подтвердила некроз», «УЗИ показало жидкость»: the study is the SUBJECT of a reported finding, not something
  // ordered. (Same idea as the explanation-request guard: naming a study is not ordering it.)
  const testIds = RESULT_REPORT.test(normalized) || METHOD_USE.test(normalized) ? [] : collectTestIds(normalized);
  // An EXPLICIT repeat/serial request ("повторить ОАК", "УЗИ в динамике",
  // "контроль СРБ") is allowed to re-order a test even when one is already
  // pending or resulted (wave §13). A bare re-order is not.
  // NB Cyrillic \b does not work in a non-unicode JS regex - "контроль" is
  // written as a stem, not "контроль\b".
  const repeatRequested = /повтор|еще раз|в динамике|в динамику|динамическ|контрол|пересдат|повторно/.test(normalized);
  for (const [position, testId] of testIds.entries()) {
    const params = { testId };
    if (repeatRequested) params.repeat = true;
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
  // "позови/позовите/позвать": the stems are позов- and позва-, not позв-.
  // "нужна консультация хирурга" is a request for the consultant as well.
  // A role NOUN is not a request: «реаниматологи делают», «я хирург», «онколог хирург должен» talk about a
  // person. Calling someone needs a request cue in the same fragment (a verb of summoning, a consultation
  // request, «сюда»). Without one the fragment stays unresolved rather than summoning staff.
  const staffRequested = STAFF_REQUEST_CUES.test(normalized);
  if (staffRequested && (staffRole || /позов|позва|вызов|вызыва|нужн[а-яе]* консультаци|консультаци[яю] (?:хирург|анестезиолог|гинеколог)/.test(normalized))) {
    results.push(command(idPrefix, index, COMMAND.CALL_STAFF, staffRole ? { role: staffRole } : {}, fragment));
    return results;
  }

  // «останавливаю инфузию», «больше жидкость не вводим»: stopping is not ordering
  // (the word «инфузию» must not read as a new order that then asks «какой раствор?»).
  if (STOP_INFUSION_WORDS.test(normalized) && !/(?:начина|назнач|введ|вводи)/.test(normalized.replace(STOP_INFUSION_WORDS, ""))) {
    results.push(command(idPrefix, index, COMMAND.STOP_INFUSION, {}, fragment));
    return results;
  }

  const medicationMatch = CONTINUATION.test(normalized) ? null : matchMedication(normalized, fragment);
  if (medicationMatch) {
    results.push(command(idPrefix, index, COMMAND.ORDER_MEDICATION, medicationMatch, fragment));
    return results;
  }

  if (INFUSION_WORDS.test(normalized) && !CONTINUATION.test(normalized)) {
    const infusion = matchInfusion(normalized);
    results.push(command(idPrefix, index, COMMAND.ORDER_INFUSION, infusion, fragment));
    return results;
  }

  // An access word means "start the operation" only once an operative plan
  // exists AND preop readiness has been reached; before that the same word is
  // the learner naming an intended approach as part of planning (task brief
  // §4.2). Without the state check, "лапароскопическая аппендэктомия" said
  // while still in the ED would try to open the abdomen.
  // A fragment that is only the NAME of an operation («операцию», «лапароскопическая гемиколэктомия слева») states
  // the operative plan. It is not the start of the operation: that needs the learner to go (см. ниже) or a ready patient.
  if (!turnContext.preopReady && OPERATION_NOUN.test(normalized)) {
    results.push(command(idPrefix, index, COMMAND.COMMIT_MANAGEMENT_PLAN, { intent: "operative" }, fragment));
    return results;
  }

  const approach = findSynonym(normalized, APPROACH_SYNONYMS);
  if (approach && (/(иду|идем|операц|доступ|начина)/.test(normalized) || turnContext.preopReady)) {
    results.push(command(idPrefix, index, COMMAND.START_PROCEDURE, { approach }, fragment));
    return results;
  }

  if (/на операцию|оперировать буду|показана операция|идем оперировать|беру в операционную|оперируем|будем оперировать|готовим на операцию|готовлю на операцию/.test(normalized)) {
    results.push(command(idPrefix, index, COMMAND.COMMIT_MANAGEMENT_PLAN, { intent: "operative" }, fragment));
    return results;
  }
  // Non-operative / watchful management in the words residents actually use. Whole fragment only: «консервативно»
  // inside a sentence about what a patient "did not say" is not a decision, and the commitment gate still applies.
  if (/^(?:пока\s+)?консервативн[а-яё]*[\s.!]*$|^(?:пока\s+)?консервативн[а-яё]* (?:тактика|лечение|ведение)|watch and wait|watchful waiting|динамическое наблюдение/.test(normalized)) {
    results.push(command(idPrefix, index, COMMAND.COMMIT_MANAGEMENT_PLAN, { intent: /watch|наблюден/.test(normalized) ? "observation" : "nonoperative" }, fragment));
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

  // Imaging language with NO modality («сделайте визуализацию живота»): a request
  // for a study whose identity is missing, so an incomplete ORDER_TEST - the lab
  // asks «Какое исследование?». It is never an examination and the interpreter
  // never picks a study for the learner. (A NAMED modality the lexicon cannot
  // resolve is not asked about: the learner already answered that; it stays an
  // unrecognised request and is offered to the semantic pass.)
  if (mentionsImagingCategory(normalized) && !imaging) {
    results.push(command(idPrefix, index, COMMAND.ORDER_TEST, {}, fragment));
    return results;
  }

  return results; // unmatched fragment: contributes nothing, not a guess
}

// Summoning language, as stems (Cyrillic-safe: no \\b / \\w). «спрошу реаниматолога» is an intention to ask
// (the future perfective is not a request in this list).
// (STAFF_REQUEST_CUES lives in conceptGrounding.js: candidate validation applies the same rule to model candidates.)

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
const ROUTE_PATTERN = /(?:^|\s)(в\/в|в\/м|п\/к|внутривенно|внутримышечно|подкожно|перорально|per\s?os)(?=\s|$|[.,;!?])/i;

// «продолжаем капать / продолжение антибиотикотерапии»: an order that already exists, not a new one.
const CONTINUATION = /продолж/;
// «откапать / капать / капельно» and the abbreviated names of the same fluids the learner writes by hand.
// "измеряю давление и пульс", "оцениваю диурез": taking a measurement. A cadence
// ("каждый час") makes it a monitoring prescription instead.
const MEASURE_VERBS = /(?:^|[^а-яё])(?:измер|замер|проверя|проверю|проверить|оцениваю|оценю|оценить|оцени|контролирую)[а-яё]*/;
const MEASURE_TARGETS = /давлен|пульс|чсс|витальн|сатурац|диурез|перфуз|капилляр/;
const isMeasurePhrase = (normalized) => MEASURE_VERBS.test(normalized) && MEASURE_TARGETS.test(normalized) && !/кажд|через|раз в|в течени|мониторинг/.test(normalized);
const STOP_INFUSION_WORDS = /(?:останов|останавл|прекращ|прекрат|приостанов|приостанавл|перекрыва|перекрою)[а-яё]*\s+(?:\S+\s+){0,2}(?:инфуз|капельниц|жидкост|болюс|введени)[а-яё]*|(?:больше|дальше)\s+(?:\S+\s+){0,2}(?:жидкост|инфуз|болюс)[а-яё]*\s+(?:не|уже не)\s+(?:вводим|вводить|вводить|лью|льём|капаем|даём|даем|буду)|(?:жидкост|инфуз|болюс)[а-яё]*\s+(?:больше|дальше)\s+не\s+(?:вводим|вводить|лью|льём|капаем|даём|даем|буду)|хватит\s+(?:жидкост|инфуз|болюс)/;
const INFUSION_WORDS = /прокапа|откапа|капать|капельн|инфузи|раствор|физраствор|физ\.?\s?р-р|р-р\s+(?:рингер|натри|глюкоз)|рингер|стерофундин|кристаллоид|хартман|гелофузин|альбумин[а-яё]*\s+\d|глюкоз[а-яё]*\s+5|болюс/;

function matchInfusion(normalized) {
  const fluidId = findSynonym(normalized, FLUID_SYNONYMS);
  const volumeMatch = /(\d{2,4})\s*мл/.exec(normalized);
  const litreMatch = volumeMatch ? null : /(\d+(?:[.,]\d+)?)\s*л(?=$|\s|[.,;])/.exec(normalized);
  const durationMatch = /за\s*(\d+)?\s*час/.exec(normalized) || /(\d+)\s*час/.exec(normalized);
  const isBolus = /болюс/.test(normalized);
  const params = {};
  if (fluidId) params.fluidId = fluidId;
  if (volumeMatch) params.volumeMl = Number(volumeMatch[1]);
  else if (litreMatch) params.volumeMl = Math.round(Number(litreMatch[1].replace(",", ".")) * 1000);
  if (isBolus) params.bolus = true;
  else if (durationMatch) params.durationMinutes = Number(durationMatch[1] ?? 1) * 60;
  return params;
}

/** "через час" -> 60, "через 2 часа" -> 120. Returns null when unstated. */
function extractDurationMinutes(normalized) {
  const minutesMatch = /через\s*(\d+)\s*минут/.exec(normalized);
  if (minutesMatch) return Number(minutesMatch[1]);
  const hoursMatch = /через\s*(\d+)?\s*час/.exec(normalized) ?? /через\s*(\d+)\s*ч(?![а-яё])/.exec(normalized);
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
  // A wait spends clinical time that cannot be given back, so the amount is read
  // from the learner's words exactly or not at all. «час» inside «полчаса» or
  // «пару часов» is not «1 час»: only an explicit number, the word «час» on its
  // own, or «полчаса» give a duration.
  if (/пол\s?часа/.test(normalized)) return { afterMinutes: 30 };
  const numberedHours = /(\d+)\s*час(?:а|ов)?(?![а-яё])/.exec(normalized);
  if (numberedHours) return { afterMinutes: Number(numberedHours[1]) * 60 };
  if (/(?:^|[^а-яё])час(?![а-яё])/.test(normalized)) return { afterMinutes: 60 };
  if (mentionsResults) return { untilNextPending: true };
  return null;
}

// A patient question needs the form of one: a question mark, the particle «ли», an interrogative, or a verb of
// asking. «раз тошноты и рвоты нет» names the symptoms while giving a reason; it asks nothing.
const INQUIRY_FORM = /\?|(?:^|\s)ли(?=$|[\s.,;!?])|(?:^|\s)(?:как|какой|какая|какое|какие|каком|когда|сколько|чем|почему|есть|бывает|бывали|бывал|был|была|были|беспокоит|болит)(?=$|[\s.,;!?])|спрош|спрос|уточн|узнат|выясн|расспр|опрос|поинтерес/;
function matchFocusedHistoryTopic(normalized) {
  if (!INQUIRY_FORM.test(normalized)) return null;
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
  if (everyMinutes != null) params.intervalMinutes = everyMinutes; // the schema / fixtures name (was `everyMinutes`, which nothing reads)
  return params;
}

/** A monitoring prescription that names neither a target nor a cadence prescribes nothing: it is not a command. */
const prescribesMonitoring = (params) => params.targets?.length > 0 || params.intervalMinutes != null;

/** "каждые 4 часа" -> 240. Returns null when unstated. */
function extractEveryMinutes(normalized) {
  // «ч» is matched with a Cyrillic-safe lookahead (\\b never sees a Cyrillic boundary).
  const hours = /каждые\s*(\d+)\s*(?:час|ч(?![а-яё]))/.exec(normalized);
  if (hours) return Number(hours[1]) * 60;
  if (/(?:^|\s)ежечасно(?=$|[\s.,;])/.test(normalized)) return 60;
  const minutesMatch = /каждые\s*(\d+)\s*минут/.exec(normalized);
  if (minutesMatch) return Number(minutesMatch[1]);
  return null;
}

function extractReassessTargets(normalized) {
  const known = {
    боль: "pain", витальн: "vitals", живот: "abdomen_exam", диурез: "urine_output", сознание: "mental_status",
    давлен: "vitals", пульс: "vitals", чсс: "vitals", сатурац: "vitals",
    перфуз: "perfusion", капилляр: "perfusion",
    "вены шеи": "neck_veins", "шейные вены": "neck_veins",
    легк: "cardiorespiratory", лёгк: "cardiorespiratory", дыхан: "cardiorespiratory",
  };
  const targets = [];
  for (const [key, value] of Object.entries(known)) {
    if (normalized.includes(key) && !targets.includes(value)) targets.push(value);
  }
  return targets;
}

function extractMonitoringTargets(normalized) {
  const targets = [];
  for (const [key, value] of Object.entries(MONITORING_TARGETS)) {
    // A short key («ад», «чсс») is a whole word: «ад» must not be found inside «надо».
    const found = key.length < 5 ? wholeWordOccurrences(normalized, key).length > 0 : normalized.includes(key);
    if (found && !targets.includes(value)) targets.push(value);
  }
  // "vitals каждые 4 часа" - the learner named a cadence but no parameter;
  // vital signs are what "monitoring" means by default in that phrasing, and
  // this is a UI/vocabulary default, not an invented clinical parameter.
  // ...but only for a GENERIC request («мониторинг состояния», «vitals каждые 4 часа»). «мониторинг отделяемого по
  // зонду» names a thing that is not a modeled target; defaulting it to vitals would prescribe something else.
  if (targets.length === 0 && /vitals|витальн|(?:^|\s)монитор[а-яё]*(?:\s+(?:состояни[а-яё]*|показател[а-яё]*|пациент[а-яё]*|параметр[а-яё]*)|[\s.,;!?]*$)/.test(normalized)) targets.push("vitals");
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
function collectTestIds(rawNormalized) {
  // «рингер-лактат» is a solution, not a lactate test: fluid names are masked
  // before test names are looked for.
  let normalized = rawNormalized;
  for (const phrase of Object.keys(FLUID_SYNONYMS).sort((a, b) => b.length - a.length)) {
    if (normalized.includes(phrase)) normalized = normalized.split(phrase).join(" ".repeat(phrase.length));
  }
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
  // A CT / MRI / X-ray of ANOTHER body region is not the modeled abdominal CT, and a region word without an
  // ultrasound word is not the pelvic ultrasound: «КТ ОМТ», «КТ ОГК» name studies the registry does not
  // model. They are dropped (the fragment stays unresolved) instead of being read as the nearest modeled
  // study. Ultrasound of the pelvis («УЗИ ОМТ») is unaffected: it has its own recognised-unmodeled id.
  const otherRegionStudy = NON_ULTRASOUND_MODALITY.test(normalized) && OTHER_REGION.test(normalized) && !ABDOMEN_REGION.test(normalized);
  return hits
    .filter((hit) => !(otherRegionStudy && ["ct_abdomen", "pelvic_ultrasound", "ultrasound_abdomen"].includes(hit.testId)))
    .sort((a, b) => a.start - b.start)
    .map((hit) => hit.testId)
    .filter((testId) => (seen.has(testId) ? false : seen.add(testId)));
}

const NON_ULTRASOUND_MODALITY = /(?:^|\s)(?:кт|мскт|мрт|рентген[а-яё]*|пэт|томограф[а-яё]*|флюорограф[а-яё]*)(?=$|[\s,.;])/;
const RESULT_REPORT = /(?:^|\s)(?:кт|мскт|мрт|узи|рентген[а-яё]*|оак|оам|срб|анализ[а-яё]*|исследование)\s+(?:подтверд|показал|выявил|обнаружил|описал|определил)/;
// «дренировать под КТ», «стадировать по КТ»: the study is the method or guidance of another act, not an order.
const METHOD_USE = /(?:^|\s)(?:под|по|при помощи|с помощью|по данным)\s+(?:контролем\s+)?(?:кт|мскт|мрт|узи|рентген[а-яё]*)(?=$|[\s,.;])/;
const OPERATION_NOUN = /^(?:(?:экстренн|плановая|плановую|лапароскопическ|открыт|повторн)[а-яё]*\s+)*(?:операци[юяи]|[а-яё]{3,}эктоми[юяи]|резекци[юяи])(?:\s+(?:слева|справа))?[\s.!]*$/;
const ABDOMEN_REGION = /(?:^|\s)(?:обп|живот[а-яё]*|брюшн[а-яё]*)(?=$|[\s,.;])/;
const OTHER_REGION = /(?:^|\s)(?:омт|огк|грудн[а-яё]*|голов[а-яё]*|шеи|таз[а-яё]*|малого таза)(?=$|[\s,.;])/;

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

// No `\b`/`\w`: they never match Cyrillic. Whitespace/start anchors only.
const EXPLANATION_OPENERS = /^(?:(?:наставник|коллеги|пожалуйста)[,\s]+)*(?:это вопрос[:,\s]+)?(?:почему|зачем|для чего|отчего|что такое|что значит|объясни|объясните|поясни|поясните|расскажи|расскажите|в чем смысл|какой смысл|в чем разница)(?:\s|$|,)/;
// Imperative/first-person forms only: "назначают" in a question is not an order.
const ORDER_VERB = /закажи|закажу|назначь|назначу|назначаю(?![а-яе])|сделай|сделаю|введи|вводи|проведи|поставь|выполни|возьми|отправь|дай(?:те)?\s/;

function isExplanationRequest(normalized) {
  return EXPLANATION_OPENERS.test(normalized) && !ORDER_VERB.test(normalized);
}

/** The fragments of a turn, grouped by sentence: string[][]. */
function splitFragments(text) {
  // `\b` does not recognize Cyrillic word boundaries in a non-unicode JS
  // regex (Cyrillic letters fall outside `\w`), so a naive `\bи\b` silently
  // never matches - discovered via a determinism check while writing this
  // file's tests. Whitespace-bounded matching is what "и" as a standalone
  // conjunction actually needs.
  // "+" and " плюс " are compound-turn separators too: "узи обп + узи омт",
  // "цефазолин 2 г + метронидазол 500 мг". "+" never occurs inside a dose or
  // number phrase, so splitting on it is unconditional like "," and ";".
  // Sentences are split first, so a command's source text never straddles two
  // sentences and commitment stays clause-local (commitmentPolicy.js). A
  // terminator counts only before whitespace: "0.9%" and "т.е." stay whole.
  return splitSentences(text).map((sentence) => sentence.split(/(?<!\d),|,(?!\d)|[;+]|\s[-–—]\s|(?:^|\s)и(?=\s)|(?:^|\s)плюс(?=\s)/i)
    .map((fragment) => fragment.trim())
    .filter((fragment) => /[\p{L}\p{N}]/u.test(fragment)));
}

/** Sentences of a turn, each keeping its own terminator. */
function splitSentences(text) {
  return text.split(/(?<=[.!?…])\s+|\n+/).map((sentence) => sentence.trim()).filter(Boolean);
}

/**
 * Source text of a whole-turn shortcut command: the sentence(s) that carry the
 * shortcut's own words, not the whole turn, so a condition or hedge in another
 * sentence does not govern it. A single-sentence turn, or one where no single
 * sentence carries the words, keeps the whole turn.
 */
function sentenceCarrying(raw, predicate) {
  const sentences = splitSentences(raw);
  if (sentences.length < 2) return raw;
  const own = sentences.filter((sentence) => predicate(normalize(sentence)));
  return own.length ? own.join(" ") : raw;
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

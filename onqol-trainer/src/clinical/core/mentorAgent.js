import { renderMentorBrief } from "./mentorBrief.js";

/**
 * The mentor channel.
 *
 * Freedom in form, not in content. The mentor may choose tone, phrasing, the
 * socratic question and the moment to stop the learner. It may not decide what
 * is clinically true: every clinical statement it makes has to come from the
 * brief it was handed.
 *
 * What it never receives: the Case Card, hidden findings, the expected action
 * list, the score. The brief carries verdicts and authored templates only, so a
 * misbehaving model has no patient fact available to leak.
 */

// The mentor MAY affirm process ("вызов старшего — зрелое решение"). It may NOT
// confirm the diagnosis or announce the expected clinical decision before the
// debrief. That is a narrower ban than the patient channel's, and deliberately
// so: banning the word "верно" outright is what made V2 unable to encourage.
const DIAGNOSIS_CONFIRMATION_RE =
  /(диагноз[а-яё]*\s+(?:поставлен|сформулирован|определ[её]н)\s+(?:верно|правильно)|(?:верный|правильный)\s+диагноз|это\s+подтверждает\s+диагноз|у\s+пациент(?:а|ки)\s+действительно|диагноз\s+подтвержд[а-яё]+|ты\s+(?:прав|права)\s+в\s+диагнозе|overall\s+score|learner\s+score)/i;

const PRESCRIPTION_RE =
  /(нужно\s+(?:выполнить|сделать)\s+(?:аппендэктомию|лапаротомию|операцию)|правильн[а-яё]+\s+тактика\s+—|следует\s+оперировать\s+сейчас)/i;

const MAX_MENTOR_CHARS = 700;

// Russian past-tense verbs are gendered, so "ты обозначил" assigns the learner
// a gender nobody stated. Catches "ты <verb>ал/ла" with up to two words in
// between ("что ты прямо обозначил"). Deliberately anchored on "ты": a bare
// -л ending elsewhere is usually about the patient or the process, which is
// fine. On a hit the turn falls back to the authored text, which is neutral.
// Note: \b cannot be used here. JavaScript word boundaries are ASCII-based, so
// \bты never matches after a space. Cyrillic-aware guards are used instead, and
// the trailing lookahead keeps "остановило" (neuter, about "что") from firing.
const GENDERED_ADDRESS_RE =
  /(?:^|[^а-яё])ты\s+(?:[а-яё]+\s+){0,2}[а-яё]*(?:ал|ял|ил|ел|ыл|ала|яла|ила|ела|ыла|лся|лась)(?![а-яё])/i;

function parseJsonPayload(payload) {
  if (typeof payload === "object" && payload !== null) return payload;
  const text = String(payload || "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Mentor agent did not return JSON.");
    return JSON.parse(match[0]);
  }
}

function significantTokens(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 5);
}

/**
 * Leak check.
 *
 * The mentor was never given these texts. This is a safety net against the
 * model reconstructing a finding from conversation context: if an unrevealed
 * finding's distinctive wording shows up in mentor output, the turn falls back
 * to deterministic rendering.
 */
export function leaksUnrevealedFinding(mentorText, caseData, revealedFindingIds = []) {
  const revealed = new Set(revealedFindingIds);
  const groups = [caseData.hidden_findings || {}, caseData.available_findings || {}];
  const mentorTokens = new Set(significantTokens(mentorText));

  for (const group of groups) {
    for (const [findingId, finding] of Object.entries(group)) {
      if (revealed.has(findingId)) continue;
      const findingTokens = significantTokens(finding.text);
      if (findingTokens.length === 0) continue;
      const overlap = findingTokens.filter((token) => mentorTokens.has(token));
      // A finding is considered leaked when a distinctive run of its wording
      // reappears. Single shared words (e.g. "живот") are not enough.
      if (overlap.length >= 4) return { leaked: true, findingId, overlap };
    }
  }
  return { leaked: false, findingId: null, overlap: [] };
}

export function validateMentorText(mentorText, caseData, revealedFindingIds = []) {
  const text = String(mentorText || "").trim();
  if (!text) return { ok: false, reason: "empty" };
  if (text.length > MAX_MENTOR_CHARS) return { ok: false, reason: "too_long" };
  if (DIAGNOSIS_CONFIRMATION_RE.test(text)) return { ok: false, reason: "premature_diagnosis_confirmation" };
  if (PRESCRIPTION_RE.test(text)) return { ok: false, reason: "prescribed_expected_decision" };
  if (GENDERED_ADDRESS_RE.test(text)) return { ok: false, reason: "gendered_address" };

  const leak = leaksUnrevealedFinding(text, caseData, revealedFindingIds);
  if (leak.leaked) return { ok: false, reason: "finding_leak", findingId: leak.findingId };

  return { ok: true, reason: null };
}

export function buildMentorPrompt({ brief, learnerText, locale = "ru" }) {
  return {
    system: [
      "You are the ON QOL Clinical Mentor: an experienced surgeon supervising a resident during a simulated case.",
      "You are given a brief describing what is pedagogically true on this turn. Render it as one short, natural mentor reply.",
      "",
      "You MAY: choose wording and tone, encourage, name what the learner did well as a process, stop the learner, ask one focused question, and reorder the points for a natural flow.",
      "You MAY affirm professional behaviour such as recognising the limits of one's own competence.",
      "",
      "You MUST NOT: state or confirm a diagnosis, say whether the learner's diagnosis is right or wrong, announce the expected clinical decision, invent or mention any patient finding, vital sign, laboratory value or examination result, or give a score.",
      "You MUST NOT introduce clinical facts that are not in the brief. If the brief does not support a statement, do not make it.",
      "",
      "WHAT ALREADY HAPPENED. The application prints the patient and environment response ABOVE your reply. Everything in brief.just_performed has already been carried out this turn and its results are already on the learner's screen.",
      "Never instruct the learner to do something listed in just_performed, and never suggest starting it. \"Начинай с осмотра\" after the examination has been performed is wrong and confusing.",
      "Treat those actions as done AND already read by the learner. Do not open by announcing them (\"осмотр уже выполнен\", \"результаты доступны на экране\") - that is narrating the screen back at someone who just read it. Start from what comes next.",
      "Every clinical claim you make must be traceable to a brief move or its attached evidence.",
      "",
      "MOVES OF TYPE sequence_inverted, outstanding_priority AND clock are things the supervisor has noticed are NOT happening. They are not reactions to the learner's message and may look unprompted; render them anyway, as the one thing worth naming now. Keep them as a nudge and a question, never as an order.",
      "",
      "Speak Russian unless the locale says otherwise. Address the learner informally, as a senior colleague would. Be brief: two to four sentences.",
      "",
      "GRAMMATICAL GENDER. The learner's gender is unknown and must stay unknown. Russian past-tense verbs and short adjectives carry gender, so never use them about the learner: not \"ты сделал\", not \"ты сделала\", not \"ты был прав\".",
      "Use instead: present tense (\"ты зовёшь\", \"ты предлагаешь\"), infinitives (\"назвать неопределённость — правильный ход\"), verbal nouns (\"вызов старшего\", \"осмотр выполнен\"), or impersonal forms (\"что уже сделано\").",
      "The same applies to Kazakh where a gendered form would otherwise appear.",
      "End with exactly ONE question - one question mark, and one thing being asked. When the brief carries two moves, do not stack their questions into a single sentence: state the second as an observation and ask only the more important one. A resident given three questions at once answers one and drops two.",
      "Return strict JSON only: {\"mentor_text\": \"...\"}",
    ].join("\n"),
    user: JSON.stringify(
      {
        locale,
        learner_message: learnerText,
        brief: {
          turn_number: brief.turnNumber,
          phase: brief.phase,
          // Action names only - never their results. Tells the mentor what the
          // deterministic layer has already answered above its reply.
          just_performed: brief.justPerformed || [],
          results_already_delivered: Boolean(brief.resultsAlreadyDelivered),
          moves: brief.moves.map((move) => ({
            type: move.type,
            authored_text: move.template,
            severity: move.severity || null,
            evidence: (move.evidence || []).map((reference) => ({
              id: reference.id,
              name: reference.name,
              section: reference.section,
              recommendation: reference.recommendation,
              provenance: reference.provenance,
            })),
          })),
        },
        reference_rendering: renderMentorBrief(brief),
        note:
          "reference_rendering is the deterministic version of this reply. Improve its phrasing and flow; do not add clinical content it does not contain.",
        output_schema: { mentor_text: "string" },
      },
      null,
      2
    ),
  };
}

/**
 * @returns {Promise<{text: string, source: "llm"|"deterministic", rejectionReason: string|null}>}
 */
export async function runMentorAgent({ brief, learnerText, caseData, revealedFindingIds = [] }, options = {}) {
  const deterministic = {
    text: renderMentorBrief(brief),
    source: "deterministic",
    rejectionReason: null,
    moveTypes: brief.moves.map((move) => move.type),
  };

  if (!options.llm) return deterministic;

  try {
    const payload = await options.llm(
      buildMentorPrompt({ brief, learnerText, locale: options.locale || brief.locale })
    );
    const parsed = parseJsonPayload(payload);
    const validation = validateMentorText(parsed.mentor_text, caseData, revealedFindingIds);
    if (!validation.ok) {
      return { ...deterministic, rejectionReason: validation.reason };
    }
    return {
      text: String(parsed.mentor_text).trim(),
      source: "llm",
      rejectionReason: null,
      moveTypes: brief.moves.map((move) => move.type),
    };
  } catch {
    return { ...deterministic, rejectionReason: "mentor_agent_error" };
  }
}

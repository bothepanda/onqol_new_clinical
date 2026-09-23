// Test / live-runner harness for fluids_01: the SAME pipeline the app runs
// (submitLearnerTurn -> renderTurnMessages), driven by a scripted or live
// "resident". Nothing here decides clinical behaviour.
import { createCommand } from "../../../core/commands/commandTypes.js";
import { createSession } from "../../../core/session/createSession.js";
import { submitLearnerTurn } from "../../../core/session/submitLearnerTurn.js";
import { buildLearnerVisibleState } from "../../../core/state/learnerView.js";
import { withShared } from "../../../core/content/loadBundle.js";
import { renderTurnMessages } from "../../../app/session/renderTurn.js";
import { buildMentorBrief } from "../../../ai/mentor/mentorBrief.js";
import { buildDebrief } from "../../../core/replay/buildDebrief.js";
import diseaseBundle from "../../generated/fluids_01.json" with { type: "json" };
import sharedBundle from "../../generated/shared.json" with { type: "json" };
import library from "../../mentor/fluids01-library.json" with { type: "json" };

export const bundle = withShared(diseaseBundle, sharedBundle);
export const fluidsLibrary = library;
export const START_ISO = "2026-09-25T02:10:00+05:00";

export function newFluidsSession({ seed = "fluids-harness", stateful = true } = {}) {
  return createSession({
    sessionId: `fluids-${seed}`,
    seed,
    mode: "reference",
    casePresetId: "FLUIDS-01",
    sessionPurpose: "internal_development",
    interactionFlags: { FLUIDS_VERTICAL_SLICE_V1: true, STATEFUL_GROUNDED_MENTOR_V1: stateful },
    bundle,
    locale: "ru",
    startIso: START_ISO,
  });
}

/** A resident at the keyboard. `say(text)` returns everything the learner saw for that turn. */
export function resident({ seed, stateful = true, interpretWith = null } = {}) {
  let session = newFluidsSession({ seed, stateful });
  const arrival = session.events.find((event) => event.type === "PATIENT_ARRIVED");
  const transcript = [{ role: "env", textRu: arrival.payload.handoffRu }];
  const turns = [];
  return {
    get session() { return session; },
    get state() { return session.state; },
    transcript,
    turns,
    say(text, { interpreted } = {}) {
      const learnerVisibleBefore = buildLearnerVisibleState(session.state);
      const turn = submitLearnerTurn({ session, text, interpreted: interpreted ?? interpretWith?.(text) });
      session = turn.session;
      const messages = renderTurnMessages({ turn, bundle, learnerVisibleBefore, interpreted: turn.interpreted, mentorTextRu: turn.mentor?.textRu ?? null }).filter(Boolean);
      transcript.push({ role: "learner", textRu: text }, ...messages);
      const record = { text, turn, messages, mentor: turn.mentor, envText: messages.filter((m) => m.role !== "mentor").map((m) => m.textRu).join(" ") };
      turns.push(record);
      return record;
    },
    /** The brief the grounded mentor would receive for the last turn. */
    briefFor(record) {
      return buildMentorBrief({ session, turn: record.turn, history: transcript.map((m) => ({ role: m.role, textRu: m.textRu })), text: record.text, library });
    },
    debrief() { return buildDebrief({ session, bundle }); },
  };
}

export const mentorIssue = (record) => record.mentor?.openQuestion?.issueId ?? null;
export const silent = (record) => !record.mentor?.textRu;

/**
 * A structured interpretation, as the semantic interpreter would hand
 * `submitLearnerTurn` (`interpreted` override). Used only where the
 * DETERMINISTIC lexicon cannot parse a compound clause; the resulting turn
 * still goes through the identical execution, mentor and rendering path.
 */
export function interp(text, commands) {
  return {
    intent: "CLINICAL_ACTION",
    commands: commands.map(([type, params], index) => createCommand({ id: `sem-${index}`, type, params: params ?? {}, sourceText: text })),
    rawText: text,
    withheldCommands: [],
    unmatchedFragments: [],
  };
}

export function dialogueContext(r, record) {
  const messages = r.transcript.map((m, index) => ({ id: `m${index}`, role: m.role, textRu: m.textRu }));
  return {
    casePresetId: r.state.session.casePresetId,
    sessionPurpose: r.state.session.purpose,
    locale: r.state.session.locale,
    text: record.text,
    history: messages.slice(-24).map((m) => ({ role: m.role, text: m.textRu })),
    facts: messages.filter((m) => m.role === "env").slice(-80).map((m) => ({ id: m.id, text: m.textRu })),
    historyTruncated: false,
  };
}

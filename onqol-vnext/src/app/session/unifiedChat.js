import { COMMAND } from "../../core/commands/commandTypes.js";
import { DISCUSSION_FRAME } from "../../ai/interpreter/discussionFrame.js";
export { INTENT_CLARIFICATION } from "../../ai/interpreter/discussionFrame.js";

const BOOKKEEPING = new Set([COMMAND.STATE_REASONING, COMMAND.ANSWER_MENTOR]);
const MENTOR_DIALOGUE_CUE = /(?:^|[\s,.!?])(?:не знаю|не уверен[аы]?|не помню|объясни|почему|зачем|что думаешь|давай обсудим)(?=$|[\s,.!?])/iu;
// Conversation cues can conflict with an otherwise literal committed order.
// Do not let a request to discuss an example execute that example.

export function routeUnifiedChat(text, interpreted) {
  const commands = interpreted.commands ?? [];
  const actions = commands.filter((x) => !BOOKKEEPING.has(x.type));
  if (actions.length && DISCUSSION_FRAME.test(text)) return { kind: "clarify", execute: false, discuss: false };
  const explicitDialogue = !!(interpreted.explanationRequest || interpreted.mentorSignal || interpreted.answeredMentorQuestion || MENTOR_DIALOGUE_CUE.test(text) ||
    commands.some((x) => BOOKKEEPING.has(x.type)) || interpreted.withheldCommands?.length);
  // An unrecognised command fragment is an interpreter result, not a teaching
  // issue. Record the turn and let the environment ask for a restatement; the
  // mentor must not invent a clinical discussion around a typo.
  if (!actions.length && !explicitDialogue && interpreted.unmatchedFragments?.length) {
    return { kind: "unrecognized", execute: true, discuss: false };
  }
  const dialogue = !actions.length || explicitDialogue;
  return { kind: actions.length ? (dialogue ? "mixed" : "clinical") : "discussion", execute: commands.length > 0, discuss: dialogue };
}

import { buildTurnContext } from "../../core/session/submitLearnerTurn.js";

// Use only the immediately preceding displayed mentor question. An old
// question must not govern a new order after intervening hospital messages.
export function buildChatTurnContext(session, messages) {
  const context = buildTurnContext(session);
  const last = messages.at(-1);
  const dialogue = session.mentorDialogue?.at(-1);
  if (last?.role === "mentor" && last.textRu === dialogue?.textShown && typeof dialogue.question?.text === "string") {
    return { ...context, precedingPrompt: dialogue.question.text };
  }
  return context;
}

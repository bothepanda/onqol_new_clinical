// A literal order quoted for discussion is not a decision to execute it.
// Shared by the interpreter and chat routing so this boundary does not depend
// on whether the experimental mentor UI is enabled.
export const DISCUSSION_FRAME = /(?:это\s+(?:только\s+)?(?:вопрос|пример)|для\s+обсуждения|как\s+(?:ты|вы)\s+дума(?:ешь|ете)|допустим|представь|цитирую|фраз[ау]\s*[«"])/iu;
export const INTENT_CLARIFICATION = "Ты хочешь выполнить действие сейчас или обсудить его? Уточни и напиши само действие — пока ничего не выполнено.";

import { ChatGroup, ChatSession, CompletionMessage } from "./types";

export function buildCompletionMessages(group: ChatGroup, chat: ChatSession): CompletionMessage[] {
  const messages: CompletionMessage[] = [];
  if (group.systemPrompt.trim()) {
    messages.push({ role: "system", content: group.systemPrompt.trim() });
  }
  for (const message of chat.messages) {
    if (message.role === "system" || !message.content.trim()) {
      continue;
    }
    if (message.role === "assistant" && message.status !== "done") {
      continue;
    }
    messages.push({ role: message.role, content: message.content });
  }
  return messages;
}

import { describe, expect, it } from "vitest";
import { buildCompletionMessages } from "./completion";
import { ChatGroup, ChatSession } from "./types";

describe("buildCompletionMessages", () => {
  it("excludes partial assistant messages from future model context", () => {
    const group: ChatGroup = {
      id: "group",
      kind: "default",
      name: "Default",
      systemPrompt: "Be concise.",
      chats: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const chat: ChatSession = {
      id: "chat",
      groupId: group.id,
      title: "Test",
      titleSource: "auto",
      modelId: "model",
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
      messages: [
        {
          id: "user-1",
          chatId: "chat",
          role: "user",
          content: "Hello",
          reasoningContent: null,
          reasoningStartedAt: null,
          reasoningEndedAt: null,
          modelId: "model",
          modelNameSnapshot: "Model",
          status: "done",
          error: null,
          position: 0,
          createdAt: group.createdAt,
          updatedAt: group.updatedAt,
        },
        {
          id: "assistant-1",
          chatId: "chat",
          role: "assistant",
          content: "Complete answer",
          reasoningContent: "Reasoning",
          reasoningStartedAt: group.createdAt,
          reasoningEndedAt: group.updatedAt,
          modelId: "model",
          modelNameSnapshot: "Model",
          status: "done",
          error: null,
          position: 1,
          createdAt: group.createdAt,
          updatedAt: group.updatedAt,
        },
        {
          id: "assistant-2",
          chatId: "chat",
          role: "assistant",
          content: "Partial answer",
          reasoningContent: "Partial reasoning",
          reasoningStartedAt: group.createdAt,
          reasoningEndedAt: group.updatedAt,
          modelId: "model",
          modelNameSnapshot: "Model",
          status: "stopped",
          error: null,
          position: 2,
          createdAt: group.createdAt,
          updatedAt: group.updatedAt,
        },
      ],
    };

    expect(buildCompletionMessages(group, chat)).toEqual([
      { role: "system", content: "Be concise." },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Complete answer" },
    ]);
  });
});

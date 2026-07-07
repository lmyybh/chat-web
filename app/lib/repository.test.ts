import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDbConnectionForTests } from "./db";
import {
  appendMessage,
  createChat,
  createGroup,
  createModel,
  deleteChat,
  deleteGroup,
  deleteModel,
  editUserMessageAndTruncate,
  getWorkspace,
  renameChat,
  updateModel,
} from "./repository";

let tempDir = "";

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-web-test-"));
  vi.stubEnv("CHAT_WEB_DB_PATH", path.join(tempDir, "chat-web.sqlite"));
  vi.stubEnv("OPENAI_COMPATIBLE_PROVIDERS", "");
  resetDbConnectionForTests();
});

afterEach(() => {
  resetDbConnectionForTests();
  vi.unstubAllEnvs();
  fs.rmSync(tempDir, { force: true, recursive: true });
});

describe("repository", () => {
  it("initializes an empty database with default seed data", () => {
    const workspace = getWorkspace();

    expect(workspace.models).toHaveLength(1);
    expect(workspace.groups).toHaveLength(1);
    expect(workspace.groups[0].chats).toHaveLength(1);
  });

  it("creates and deletes groups while preserving at least one group", () => {
    const initialGroupId = getWorkspace().groups[0].id;
    const created = createGroup();

    let workspace = getWorkspace();
    expect(workspace.groups).toHaveLength(2);

    deleteGroup(created.groupId);
    workspace = getWorkspace();
    expect(workspace.groups.map((group) => group.id)).not.toContain(created.groupId);
    expect(workspace.groups).toHaveLength(1);

    deleteGroup(initialGroupId);
    workspace = getWorkspace();
    expect(workspace.groups).toHaveLength(1);
    expect(workspace.groups.map((group) => group.id)).not.toContain(initialGroupId);
    expect(workspace.groups[0].chats).toHaveLength(1);
  });

  it("deletes a chat and creates a blank replacement when the group would be empty", () => {
    const workspace = getWorkspace();
    const chatId = workspace.groups[0].chats[0].id;

    const result = deleteChat(chatId);
    const next = getWorkspace();

    expect(result?.chatId).not.toBe(chatId);
    expect(next.groups[0].chats).toHaveLength(1);
  });

  it("edits a user message and truncates later messages", () => {
    const chatId = getWorkspace().groups[0].chats[0].id;
    const user = appendMessage({ chatId, role: "user", content: "first" });
    appendMessage({ chatId, role: "assistant", content: "old answer" });
    appendMessage({ chatId, role: "user", content: "later" });

    editUserMessageAndTruncate(user.messageId, "edited");
    const messages = getWorkspace().groups[0].chats[0].messages;

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: "user", content: "edited" });
  });

  it("manual chat title prevents automatic title overwrite", () => {
    const chatId = getWorkspace().groups[0].chats[0].id;

    renameChat(chatId, "Manual name");
    appendMessage({ chatId, role: "user", content: "This should not become the title" });
    const chat = getWorkspace().groups[0].chats[0];

    expect(chat.title).toBe("Manual name");
    expect(chat.titleSource).toBe("manual");
  });

  it("deleting a model keeps message history display snapshots", () => {
    const first = getWorkspace();
    const chatId = first.groups[0].chats[0].id;
    const created = createModel({
      name: "Local",
      model: "qwen",
      providerId: first.models[0].providerId,
    });
    appendMessage({
      chatId,
      role: "assistant",
      content: "hello",
      modelId: created.modelId,
    });

    deleteModel(created.modelId);
    const message = getWorkspace().groups[0].chats[0].messages[0];

    expect(message.modelId).toBeNull();
    expect(message.modelNameSnapshot).toBe("Local");
  });

  it("updates model name, provider, and provider model id", () => {
    vi.stubEnv(
      "OPENAI_COMPATIBLE_PROVIDERS",
      JSON.stringify([
        {
          id: "openai",
          name: "OpenAI",
          baseURL: "https://api.openai.com/v1",
          apiKeyEnv: "OPENAI_API_KEY",
        },
        {
          id: "local",
          name: "Local",
          baseURL: "http://localhost:30000/v1",
          apiKeyEnv: "",
        },
      ]),
    );
    const modelId = getWorkspace().models[0].id;

    updateModel(modelId, {
      name: "Local GLM",
      model: "glm-4.5",
      providerId: "local",
    });
    const model = getWorkspace().models[0];

    expect(model).toMatchObject({
      id: modelId,
      name: "Local GLM",
      model: "glm-4.5",
      providerId: "local",
    });
  });
});

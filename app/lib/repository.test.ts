import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDbConnectionForTests } from "./db";
import { getDb } from "./db";
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
  updateDefaultSystemPrompt,
  updateMessageReasoning,
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
    expect(workspace.defaultGroup).toMatchObject({ kind: "default", name: "Default", systemPrompt: "" });
    expect(workspace.defaultGroup.chats).toHaveLength(0);
    expect(workspace.groups).toHaveLength(0);
  });

  it("creates and deletes user groups without requiring one to remain", () => {
    const created = createGroup();

    let workspace = getWorkspace();
    expect(workspace.groups).toHaveLength(1);
    expect(workspace.groups[0]).toMatchObject({ id: created.groupId, kind: "user" });

    deleteGroup(created.groupId);
    workspace = getWorkspace();
    expect(workspace.groups.map((group) => group.id)).not.toContain(created.groupId);
    expect(workspace.groups).toHaveLength(0);
    expect(workspace.defaultGroup.kind).toBe("default");
  });

  it("deletes a chat without creating a blank replacement", () => {
    const created = createChat();

    const result = deleteChat(created.chatId);
    const next = getWorkspace();

    expect(result?.chatId).toBe(created.chatId);
    expect(next.defaultGroup.chats).toHaveLength(0);
  });

  it("cleans up legacy empty default chats", () => {
    const db = getDb();
    const workspace = getWorkspace();
    const createdAt = new Date().toISOString();
    db.prepare("DELETE FROM app_meta WHERE key = ?").run("cleanup_empty_default_chats_v1");
    db.prepare(
      "INSERT INTO chats (id, group_id, title, title_source, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "legacy_empty_chat",
      workspace.defaultGroup.id,
      "New chat",
      "auto",
      workspace.models[0].id,
      createdAt,
      createdAt,
    );

    resetDbConnectionForTests();
    const next = getWorkspace();

    expect(next.defaultGroup.chats.map((chat) => chat.id)).not.toContain("legacy_empty_chat");
  });

  it("renumbers duplicate legacy message positions before enforcing uniqueness", () => {
    const db = getDb();
    const workspace = getWorkspace();
    const chatId = createChat().chatId;
    const createdAt = new Date().toISOString();
    db.prepare("DROP INDEX IF EXISTS idx_messages_chat_position").run();
    db.prepare(
      `INSERT INTO messages
        (id, chat_id, role, content, reasoning_content, reasoning_started_at, reasoning_ended_at, model_id, model_name_snapshot, status, error, position, created_at, updated_at)
       VALUES (?, ?, 'user', ?, NULL, NULL, NULL, ?, ?, 'done', NULL, 0, ?, ?)`,
    ).run("legacy_msg_1", chatId, "one", workspace.models[0].id, workspace.models[0].name, createdAt, createdAt);
    db.prepare(
      `INSERT INTO messages
        (id, chat_id, role, content, reasoning_content, reasoning_started_at, reasoning_ended_at, model_id, model_name_snapshot, status, error, position, created_at, updated_at)
       VALUES (?, ?, 'assistant', ?, NULL, NULL, NULL, ?, ?, 'done', NULL, 0, ?, ?)`,
    ).run("legacy_msg_2", chatId, "two", workspace.models[0].id, workspace.models[0].name, createdAt, createdAt);

    resetDbConnectionForTests();
    const messages = getWorkspace().defaultGroup.chats[0].messages;
    const index = getDb()
      .prepare("PRAGMA index_list(messages)")
      .all<{ name: string; unique: number }>()
      .find((item) => item.name === "idx_messages_chat_position");

    expect(messages.map((message) => message.position)).toEqual([0, 1]);
    expect(index?.unique).toBe(1);
  });

  it("edits a user message and truncates later messages", () => {
    const chatId = createChat().chatId;
    const user = appendMessage({ chatId, role: "user", content: "first" });
    appendMessage({ chatId, role: "assistant", content: "old answer" });
    appendMessage({ chatId, role: "user", content: "later" });

    editUserMessageAndTruncate(user.messageId, "edited");
    const messages = getWorkspace().defaultGroup.chats[0].messages;

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: "user", content: "edited" });
  });

  it("persists assistant reasoning content", () => {
    const chatId = createChat().chatId;
    const startedAt = "2026-01-01T00:00:00.000Z";
    const endedAt = "2026-01-01T00:00:03.000Z";
    const assistant = appendMessage({
      chatId,
      role: "assistant",
      content: "",
      reasoningContent: "draft thought",
      reasoningStartedAt: startedAt,
      reasoningEndedAt: null,
      status: "streaming",
    });

    updateMessageReasoning(assistant.messageId, "final thought", startedAt, endedAt);
    const message = getWorkspace().defaultGroup.chats[0].messages[0];

    expect(message).toMatchObject({
      reasoningContent: "final thought",
      reasoningStartedAt: startedAt,
      reasoningEndedAt: endedAt,
    });
  });

  it("manual chat title prevents automatic title overwrite", () => {
    const chatId = createChat().chatId;

    renameChat(chatId, "Manual name");
    appendMessage({ chatId, role: "user", content: "This should not become the title" });
    const chat = getWorkspace().defaultGroup.chats[0];

    expect(chat.title).toBe("Manual name");
    expect(chat.titleSource).toBe("manual");
  });

  it("deleting a model keeps message history display snapshots", () => {
    const first = getWorkspace();
    const chatId = createChat().chatId;
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
    const message = getWorkspace().defaultGroup.chats[0].messages[0];

    expect(message.modelId).toBeNull();
    expect(message.modelNameSnapshot).toBe("Local");
  });

  it("updates the default group system prompt for ungrouped chats", () => {
    updateDefaultSystemPrompt("Default prompt");

    expect(getWorkspace().defaultGroup.systemPrompt).toBe("Default prompt");
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

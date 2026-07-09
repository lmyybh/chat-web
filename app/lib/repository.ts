import { getDb } from "./db";
import { getProviders } from "./providers";
import {
  ChatGroup,
  ChatMessage,
  ChatRole,
  ChatSession,
  MessageStatus,
  ModelConfig,
  Workspace,
} from "./types";

type ModelRow = {
  id: string;
  name: string;
  model: string;
  provider_id: string;
  created_at: string;
  updated_at: string;
};

type GroupRow = {
  id: string;
  kind: "default" | "user";
  name: string;
  system_prompt: string;
  created_at: string;
  updated_at: string;
};

type ChatRow = {
  id: string;
  group_id: string;
  title: string;
  title_source: "auto" | "manual";
  model_id: string;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  chat_id: string;
  role: ChatRole;
  content: string;
  reasoning_content: string | null;
  reasoning_started_at: string | null;
  reasoning_ended_at: string | null;
  model_id: string | null;
  model_name_snapshot: string | null;
  status: MessageStatus;
  error: string | null;
  position: number;
  created_at: string;
  updated_at: string;
};

export type NewModelInput = {
  name: string;
  model: string;
  providerId: string;
};

export type NewMessageInput = {
  chatId: string;
  role: ChatRole;
  content: string;
  reasoningContent?: string | null;
  reasoningStartedAt?: string | null;
  reasoningEndedAt?: string | null;
  modelId?: string | null;
  status?: MessageStatus;
  error?: string | null;
};

const uid = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const nowIso = () => new Date().toISOString();

export function getWorkspace(): Workspace {
  ensureSeedData();
  const db = getDb();
  const models = db
    .prepare("SELECT * FROM models ORDER BY created_at ASC")
    .all<ModelRow>()
    .map(mapModel);
  const groupRows = db.prepare("SELECT * FROM groups ORDER BY created_at ASC").all<GroupRow>();
  const chatRows = db
    .prepare("SELECT * FROM chats ORDER BY updated_at DESC, created_at DESC")
    .all<ChatRow>();
  const messageRows = db
    .prepare("SELECT * FROM messages ORDER BY position ASC, created_at ASC")
    .all<MessageRow>();

  const messagesByChat = new Map<string, ChatMessage[]>();
  for (const row of messageRows) {
    const messages = messagesByChat.get(row.chat_id) ?? [];
    messages.push(mapMessage(row));
    messagesByChat.set(row.chat_id, messages);
  }

  const chatsByGroup = new Map<string, ChatSession[]>();
  for (const row of chatRows) {
    const chats = chatsByGroup.get(row.group_id) ?? [];
    chats.push({ ...mapChat(row), messages: messagesByChat.get(row.id) ?? [] });
    chatsByGroup.set(row.group_id, chats);
  }

  return {
    models,
    defaultGroup: buildGroup(
      groupRows.find((row) => row.kind === "default") ?? groupRows[0],
      chatsByGroup,
    ),
    groups: groupRows
      .filter((row) => row.kind === "user")
      .map((row) => buildGroup(row, chatsByGroup)),
  };
}

export function createGroup(name?: string) {
  ensureSeedData();
  const db = getDb();
  const createdAt = nowIso();
  const groupId = uid("group");
  const groupName = name?.trim() || `Group ${getUserGroupCount() + 1}`;

  db.prepare(
    "INSERT INTO groups (id, kind, name, system_prompt, created_at, updated_at) VALUES (?, 'user', ?, ?, ?, ?)",
  ).run(groupId, groupName, "You are a helpful assistant.", createdAt, createdAt);

  return { groupId };
}

export function updateGroup(groupId: string, patch: { name: string; systemPrompt: string }) {
  ensureSeedData();
  const group = getGroupRow(groupId);
  if (!group) {
    throw new Error("Group not found.");
  }
  if (group.kind === "default") {
    getDb()
      .prepare("UPDATE groups SET system_prompt = ?, updated_at = ? WHERE id = ?")
      .run(patch.systemPrompt, nowIso(), groupId);
    return;
  }
  const name = patch.name.trim() || "Untitled group";
  getDb()
    .prepare("UPDATE groups SET name = ?, system_prompt = ?, updated_at = ? WHERE id = ?")
    .run(name, patch.systemPrompt, nowIso(), groupId);
}

export function updateDefaultSystemPrompt(systemPrompt: string) {
  ensureSeedData();
  const defaultGroup = getDefaultGroupRow();
  getDb()
    .prepare("UPDATE groups SET system_prompt = ?, updated_at = ? WHERE id = ?")
    .run(systemPrompt, nowIso(), defaultGroup.id);
}

export function deleteGroup(groupId: string) {
  ensureSeedData();
  const db = getDb();
  const group = getGroupRow(groupId);
  if (!group) {
    return null;
  }
  if (group.kind === "default") {
    throw new Error("The default chat container cannot be deleted.");
  }
  db.prepare("DELETE FROM groups WHERE id = ?").run(groupId);
  return { groupId };
}

export function createChat(groupId?: string, modelId?: string) {
  ensureSeedData();
  const db = getDb();
  const targetGroupId = groupId || getDefaultGroupRow().id;
  const group = getGroupRow(targetGroupId);
  if (!group) {
    throw new Error("Group not found.");
  }
  const createdAt = nowIso();
  const chatId = uid("chat");
  const selectedModelId = modelId && getModelRow(modelId) ? modelId : getFallbackModelId();
  db.prepare(
    "INSERT INTO chats (id, group_id, title, title_source, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(chatId, targetGroupId, "New chat", "auto", selectedModelId, createdAt, createdAt);
  return { chatId };
}

export function deleteChat(chatId: string) {
  ensureSeedData();
  const db = getDb();
  return db.transaction(() => {
    const chat = getChatRow(chatId);
    if (!chat) {
      return null;
    }
    db.prepare("DELETE FROM chats WHERE id = ?").run(chatId);
    return { groupId: chat.group_id, chatId };
  })();
}

export function renameChat(chatId: string, title: string) {
  ensureSeedData();
  const nextTitle = title.trim() || "New chat";
  getDb()
    .prepare("UPDATE chats SET title = ?, title_source = 'manual', updated_at = ? WHERE id = ?")
    .run(nextTitle, nowIso(), chatId);
}

export function moveChat(chatId: string, groupId: string) {
  ensureSeedData();
  const chat = getChatRow(chatId);
  if (!chat) {
    throw new Error("Chat not found.");
  }
  const group = getGroupRow(groupId);
  if (!group) {
    throw new Error("Group not found.");
  }
  getDb().prepare("UPDATE chats SET group_id = ?, updated_at = ? WHERE id = ?").run(groupId, nowIso(), chatId);
  return { chatId, groupId };
}

export function setChatModel(chatId: string, modelId: string) {
  ensureSeedData();
  if (!getModelRow(modelId)) {
    throw new Error("Model not found.");
  }
  getDb().prepare("UPDATE chats SET model_id = ?, updated_at = ? WHERE id = ?").run(modelId, nowIso(), chatId);
}

export function createModel(input: NewModelInput) {
  ensureSeedData();
  const provider = getProviders().find((item) => item.id === input.providerId);
  if (!provider) {
    throw new Error("Provider not found.");
  }
  const createdAt = nowIso();
  const modelId = uid("model");
  getDb()
    .prepare(
      "INSERT INTO models (id, name, model, provider_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(modelId, input.name.trim(), input.model.trim(), input.providerId, createdAt, createdAt);
  return { modelId };
}

export function updateModel(modelId: string, input: NewModelInput) {
  ensureSeedData();
  const provider = getProviders().find((item) => item.id === input.providerId);
  if (!provider) {
    throw new Error("Provider not found.");
  }
  const name = input.name.trim();
  const model = input.model.trim();
  if (!name || !model) {
    throw new Error("Model name and id are required.");
  }
  getDb()
    .prepare("UPDATE models SET name = ?, model = ?, provider_id = ?, updated_at = ? WHERE id = ?")
    .run(name, model, input.providerId, nowIso(), modelId);
  return { modelId };
}

export function deleteModel(modelId: string) {
  ensureSeedData();
  const db = getDb();
  return db.transaction(() => {
    const models = db.prepare("SELECT * FROM models ORDER BY created_at ASC").all<ModelRow>();
    if (models.length <= 1) {
      return null;
    }
    const fallback = models.find((model) => model.id !== modelId);
    if (!fallback) {
      return null;
    }
    db.prepare("UPDATE chats SET model_id = ?, updated_at = ? WHERE model_id = ?").run(
      fallback.id,
      nowIso(),
      modelId,
    );
    db.prepare("DELETE FROM models WHERE id = ?").run(modelId);
    return { fallbackModelId: fallback.id };
  })();
}

export function appendMessage(input: NewMessageInput) {
  ensureSeedData();
  const db = getDb();
  const chat = getChatRow(input.chatId);
  if (!chat) {
    throw new Error("Chat not found.");
  }
  const createdAt = nowIso();
  const messageId = uid("msg");
  const model = input.modelId ? getModelRow(input.modelId) : getModelRow(chat.model_id);

  db.transaction(() => {
    db.prepare(
      `INSERT INTO messages
        (id, chat_id, role, content, reasoning_content, reasoning_started_at, reasoning_ended_at, model_id, model_name_snapshot, status, error, position, created_at, updated_at)
       VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         COALESCE((SELECT MAX(position) + 1 FROM messages WHERE chat_id = ?), 0),
         ?, ?
       )`,
    ).run(
      messageId,
      input.chatId,
      input.role,
      input.content,
      input.reasoningContent ?? null,
      input.reasoningStartedAt ?? null,
      input.reasoningEndedAt ?? null,
      model?.id ?? null,
      model?.name ?? null,
      input.status ?? "done",
      input.error ?? null,
      input.chatId,
      createdAt,
      createdAt,
    );
    touchChat(input.chatId);
    maybeRefreshAutoTitle(input.chatId);
  })();

  return { messageId };
}

export function editUserMessageAndTruncate(messageId: string, content: string) {
  ensureSeedData();
  const db = getDb();
  return db.transaction(() => {
    const message = getMessageRow(messageId);
    if (!message || message.role !== "user") {
      throw new Error("Only user messages can be edited.");
    }
    const chat = getChatRow(message.chat_id);
    if (!chat) {
      throw new Error("Chat not found.");
    }
    const model = getModelRow(chat.model_id);
    db.prepare("DELETE FROM messages WHERE chat_id = ? AND position > ?").run(
      message.chat_id,
      message.position,
    );
    db.prepare(
      "UPDATE messages SET content = ?, model_id = ?, model_name_snapshot = ?, status = 'done', error = NULL, updated_at = ? WHERE id = ?",
    ).run(content, model?.id ?? null, model?.name ?? null, nowIso(), messageId);
    touchChat(message.chat_id);
    maybeRefreshAutoTitle(message.chat_id);
    return { chatId: message.chat_id };
  })();
}

export function updateMessageContent(messageId: string, content: string) {
  ensureSeedData();
  getDb()
    .prepare("UPDATE messages SET content = ?, updated_at = ? WHERE id = ?")
    .run(content, nowIso(), messageId);
  const message = getMessageRow(messageId);
  if (message) {
    touchChat(message.chat_id);
  }
}

export function updateMessageReasoning(
  messageId: string,
  reasoningContent: string | null,
  reasoningStartedAt: string | null,
  reasoningEndedAt: string | null = null,
) {
  ensureSeedData();
  getDb()
    .prepare(
      "UPDATE messages SET reasoning_content = ?, reasoning_started_at = ?, reasoning_ended_at = ?, updated_at = ? WHERE id = ?",
    )
    .run(reasoningContent, reasoningStartedAt, reasoningEndedAt, nowIso(), messageId);
  const message = getMessageRow(messageId);
  if (message) {
    touchChat(message.chat_id);
  }
}

export function updateMessageStatus(messageId: string, status: MessageStatus, error?: string | null) {
  ensureSeedData();
  getDb()
    .prepare("UPDATE messages SET status = ?, error = ?, updated_at = ? WHERE id = ?")
    .run(status, error ?? null, nowIso(), messageId);
  const message = getMessageRow(messageId);
  if (message) {
    touchChat(message.chat_id);
  }
}

export function ensureSeedData() {
  const db = getDb();
  const modelCount = db.prepare("SELECT COUNT(*) AS count FROM models").get<{ count: number }>()?.count ?? 0;
  const defaultGroup = db.prepare("SELECT id FROM groups WHERE kind = 'default' LIMIT 1").get<{ id: string }>();
  if (modelCount > 0 && defaultGroup) {
    return;
  }

  db.transaction(() => {
    let modelId = getFallbackModelId(false);
    if (!modelId) {
      const provider = getProviders()[0];
      const createdAt = nowIso();
      modelId = uid("model");
      db.prepare(
        "INSERT INTO models (id, name, model, provider_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(modelId, "GPT-4o mini", "gpt-4o-mini", provider.id, createdAt, createdAt);
    }
    if (!db.prepare("SELECT id FROM groups WHERE kind = 'default' LIMIT 1").get<{ id: string }>()) {
      createDefaultGroup();
    }
  })();
}

function createDefaultGroup() {
  const db = getDb();
  const createdAt = nowIso();
  const groupId = uid("group");
  db.prepare(
    "INSERT INTO groups (id, kind, name, system_prompt, created_at, updated_at) VALUES (?, 'default', ?, ?, ?, ?)",
  ).run(groupId, "Default", "", createdAt, createdAt);
  return { groupId };
}

function getFallbackModelId(ensure = true) {
  if (ensure) {
    ensureSeedData();
  }
  const model = getDb().prepare("SELECT id FROM models ORDER BY created_at ASC LIMIT 1").get<{ id: string }>();
  if (!model) {
    if (!ensure) {
      return null;
    }
    throw new Error("No model is configured.");
  }
  return model.id;
}

function getUserGroupCount() {
  return getDb()
    .prepare("SELECT COUNT(*) AS count FROM groups WHERE kind = 'user'")
    .get<{ count: number }>()?.count ?? 0;
}

function getGroupRow(groupId: string) {
  return getDb().prepare("SELECT * FROM groups WHERE id = ?").get<GroupRow>(groupId);
}

function getDefaultGroupRow() {
  const group = getDb()
    .prepare("SELECT * FROM groups WHERE kind = 'default' ORDER BY created_at ASC LIMIT 1")
    .get<GroupRow>();
  if (!group) {
    throw new Error("Default chat container is missing.");
  }
  return group;
}

function getChatRow(chatId: string) {
  return getDb().prepare("SELECT * FROM chats WHERE id = ?").get<ChatRow>(chatId);
}

function getMessageRow(messageId: string) {
  return getDb().prepare("SELECT * FROM messages WHERE id = ?").get<MessageRow>(messageId);
}

function getModelRow(modelId: string) {
  return getDb().prepare("SELECT * FROM models WHERE id = ?").get<ModelRow>(modelId);
}

function touchChat(chatId: string) {
  getDb().prepare("UPDATE chats SET updated_at = ? WHERE id = ?").run(nowIso(), chatId);
}

function maybeRefreshAutoTitle(chatId: string) {
  const db = getDb();
  const chat = getChatRow(chatId);
  if (!chat || chat.title_source !== "auto") {
    return;
  }
  const firstUser = db
    .prepare("SELECT content FROM messages WHERE chat_id = ? AND role = 'user' ORDER BY position ASC LIMIT 1")
    .get<{ content: string }>(chatId);
  const title = firstUser ? buildTitle(firstUser.content) : "New chat";
  db.prepare("UPDATE chats SET title = ?, updated_at = ? WHERE id = ?").run(title, nowIso(), chatId);
}

function buildTitle(content: string) {
  const trimmed = content.trim();
  if (!trimmed) {
    return "New chat";
  }
  return trimmed.length > 42 ? `${trimmed.slice(0, 42)}...` : trimmed;
}

function mapModel(row: ModelRow): ModelConfig {
  return {
    id: row.id,
    name: row.name,
    model: row.model,
    providerId: row.provider_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildGroup(row: GroupRow, chatsByGroup: Map<string, ChatSession[]>): ChatGroup {
  return {
    ...mapGroup(row),
    chats: chatsByGroup.get(row.id) ?? [],
  };
}

function mapGroup(row: GroupRow): Omit<ChatGroup, "chats"> {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    systemPrompt: row.system_prompt,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapChat(row: ChatRow): Omit<ChatSession, "messages"> {
  return {
    id: row.id,
    groupId: row.group_id,
    title: row.title,
    titleSource: row.title_source,
    modelId: row.model_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    chatId: row.chat_id,
    role: row.role,
    content: row.content,
    reasoningContent: row.reasoning_content,
    reasoningStartedAt: row.reasoning_started_at,
    reasoningEndedAt: row.reasoning_ended_at,
    modelId: row.model_id,
    modelNameSnapshot: row.model_name_snapshot,
    status: row.status,
    error: row.error,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

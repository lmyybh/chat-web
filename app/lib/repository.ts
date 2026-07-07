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
    groups: groupRows.map((row) => ({
      ...mapGroup(row),
      chats: chatsByGroup.get(row.id) ?? [],
    })),
  };
}

export function createGroup() {
  ensureSeedData();
  const db = getDb();
  const createdAt = nowIso();
  const groupId = uid("group");
  const modelId = getFallbackModelId();
  const chatId = uid("chat");

  db.transaction(() => {
    db.prepare(
      "INSERT INTO groups (id, name, system_prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run(groupId, `Group ${getGroupCount() + 1}`, "You are a helpful assistant.", createdAt, createdAt);
    db.prepare(
      "INSERT INTO chats (id, group_id, title, title_source, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(chatId, groupId, "New chat", "auto", modelId, createdAt, createdAt);
  })();

  return { groupId, chatId };
}

export function updateGroup(groupId: string, patch: { name: string; systemPrompt: string }) {
  ensureSeedData();
  const name = patch.name.trim() || "Untitled group";
  getDb()
    .prepare("UPDATE groups SET name = ?, system_prompt = ?, updated_at = ? WHERE id = ?")
    .run(name, patch.systemPrompt, nowIso(), groupId);
}

export function deleteGroup(groupId: string) {
  ensureSeedData();
  const db = getDb();
  const deleted = db.transaction(() => {
    const group = getGroupRow(groupId);
    if (!group) {
      return null;
    }
    db.prepare("DELETE FROM groups WHERE id = ?").run(groupId);
    if (getGroupCount() === 0) {
      const fallbackModelId = getFallbackModelId(false);
      if (!fallbackModelId) {
        throw new Error("No model is configured.");
      }
      const created = createDefaultGroupAndChat(fallbackModelId);
      return created;
    }
    const fallback = db
      .prepare("SELECT id, group_id FROM chats ORDER BY updated_at DESC LIMIT 1")
      .get<{ id: string; group_id: string }>();
    return fallback ? { groupId: fallback.group_id, chatId: fallback.id } : null;
  })();
  return deleted;
}

export function createChat(groupId: string, modelId?: string) {
  ensureSeedData();
  const db = getDb();
  const group = getGroupRow(groupId);
  if (!group) {
    throw new Error("Group not found.");
  }
  const createdAt = nowIso();
  const chatId = uid("chat");
  const selectedModelId = modelId && getModelRow(modelId) ? modelId : getFallbackModelId();
  db.prepare(
    "INSERT INTO chats (id, group_id, title, title_source, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(chatId, groupId, "New chat", "auto", selectedModelId, createdAt, createdAt);
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

    const remainingInGroup = db
      .prepare("SELECT id FROM chats WHERE group_id = ? ORDER BY updated_at DESC LIMIT 1")
      .get<{ id: string }>(chat.group_id);
    if (remainingInGroup) {
      return { groupId: chat.group_id, chatId: remainingInGroup.id };
    }

    const createdAt = nowIso();
    const fallbackChatId = uid("chat");
    db.prepare(
      "INSERT INTO chats (id, group_id, title, title_source, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(fallbackChatId, chat.group_id, "New chat", "auto", chat.model_id, createdAt, createdAt);
    return { groupId: chat.group_id, chatId: fallbackChatId };
  })();
}

export function renameChat(chatId: string, title: string) {
  ensureSeedData();
  const nextTitle = title.trim() || "New chat";
  getDb()
    .prepare("UPDATE chats SET title = ?, title_source = 'manual', updated_at = ? WHERE id = ?")
    .run(nextTitle, nowIso(), chatId);
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
  const position =
    (db
      .prepare("SELECT MAX(position) AS max_position FROM messages WHERE chat_id = ?")
      .get<{ max_position: number | null }>(input.chatId)?.max_position ?? -1) + 1;

  db.transaction(() => {
    db.prepare(
      `INSERT INTO messages
        (id, chat_id, role, content, model_id, model_name_snapshot, status, error, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      messageId,
      input.chatId,
      input.role,
      input.content,
      model?.id ?? null,
      model?.name ?? null,
      input.status ?? "done",
      input.error ?? null,
      position,
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
  if (modelCount > 0 && getGroupCount() > 0) {
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
    if (getGroupCount() === 0) {
      createDefaultGroupAndChat(modelId);
    }
  })();
}

function createDefaultGroupAndChat(modelId: string) {
  const db = getDb();
  const createdAt = nowIso();
  const groupId = uid("group");
  const chatId = uid("chat");
  db.prepare(
    "INSERT INTO groups (id, name, system_prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run(groupId, "Default", "You are a helpful assistant.", createdAt, createdAt);
  db.prepare(
    "INSERT INTO chats (id, group_id, title, title_source, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(chatId, groupId, "New chat", "auto", modelId, createdAt, createdAt);
  return { groupId, chatId };
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

function getGroupCount() {
  return getDb().prepare("SELECT COUNT(*) AS count FROM groups").get<{ count: number }>()?.count ?? 0;
}

function getGroupRow(groupId: string) {
  return getDb().prepare("SELECT * FROM groups WHERE id = ?").get<GroupRow>(groupId);
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

function mapGroup(row: GroupRow): Omit<ChatGroup, "chats"> {
  return {
    id: row.id,
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
    modelId: row.model_id,
    modelNameSnapshot: row.model_name_snapshot,
    status: row.status,
    error: row.error,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

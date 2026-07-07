import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

let connection: Database | null = null;
let connectionPath = "";

export function getDb() {
  const dbPath = getDatabasePath();
  if (connection && connectionPath === dbPath) {
    return connection;
  }

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  connection = new Database(dbPath);
  connectionPath = dbPath;
  connection.pragma("journal_mode = WAL");
  connection.pragma("foreign_keys = ON");
  migrate(connection);
  return connection;
}

export function resetDbConnectionForTests() {
  connection = null;
  connectionPath = "";
}

function getDatabasePath() {
  return process.env.CHAT_WEB_DB_PATH || path.join(process.cwd(), "data", "chat-web.sqlite");
}

function migrate(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      api_key TEXT,
      api_key_env TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS models (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      model TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      title_source TEXT NOT NULL CHECK (title_source IN ('auto', 'manual')),
      model_id TEXT NOT NULL REFERENCES models(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
      content TEXT NOT NULL,
      model_id TEXT REFERENCES models(id) ON DELETE SET NULL,
      model_name_snapshot TEXT,
      status TEXT NOT NULL CHECK (status IN ('done', 'streaming', 'error', 'stopped')),
      error TEXT,
      position INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chats_group_id ON chats(group_id);
    CREATE INDEX IF NOT EXISTS idx_messages_chat_position ON messages(chat_id, position);
  `);
}

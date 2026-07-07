import { getDb } from "./db";
import { ProviderConfig, PublicProvider } from "./types";

type ProviderRow = {
  id: string;
  name: string;
  base_url: string;
  api_key: string | null;
  api_key_env: string | null;
  created_at: string;
  updated_at: string;
};

export type NewProviderInput = {
  id: string;
  name: string;
  baseURL: string;
  apiKey?: string | null;
};

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

export function getProviders(): ProviderConfig[] {
  ensureProviderSeedData();
  return getDb()
    .prepare("SELECT * FROM providers ORDER BY created_at ASC")
    .all<ProviderRow>()
    .map(mapProvider);
}

export function getPublicProviders(): PublicProvider[] {
  return getProviders().map(({ id, name, baseURL, apiKey, apiKeyEnv }) => ({
    id,
    name,
    baseURL,
    hasApiKey: Boolean(apiKey || (apiKeyEnv && process.env[apiKeyEnv])),
  }));
}

export function getProvider(providerId: string) {
  ensureProviderSeedData();
  const row = getDb().prepare("SELECT * FROM providers WHERE id = ?").get<ProviderRow>(providerId);
  return row ? mapProvider(row) : null;
}

export function createProvider(input: NewProviderInput) {
  ensureProviderSeedData();
  const provider = normalizeProviderInput(input);
  const createdAt = nowIso();
  getDb()
    .prepare(
      "INSERT INTO providers (id, name, base_url, api_key, api_key_env, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(provider.id, provider.name, provider.baseURL, provider.apiKey || null, null, createdAt, createdAt);
  return { providerId: provider.id };
}

export function deleteProvider(providerId: string) {
  ensureProviderSeedData();
  const db = getDb();
  const providerCount = db.prepare("SELECT COUNT(*) AS count FROM providers").get<{ count: number }>()?.count ?? 0;
  if (providerCount <= 1) {
    throw new Error("At least one provider must remain.");
  }
  const modelCount =
    db.prepare("SELECT COUNT(*) AS count FROM models WHERE provider_id = ?").get<{ count: number }>(providerId)
      ?.count ?? 0;
  if (modelCount > 0) {
    throw new Error("Delete or move models that use this provider first.");
  }
  db.prepare("DELETE FROM providers WHERE id = ?").run(providerId);
  return { providerId };
}

export function getProviderAuthHeader(provider: ProviderConfig): Record<string, string> {
  if (provider.apiKeyEnv) {
    const envKey = process.env[provider.apiKeyEnv];
    if (!envKey) {
      throw new Error(`Missing ${provider.apiKeyEnv} on the server for provider ${provider.name}.`);
    }
    return { Authorization: `Bearer ${envKey}` };
  }
  if (!provider.apiKey) {
    return {};
  }
  return { Authorization: `Bearer ${provider.apiKey}` };
}

export function ensureProviderSeedData() {
  const db = getDb();
  const count = db.prepare("SELECT COUNT(*) AS count FROM providers").get<{ count: number }>()?.count ?? 0;
  if (count > 0) {
    normalizeEnvBackedProviderKeys();
    return;
  }

  const createdAt = nowIso();
  const providers = getInitialProviders();
  const insert = db.prepare(
    "INSERT INTO providers (id, name, base_url, api_key, api_key_env, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  db.transaction(() => {
    for (const provider of providers) {
      insert.run(
        provider.id,
        provider.name,
        provider.baseURL,
        provider.apiKey || null,
        provider.apiKeyEnv || null,
        createdAt,
        createdAt,
      );
    }
  })();
}

function getInitialProviders(): ProviderConfig[] {
  const raw = process.env.OPENAI_COMPATIBLE_PROVIDERS;
  if (!raw?.trim()) {
    return [
      {
        id: "openai",
        name: "OpenAI",
        baseURL: normalizeBaseUrl(process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL),
        apiKey: null,
        apiKeyEnv: "OPENAI_API_KEY",
      },
    ];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("OPENAI_COMPATIBLE_PROVIDERS must be valid JSON.");
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("OPENAI_COMPATIBLE_PROVIDERS must be a non-empty array.");
  }

  return parsed.map((item, index) => parseEnvProvider(item, index));
}

function parseEnvProvider(item: unknown, index: number): ProviderConfig {
  if (!item || typeof item !== "object") {
    throw new Error(`Provider at index ${index} must be an object.`);
  }
  const provider = item as Record<string, unknown>;
  if (
    typeof provider.id !== "string" ||
    typeof provider.name !== "string" ||
    typeof provider.baseURL !== "string"
  ) {
    throw new Error(`Provider at index ${index} must include id, name, and baseURL.`);
  }
  if (provider.apiKeyEnv !== undefined && typeof provider.apiKeyEnv !== "string") {
    throw new Error(`Provider ${provider.id} has invalid apiKeyEnv.`);
  }
  const apiKeyEnv = provider.apiKeyEnv ?? "OPENAI_API_KEY";
  return {
    id: provider.id.trim(),
    name: provider.name.trim(),
    baseURL: normalizeBaseUrl(provider.baseURL),
    apiKey: null,
    apiKeyEnv,
  };
}

function normalizeEnvBackedProviderKeys() {
  const openAiKey = process.env.OPENAI_API_KEY;
  if (!openAiKey) {
    return;
  }
  getDb()
    .prepare(
      "UPDATE providers SET api_key = NULL, api_key_env = 'OPENAI_API_KEY', updated_at = ? WHERE id = 'openai' AND api_key = ? AND api_key_env IS NULL",
    )
    .run(nowIso(), openAiKey);
}

function normalizeProviderInput(input: NewProviderInput) {
  const id = input.id.trim();
  const name = input.name.trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error("Provider id can only include letters, numbers, underscores, and hyphens.");
  }
  if (!name) {
    throw new Error("Provider name is required.");
  }
  return {
    id,
    name,
    baseURL: normalizeBaseUrl(input.baseURL),
    apiKey: input.apiKey?.trim() || null,
  };
}

function mapProvider(row: ProviderRow): ProviderConfig {
  return {
    id: row.id,
    name: row.name,
    baseURL: row.base_url,
    apiKey: row.api_key,
    apiKeyEnv: row.api_key_env,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeBaseUrl(baseURL: string) {
  const trimmed = baseURL.trim() || DEFAULT_BASE_URL;
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

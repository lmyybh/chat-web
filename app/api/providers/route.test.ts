import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_SESSION_COOKIE, API_SESSION_HEADER } from "../../lib/api-session";
import { resetDbConnectionForTests } from "../../lib/db";
import { getDb } from "../../lib/db";
import { DELETE, GET, POST } from "./route";

let tempDir = "";

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-web-provider-test-"));
  vi.stubEnv("CHAT_WEB_DB_PATH", path.join(tempDir, "chat-web.sqlite"));
  vi.stubEnv("OPENAI_COMPATIBLE_PROVIDERS", "");
  vi.stubEnv("OPENAI_API_KEY", "");
  resetDbConnectionForTests();
});

afterEach(() => {
  resetDbConnectionForTests();
  vi.unstubAllEnvs();
  fs.rmSync(tempDir, { force: true, recursive: true });
});

describe("/api/providers", () => {
  it("returns only public provider fields", async () => {
    const response = await GET(new Request("http://localhost/api/providers"));
    const data = await response.json();

    expect(data).toEqual({
      providers: [
        {
          id: "openai",
          name: "OpenAI",
          baseURL: "https://api.openai.com/v1",
          hasApiKey: false,
        },
      ],
    });
    expect(JSON.stringify(data)).not.toContain("apiKey:");
    expect(JSON.stringify(data)).not.toContain("apiKeyEnv");
  });

  it("creates and deletes providers without returning api keys", async () => {
    const sessionHeaders = await createSessionHeaders();
    const createResponse = await POST(
      new Request("http://localhost/api/providers", {
        method: "POST",
        headers: sessionHeaders.json,
        body: JSON.stringify({
          id: "local",
          name: "Local",
          baseURL: "http://localhost:30000/v1/",
          apiKey: "secret-key",
        }),
      }),
    );

    expect(createResponse.status).toBe(200);
    const created = await createResponse.json();
    expect(created.providers).toContainEqual({
      id: "local",
      name: "Local",
      baseURL: "http://localhost:30000/v1",
      hasApiKey: true,
    });
    expect(JSON.stringify(created)).not.toContain("secret-key");

    const deleteResponse = await DELETE(
      new Request("http://localhost/api/providers?id=local", {
        headers: sessionHeaders.session,
      }),
    );
    expect(deleteResponse.status).toBe(200);
    const deleted = await deleteResponse.json();
    expect(deleted.providers.map((provider: { id: string }) => provider.id)).not.toContain("local");
  });

  it("rejects cross-origin provider mutations", async () => {
    const sessionHeaders = await createSessionHeaders();

    const response = await POST(
      new Request("http://localhost/api/providers", {
        method: "POST",
        headers: {
          ...sessionHeaders.json,
          Origin: "http://malicious.invalid",
        },
        body: JSON.stringify({
          id: "local",
          name: "Local",
          baseURL: "http://localhost:30000/v1",
        }),
      }),
    );

    expect(response.status).toBe(403);
  });

  it("keeps env-backed OpenAI keys out of SQLite while reporting availability", async () => {
    vi.stubEnv("OPENAI_API_KEY", "env-key");
    resetDbConnectionForTests();

    const response = await GET(new Request("http://localhost/api/providers"));
    const data = await response.json();
    const row = getDb()
      .prepare("SELECT api_key, api_key_env FROM providers WHERE id = ?")
      .get<{ api_key: string | null; api_key_env: string | null }>("openai");

    expect(data.providers[0]).toMatchObject({ id: "openai", hasApiKey: true });
    expect(row).toEqual({ api_key: null, api_key_env: "OPENAI_API_KEY" });
  });
});

async function createSessionHeaders() {
  const response = await GET(new Request("http://localhost/api/providers"));
  const token = extractSessionToken(response);
  const session = {
    Cookie: `${API_SESSION_COOKIE}=${token}`,
    [API_SESSION_HEADER]: token,
  };
  return {
    session,
    json: {
      ...session,
      "Content-Type": "application/json",
    },
  };
}

function extractSessionToken(response: Response) {
  const cookie = response.headers.get("set-cookie") || "";
  const match = new RegExp(`${API_SESSION_COOKIE}=([^;]+)`).exec(cookie);
  if (!match) {
    throw new Error("Missing API session cookie.");
  }
  return match[1];
}

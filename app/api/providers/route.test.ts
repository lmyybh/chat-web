import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDbConnectionForTests } from "../../lib/db";
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
    const response = await GET();
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
    const createResponse = await POST(
      new Request("http://localhost/api/providers", {
        method: "POST",
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

    const deleteResponse = await DELETE(new Request("http://localhost/api/providers?id=local"));
    expect(deleteResponse.status).toBe(200);
    const deleted = await deleteResponse.json();
    expect(deleted.providers.map((provider: { id: string }) => provider.id)).not.toContain("local");
  });
});

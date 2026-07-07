import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDbConnectionForTests } from "../../lib/db";
import { POST } from "./route";

let tempDir = "";

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-web-chat-test-"));
  vi.stubEnv("CHAT_WEB_DB_PATH", path.join(tempDir, "chat-web.sqlite"));
  resetDbConnectionForTests();
});

afterEach(() => {
  resetDbConnectionForTests();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fs.rmSync(tempDir, { force: true, recursive: true });
});

describe("/api/chat", () => {
  it("returns a clear error when provider API key is missing", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENAI_COMPATIBLE_PROVIDERS", "");

    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({
          providerId: "openai",
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "hello" }],
        }),
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Missing OPENAI_API_KEY on the server for provider OpenAI.",
    });
  });

  it("rejects unknown provider ids", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_COMPATIBLE_PROVIDERS", "");

    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({
          providerId: "unknown",
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "hello" }],
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Unknown providerId." });
  });

  it("validates request body", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_COMPATIBLE_PROVIDERS", "");

    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({ providerId: "openai", model: "", messages: [] }),
      }),
    );

    expect(response.status).toBe(400);
  });

  it("streams provider deltas without accepting arbitrary base URLs", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_COMPATIBLE_PROVIDERS", "");
    const encoder = new TextEncoder();
    const providerStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"content":"hel"}}]}\n\ndata: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n\n',
          ),
        );
        controller.close();
      },
    });
    const fetchMock = vi.fn(async () => new Response(providerStream, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({
          providerId: "openai",
          model: "gpt-4o-mini",
          baseURL: "http://malicious.invalid/v1",
          messages: [{ role: "user", content: "hello" }],
        }),
      }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
      }),
    );
    const text = await response.text();
    expect(text).toContain('data: {"delta":"hel"}');
    expect(text).toContain('data: {"delta":"lo"}');
  });

  it("forwards provider stream errors", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_COMPATIBLE_PROVIDERS", "");
    const encoder = new TextEncoder();
    const providerStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: error\ndata: {"error":"stream failed"}\n\n'));
        controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(providerStream, { status: 200 })));

    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({
          providerId: "openai",
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "hello" }],
        }),
      }),
    );

    expect(await response.text()).toContain('event: error\ndata: {"error":"stream failed"}');
  });
});

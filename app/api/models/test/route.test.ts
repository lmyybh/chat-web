import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("../../../lib/api-security", () => ({ validateApiMutationRequest: vi.fn(() => null) }));
vi.mock("../../../lib/providers", () => ({
  getProvider: vi.fn(() => ({ baseURL: "https://provider.example/v1" })),
  getProviderAuthHeader: vi.fn(() => ({ Authorization: "Bearer test-key" })),
}));

afterEach(() => vi.unstubAllGlobals());

function request() {
  return new Request("http://localhost/api/models/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ providerId: "test", model: "test-model" }),
  });
}

describe("model availability test", () => {
  it("sends a real completion request with the saved provider credentials", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] })));
    vi.stubGlobal("fetch", fetch);
    const response = await POST(request());
    expect(await response.json()).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith("https://provider.example/v1/chat/completions", expect.objectContaining({
      headers: { Authorization: "Bearer test-key", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "test-model", messages: [{ role: "user", content: "Reply with OK only." }], stream: false }),
    }));
  });

  it.each([
    JSON.stringify({ error: { message: "Denied", code: "invalid_key", details: "x".repeat(20000) } }),
    "<html>Proxy error\nFull upstream details</html>",
  ])("preserves the complete upstream error body", async (raw) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(raw, { status: 401, statusText: "Unauthorized" })));
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: `HTTP 401 Unauthorized\n\n${raw}` });
  });

  it.each(["not JSON", '{"error":{"message":"failed","code":123}}', '{"choices":[]}', '{"choices":{},"detail":"upstream failure"}'])("rejects invalid successful HTTP responses", async (raw) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(raw)));
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect((await response.json()).error).toContain(raw);
  });

  it("includes the underlying cause of network failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch failed", { cause: new Error("ECONNREFUSED") })));
    const response = await POST(request());
    const { error } = await response.json();
    expect(error).toContain("fetch failed");
    expect(error).toContain("ECONNREFUSED");
  });
});

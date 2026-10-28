// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.hoisted(() => vi.stubEnv("NEXT_PUBLIC_GATEWAY_PREFIX", "/gateway/application"));
import Home from "./page";
import { PublicProvider, Workspace } from "./lib/types";

const model = { id: "m", providerId: "p", name: "Test model", model: "model-a", createdAt: "", updatedAt: "" };
let workspace: Workspace;
let provider: PublicProvider;
let save: () => Promise<Response>;
let test: (init?: RequestInit) => Promise<Response>;
let fetchMock: ReturnType<typeof vi.fn>;
function json(value: unknown, status = 200) { return Promise.resolve(new Response(JSON.stringify(value), { status })); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  window.localStorage.clear();
  workspace = { models: [{ ...model }], groups: [], defaultGroup: { id: "default", kind: "default", name: "Default", systemPrompt: "", chats: [], createdAt: "", updatedAt: "" } };
  provider = { id: "p", name: "Provider", baseURL: "https://old.example", hasApiKey: true };
  save = () => json({ providers: [provider] });
  test = () => json({ ok: true });
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/gateway/application/api/models/test") return test(init);
    if (url === "/gateway/application/api/providers") {
      return init?.method === "PUT" ? save() : json({ providers: [provider] });
    }
    if (url === "/gateway/application/api/workspace") {
      if (init?.method === "POST") {
        const action = JSON.parse(init.body as string);
        workspace.models[0] = { ...workspace.models[0], model: action.model, name: action.name };
      }
      return json({ workspace });
    }
    throw new Error(`Unexpected URL: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function openSettings() {
  render(React.createElement(Home));
  fireEvent.click(await screen.findByRole("button", { name: "设置" }));
  await screen.findByRole("button", { name: "测试 Test model" });
}
const testCalls = () => fetchMock.mock.calls.filter(([url]) => url === "/gateway/application/api/models/test");

describe("model tests in settings", () => {
  it("uses the gateway prefix and waits for the blur save before testing", async () => {
    const saving = deferred<Response>();
    save = () => saving.promise;
    await openSettings();
    const input = screen.getByLabelText("Base URL");
    fireEvent.change(input, { target: { value: "https://new.example" } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole("button", { name: "测试 Test model" }));
    expect(testCalls()).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
    provider.baseURL = "https://new.example";
    await act(async () => saving.resolve(await json({ providers: [provider] })));
    await screen.findByText("测试成功，模型可用。");
    expect(testCalls()).toHaveLength(1);
  });

  it("does not test when saving fails and displays the save error", async () => {
    const saving = deferred<Response>();
    save = () => saving.promise;
    await openSettings();
    const input = screen.getByLabelText("Base URL");
    fireEvent.change(input, { target: { value: "https://new.example" } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole("button", { name: "测试 Test model" }));
    await act(async () => saving.resolve(await json({ error: "Save failed in full" }, 500)));
    await waitFor(() => expect(screen.getAllByText("Save failed in full").length).toBeGreaterThan(0));
    expect(testCalls()).toHaveLength(0);
  });

  it("clears success after editing the model ID", async () => {
    await openSettings();
    fireEvent.click(screen.getByRole("button", { name: "测试 Test model" }));
    await screen.findByText("测试成功，模型可用。");
    fireEvent.click(screen.getByTitle("编辑模型"));
    fireEvent.change(screen.getByPlaceholderText("模型 ID"), { target: { value: "invalid-model" } });
    fireEvent.click(screen.getByTitle("保存模型"));
    await screen.findByText("invalid-model");
    expect(screen.queryByText("测试成功，模型可用。")).toBeNull();
  });

  it("cancels and ignores an old response when provider settings change", async () => {
    const testing = deferred<Response>();
    let signal: AbortSignal | undefined;
    test = (init) => { signal = init?.signal as AbortSignal; return testing.promise; };
    await openSettings();
    fireEvent.click(screen.getByRole("button", { name: "测试 Test model" }));
    await waitFor(() => expect(testCalls()).toHaveLength(1));
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "new-key" } });
    expect(signal?.aborted).toBe(true);
    await act(async () => testing.resolve(await json({ ok: true })));
    expect(screen.queryByText("测试成功，模型可用。")).toBeNull();
  });
});

"use client";

import {
  Bot,
  Check,
  Clipboard,
  Menu,
  MessageSquarePlus,
  Pencil,
  Plus,
  RefreshCcw,
  Send,
  Settings2,
  Square,
  Trash2,
  User,
  X,
} from "lucide-react";
import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ChatGroup,
  ChatMessage,
  ChatSession,
  CompletionMessage,
  ModelConfig,
  PublicProvider,
  Workspace,
} from "./lib/types";

type PendingChat = {
  status: "streaming" | "error";
  error?: string;
};

type WorkspaceResponse = {
  workspace: Workspace;
  result?: unknown;
  error?: string;
};

type ProvidersResponse = {
  providers: PublicProvider[];
  result?: unknown;
  error?: string;
};

const ACTIVE_GROUP_KEY = "chat-web:active-group";
const ACTIVE_CHAT_KEY = "chat-web:active-chat";

export default function Home() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [providers, setProviders] = useState<PublicProvider[]>([]);
  const [activeGroupId, setActiveGroupId] = useState("");
  const [activeChatId, setActiveChatId] = useState("");
  const [draft, setDraft] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [pendingByChat, setPendingByChat] = useState<Record<string, PendingChat>>({});
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modelFormOpen, setModelFormOpen] = useState(false);
  const [modelName, setModelName] = useState("");
  const [modelId, setModelId] = useState("");
  const [providerId, setProviderId] = useState("");
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [editingModelName, setEditingModelName] = useState("");
  const [editingModelModel, setEditingModelModel] = useState("");
  const [editingModelProviderId, setEditingModelProviderId] = useState("");
  const [providerFormOpen, setProviderFormOpen] = useState(false);
  const [newProviderId, setNewProviderId] = useState("");
  const [newProviderName, setNewProviderName] = useState("");
  const [newProviderBaseURL, setNewProviderBaseURL] = useState("");
  const [newProviderApiKey, setNewProviderApiKey] = useState("");

  const abortControllers = useRef(new Map<string, AbortController>());
  const streamContent = useRef(new Map<string, string>());

  useEffect(() => {
    setActiveGroupId(window.localStorage.getItem(ACTIVE_GROUP_KEY) || "");
    setActiveChatId(window.localStorage.getItem(ACTIVE_CHAT_KEY) || "");
    void loadInitialData();
  }, []);

  useEffect(() => {
    if (activeGroupId) {
      window.localStorage.setItem(ACTIVE_GROUP_KEY, activeGroupId);
    }
    if (activeChatId) {
      window.localStorage.setItem(ACTIVE_CHAT_KEY, activeChatId);
    }
  }, [activeChatId, activeGroupId]);

  const activeGroup = useMemo(
    () => workspace?.groups.find((group) => group.id === activeGroupId) ?? workspace?.groups[0] ?? null,
    [activeGroupId, workspace],
  );
  const activeChat = useMemo(
    () =>
      activeGroup?.chats.find((chat) => chat.id === activeChatId) ??
      activeGroup?.chats[0] ??
      workspace?.groups.flatMap((group) => group.chats)[0] ??
      null,
    [activeChatId, activeGroup, workspace],
  );
  const activeModel = useMemo(
    () => workspace?.models.find((model) => model.id === activeChat?.modelId) ?? workspace?.models[0] ?? null,
    [activeChat?.modelId, workspace],
  );
  const activePending = activeChat ? pendingByChat[activeChat.id] : undefined;

  useEffect(() => {
    if (!workspace) {
      return;
    }
    const fallbackGroup = activeGroup ?? workspace.groups[0];
    const fallbackChat = activeChat ?? fallbackGroup?.chats[0];
    if (fallbackGroup && fallbackGroup.id !== activeGroupId) {
      setActiveGroupId(fallbackGroup.id);
    }
    if (fallbackChat && fallbackChat.id !== activeChatId) {
      setActiveChatId(fallbackChat.id);
    }
  }, [activeChat, activeChatId, activeGroup, activeGroupId, workspace]);

  useEffect(() => {
    setTitleDraft(activeChat?.title ?? "");
  }, [activeChat?.id, activeChat?.title]);

  useEffect(() => {
    if (!providerId && providers[0]) {
      setProviderId(providers[0].id);
    }
  }, [providerId, providers]);

  async function loadInitialData() {
    const [workspaceResponse, providersResponse] = await Promise.all([
      fetch("/api/workspace"),
      fetch("/api/providers"),
    ]);
    const workspaceData = (await workspaceResponse.json()) as WorkspaceResponse;
    const providersData = (await providersResponse.json()) as {
      providers?: PublicProvider[];
      error?: string;
    };
    if (workspaceData.error) {
      throw new Error(workspaceData.error);
    }
    if (providersData.error) {
      throw new Error(providersData.error);
    }
    setWorkspace(workspaceData.workspace);
    setProviders(providersData.providers ?? []);
  }

  async function loadProviders() {
    const response = await fetch("/api/providers");
    const data = (await response.json()) as ProvidersResponse;
    if (!response.ok || data.error) {
      throw new Error(data.error || "Failed to load providers.");
    }
    setProviders(data.providers);
    return data.providers;
  }

  async function runWorkspaceAction<T>(action: Record<string, unknown>) {
    const response = await fetch("/api/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action),
    });
    const data = (await response.json()) as WorkspaceResponse & { result?: T };
    if (!response.ok || data.error) {
      throw new Error(data.error || "Workspace update failed.");
    }
    setWorkspace(data.workspace);
    return data;
  }

  async function runProviderAction(
    method: "POST" | "DELETE",
    payload?: Record<string, unknown>,
    providerIdToDelete?: string,
  ) {
    const target =
      method === "DELETE" ? `/api/providers?id=${encodeURIComponent(providerIdToDelete || "")}` : "/api/providers";
    const response = await fetch(target, {
      method,
      headers: payload ? { "Content-Type": "application/json" } : undefined,
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const data = (await response.json()) as ProvidersResponse;
    if (!response.ok || data.error) {
      throw new Error(data.error || "Provider update failed.");
    }
    setProviders(data.providers);
    return data;
  }

  async function handleSend(event: FormEvent) {
    event.preventDefault();
    if (!activeChat || !activeGroup || !activeModel) {
      return;
    }
    const content = draft.trim();
    if (!content || pendingByChat[activeChat.id]?.status === "streaming") {
      return;
    }
    setDraft("");
    const userData = await runWorkspaceAction<{ messageId: string }>({
      type: "appendMessage",
      chatId: activeChat.id,
      role: "user",
      content,
      modelId: activeModel.id,
      status: "done",
    });
    await startAssistantStream(userData.workspace, activeChat.id);
  }

  async function handleResend(message: ChatMessage) {
    if (!activeChat) {
      return;
    }
    const content = editingMessageId === message.id ? editingContent.trim() : message.content.trim();
    if (!content || pendingByChat[activeChat.id]?.status === "streaming") {
      return;
    }
    setEditingMessageId(null);
    setEditingContent("");
    const data = await runWorkspaceAction({
      type: "editUserMessageAndTruncate",
      messageId: message.id,
      content,
    });
    await startAssistantStream(data.workspace, activeChat.id);
  }

  async function startAssistantStream(nextWorkspace: Workspace, chatId: string) {
    const chat = findChat(nextWorkspace, chatId);
    const group = chat ? nextWorkspace.groups.find((item) => item.id === chat.groupId) : null;
    const model = chat ? nextWorkspace.models.find((item) => item.id === chat.modelId) : null;
    if (!chat || !group || !model) {
      return;
    }

    const messages = buildCompletionMessages(group, chat);
    const assistantData = await runWorkspaceAction<{ messageId: string }>({
      type: "appendMessage",
      chatId,
      role: "assistant",
      content: "",
      modelId: model.id,
      status: "streaming",
    });
    const assistantId = assistantData.result?.messageId;
    if (!assistantId) {
      return;
    }

    const controller = new AbortController();
    abortControllers.current.set(chatId, controller);
    streamContent.current.set(assistantId, "");
    setPending(chatId, { status: "streaming" });

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: model.providerId,
          model: model.model,
          messages,
        }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const errorData = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(errorData.error || "Assistant response failed.");
      }

      await readAssistantStream(response.body, assistantId);
      const finalContent = streamContent.current.get(assistantId) ?? "";
      await runWorkspaceAction({
        type: "updateMessageContent",
        messageId: assistantId,
        content: finalContent,
      });
      await runWorkspaceAction({
        type: "updateMessageStatus",
        messageId: assistantId,
        status: "done",
      });
      clearPending(chatId);
    } catch (error) {
      const stopped = controller.signal.aborted;
      const finalContent = streamContent.current.get(assistantId) ?? "";
      await runWorkspaceAction({
        type: "updateMessageContent",
        messageId: assistantId,
        content: finalContent,
      }).catch(() => undefined);
      await runWorkspaceAction({
        type: "updateMessageStatus",
        messageId: assistantId,
        status: stopped ? "stopped" : "error",
        error: stopped ? null : error instanceof Error ? error.message : "Assistant response failed.",
      }).catch(() => undefined);
      if (stopped) {
        clearPending(chatId);
      } else {
        setPending(chatId, {
          status: "error",
          error: error instanceof Error ? error.message : "Assistant response failed.",
        });
      }
    } finally {
      abortControllers.current.delete(chatId);
      streamContent.current.delete(assistantId);
    }
  }

  async function readAssistantStream(body: ReadableStream<Uint8Array>, assistantId: string) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const event of events) {
        const eventLines = event.split(/\r?\n/);
        const isErrorEvent = eventLines.some((line) => line.trim() === "event: error");
        const dataLine = eventLines.find((line) => line.startsWith("data:"));
        if (!dataLine) {
          continue;
        }
        const payload = dataLine.slice(5).trim();
        if (payload === "[DONE]") {
          return;
        }
        const parsed = JSON.parse(payload) as { delta?: string; error?: string };
        if (isErrorEvent || parsed.error) {
          throw new Error(parsed.error || "Provider stream failed.");
        }
        if (parsed.delta) {
          const next = `${streamContent.current.get(assistantId) ?? ""}${parsed.delta}`;
          streamContent.current.set(assistantId, next);
          updateLocalMessage(assistantId, { content: next });
        }
      }
    }
  }

  function updateLocalMessage(messageId: string, patch: Partial<ChatMessage>) {
    setWorkspace((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        groups: current.groups.map((group) => ({
          ...group,
          chats: group.chats.map((chat) => ({
            ...chat,
            messages: chat.messages.map((message) =>
              message.id === messageId ? { ...message, ...patch } : message,
            ),
          })),
        })),
      };
    });
  }

  function stopChat(chatId: string) {
    abortControllers.current.get(chatId)?.abort();
  }

  function setPending(chatId: string, pending: PendingChat) {
    setPendingByChat((current) => ({ ...current, [chatId]: pending }));
  }

  function clearPending(chatId: string) {
    setPendingByChat((current) => {
      const next = { ...current };
      delete next[chatId];
      return next;
    });
  }

  async function handleCreateGroup() {
    const data = await runWorkspaceAction<{ groupId: string; chatId: string }>({ type: "createGroup" });
    if (data.result) {
      setActiveGroupId(data.result.groupId);
      setActiveChatId(data.result.chatId);
    }
  }

  async function handleDeleteGroup(group: ChatGroup) {
    if (!window.confirm(`Delete "${group.name}" and all of its chats?`)) {
      return;
    }
    group.chats.forEach((chat) => stopChat(chat.id));
    const data = await runWorkspaceAction<{ groupId: string; chatId: string }>({
      type: "deleteGroup",
      groupId: group.id,
    });
    const fallback = data.result ?? firstSelection(data.workspace);
    if (fallback) {
      setActiveGroupId(fallback.groupId);
      setActiveChatId(fallback.chatId);
    }
  }

  async function handleCreateChat() {
    if (!activeGroup || !activeChat) {
      return;
    }
    const data = await runWorkspaceAction<{ chatId: string }>({
      type: "createChat",
      groupId: activeGroup.id,
      modelId: activeChat.modelId,
    });
    if (data.result) {
      setActiveGroupId(activeGroup.id);
      setActiveChatId(data.result.chatId);
    }
  }

  async function handleDeleteChat(chat: ChatSession) {
    stopChat(chat.id);
    const data = await runWorkspaceAction<{ groupId: string; chatId: string }>({
      type: "deleteChat",
      chatId: chat.id,
    });
    const fallback = data.result ?? firstSelection(data.workspace);
    if (fallback) {
      setActiveGroupId(fallback.groupId);
      setActiveChatId(fallback.chatId);
    }
  }

  async function handleAddModel(event: FormEvent) {
    event.preventDefault();
    if (!modelName.trim() || !modelId.trim() || !providerId) {
      return;
    }
    await runWorkspaceAction({
      type: "createModel",
      name: modelName,
      model: modelId,
      providerId,
    });
    setModelName("");
    setModelId("");
    setModelFormOpen(false);
  }

  async function handleAddProvider(event: FormEvent) {
    event.preventDefault();
    if (!newProviderId.trim() || !newProviderName.trim() || !newProviderBaseURL.trim()) {
      return;
    }
    try {
      await runProviderAction("POST", {
        id: newProviderId,
        name: newProviderName,
        baseURL: newProviderBaseURL,
        apiKey: newProviderApiKey,
      });
      setNewProviderId("");
      setNewProviderName("");
      setNewProviderBaseURL("");
      setNewProviderApiKey("");
      setProviderFormOpen(false);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Provider update failed.");
    }
  }

  async function handleDeleteProvider(provider: PublicProvider) {
    if (!window.confirm(`Delete provider "${provider.name}"?`)) {
      return;
    }
    try {
      await runProviderAction("DELETE", undefined, provider.id);
      const nextProviders = await loadProviders();
      if (providerId === provider.id) {
        setProviderId(nextProviders[0]?.id || "");
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Provider update failed.");
    }
  }

  async function handleUpdateModel(event: FormEvent) {
    event.preventDefault();
    if (!editingModelId || !editingModelName.trim() || !editingModelModel.trim() || !editingModelProviderId) {
      return;
    }
    await runWorkspaceAction({
      type: "updateModel",
      modelId: editingModelId,
      name: editingModelName,
      model: editingModelModel,
      providerId: editingModelProviderId,
    });
    setEditingModelId(null);
    setEditingModelName("");
    setEditingModelModel("");
    setEditingModelProviderId("");
  }

  function startEditingModel(model: ModelConfig) {
    setEditingModelId(model.id);
    setEditingModelName(model.name);
    setEditingModelModel(model.model);
    setEditingModelProviderId(model.providerId);
  }

  if (!workspace || !activeGroup || !activeChat || !activeModel) {
    return (
      <main className="loading-shell">
        <RefreshCcw className="spin" size={22} />
      </main>
    );
  }

  return (
    <main className="app-shell">
      {sidebarOpen && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}

      <aside className={sidebarOpen ? "sidebar open" : "sidebar"} aria-label="Chat navigation">
        <div className="sidebar-header">
          <div>
            <p className="eyebrow">Chat Web</p>
            <h1>Assistant</h1>
          </div>
          <button
            className="icon-button"
            title="New group"
            onClick={() => {
              void handleCreateGroup();
              setSidebarOpen(false);
            }}
          >
            <Plus size={18} />
          </button>
        </div>

        <button className="text-button sidebar-settings-button" onClick={() => setSettingsOpen(true)}>
          <Settings2 size={16} /> Settings
        </button>

        <div className="group-list">
          {workspace.groups.map((group) => (
            <button
              key={group.id}
              className={group.id === activeGroup.id ? "group-item active" : "group-item"}
              onClick={() => {
                setActiveGroupId(group.id);
                setActiveChatId(group.chats[0]?.id || activeChat.id);
                setSidebarOpen(false);
              }}
            >
              <span>{group.name}</span>
              <small>{group.chats.length}</small>
            </button>
          ))}
        </div>

        <div className="chat-list-header">
          <span>Chats</span>
          <button
            className="icon-button subtle"
            title="New chat"
            onClick={() => {
              void handleCreateChat();
              setSidebarOpen(false);
            }}
          >
            <MessageSquarePlus size={17} />
          </button>
        </div>

        <div className="chat-list">
          {activeGroup.chats.map((chat) => (
            <div key={chat.id} className={chat.id === activeChat.id ? "chat-row active" : "chat-row"}>
              <button
                className="chat-title"
                onClick={() => {
                  setActiveGroupId(chat.groupId);
                  setActiveChatId(chat.id);
                  setSidebarOpen(false);
                }}
              >
                {chat.title}
              </button>
              <button className="icon-button danger" title="Delete chat" onClick={() => handleDeleteChat(chat)}>
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      <section className="conversation" aria-label="Conversation">
        <header className="conversation-header">
          <button className="icon-button mobile-menu-button" title="Navigation" onClick={() => setSidebarOpen(true)}>
            <Menu size={18} />
          </button>
          <div className="title-editor">
            <p className="eyebrow">{activeGroup.name}</p>
            <input
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.target.value)}
              onBlur={() => {
                if (titleDraft.trim() !== activeChat.title) {
                  void runWorkspaceAction({
                    type: "renameChat",
                    chatId: activeChat.id,
                    title: titleDraft,
                  });
                }
              }}
            />
          </div>
          <label className="model-select">
            <span>Model</span>
            <select
              value={activeChat.modelId}
              onChange={(event) =>
                void runWorkspaceAction({
                  type: "setChatModel",
                  chatId: activeChat.id,
                  modelId: event.target.value,
                })
              }
            >
              {workspace.models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
          </label>
          <button className="icon-button" title="Settings" onClick={() => setSettingsOpen(true)}>
            <Settings2 size={18} />
          </button>
        </header>

        <div className="message-list">
          {activeChat.messages.length === 0 ? (
            <div className="empty-state">
              <Bot size={36} />
              <h2>Start a conversation</h2>
              <p>Messages in this chat will use the group system prompt and the selected model.</p>
            </div>
          ) : (
            activeChat.messages.map((message) => (
              <MessageView
                key={message.id}
                message={message}
                editingMessageId={editingMessageId}
                editingContent={editingContent}
                onEditingContentChange={setEditingContent}
                onEdit={() => {
                  setEditingMessageId(message.id);
                  setEditingContent(message.content);
                }}
                onCancelEdit={() => {
                  setEditingMessageId(null);
                  setEditingContent("");
                }}
                onResend={() => void handleResend(message)}
              />
            ))
          )}
        </div>

        {activePending?.status === "error" && activePending.error && (
          <div className="error-banner">{activePending.error}</div>
        )}

        <form className="composer" onSubmit={handleSend}>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={`Message ${activeModel.name}`}
            rows={2}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          {activePending?.status === "streaming" ? (
            <button className="send-button stop" type="button" title="Stop" onClick={() => stopChat(activeChat.id)}>
              <Square size={17} />
            </button>
          ) : (
            <button className="send-button" disabled={!draft.trim()} title="Send">
              <Send size={19} />
            </button>
          )}
        </form>
      </section>

      {settingsOpen && <button className="settings-backdrop" aria-label="Close settings" onClick={() => setSettingsOpen(false)} />}

      <aside className={settingsOpen ? "settings open" : "settings"} aria-label="Settings">
        <div className="settings-title">
          <div className="settings-title-left">
            <Settings2 size={18} />
            <h2>Workspace</h2>
          </div>
          <button className="icon-button" title="Close settings" onClick={() => setSettingsOpen(false)}>
            <X size={17} />
          </button>
        </div>

        <section className="settings-section">
          <label>
            Group name
            <input
              value={activeGroup.name}
              onChange={(event) =>
                void runWorkspaceAction({
                  type: "updateGroup",
                  groupId: activeGroup.id,
                  name: event.target.value,
                  systemPrompt: activeGroup.systemPrompt,
                })
              }
            />
          </label>
          <label>
            System prompt
            <textarea
              value={activeGroup.systemPrompt}
              onChange={(event) =>
                void runWorkspaceAction({
                  type: "updateGroup",
                  groupId: activeGroup.id,
                  name: activeGroup.name,
                  systemPrompt: event.target.value,
                })
              }
              rows={8}
            />
          </label>
          <button className="text-button danger-text" onClick={() => void handleDeleteGroup(activeGroup)}>
            <Trash2 size={15} /> Delete group
          </button>
        </section>

        <section className="settings-section">
          <div className="section-header">
            <h3>Providers</h3>
            <button
              className="icon-button"
              title="Add provider"
              onClick={() => setProviderFormOpen((open) => !open)}
            >
              <Plus size={17} />
            </button>
          </div>

          {providerFormOpen && (
            <form className="model-form" onSubmit={handleAddProvider}>
              <input
                placeholder="Provider id"
                value={newProviderId}
                onChange={(event) => setNewProviderId(event.target.value)}
              />
              <input
                placeholder="Display name"
                value={newProviderName}
                onChange={(event) => setNewProviderName(event.target.value)}
              />
              <input
                placeholder="Base URL"
                value={newProviderBaseURL}
                onChange={(event) => setNewProviderBaseURL(event.target.value)}
              />
              <input
                type="password"
                placeholder="API key"
                value={newProviderApiKey}
                onChange={(event) => setNewProviderApiKey(event.target.value)}
                autoComplete="new-password"
              />
              <button className="primary-button">Add provider</button>
            </form>
          )}

          <div className="provider-list">
            {providers.map((provider) => (
              <div key={provider.id} className="provider-row">
                <div className="provider-name">
                  <strong>{provider.name}</strong>
                  <span>{provider.baseURL}</span>
                  <small>{provider.hasApiKey ? "API key saved" : "No API key"}</small>
                </div>
                <button
                  className="icon-button danger"
                  title="Delete provider"
                  onClick={() => void handleDeleteProvider(provider)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="settings-section">
          <div className="section-header">
            <h3>Models</h3>
            <button
              className="icon-button"
              title="Add model"
              onClick={() => setModelFormOpen((open) => !open)}
            >
              <Plus size={17} />
            </button>
          </div>

          {modelFormOpen && (
            <form className="model-form" onSubmit={handleAddModel}>
              <input
                placeholder="Display name"
                value={modelName}
                onChange={(event) => setModelName(event.target.value)}
              />
              <input
                placeholder="Model id"
                value={modelId}
                onChange={(event) => setModelId(event.target.value)}
              />
              <select value={providerId} onChange={(event) => setProviderId(event.target.value)}>
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
              <button className="primary-button">Add model</button>
            </form>
          )}

          <div className="model-list">
            {workspace.models.map((model) => (
              <ModelRow
                key={model.id}
                model={model}
                active={model.id === activeChat.modelId}
                providers={providers}
                editing={editingModelId === model.id}
                editingName={editingModelName}
                editingModel={editingModelModel}
                editingProviderId={editingModelProviderId}
                onEditingNameChange={setEditingModelName}
                onEditingModelChange={setEditingModelModel}
                onEditingProviderChange={setEditingModelProviderId}
                onSubmitEdit={handleUpdateModel}
                onStartEdit={() => startEditingModel(model)}
                onCancelEdit={() => setEditingModelId(null)}
                onSelect={() =>
                  void runWorkspaceAction({
                    type: "setChatModel",
                    chatId: activeChat.id,
                    modelId: model.id,
                  })
                }
                onDelete={() => void runWorkspaceAction({ type: "deleteModel", modelId: model.id })}
              />
            ))}
          </div>
        </section>
      </aside>
    </main>
  );
}

function MessageView({
  message,
  editingMessageId,
  editingContent,
  onEditingContentChange,
  onEdit,
  onCancelEdit,
  onResend,
}: {
  message: ChatMessage;
  editingMessageId: string | null;
  editingContent: string;
  onEditingContentChange: (content: string) => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onResend: () => void;
}) {
  const isEditing = editingMessageId === message.id;
  const label = message.role === "user" ? "You" : "Assistant";
  return (
    <article className={`message ${message.role}`}>
      <div className="avatar" aria-hidden="true">
        {message.role === "user" ? <User size={17} /> : <Bot size={17} />}
      </div>
      <div className="message-body">
        <div className="message-meta">
          <strong>{label}</strong>
          {message.modelNameSnapshot && <span>{message.modelNameSnapshot}</span>}
          {message.status !== "done" && <span>{message.status}</span>}
          <button className="inline-icon-button" title="Copy message" onClick={() => copyText(message.content)}>
            <Clipboard size={14} />
          </button>
        </div>
        {isEditing ? (
          <textarea
            className="edit-box"
            value={editingContent}
            onChange={(event) => onEditingContentChange(event.target.value)}
            rows={5}
          />
        ) : message.role === "assistant" ? (
          <div className="markdown-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {message.content || (message.status === "streaming" ? " " : "")}
            </ReactMarkdown>
          </div>
        ) : (
          <p>{message.content}</p>
        )}
        {message.error && <div className="message-error">{message.error}</div>}
        {message.role === "user" && (
          <div className="message-actions">
            {isEditing ? (
              <>
                <button className="text-button" onClick={onResend}>
                  <Check size={15} /> Save & resend
                </button>
                <button className="text-button muted" onClick={onCancelEdit}>
                  <X size={15} /> Cancel
                </button>
              </>
            ) : (
              <>
                <button className="text-button" onClick={onEdit}>
                  <Pencil size={15} /> Edit
                </button>
                <button className="text-button" onClick={onResend}>
                  <RefreshCcw size={15} /> Resend
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function ModelRow({
  model,
  active,
  providers,
  editing,
  editingName,
  editingModel,
  editingProviderId,
  onEditingNameChange,
  onEditingModelChange,
  onEditingProviderChange,
  onSubmitEdit,
  onStartEdit,
  onCancelEdit,
  onSelect,
  onDelete,
}: {
  model: ModelConfig;
  active: boolean;
  providers: PublicProvider[];
  editing: boolean;
  editingName: string;
  editingModel: string;
  editingProviderId: string;
  onEditingNameChange: (value: string) => void;
  onEditingModelChange: (value: string) => void;
  onEditingProviderChange: (value: string) => void;
  onSubmitEdit: (event: FormEvent) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const providerName = providers.find((provider) => provider.id === model.providerId)?.name ?? model.providerId;
  if (editing) {
    return (
      <form className="model-edit-row" onSubmit={onSubmitEdit}>
        <input value={editingName} onChange={(event) => onEditingNameChange(event.target.value)} />
        <input value={editingModel} onChange={(event) => onEditingModelChange(event.target.value)} />
        <select value={editingProviderId} onChange={(event) => onEditingProviderChange(event.target.value)}>
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name}
            </option>
          ))}
        </select>
        <div className="model-edit-actions">
          <button className="icon-button" title="Save model">
            <Check size={15} />
          </button>
          <button className="icon-button" type="button" title="Cancel" onClick={onCancelEdit}>
            <X size={15} />
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className={active ? "model-row active" : "model-row"}>
      <button className="model-name" onClick={onSelect}>
        <strong>{model.name}</strong>
        <span>
          {providerName} / {model.model}
        </span>
      </button>
      <button className="icon-button" title="Edit model" onClick={onStartEdit}>
        <Pencil size={15} />
      </button>
      <button className="icon-button danger" title="Delete model" onClick={onDelete}>
        <Trash2 size={15} />
      </button>
    </div>
  );
}

const markdownComponents: Components = {
  pre({ children }) {
    const text = extractText(children);
    return (
      <div className="code-block">
        <button className="code-copy" onClick={() => copyText(text)}>
          <Clipboard size={14} />
        </button>
        <pre>{children}</pre>
      </div>
    );
  },
  a({ children, href }) {
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  },
};

function buildCompletionMessages(group: ChatGroup, chat: ChatSession): CompletionMessage[] {
  const messages: CompletionMessage[] = [];
  if (group.systemPrompt.trim()) {
    messages.push({ role: "system", content: group.systemPrompt.trim() });
  }
  for (const message of chat.messages) {
    if (message.role === "system" || !message.content.trim()) {
      continue;
    }
    messages.push({ role: message.role, content: message.content });
  }
  return messages;
}

function findChat(workspace: Workspace, chatId: string) {
  return workspace.groups.flatMap((group) => group.chats).find((chat) => chat.id === chatId) ?? null;
}

function firstSelection(workspace: Workspace) {
  const group = workspace.groups[0];
  const chat = group?.chats[0];
  return group && chat ? { groupId: group.id, chatId: chat.id } : null;
}

function extractText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(extractText).join("");
  }
  if (node && typeof node === "object" && "props" in node) {
    const props = node.props as { children?: ReactNode };
    return extractText(props.children);
  }
  return "";
}

function copyText(text: string) {
  void navigator.clipboard?.writeText(text);
}

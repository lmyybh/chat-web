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
import { FormEvent, ReactNode, RefObject, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { API_SESSION_COOKIE, API_SESSION_HEADER } from "./lib/api-session";
import { buildCompletionMessages } from "./lib/completion";
import {
  ChatGroup,
  ChatMessage,
  ChatSession,
  ModelConfig,
  PublicProvider,
  Workspace,
} from "./lib/types";

type View = { type: "home" } | { type: "group"; groupId: string } | { type: "chat"; chatId: string };

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

const LAST_MODEL_KEY = "chat-web:last-model";

export default function Home() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [providers, setProviders] = useState<PublicProvider[]>([]);
  const [view, setView] = useState<View>({ type: "home" });
  const [draft, setDraft] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [pendingByChat, setPendingByChat] = useState<Record<string, PendingChat>>({});
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lastModelId, setLastModelId] = useState("");
  const [defaultPromptDraft, setDefaultPromptDraft] = useState("");

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
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);
  const defaultPromptDirty = useRef(false);
  const workspaceRequestSeq = useRef(0);
  const appliedWorkspaceRequestSeq = useRef(0);
  const providersRequestSeq = useRef(0);
  const appliedProvidersRequestSeq = useRef(0);

  useEffect(() => {
    setLastModelId(window.localStorage.getItem(LAST_MODEL_KEY) || "");
    void loadInitialData();
  }, []);

  const allChats = useMemo(
    () => [
      ...(workspace?.defaultGroup.chats ?? []),
      ...(workspace?.groups.flatMap((group) => group.chats) ?? []),
    ],
    [workspace],
  );
  const activeChat = useMemo(
    () => (view.type === "chat" ? allChats.find((chat) => chat.id === view.chatId) ?? null : null),
    [allChats, view],
  );
  const activeChatGroup = useMemo(
    () => (activeChat && workspace ? findGroupForChat(workspace, activeChat.id) : null),
    [activeChat, workspace],
  );
  const activeGroup = useMemo(
    () =>
      view.type === "group" ? workspace?.groups.find((group) => group.id === view.groupId) ?? null : null,
    [view, workspace],
  );
  const activeLastMessageContent = activeChat?.messages.at(-1)?.content;
  const selectedModel = useMemo(() => {
    if (!workspace?.models.length) {
      return null;
    }
    return workspace.models.find((model) => model.id === lastModelId) ?? workspace.models[0];
  }, [lastModelId, workspace]);
  const activePending = activeChat ? pendingByChat[activeChat.id] : undefined;

  useEffect(() => {
    if (!workspace?.models.length) {
      return;
    }
    const model = workspace.models.find((item) => item.id === lastModelId) ?? workspace.models[0];
    if (model.id !== lastModelId) {
      setLastModelId(model.id);
      window.localStorage.setItem(LAST_MODEL_KEY, model.id);
    }
  }, [lastModelId, workspace?.models]);

  useEffect(() => {
    setTitleDraft(activeChat?.title ?? "");
  }, [activeChat?.id, activeChat?.title]);

  useEffect(() => {
    stickToBottom.current = true;
    requestAnimationFrame(() => scrollMessagesToBottom("auto"));
  }, [activeChat?.id]);

  useEffect(() => {
    if (stickToBottom.current) {
      requestAnimationFrame(() => scrollMessagesToBottom("smooth"));
    }
  }, [activeChat?.messages.length, activeLastMessageContent]);

  useEffect(() => {
    if (!defaultPromptDirty.current) {
      setDefaultPromptDraft(workspace?.defaultGroup.systemPrompt ?? "");
    }
  }, [workspace?.defaultGroup.systemPrompt]);

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
    const providersData = (await providersResponse.json()) as ProvidersResponse;
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
    const requestId = ++providersRequestSeq.current;
    const response = await fetch("/api/providers");
    const data = (await response.json()) as ProvidersResponse;
    if (!response.ok || data.error) {
      throw new Error(data.error || "Failed to load providers.");
    }
    applyProvidersSnapshot(data.providers, requestId);
    return data.providers;
  }

  async function runWorkspaceAction<T>(action: Record<string, unknown>) {
    const requestId = ++workspaceRequestSeq.current;
    const response = await fetchWithSessionRetry("/api/workspace", {
      method: "POST",
      headers: getJsonApiHeaders(),
      body: JSON.stringify(action),
    });
    const data = (await response.json()) as WorkspaceResponse & { result?: T };
    if (!response.ok || data.error) {
      throw new Error(data.error || "Workspace update failed.");
    }
    applyWorkspaceSnapshot(data.workspace, requestId);
    return data;
  }

  async function runProviderAction(
    method: "POST" | "DELETE",
    payload?: Record<string, unknown>,
    providerIdToDelete?: string,
  ) {
    const requestId = ++providersRequestSeq.current;
    const target =
      method === "DELETE" ? `/api/providers?id=${encodeURIComponent(providerIdToDelete || "")}` : "/api/providers";
    const response = await fetchWithSessionRetry(target, {
      method,
      headers: payload ? getJsonApiHeaders() : getApiSessionHeaders(),
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const data = (await response.json()) as ProvidersResponse;
    if (!response.ok || data.error) {
      throw new Error(data.error || "Provider update failed.");
    }
    applyProvidersSnapshot(data.providers, requestId);
    return data;
  }

  function applyWorkspaceSnapshot(nextWorkspace: Workspace, requestId: number) {
    if (requestId < appliedWorkspaceRequestSeq.current) {
      return;
    }
    appliedWorkspaceRequestSeq.current = requestId;
    const liveContent = new Map(streamContent.current);
    setWorkspace(mergeStreamingContent(nextWorkspace, liveContent));
  }

  function applyProvidersSnapshot(nextProviders: PublicProvider[], requestId: number) {
    if (requestId < appliedProvidersRequestSeq.current) {
      return;
    }
    appliedProvidersRequestSeq.current = requestId;
    setProviders(nextProviders);
  }

  async function handleSend(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !workspace || !selectedModel) {
      return;
    }

    let chatId = activeChat?.id ?? "";
    let nextWorkspace = workspace;
    if (!chatId) {
      const groupId = view.type === "group" ? view.groupId : undefined;
      const created = await runWorkspaceAction<{ chatId: string }>({
        type: "createChat",
        groupId,
        modelId: selectedModel.id,
      });
      chatId = created.result?.chatId ?? "";
      nextWorkspace = created.workspace;
      if (chatId) {
        setView({ type: "chat", chatId });
      }
    }
    if (!chatId || pendingByChat[chatId]?.status === "streaming") {
      return;
    }

    const targetChat = findChat(nextWorkspace, chatId);
    if (targetChat && targetChat.modelId !== selectedModel.id) {
      const modelData = await runWorkspaceAction({
        type: "setChatModel",
        chatId,
        modelId: selectedModel.id,
      });
      nextWorkspace = modelData.workspace;
    }

    setDraft("");
    stickToBottom.current = true;
    const userData = await runWorkspaceAction<{ messageId: string }>({
      type: "appendMessage",
      chatId,
      role: "user",
      content,
      modelId: selectedModel.id,
      status: "done",
    });
    nextWorkspace = userData.workspace;
    await startAssistantStream(nextWorkspace, chatId);
  }

  async function handleResend(message: ChatMessage) {
    const chat = allChats.find((item) => item.id === message.chatId);
    if (!chat || pendingByChat[chat.id]?.status === "streaming") {
      return;
    }
    const content = editingMessageId === message.id ? editingContent.trim() : message.content.trim();
    if (!content) {
      return;
    }
    setEditingMessageId(null);
    setEditingContent("");
    stickToBottom.current = true;
    const data = await runWorkspaceAction({
      type: "editUserMessageAndTruncate",
      messageId: message.id,
      content,
    });
    await startAssistantStream(data.workspace, chat.id);
  }

  async function startAssistantStream(nextWorkspace: Workspace, chatId: string) {
    const chat = findChat(nextWorkspace, chatId);
    const group = findGroupForChat(nextWorkspace, chatId);
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
      const response = await fetchWithSessionRetry("/api/chat", {
        method: "POST",
        headers: getJsonApiHeaders(),
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
        defaultGroup: {
          ...current.defaultGroup,
          chats: updateChatMessages(current.defaultGroup.chats, messageId, patch),
        },
        groups: current.groups.map((group) => ({
          ...group,
          chats: updateChatMessages(group.chats, messageId, patch),
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

  function scrollMessagesToBottom(behavior: ScrollBehavior) {
    const element = messageListRef.current;
    if (!element) {
      return;
    }
    element.scrollTo({ top: element.scrollHeight, behavior });
  }

  function updateStickToBottom(sticks: boolean) {
    stickToBottom.current = sticks;
  }

  function handleModelChange(modelId: string) {
    setLastModelId(modelId);
    window.localStorage.setItem(LAST_MODEL_KEY, modelId);
    if (activeChat) {
      void runWorkspaceAction({ type: "setChatModel", chatId: activeChat.id, modelId });
    }
  }

  async function saveDefaultSystemPrompt() {
    if (!workspace || defaultPromptDraft === workspace.defaultGroup.systemPrompt) {
      defaultPromptDirty.current = false;
      return;
    }
    const nextPrompt = defaultPromptDraft;
    defaultPromptDirty.current = false;
    try {
      await runWorkspaceAction({
        type: "updateDefaultSystemPrompt",
        systemPrompt: nextPrompt,
      });
    } catch (error) {
      defaultPromptDirty.current = true;
      window.alert(error instanceof Error ? error.message : "Workspace update failed.");
    }
  }

  async function handleCreateGroup() {
    const data = await runWorkspaceAction<{ groupId: string }>({ type: "createGroup" });
    if (data.result) {
      setView({ type: "group", groupId: data.result.groupId });
      setSidebarOpen(false);
    }
  }

  async function handleDeleteGroup(group: ChatGroup) {
    if (!window.confirm(`Delete "${group.name}" and all of its chats?`)) {
      return;
    }
    group.chats.forEach((chat) => stopChat(chat.id));
    await runWorkspaceAction({ type: "deleteGroup", groupId: group.id });
    setView({ type: "home" });
  }

  async function handleCreateChat(groupId?: string) {
    if (!selectedModel) {
      return;
    }
    const data = await runWorkspaceAction<{ chatId: string }>({
      type: "createChat",
      groupId,
      modelId: selectedModel.id,
    });
    if (data.result) {
      setView({ type: "chat", chatId: data.result.chatId });
      setSidebarOpen(false);
    }
  }

  async function handleDeleteChat(chat: ChatSession) {
    stopChat(chat.id);
    await runWorkspaceAction({ type: "deleteChat", chatId: chat.id });
    if (view.type === "chat" && view.chatId === chat.id) {
      setView({ type: "home" });
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

  if (!workspace || !selectedModel) {
    return (
      <main className="loading-shell">
        <RefreshCcw className="spin" size={22} />
      </main>
    );
  }

  return (
    <main className="app-shell">
      {sidebarOpen && (
        <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />
      )}

      <aside className={sidebarOpen ? "sidebar open" : "sidebar"} aria-label="Chat navigation">
        <div className="sidebar-header">
          <div>
            <button
              className="brand-button"
              onClick={() => {
                setView({ type: "home" });
                setSidebarOpen(false);
              }}
            >
              <span className="eyebrow">Chat Web</span>
              <strong>Assistant</strong>
            </button>
          </div>
          <button className="icon-button" title="New group" onClick={handleCreateGroup}>
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
              className={view.type === "group" && view.groupId === group.id ? "group-item active" : "group-item"}
              onClick={() => {
                setView({ type: "group", groupId: group.id });
                setSidebarOpen(false);
              }}
            >
              <span>{group.name}</span>
              <small>{group.chats.length}</small>
            </button>
          ))}
        </div>

        <div className="chat-list-header">
          <span>Direct chats</span>
          <button className="icon-button subtle" title="New chat" onClick={() => void handleCreateChat()}>
            <MessageSquarePlus size={17} />
          </button>
        </div>

        <div className="chat-list">
          {workspace.defaultGroup.chats.map((chat) => (
            <div key={chat.id} className={view.type === "chat" && view.chatId === chat.id ? "chat-row active" : "chat-row"}>
              <button
                className="chat-title"
                onClick={() => {
                  setView({ type: "chat", chatId: chat.id });
                  setSidebarOpen(false);
                }}
              >
                {chat.title}
              </button>
              <button className="icon-button danger" title="Delete chat" onClick={() => void handleDeleteChat(chat)}>
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
          {view.type === "chat" && activeChat ? (
            <div className="title-editor">
              <p className="eyebrow">{activeChatGroup?.kind === "default" ? "Chats" : activeChatGroup?.name}</p>
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
          ) : (
            <div className="title-editor">
              <p className="eyebrow">{view.type === "home" ? "Home" : "Group"}</p>
              <h2>{view.type === "home" ? "Chats" : activeGroup?.name}</h2>
            </div>
          )}
          <button className="icon-button" title="Settings" onClick={() => setSettingsOpen(true)}>
            <Settings2 size={18} />
          </button>
        </header>

        {view.type === "home" && (
          <HomeView />
        )}

        {view.type === "group" && activeGroup && (
          <GroupView
            group={activeGroup}
            onUpdateGroup={(patch) =>
              runWorkspaceAction({
                type: "updateGroup",
                groupId: activeGroup.id,
                name: patch.name,
                systemPrompt: patch.systemPrompt,
              }).then(() => undefined)
            }
            onDeleteGroup={() => void handleDeleteGroup(activeGroup)}
            onCreateChat={() => void handleCreateChat(activeGroup.id)}
            onOpenChat={(chatId) => setView({ type: "chat", chatId })}
            onDeleteChat={handleDeleteChat}
          />
        )}

        {view.type === "chat" && activeChat && (
          <ChatView
            chat={activeChat}
            messageListRef={messageListRef}
            editingMessageId={editingMessageId}
            editingContent={editingContent}
            onEditingContentChange={setEditingContent}
            onEditMessage={(message) => {
              setEditingMessageId(message.id);
              setEditingContent(message.content);
            }}
            onCancelEdit={() => {
              setEditingMessageId(null);
              setEditingContent("");
            }}
            onResend={(message) => void handleResend(message)}
            onStickToBottomChange={updateStickToBottom}
          />
        )}

        {activePending?.status === "error" && activePending.error && (
          <div className="error-banner">{activePending.error}</div>
        )}

        <Composer
          draft={draft}
          models={workspace.models}
          selectedModelId={selectedModel.id}
          streaming={activeChat ? activePending?.status === "streaming" : false}
          onDraftChange={setDraft}
          onModelChange={handleModelChange}
          onSubmit={handleSend}
          onStop={() => activeChat && stopChat(activeChat.id)}
        />
      </section>

      {settingsOpen && (
        <button className="settings-backdrop" aria-label="Close settings" onClick={() => setSettingsOpen(false)} />
      )}

      <aside className={settingsOpen ? "settings open" : "settings"} aria-label="Settings">
        <div className="settings-title">
          <div className="settings-title-left">
            <Settings2 size={18} />
            <h2>Settings</h2>
          </div>
          <button className="icon-button" title="Close settings" onClick={() => setSettingsOpen(false)}>
            <X size={17} />
          </button>
        </div>

        <section className="settings-section">
          <label>
            Default system prompt
            <textarea
              value={defaultPromptDraft}
              onChange={(event) => {
                defaultPromptDirty.current = true;
                setDefaultPromptDraft(event.target.value);
              }}
              onBlur={() => void saveDefaultSystemPrompt()}
              rows={5}
            />
          </label>
        </section>

        <section className="settings-section">
          <div className="section-header">
            <h3>Providers</h3>
            <button className="icon-button" title="Add provider" onClick={() => setProviderFormOpen((open) => !open)}>
              <Plus size={17} />
            </button>
          </div>

          {providerFormOpen && (
            <form className="model-form" onSubmit={handleAddProvider}>
              <input placeholder="Provider id" value={newProviderId} onChange={(event) => setNewProviderId(event.target.value)} />
              <input placeholder="Display name" value={newProviderName} onChange={(event) => setNewProviderName(event.target.value)} />
              <input placeholder="Base URL" value={newProviderBaseURL} onChange={(event) => setNewProviderBaseURL(event.target.value)} />
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
                <button className="icon-button danger" title="Delete provider" onClick={() => void handleDeleteProvider(provider)}>
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="settings-section">
          <div className="section-header">
            <h3>Models</h3>
            <button className="icon-button" title="Add model" onClick={() => setModelFormOpen((open) => !open)}>
              <Plus size={17} />
            </button>
          </div>

          {modelFormOpen && (
            <form className="model-form" onSubmit={handleAddModel}>
              <input placeholder="Display name" value={modelName} onChange={(event) => setModelName(event.target.value)} />
              <input placeholder="Model id" value={modelId} onChange={(event) => setModelId(event.target.value)} />
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
                active={model.id === selectedModel.id}
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
                onSelect={() => handleModelChange(model.id)}
                onDelete={() => void runWorkspaceAction({ type: "deleteModel", modelId: model.id })}
              />
            ))}
          </div>
        </section>
      </aside>
    </main>
  );
}

function HomeView() {
  return (
    <div className="home-start">
      <Bot size={38} />
      <h2>Start a conversation</h2>
      <p>Use the composer below to create a direct chat.</p>
    </div>
  );
}

function GroupView({
  group,
  onUpdateGroup,
  onDeleteGroup,
  onCreateChat,
  onOpenChat,
  onDeleteChat,
}: {
  group: ChatGroup;
  onUpdateGroup: (patch: { name: string; systemPrompt: string }) => Promise<void> | void;
  onDeleteGroup: () => void;
  onCreateChat: () => void;
  onOpenChat: (chatId: string) => void;
  onDeleteChat: (chat: ChatSession) => void;
}) {
  const [nameDraft, setNameDraft] = useState(group.name);
  const [systemPromptDraft, setSystemPromptDraft] = useState(group.systemPrompt);
  const draftDirty = useRef(false);

  useEffect(() => {
    if (!draftDirty.current) {
      setNameDraft(group.name);
      setSystemPromptDraft(group.systemPrompt);
    }
  }, [group.id, group.name, group.systemPrompt]);

  async function saveGroupDraft() {
    if (nameDraft === group.name && systemPromptDraft === group.systemPrompt) {
      draftDirty.current = false;
      return;
    }
    const patch = { name: nameDraft, systemPrompt: systemPromptDraft };
    draftDirty.current = false;
    try {
      await onUpdateGroup(patch);
    } catch (error) {
      draftDirty.current = true;
      window.alert(error instanceof Error ? error.message : "Workspace update failed.");
    }
  }

  return (
    <div className="workspace-home">
      <section className="group-settings-panel">
        <label>
          Group name
          <input
            value={nameDraft}
            onChange={(event) => {
              draftDirty.current = true;
              setNameDraft(event.target.value);
            }}
            onBlur={() => void saveGroupDraft()}
          />
        </label>
        <label>
          System prompt
          <textarea
            value={systemPromptDraft}
            onChange={(event) => {
              draftDirty.current = true;
              setSystemPromptDraft(event.target.value);
            }}
            onBlur={() => void saveGroupDraft()}
            rows={6}
          />
        </label>
        <button className="text-button danger-text" onClick={onDeleteGroup}>
          <Trash2 size={15} /> Delete group
        </button>
      </section>

      <ChatListPanel
        title="Group chats"
        chats={group.chats}
        emptyText="No chats in this group yet."
        action={
          <button className="text-button" onClick={onCreateChat}>
            <MessageSquarePlus size={15} /> New chat
          </button>
        }
        onOpenChat={onOpenChat}
        onDeleteChat={onDeleteChat}
      />
    </div>
  );
}

function ChatListPanel({
  title,
  chats,
  emptyText,
  action,
  onOpenChat,
  onDeleteChat,
}: {
  title: string;
  chats: ChatSession[];
  emptyText: string;
  action?: ReactNode;
  onOpenChat: (chatId: string) => void;
  onDeleteChat: (chat: ChatSession) => void;
}) {
  return (
    <section className="chat-table-section">
      <div className="section-header">
        <h3>{title}</h3>
        {action}
      </div>
      {chats.length === 0 ? (
        <div className="empty-inline">{emptyText}</div>
      ) : (
        <div className="compact-chat-list">
          {chats.map((chat) => (
            <div key={chat.id} className="compact-chat-row">
              <button className="compact-chat-title" onClick={() => onOpenChat(chat.id)}>
                <strong>{chat.title}</strong>
                <span>{formatDate(chat.updatedAt)}</span>
              </button>
              <button className="icon-button danger" title="Delete chat" onClick={() => onDeleteChat(chat)}>
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ChatView({
  chat,
  messageListRef,
  editingMessageId,
  editingContent,
  onEditingContentChange,
  onEditMessage,
  onCancelEdit,
  onResend,
  onStickToBottomChange,
}: {
  chat: ChatSession;
  messageListRef: RefObject<HTMLDivElement>;
  editingMessageId: string | null;
  editingContent: string;
  onEditingContentChange: (content: string) => void;
  onEditMessage: (message: ChatMessage) => void;
  onCancelEdit: () => void;
  onResend: (message: ChatMessage) => void;
  onStickToBottomChange: (sticks: boolean) => void;
}) {
  return (
    <div
      className="message-list"
      ref={messageListRef}
      onScroll={(event) => onStickToBottomChange(isNearBottom(event.currentTarget))}
    >
      {chat.messages.length === 0 ? (
        <div className="empty-state">
          <Bot size={36} />
          <h2>Start a conversation</h2>
          <p>Messages in this chat will use the selected model and its container system prompt.</p>
        </div>
      ) : (
        chat.messages.map((message) => (
          <MessageView
            key={message.id}
            message={message}
            editingMessageId={editingMessageId}
            editingContent={editingContent}
            onEditingContentChange={onEditingContentChange}
            onEdit={() => onEditMessage(message)}
            onCancelEdit={onCancelEdit}
            onResend={() => onResend(message)}
          />
        ))
      )}
    </div>
  );
}

function isNearBottom(element: HTMLElement) {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 80;
}

function Composer({
  draft,
  models,
  selectedModelId,
  streaming,
  onDraftChange,
  onModelChange,
  onSubmit,
  onStop,
}: {
  draft: string;
  models: ModelConfig[];
  selectedModelId: string;
  streaming: boolean;
  onDraftChange: (draft: string) => void;
  onModelChange: (modelId: string) => void;
  onSubmit: (event: FormEvent) => void;
  onStop: () => void;
}) {
  const selectedModel = models.find((model) => model.id === selectedModelId) ?? models[0];
  return (
    <form className="composer" onSubmit={onSubmit}>
      <div className="composer-toolbar">
        <select value={selectedModelId} onChange={(event) => onModelChange(event.target.value)}>
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
            </option>
          ))}
        </select>
      </div>
      <textarea
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        placeholder={`Message ${selectedModel?.name ?? "model"}`}
        rows={2}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />
      {streaming ? (
        <button className="send-button stop" type="button" title="Stop" onClick={onStop}>
          <Square size={17} />
        </button>
      ) : (
        <button className="send-button" disabled={!draft.trim()} title="Send">
          <Send size={19} />
        </button>
      )}
    </form>
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

function findChat(workspace: Workspace, chatId: string) {
  return [workspace.defaultGroup, ...workspace.groups]
    .flatMap((group) => group.chats)
    .find((chat) => chat.id === chatId) ?? null;
}

function getJsonApiHeaders(): HeadersInit {
  return {
    ...getApiSessionHeaders(),
    "Content-Type": "application/json",
  };
}

async function fetchWithSessionRetry(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  if (!(await isInvalidApiSession(response))) {
    return response;
  }
  await refreshApiSession();
  return fetch(input, withCurrentApiSessionHeader(init));
}

async function refreshApiSession() {
  await fetch("/api/providers", { cache: "no-store" });
}

async function isInvalidApiSession(response: Response) {
  if (response.status !== 403) {
    return false;
  }
  const data = (await response.clone().json().catch(() => null)) as { error?: string } | null;
  return data?.error === "Invalid API session.";
}

function withCurrentApiSessionHeader(init?: RequestInit): RequestInit | undefined {
  const token = readBrowserCookie(API_SESSION_COOKIE);
  if (!token) {
    return init;
  }
  const headers = new Headers(init?.headers);
  headers.set(API_SESSION_HEADER, token);
  return { ...init, headers };
}

function getApiSessionHeaders(): HeadersInit {
  const token = readBrowserCookie(API_SESSION_COOKIE);
  return token ? { [API_SESSION_HEADER]: token } : {};
}

function readBrowserCookie(name: string) {
  const prefix = `${name}=`;
  return document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length) ?? "";
}

function mergeStreamingContent(workspace: Workspace, liveContent: Map<string, string>): Workspace {
  if (liveContent.size === 0) {
    return workspace;
  }
  return {
    ...workspace,
    defaultGroup: mergeStreamingGroup(workspace.defaultGroup, liveContent),
    groups: workspace.groups.map((group) => mergeStreamingGroup(group, liveContent)),
  };
}

function mergeStreamingGroup(group: ChatGroup, liveContent: Map<string, string>): ChatGroup {
  return {
    ...group,
    chats: group.chats.map((chat) => ({
      ...chat,
      messages: chat.messages.map((message) =>
        liveContent.has(message.id) ? { ...message, content: liveContent.get(message.id) ?? "" } : message,
      ),
    })),
  };
}

function findGroupForChat(workspace: Workspace, chatId: string) {
  return [workspace.defaultGroup, ...workspace.groups].find((group) =>
    group.chats.some((chat) => chat.id === chatId),
  ) ?? null;
}

function updateChatMessages(chats: ChatSession[], messageId: string, patch: Partial<ChatMessage>) {
  return chats.map((chat) => ({
    ...chat,
    messages: chat.messages.map((message) => (message.id === messageId ? { ...message, ...patch } : message)),
  }));
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

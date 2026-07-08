"use client";

import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as ScrollArea from "@radix-ui/react-scroll-area";
import * as Select from "@radix-ui/react-select";
import * as Tooltip from "@radix-ui/react-tooltip";
import {
  Bot,
  Brain,
  Check,
  ChevronDown,
  Clipboard,
  Cpu,
  Folder,
  KeyRound,
  Menu,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCcw,
  Send,
  Settings2,
  Sparkles,
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
type SettingsTab = "general" | "providers" | "models";

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

type ConfirmDialogState = {
  title: string;
  description: string;
  confirmLabel: string;
  tone?: "danger";
  errorMessage?: string;
  onConfirm: () => Promise<void> | void;
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
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [lastModelId, setLastModelId] = useState("");
  const [defaultPromptDraft, setDefaultPromptDraft] = useState("");
  const [deepThinkingEnabled, setDeepThinkingEnabled] = useState(false);
  const [uiError, setUiError] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

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
  const streamReasoningContent = useRef(new Map<string, string>());
  const streamReasoningStartedAt = useRef(new Map<string, string>());
  const streamReasoningEndedAt = useRef(new Map<string, string>());
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
    const liveReasoningContent = new Map(streamReasoningContent.current);
    const liveReasoningStartedAt = new Map(streamReasoningStartedAt.current);
    const liveReasoningEndedAt = new Map(streamReasoningEndedAt.current);
    setWorkspace(
      mergeStreamingContent(
        nextWorkspace,
        liveContent,
        liveReasoningContent,
        liveReasoningStartedAt,
        liveReasoningEndedAt,
      ),
    );
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
    await startAssistantStream(nextWorkspace, chatId, deepThinkingEnabled);
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
    await startAssistantStream(data.workspace, chat.id, deepThinkingEnabled);
  }

  async function startAssistantStream(nextWorkspace: Workspace, chatId: string, enableThinking: boolean) {
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
          enableThinking,
        }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const errorData = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(errorData.error || "Assistant response failed.");
      }

      await readAssistantStream(response.body, assistantId);
      const finalContent = streamContent.current.get(assistantId) ?? "";
      const finalReasoningContent = streamReasoningContent.current.get(assistantId) ?? "";
      const reasoningStartedAt = streamReasoningStartedAt.current.get(assistantId) ?? null;
      const reasoningEndedAt = getReasoningEndedAt(assistantId);
      await runWorkspaceAction({
        type: "updateMessageContent",
        messageId: assistantId,
        content: finalContent,
      });
      if (finalReasoningContent || reasoningStartedAt) {
        await runWorkspaceAction({
          type: "updateMessageReasoning",
          messageId: assistantId,
          reasoningContent: finalReasoningContent || null,
          reasoningStartedAt,
          reasoningEndedAt,
        });
      }
      await runWorkspaceAction({
        type: "updateMessageStatus",
        messageId: assistantId,
        status: "done",
      });
      clearPending(chatId);
    } catch (error) {
      const stopped = controller.signal.aborted;
      const finalContent = streamContent.current.get(assistantId) ?? "";
      const finalReasoningContent = streamReasoningContent.current.get(assistantId) ?? "";
      const reasoningStartedAt = streamReasoningStartedAt.current.get(assistantId) ?? null;
      const reasoningEndedAt = getReasoningEndedAt(assistantId);
      await runWorkspaceAction({
        type: "updateMessageContent",
        messageId: assistantId,
        content: finalContent,
      }).catch(() => undefined);
      if (finalReasoningContent || reasoningStartedAt) {
        await runWorkspaceAction({
          type: "updateMessageReasoning",
          messageId: assistantId,
          reasoningContent: finalReasoningContent || null,
          reasoningStartedAt,
          reasoningEndedAt,
        }).catch(() => undefined);
      }
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
      streamReasoningContent.current.delete(assistantId);
      streamReasoningStartedAt.current.delete(assistantId);
      streamReasoningEndedAt.current.delete(assistantId);
    }
  }

  function getReasoningEndedAt(assistantId: string) {
    if (!streamReasoningStartedAt.current.has(assistantId)) {
      return null;
    }
    const existing = streamReasoningEndedAt.current.get(assistantId);
    if (existing) {
      return existing;
    }
    const endedAt = new Date().toISOString();
    streamReasoningEndedAt.current.set(assistantId, endedAt);
    return endedAt;
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
        const parsed = JSON.parse(payload) as { delta?: string; reasoningDelta?: string; error?: string };
        if (isErrorEvent || parsed.error) {
          throw new Error(parsed.error || "Provider stream failed.");
        }
        if (parsed.reasoningDelta) {
          const startedAt = streamReasoningStartedAt.current.get(assistantId) ?? new Date().toISOString();
          streamReasoningStartedAt.current.set(assistantId, startedAt);
          const nextReasoning = `${streamReasoningContent.current.get(assistantId) ?? ""}${parsed.reasoningDelta}`;
          streamReasoningContent.current.set(assistantId, nextReasoning);
          updateLocalMessage(assistantId, {
            reasoningContent: nextReasoning,
            reasoningStartedAt: startedAt,
          });
        }
        if (parsed.delta) {
          if (streamReasoningStartedAt.current.has(assistantId) && !streamReasoningEndedAt.current.has(assistantId)) {
            const endedAt = new Date().toISOString();
            streamReasoningEndedAt.current.set(assistantId, endedAt);
            updateLocalMessage(assistantId, { reasoningEndedAt: endedAt });
          }
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

  function showUiError(error: unknown, fallback: string) {
    setUiError(error instanceof Error ? error.message : fallback);
  }

  async function handleConfirmAction() {
    if (!confirmDialog || confirmBusy) {
      return;
    }
    setConfirmBusy(true);
    try {
      await confirmDialog.onConfirm();
      setConfirmDialog(null);
    } catch (error) {
      setConfirmDialog((current) =>
        current
          ? {
              ...current,
              errorMessage: error instanceof Error ? error.message : "操作失败，请稍后重试。",
            }
          : current,
      );
    } finally {
      setConfirmBusy(false);
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
      setUiError(null);
    } catch (error) {
      defaultPromptDirty.current = true;
      showUiError(error, "默认系统提示词保存失败。");
    }
  }

  async function handleCreateGroup() {
    const data = await runWorkspaceAction<{ groupId: string }>({ type: "createGroup" });
    if (data.result) {
      setView({ type: "group", groupId: data.result.groupId });
      setSidebarOpen(false);
    }
  }

  function handleDeleteGroup(group: ChatGroup) {
    setConfirmDialog({
      title: "删除分组",
      description: `将删除“${group.name}”以及其中的 ${group.chats.length} 个对话，此操作无法撤销。`,
      confirmLabel: "删除分组",
      tone: "danger",
      onConfirm: async () => {
        group.chats.forEach((chat) => stopChat(chat.id));
        await runWorkspaceAction({ type: "deleteGroup", groupId: group.id });
        setView({ type: "home" });
      },
    });
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

  function handleDeleteChat(chat: ChatSession) {
    setConfirmDialog({
      title: "删除对话",
      description: `将删除“${formatChatTitle(chat.title)}”，此操作无法撤销。`,
      confirmLabel: "删除对话",
      tone: "danger",
      onConfirm: async () => {
        stopChat(chat.id);
        await runWorkspaceAction({ type: "deleteChat", chatId: chat.id });
        if (view.type === "chat" && view.chatId === chat.id) {
          setView({ type: "home" });
        }
      },
    });
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
      setUiError(null);
    } catch (error) {
      showUiError(error, "供应商保存失败。");
    }
  }

  async function handleDeleteProvider(provider: PublicProvider) {
    setConfirmDialog({
      title: "删除供应商",
      description: `将删除“${provider.name}”。如果仍有模型依赖它，服务端会拒绝删除。`,
      confirmLabel: "删除供应商",
      tone: "danger",
      onConfirm: async () => {
        await runProviderAction("DELETE", undefined, provider.id);
        const nextProviders = await loadProviders();
        if (providerId === provider.id) {
          setProviderId(nextProviders[0]?.id || "");
        }
      },
    });
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

  function handleDeleteModel(model: ModelConfig) {
    setConfirmDialog({
      title: "删除模型",
      description: `将删除“${model.name}”。已使用该模型的对话会自动切换到其他可用模型。`,
      confirmLabel: "删除模型",
      tone: "danger",
      onConfirm: async () => {
        if ((workspace?.models.length ?? 0) <= 1) {
          throw new Error("至少需要保留一个模型。");
        }
        await runWorkspaceAction({ type: "deleteModel", modelId: model.id });
        if (model.id === lastModelId) {
          const fallback = workspace?.models.find((item) => item.id !== model.id);
          if (fallback) {
            setLastModelId(fallback.id);
            window.localStorage.setItem(LAST_MODEL_KEY, fallback.id);
          }
        }
      },
    });
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
    <Tooltip.Provider delayDuration={180}>
      <main className="app-shell">
        {sidebarOpen && (
          <button className="sidebar-backdrop" aria-label="关闭导航" onClick={() => setSidebarOpen(false)} />
        )}

        <aside className={sidebarOpen ? "sidebar open" : "sidebar"} aria-label="聊天导航">
          <div className="sidebar-header">
            <div className="brand-button" aria-label="Chat Web">
              <strong>Chat Web</strong>
            </div>
          </div>

          <div className="new-chat-row">
            <button className="new-chat-button" type="button" onClick={() => void handleCreateChat()}>
              <MessageSquarePlus size={17} />
              新建对话
            </button>
          </div>

          <nav className="nav-stack" aria-label="主要导航">
            <button
              className={view.type === "home" ? "nav-item active" : "nav-item"}
              type="button"
              onClick={() => {
                setView({ type: "home" });
                setSidebarOpen(false);
              }}
            >
              <Folder size={17} />
              我的空间
            </button>
          </nav>

          <section className="sidebar-section">
            <div className="sidebar-section-title">
              <span>对话分组</span>
              <button className="link-icon-button" type="button" title="新分组" onClick={handleCreateGroup}>
                <Plus size={16} />
              </button>
            </div>
            <div className="group-list">
              {workspace.groups.length === 0 ? (
                <div className="sidebar-empty">暂无分组</div>
              ) : (
                workspace.groups.map((group) => (
                  <button
                    key={group.id}
                    className={view.type === "group" && view.groupId === group.id ? "group-item active" : "group-item"}
                    type="button"
                    onClick={() => {
                      setView({ type: "group", groupId: group.id });
                      setSidebarOpen(false);
                    }}
                  >
                    <span>{group.name}</span>
                    <small>{group.chats.length}</small>
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="sidebar-section chat-section">
            <div className="sidebar-section-title">
              <span>最近对话</span>
            </div>
            <ScrollArea.Root className="chat-list-scroll">
              <ScrollArea.Viewport className="scroll-area-viewport">
                <div className="chat-list">
                  {workspace.defaultGroup.chats.length === 0 ? (
                    <div className="sidebar-empty">还没有最近对话</div>
                  ) : (
                    workspace.defaultGroup.chats.map((chat) => (
                      <SidebarChatRow
                        key={chat.id}
                        chat={chat}
                        active={view.type === "chat" && view.chatId === chat.id}
                        onOpen={() => {
                          setView({ type: "chat", chatId: chat.id });
                          setSidebarOpen(false);
                        }}
                        onDelete={() => handleDeleteChat(chat)}
                      />
                    ))
                  )}
                </div>
              </ScrollArea.Viewport>
              <ScrollArea.Scrollbar className="scrollbar" orientation="vertical">
                <ScrollArea.Thumb className="scrollbar-thumb" />
              </ScrollArea.Scrollbar>
            </ScrollArea.Root>
          </section>
        </aside>

        <section className="conversation" aria-label="对话">
          <header className="conversation-header">
            <div className="header-left">
              <button className="icon-button mobile-menu-button" title="导航" onClick={() => setSidebarOpen(true)}>
                <Menu size={18} />
              </button>
              <ModelSelect models={workspace.models} selectedModelId={selectedModel.id} onModelChange={handleModelChange} />
            </div>

            <div className="header-actions">
              <TooltipIconButton label="设置" onClick={() => setSettingsOpen(true)}>
                <Settings2 size={18} />
              </TooltipIconButton>
            </div>
          </header>

          {view.type === "home" && <HomeView selectedModelName={selectedModel.name} />}

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
              onError={(error) => showUiError(error, "分组设置保存失败。")}
              onDeleteGroup={() => void handleDeleteGroup(activeGroup)}
              onCreateChat={() => void handleCreateChat(activeGroup.id)}
              onOpenChat={(chatId) => setView({ type: "chat", chatId })}
              onDeleteChat={handleDeleteChat}
            />
          )}

          {view.type === "chat" && activeChat && (
            <ChatView
              chat={activeChat}
              groupLabel={activeChatGroup?.kind === "default" ? "最近对话" : activeChatGroup?.name ?? "对话"}
              titleDraft={titleDraft}
              messageListRef={messageListRef}
              editingMessageId={editingMessageId}
              editingContent={editingContent}
              onTitleDraftChange={setTitleDraft}
              onTitleBlur={() => {
                if (titleDraft.trim() !== activeChat.title) {
                  void runWorkspaceAction({
                    type: "renameChat",
                    chatId: activeChat.id,
                    title: titleDraft,
                  });
                }
              }}
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

          {uiError && (
            <div className="error-banner app-error-banner">
              <span>{uiError}</span>
              <button type="button" onClick={() => setUiError(null)}>
                <X size={15} />
              </button>
            </div>
          )}

          <Composer
            draft={draft}
            selectedModelName={selectedModel.name}
            streaming={activeChat ? activePending?.status === "streaming" : false}
            deepThinkingEnabled={deepThinkingEnabled}
            onDraftChange={setDraft}
            onDeepThinkingChange={setDeepThinkingEnabled}
            onSubmit={handleSend}
            onStop={() => activeChat && stopChat(activeChat.id)}
          />
        </section>

        <Dialog.Root open={settingsOpen} onOpenChange={setSettingsOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className="settings-overlay" />
            <Dialog.Content className="settings-dialog">
              <aside className="settings-nav">
                <Dialog.Title className="settings-heading">设置</Dialog.Title>
                <Dialog.Description className="settings-description">
                  管理本地提示词、供应商和模型。
                </Dialog.Description>
                <SettingsNavButton
                  active={settingsTab === "general"}
                  icon={<Settings2 size={17} />}
                  label="通用"
                  onClick={() => setSettingsTab("general")}
                />
                <SettingsNavButton
                  active={settingsTab === "providers"}
                  icon={<KeyRound size={17} />}
                  label="供应商"
                  onClick={() => setSettingsTab("providers")}
                />
                <SettingsNavButton
                  active={settingsTab === "models"}
                  icon={<Cpu size={17} />}
                  label="模型"
                  onClick={() => setSettingsTab("models")}
                />
              </aside>

              <section className="settings-panel">
                <button className="dialog-close" type="button" title="关闭设置" onClick={() => setSettingsOpen(false)}>
                  <X size={18} />
                </button>

                {settingsTab === "general" && (
                  <div className="settings-content">
                    <div className="settings-panel-header">
                      <div>
                        <h2>通用</h2>
                        <p>配置新对话默认使用的系统提示词。</p>
                      </div>
                    </div>

                    <label className="field-block">
                      <span>默认系统提示词</span>
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
                  </div>
                )}

                {settingsTab === "providers" && (
                  <div className="settings-content">
                    <div className="settings-panel-header">
                      <div>
                        <h2>供应商</h2>
                        <p>API key 只保存在本地 SQLite，不返回给浏览器。</p>
                      </div>
                      <button className="text-button" type="button" onClick={() => setProviderFormOpen((open) => !open)}>
                        <Plus size={16} />
                        添加
                      </button>
                    </div>

                    {providerFormOpen && (
                      <form className="model-form" onSubmit={handleAddProvider}>
                        <input placeholder="供应商 ID" value={newProviderId} onChange={(event) => setNewProviderId(event.target.value)} />
                        <input placeholder="显示名称" value={newProviderName} onChange={(event) => setNewProviderName(event.target.value)} />
                        <input placeholder="Base URL" value={newProviderBaseURL} onChange={(event) => setNewProviderBaseURL(event.target.value)} />
                        <input
                          type="password"
                          placeholder="API key，可选"
                          value={newProviderApiKey}
                          onChange={(event) => setNewProviderApiKey(event.target.value)}
                          autoComplete="new-password"
                        />
                        <button className="primary-button">添加供应商</button>
                      </form>
                    )}

                    <div className="provider-list">
                      {providers.length === 0 ? (
                        <div className="empty-inline">还没有供应商。添加一个供应商后即可配置模型。</div>
                      ) : (
                        providers.map((provider) => (
                          <div key={provider.id} className="provider-row">
                            <div className="provider-name">
                              <strong>{provider.name}</strong>
                              <span>{provider.baseURL}</span>
                              <small>{provider.hasApiKey ? "API key 已保存" : "未配置 API key"}</small>
                            </div>
                            <TooltipIconButton label="删除供应商" tone="danger" onClick={() => handleDeleteProvider(provider)}>
                              <Trash2 size={15} />
                            </TooltipIconButton>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {settingsTab === "models" && (
                  <div className="settings-content">
                    <div className="settings-panel-header">
                      <div>
                        <h2>模型</h2>
                        <p>选择和维护可用于新对话的模型。</p>
                      </div>
                      <button className="text-button" type="button" onClick={() => setModelFormOpen((open) => !open)}>
                        <Plus size={16} />
                        添加
                      </button>
                    </div>

                    {modelFormOpen && (
                      <form className="model-form" onSubmit={handleAddModel}>
                        <input placeholder="显示名称" value={modelName} onChange={(event) => setModelName(event.target.value)} />
                        <input placeholder="模型 ID" value={modelId} onChange={(event) => setModelId(event.target.value)} />
                        <select value={providerId} onChange={(event) => setProviderId(event.target.value)}>
                          {providers.map((provider) => (
                            <option key={provider.id} value={provider.id}>
                              {provider.name}
                            </option>
                          ))}
                        </select>
                        <button className="primary-button">添加模型</button>
                      </form>
                    )}

                    <div className="model-list">
                      {workspace.models.length === 0 ? (
                        <div className="empty-inline">还没有模型。添加模型后即可开始对话。</div>
                      ) : (
                        workspace.models.map((model) => (
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
                            onDelete={() => handleDeleteModel(model)}
                          />
                        ))
                      )}
                    </div>
                  </div>
                )}
              </section>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        <ConfirmDialog
          state={confirmDialog}
          busy={confirmBusy}
          onCancel={() => setConfirmDialog(null)}
          onConfirm={() => void handleConfirmAction()}
        />
      </main>
    </Tooltip.Provider>
  );
}

function HomeView({ selectedModelName }: { selectedModelName: string }) {
  return (
    <div className="home-start">
      <div className="welcome-mark">
        <Sparkles size={30} />
      </div>
      <h1>你好，我是 Chat Web</h1>
      <p>当前模型：{selectedModelName}</p>
    </div>
  );
}

function TooltipIconButton({
  label,
  children,
  tone,
  onClick,
}: {
  label: string;
  children: ReactNode;
  tone?: "danger";
  onClick?: () => void;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button className={tone === "danger" ? "icon-button danger" : "icon-button"} type="button" onClick={onClick}>
          {children}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltip-content" sideOffset={8}>
          {label}
          <Tooltip.Arrow className="tooltip-arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function ConfirmDialog({
  state,
  busy,
  onCancel,
  onConfirm,
}: {
  state: ConfirmDialogState | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!state) {
    return null;
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) {
          onCancel();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="confirm-overlay" />
        <Dialog.Content className="confirm-dialog">
          <Dialog.Title className="confirm-title">{state.title}</Dialog.Title>
          <Dialog.Description className="confirm-description">{state.description}</Dialog.Description>
          {state.errorMessage && <div className="confirm-error">{state.errorMessage}</div>}
          <div className="confirm-actions">
            <button className="text-button muted" type="button" disabled={busy} onClick={onCancel}>
              取消
            </button>
            <button
              className={state.tone === "danger" ? "primary-button danger-primary" : "primary-button"}
              type="button"
              disabled={busy}
              onClick={onConfirm}
            >
              {busy ? "处理中..." : state.confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SidebarChatRow({
  chat,
  active,
  onOpen,
  onDelete,
}: {
  chat: ChatSession;
  active: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={active ? "chat-row active" : "chat-row"}>
      <button className="chat-title" type="button" onClick={onOpen}>
        {formatChatTitle(chat.title)}
      </button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className="row-menu-button" type="button" title="更多">
            <MoreHorizontal size={16} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="dropdown-content" sideOffset={6} align="end">
            <DropdownMenu.Item className="dropdown-item danger" onSelect={onDelete}>
              <Trash2 size={14} />
              删除对话
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

function ModelSelect({
  models,
  selectedModelId,
  onModelChange,
}: {
  models: ModelConfig[];
  selectedModelId: string;
  onModelChange: (modelId: string) => void;
}) {
  return (
    <Select.Root value={selectedModelId} onValueChange={onModelChange}>
      <Select.Trigger className="model-select-trigger" aria-label="选择模型">
        <Select.Value />
        <Select.Icon>
          <ChevronDown size={15} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="select-content" position="popper" sideOffset={8}>
          <Select.Viewport className="select-viewport">
            {models.map((model) => (
              <Select.Item key={model.id} className="select-item" value={model.id}>
                <Select.ItemText>{model.name}</Select.ItemText>
                <Select.ItemIndicator className="select-item-indicator">
                  <Check size={14} />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

function SettingsNavButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className={active ? "settings-nav-item active" : "settings-nav-item"} type="button" onClick={onClick}>
      {icon}
      {label}
    </button>
  );
}

function GroupView({
  group,
  onUpdateGroup,
  onError,
  onDeleteGroup,
  onCreateChat,
  onOpenChat,
  onDeleteChat,
}: {
  group: ChatGroup;
  onUpdateGroup: (patch: { name: string; systemPrompt: string }) => Promise<void> | void;
  onError: (error: unknown) => void;
  onDeleteGroup: () => void;
  onCreateChat: () => void;
  onOpenChat: (chatId: string) => void;
  onDeleteChat: (chat: ChatSession) => void;
}) {
  const [nameDraft, setNameDraft] = useState(group.name);
  const [systemPromptDraft, setSystemPromptDraft] = useState(group.systemPrompt);
  const [editingGroupSettings, setEditingGroupSettings] = useState(false);
  const draftDirty = useRef(false);

  useEffect(() => {
    if (!draftDirty.current) {
      setNameDraft(group.name);
      setSystemPromptDraft(group.systemPrompt);
    }
    setEditingGroupSettings(false);
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
      onError(error);
    }
  }

  return (
    <div className="workspace-home">
      <header className="group-hero">
        <div className="group-title-row">
          <h1>{group.name}</h1>
          <div className="group-instruction">
            <span>指令：</span>
            <p>{group.systemPrompt.trim() || "这个分组尚未设置系统提示词"}</p>
            <button
              className="inline-icon-button"
              type="button"
              title="编辑分组设置"
              onClick={() => setEditingGroupSettings((open) => !open)}
            >
              <Pencil size={15} />
            </button>
          </div>
        </div>
        <div className="group-hero-actions">
          <button className="text-button" type="button" onClick={onCreateChat}>
            <MessageSquarePlus size={15} />
            新对话
          </button>
          <button className="text-button danger-text" type="button" onClick={onDeleteGroup}>
            <Trash2 size={15} />
            删除
          </button>
        </div>
      </header>

      {editingGroupSettings && (
        <section className="group-settings-panel">
          <label>
            分组名称
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
            系统提示词
            <textarea
              value={systemPromptDraft}
              onChange={(event) => {
                draftDirty.current = true;
                setSystemPromptDraft(event.target.value);
              }}
              onBlur={() => void saveGroupDraft()}
              rows={4}
            />
          </label>
        </section>
      )}

      <ChatListPanel
        chats={group.chats}
        emptyText="这个分组还没有对话。"
        onOpenChat={onOpenChat}
        onDeleteChat={onDeleteChat}
      />
    </div>
  );
}

function ChatListPanel({
  chats,
  emptyText,
  onOpenChat,
  onDeleteChat,
}: {
  chats: ChatSession[];
  emptyText: string;
  onOpenChat: (chatId: string) => void;
  onDeleteChat: (chat: ChatSession) => void;
}) {
  return (
    <section className="chat-table-section">
      {chats.length === 0 ? (
        <div className="empty-inline">{emptyText}</div>
      ) : (
        <div className="compact-chat-list">
          {chats.map((chat) => (
            <div key={chat.id} className="compact-chat-row">
              <button className="compact-chat-title" type="button" onClick={() => onOpenChat(chat.id)}>
                <div>
                  <strong>{formatChatTitle(chat.title)}</strong>
                  <p>{getChatPreview(chat)}</p>
                </div>
                <time>{formatDate(chat.updatedAt)}</time>
              </button>
              <button className="icon-button danger" type="button" title="删除对话" onClick={() => onDeleteChat(chat)}>
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
  groupLabel,
  titleDraft,
  messageListRef,
  editingMessageId,
  editingContent,
  onTitleDraftChange,
  onTitleBlur,
  onEditingContentChange,
  onEditMessage,
  onCancelEdit,
  onResend,
  onStickToBottomChange,
}: {
  chat: ChatSession;
  groupLabel: string;
  titleDraft: string;
  messageListRef: RefObject<HTMLDivElement>;
  editingMessageId: string | null;
  editingContent: string;
  onTitleDraftChange: (title: string) => void;
  onTitleBlur: () => void;
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
      <div className="chat-title-editor">
        <p>{groupLabel}</p>
        <input value={titleDraft} onChange={(event) => onTitleDraftChange(event.target.value)} onBlur={onTitleBlur} placeholder="新对话" />
      </div>
      {chat.messages.length === 0 ? (
        <div className="empty-state">
          <Sparkles size={34} />
          <h2>开始这个对话</h2>
          <p>消息会使用当前模型和所在分组的系统提示词。</p>
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
  selectedModelName,
  streaming,
  deepThinkingEnabled,
  onDraftChange,
  onDeepThinkingChange,
  onSubmit,
  onStop,
}: {
  draft: string;
  selectedModelName: string;
  streaming: boolean;
  deepThinkingEnabled: boolean;
  onDraftChange: (draft: string) => void;
  onDeepThinkingChange: (enabled: boolean) => void;
  onSubmit: (event: FormEvent) => void;
  onStop: () => void;
}) {
  return (
    <form className="composer" onSubmit={onSubmit}>
      <textarea
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        placeholder={`向 ${selectedModelName} 提问`}
        rows={2}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <div className="composer-toolbar">
        <button
          className={deepThinkingEnabled ? "thinking-toggle active" : "thinking-toggle"}
          type="button"
          aria-pressed={deepThinkingEnabled}
          title={deepThinkingEnabled ? "关闭深度思考" : "开启深度思考"}
          onClick={() => onDeepThinkingChange(!deepThinkingEnabled)}
        >
          <Brain size={16} />
          深度思考
        </button>
      </div>
      {streaming ? (
        <button className="send-button stop" type="button" title="停止生成" onClick={onStop}>
          <Square size={17} />
        </button>
      ) : (
        <button className="send-button" disabled={!draft.trim()} title="发送">
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
  const [reasoningOpen, setReasoningOpen] = useState(message.status === "streaming");
  const hasReasoning = message.role === "assistant" && Boolean(message.reasoningContent?.trim());
  const label = message.role === "user" ? "你" : "助手";

  useEffect(() => {
    if (message.status === "streaming" && hasReasoning) {
      setReasoningOpen(true);
    }
  }, [hasReasoning, message.status]);

  return (
    <article className={`message ${message.role}`}>
      <div className="avatar" aria-hidden="true">
        {message.role === "user" ? <User size={17} /> : <Bot size={17} />}
      </div>
      <div className="message-body">
        <div className="message-meta">
          <strong>{label}</strong>
          {message.modelNameSnapshot && <span>{message.modelNameSnapshot}</span>}
          {message.status !== "done" && <span>{formatMessageStatus(message.status)}</span>}
          <button className="inline-icon-button" type="button" title="复制消息" onClick={() => copyText(message.content)}>
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
          <>
            {hasReasoning && (
              <ReasoningPanel
                message={message}
                open={reasoningOpen}
                onOpenChange={() => setReasoningOpen((open) => !open)}
              />
            )}
            <div className="markdown-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {message.content || (message.status === "streaming" ? " " : "")}
              </ReactMarkdown>
            </div>
          </>
        ) : (
          <p>{message.content}</p>
        )}
        {message.error && <div className="message-error">{message.error}</div>}
        {message.role === "user" && (
          <div className="message-actions">
            {isEditing ? (
              <>
                <button className="text-button" type="button" onClick={onResend}>
                  <Check size={15} /> 保存并重发
                </button>
                <button className="text-button muted" type="button" onClick={onCancelEdit}>
                  <X size={15} /> 取消
                </button>
              </>
            ) : (
              <>
                <button className="message-action-button" type="button" title="编辑消息" onClick={onEdit}>
                  <Pencil size={15} />
                </button>
                <button className="message-action-button" type="button" title="重发消息" onClick={onResend}>
                  <RefreshCcw size={15} />
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function ReasoningPanel({
  message,
  open,
  onOpenChange,
}: {
  message: ChatMessage;
  open: boolean;
  onOpenChange: () => void;
}) {
  const isThinking = message.status === "streaming" && !message.reasoningEndedAt;
  return (
    <section className={open ? "reasoning-panel open" : "reasoning-panel"}>
      <button className="reasoning-toggle" type="button" onClick={onOpenChange} aria-expanded={open}>
        <ChevronDown size={15} />
        <span>{isThinking ? "思考中" : `已思考 ${formatReasoningDuration(message)}`}</span>
      </button>
      {open && (
        <div className="reasoning-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {message.reasoningContent || ""}
          </ReactMarkdown>
        </div>
      )}
    </section>
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
        <input placeholder="显示名称" value={editingName} onChange={(event) => onEditingNameChange(event.target.value)} />
        <input placeholder="模型 ID" value={editingModel} onChange={(event) => onEditingModelChange(event.target.value)} />
        <select value={editingProviderId} onChange={(event) => onEditingProviderChange(event.target.value)}>
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name}
            </option>
          ))}
        </select>
        <div className="model-edit-actions">
          <button className="icon-button" title="保存模型">
            <Check size={15} />
          </button>
          <button className="icon-button" type="button" title="取消" onClick={onCancelEdit}>
            <X size={15} />
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className={active ? "model-row active" : "model-row"}>
      <button className="model-name" type="button" onClick={onSelect}>
        <strong>{model.name}</strong>
        <span>
          {providerName} / {model.model}
        </span>
      </button>
      <button className="icon-button" type="button" title="编辑模型" onClick={onStartEdit}>
        <Pencil size={15} />
      </button>
      <button className="icon-button danger" type="button" title="删除模型" onClick={onDelete}>
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
        <button className="code-copy" type="button" title="复制代码" onClick={() => copyText(text)}>
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

function mergeStreamingContent(
  workspace: Workspace,
  liveContent: Map<string, string>,
  liveReasoningContent: Map<string, string>,
  liveReasoningStartedAt: Map<string, string>,
  liveReasoningEndedAt: Map<string, string>,
): Workspace {
  if (
    liveContent.size === 0 &&
    liveReasoningContent.size === 0 &&
    liveReasoningStartedAt.size === 0 &&
    liveReasoningEndedAt.size === 0
  ) {
    return workspace;
  }
  return {
    ...workspace,
    defaultGroup: mergeStreamingGroup(
      workspace.defaultGroup,
      liveContent,
      liveReasoningContent,
      liveReasoningStartedAt,
      liveReasoningEndedAt,
    ),
    groups: workspace.groups.map((group) =>
      mergeStreamingGroup(group, liveContent, liveReasoningContent, liveReasoningStartedAt, liveReasoningEndedAt),
    ),
  };
}

function mergeStreamingGroup(
  group: ChatGroup,
  liveContent: Map<string, string>,
  liveReasoningContent: Map<string, string>,
  liveReasoningStartedAt: Map<string, string>,
  liveReasoningEndedAt: Map<string, string>,
): ChatGroup {
  return {
    ...group,
    chats: group.chats.map((chat) => ({
      ...chat,
      messages: chat.messages.map((message) => ({
        ...message,
        ...(liveContent.has(message.id) ? { content: liveContent.get(message.id) ?? "" } : {}),
        ...(liveReasoningContent.has(message.id)
          ? { reasoningContent: liveReasoningContent.get(message.id) ?? "" }
          : {}),
        ...(liveReasoningStartedAt.has(message.id)
          ? { reasoningStartedAt: liveReasoningStartedAt.get(message.id) ?? null }
          : {}),
        ...(liveReasoningEndedAt.has(message.id)
          ? { reasoningEndedAt: liveReasoningEndedAt.get(message.id) ?? null }
          : {}),
      })),
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

function getChatPreview(chat: ChatSession) {
  const latest = [...chat.messages].reverse().find((message) => message.content.trim());
  return latest?.content.trim().replace(/\s+/g, " ").slice(0, 120) || "暂无消息内容";
}

function formatChatTitle(title: string) {
  return title === "New chat" ? "新对话" : title;
}

function formatMessageStatus(status: ChatMessage["status"]) {
  const statusText: Record<ChatMessage["status"], string> = {
    done: "已完成",
    streaming: "生成中",
    error: "出错",
    stopped: "已停止",
  };
  return statusText[status];
}

function formatReasoningDuration(message: ChatMessage) {
  if (!message.reasoningStartedAt) {
    return "1秒";
  }
  const startedAt = new Date(message.reasoningStartedAt).getTime();
  const endedAt = message.reasoningEndedAt
    ? new Date(message.reasoningEndedAt).getTime()
    : message.status === "streaming"
      ? Date.now()
      : new Date(message.updatedAt).getTime();
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt <= startedAt) {
    return "1秒";
  }
  return `${Math.max(1, Math.round((endedAt - startedAt) / 1000))}秒`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

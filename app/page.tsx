"use client";

import Image from "next/image";
import appIcon from "./icon.png";
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
import hljs from "highlight.js/lib/core";
import bashLanguage from "highlight.js/lib/languages/bash";
import cssLanguage from "highlight.js/lib/languages/css";
import javascriptLanguage from "highlight.js/lib/languages/javascript";
import jsonLanguage from "highlight.js/lib/languages/json";
import markdownLanguage from "highlight.js/lib/languages/markdown";
import pythonLanguage from "highlight.js/lib/languages/python";
import shellLanguage from "highlight.js/lib/languages/shell";
import sqlLanguage from "highlight.js/lib/languages/sql";
import typescriptLanguage from "highlight.js/lib/languages/typescript";
import xmlLanguage from "highlight.js/lib/languages/xml";
import yamlLanguage from "highlight.js/lib/languages/yaml";
import { CSSProperties, FormEvent, ReactNode, RefObject, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

type View =
  | { type: "home" }
  | { type: "new"; groupId?: string }
  | { type: "group"; groupId: string }
  | { type: "chat"; chatId: string };
type SettingsTab = "providers" | "chat";
type ProviderDetailMode = "view" | "create";

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
const API_KEY_MASK = "************************";
const GATEWAY_PREFIX = normalizeGatewayPrefix(process.env.NEXT_PUBLIC_GATEWAY_PREFIX);

hljs.registerLanguage("bash", bashLanguage);
hljs.registerLanguage("css", cssLanguage);
hljs.registerLanguage("javascript", javascriptLanguage);
hljs.registerLanguage("json", jsonLanguage);
hljs.registerLanguage("markdown", markdownLanguage);
hljs.registerLanguage("python", pythonLanguage);
hljs.registerLanguage("shell", shellLanguage);
hljs.registerLanguage("sql", sqlLanguage);
hljs.registerLanguage("typescript", typescriptLanguage);
hljs.registerLanguage("xml", xmlLanguage);
hljs.registerLanguage("yaml", yamlLanguage);
hljs.registerAliases(["js", "jsx"], { languageName: "javascript" });
hljs.registerAliases(["ts", "tsx"], { languageName: "typescript" });
hljs.registerAliases(["html", "svg"], { languageName: "xml" });
hljs.registerAliases(["sh", "zsh"], { languageName: "bash" });
hljs.registerAliases(["yml"], { languageName: "yaml" });

function readViewFromCurrentUrl(): View {
  if (typeof window === "undefined") {
    return { type: "home" };
  }
  const params = new URLSearchParams(window.location.search);
  const chatId = params.get("chat")?.trim();
  if (chatId) {
    return { type: "chat", chatId };
  }
  const groupId = params.get("group")?.trim();
  if (groupId) {
    return { type: "group", groupId };
  }
  return { type: "home" };
}

function getUrlForView(view: View) {
  const params = new URLSearchParams(window.location.search);
  params.delete("chat");
  params.delete("group");
  if (view.type === "chat") {
    params.set("chat", view.chatId);
  } else if (view.type === "group") {
    params.set("group", view.groupId);
  }
  const query = params.toString();
  return `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
}

function getCurrentPathWithSearch() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function normalizeBaseURLDraft(value: string) {
  const trimmed = value.trim();
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

export default function Home() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [providers, setProviders] = useState<PublicProvider[]>([]);
  const [view, setView] = useState<View>(() => readViewFromCurrentUrl());
  const [draft, setDraft] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [pendingByChat, setPendingByChat] = useState<Record<string, PendingChat>>({});
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("providers");
  const [lastModelId, setLastModelId] = useState("");
  const [groupFormOpen, setGroupFormOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [defaultPromptDraft, setDefaultPromptDraft] = useState("");
  const [deepThinkingEnabled, setDeepThinkingEnabled] = useState(false);
  const [uiError, setUiError] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const [modelFormProviderId, setModelFormProviderId] = useState<string | null>(null);
  const [modelName, setModelName] = useState("");
  const [modelId, setModelId] = useState("");
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [editingModelName, setEditingModelName] = useState("");
  const [editingModelModel, setEditingModelModel] = useState("");

  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [providerDetailMode, setProviderDetailMode] = useState<ProviderDetailMode>("view");
  const [newProviderId, setNewProviderId] = useState("");
  const [newProviderName, setNewProviderName] = useState("");
  const [newProviderBaseURL, setNewProviderBaseURL] = useState("");
  const [newProviderApiKey, setNewProviderApiKey] = useState("");
  const [providerNameDraft, setProviderNameDraft] = useState("");
  const [providerBaseURLDraft, setProviderBaseURLDraft] = useState("");
  const [providerApiKeyDraft, setProviderApiKeyDraft] = useState("");

  const abortControllers = useRef(new Map<string, AbortController>());
  const streamContent = useRef(new Map<string, string>());
  const streamReasoningContent = useRef(new Map<string, string>());
  const streamReasoningStartedAt = useRef(new Map<string, string>());
  const streamReasoningEndedAt = useRef(new Map<string, string>());
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const groupFormRef = useRef<HTMLDivElement | null>(null);
  const copyNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stickToBottom = useRef(true);
  const defaultPromptDirty = useRef(false);
  const workspaceRequestSeq = useRef(0);
  const appliedWorkspaceRequestSeq = useRef(0);
  const providersRequestSeq = useRef(0);
  const appliedProvidersRequestSeq = useRef(0);
  const skipNextUrlSync = useRef(false);
  const nextUrlSyncMode = useRef<"push" | "replace">("push");

  useEffect(() => {
    setLastModelId(window.localStorage.getItem(LAST_MODEL_KEY) || "");
    void loadInitialData();
  }, []);

  useEffect(() => {
    return () => {
      if (copyNoticeTimer.current) {
        clearTimeout(copyNoticeTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    function handlePopState() {
      skipNextUrlSync.current = true;
      nextUrlSyncMode.current = "push";
      setView(readViewFromCurrentUrl());
      setSidebarOpen(false);
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
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
  const activeGroup = useMemo(
    () =>
      view.type === "group" ? workspace?.groups.find((group) => group.id === view.groupId) ?? null : null,
    [view, workspace],
  );
  const activeLastMessageContent = activeChat?.messages.at(-1)?.content;
  const activeLastMessageReasoningContent = activeChat?.messages.at(-1)?.reasoningContent;
  const selectedModel = useMemo(() => {
    if (!workspace?.models.length) {
      return null;
    }
    const modelId = activeChat?.modelId || lastModelId;
    return workspace.models.find((model) => model.id === modelId) ?? workspace.models[0];
  }, [activeChat?.modelId, lastModelId, workspace]);
  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedProviderId) ?? providers[0] ?? null,
    [providers, selectedProviderId],
  );
  const selectedProviderModels = useMemo(() => {
    if (!workspace || !selectedProvider) {
      return [];
    }
    return workspace.models.filter((model) => model.providerId === selectedProvider.id);
  }, [selectedProvider, workspace]);
  const activePending = activeChat ? pendingByChat[activeChat.id] : undefined;

  useEffect(() => {
    if (skipNextUrlSync.current) {
      skipNextUrlSync.current = false;
      return;
    }
    const nextUrl = getUrlForView(view);
    const currentUrl = getCurrentPathWithSearch();
    if (nextUrl === currentUrl) {
      return;
    }
    const mode = nextUrlSyncMode.current;
    nextUrlSyncMode.current = "push";
    window.history[mode === "replace" ? "replaceState" : "pushState"]({ view }, "", nextUrl);
  }, [view]);

  useEffect(() => {
    if (!workspace) {
      return;
    }
    if (view.type === "chat" && !findChat(workspace, view.chatId)) {
      navigateToView({ type: "home" }, "replace");
      return;
    }
    if (view.type === "group" && !workspace.groups.some((group) => group.id === view.groupId)) {
      navigateToView({ type: "home" }, "replace");
    }
  }, [view, workspace]);

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
    if (!groupFormOpen) {
      return;
    }
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node) || groupFormRef.current?.contains(target)) {
        return;
      }
      setGroupFormOpen(false);
      setNewGroupName("");
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [groupFormOpen]);

  useEffect(() => {
    stickToBottom.current = true;
    requestAnimationFrame(() => scrollMessagesToBottom("auto"));
  }, [activeChat?.id]);

  useEffect(() => {
    if (stickToBottom.current) {
      // Streaming updates arrive frequently; instant scrolling avoids queuing
      // overlapping smooth-scroll animations that fight user navigation.
      requestAnimationFrame(() => scrollMessagesToBottom("auto"));
    }
  }, [activeChat?.messages.length, activeLastMessageContent, activeLastMessageReasoningContent]);

  useEffect(() => {
    if (!defaultPromptDirty.current) {
      setDefaultPromptDraft(workspace?.defaultGroup.systemPrompt ?? "");
    }
  }, [workspace?.defaultGroup.systemPrompt]);

  useEffect(() => {
    if (providerDetailMode === "create") {
      return;
    }
    if (!providers.length) {
      setSelectedProviderId("");
      return;
    }
    if (!selectedProviderId || !providers.some((provider) => provider.id === selectedProviderId)) {
      setSelectedProviderId(providers[0].id);
    }
  }, [providerDetailMode, providers, selectedProviderId]);

  useEffect(() => {
    const provider = providers.find((item) => item.id === selectedProviderId);
    if (!provider || providerDetailMode === "create") {
      return;
    }
    setProviderNameDraft(provider.name);
    setProviderBaseURLDraft(provider.baseURL);
    setProviderApiKeyDraft("");
  }, [providerDetailMode, providers, selectedProviderId]);

  function navigateToView(nextView: View, mode: "push" | "replace" = "push") {
    nextUrlSyncMode.current = mode;
    setView(nextView);
  }

  async function loadInitialData() {
    const [workspaceResponse, providersResponse] = await Promise.all([
      fetch(apiUrl("/api/workspace")),
      fetch(apiUrl("/api/providers")),
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

  async function loadWorkspace() {
    const requestId = ++workspaceRequestSeq.current;
    const response = await fetch(apiUrl("/api/workspace"));
    const data = (await response.json()) as WorkspaceResponse;
    if (!response.ok || data.error) {
      throw new Error(data.error || "Failed to load workspace.");
    }
    applyWorkspaceSnapshot(data.workspace, requestId);
    return data;
  }

  async function loadProviders() {
    const requestId = ++providersRequestSeq.current;
    const response = await fetch(apiUrl("/api/providers"));
    const data = (await response.json()) as ProvidersResponse;
    if (!response.ok || data.error) {
      throw new Error(data.error || "Failed to load providers.");
    }
    applyProvidersSnapshot(data.providers, requestId);
    return data.providers;
  }

  async function runWorkspaceAction<T>(action: Record<string, unknown>) {
    const requestId = ++workspaceRequestSeq.current;
    const response = await fetchWithSessionRetry(apiUrl("/api/workspace"), {
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
    method: "POST" | "PUT" | "DELETE",
    payload?: Record<string, unknown>,
    providerIdToDelete?: string,
  ) {
    const requestId = ++providersRequestSeq.current;
    const target =
      method === "DELETE"
        ? apiUrl(`/api/providers?id=${encodeURIComponent(providerIdToDelete || "")}`)
        : apiUrl("/api/providers");
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
      const groupId = view.type === "group" || view.type === "new" ? view.groupId : undefined;
      const created = await runWorkspaceAction<{ chatId: string }>({
        type: "createChat",
        groupId,
        modelId: selectedModel.id,
      });
      chatId = created.result?.chatId ?? "";
      nextWorkspace = created.workspace;
      if (chatId) {
        navigateToView({ type: "chat", chatId });
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
      const response = await fetchWithSessionRetry(apiUrl("/api/chat"), {
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
      void runWorkspaceAction({ type: "setChatModel", chatId: activeChat.id, modelId }).catch((error) =>
        showUiError(error, "模型切换失败。"),
      );
    }
  }

  function showUiError(error: unknown, fallback: string) {
    setUiError(error instanceof Error ? error.message : fallback);
  }

  function handleCopyText(text: string) {
    void copyText(text)
      .then(() => {
        setUiError(null);
        setCopyNotice("复制成功");
        if (copyNoticeTimer.current) {
          clearTimeout(copyNoticeTimer.current);
        }
        copyNoticeTimer.current = setTimeout(() => {
          setCopyNotice(null);
          copyNoticeTimer.current = null;
        }, 1600);
      })
      .catch((error) => {
        setCopyNotice(null);
        showUiError(error, "复制失败。");
      });
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

  async function handleCreateGroup(event: FormEvent) {
    event.preventDefault();
    const name = newGroupName.trim();
    if (!name) {
      return;
    }
    const data = await runWorkspaceAction<{ groupId: string }>({ type: "createGroup", name });
    if (data.result) {
      setGroupFormOpen(false);
      setNewGroupName("");
      navigateToView({ type: "group", groupId: data.result.groupId });
      setSidebarOpen(false);
    }
  }

  function handleCancelCreateGroup() {
    setGroupFormOpen(false);
    setNewGroupName("");
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
        navigateToView({ type: "home" }, "replace");
      },
    });
  }

  async function handleRenameGroup(group: ChatGroup, name: string) {
    try {
      await runWorkspaceAction({
        type: "updateGroup",
        groupId: group.id,
        name,
        systemPrompt: group.systemPrompt,
      });
      setUiError(null);
    } catch (error) {
      showUiError(error, "分组重命名失败。");
    }
  }

  function handleCreateChat(groupId?: string) {
    setDraft("");
    navigateToView({ type: "new", groupId });
    setSidebarOpen(false);
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
          navigateToView({ type: "home" }, "replace");
        }
      },
    });
  }

  async function handleRenameChat(chat: ChatSession, title: string) {
    try {
      await runWorkspaceAction({
        type: "renameChat",
        chatId: chat.id,
        title,
      });
      setUiError(null);
    } catch (error) {
      showUiError(error, "对话重命名失败。");
    }
  }

  async function handleMoveChat(chat: ChatSession, groupId: string) {
    try {
      await runWorkspaceAction<{ chatId: string; groupId: string }>({
        type: "moveChat",
        chatId: chat.id,
        groupId,
      });
      setUiError(null);
    } catch (error) {
      showUiError(error, "移动对话失败。");
    }
  }

  async function handleAddModel(event: FormEvent, targetProviderId: string) {
    event.preventDefault();
    if (!modelName.trim() || !modelId.trim()) {
      return;
    }
    try {
      await runWorkspaceAction({
        type: "createModel",
        name: modelName,
        model: modelId,
        providerId: targetProviderId,
      });
      setModelName("");
      setModelId("");
      setModelFormProviderId(null);
      setUiError(null);
    } catch (error) {
      showUiError(error, "模型保存失败。");
    }
  }

  function handleCancelAddModel() {
    setModelName("");
    setModelId("");
    setModelFormProviderId(null);
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
      setSelectedProviderId(newProviderId.trim());
      setProviderDetailMode("view");
      setUiError(null);
    } catch (error) {
      showUiError(error, "供应商保存失败。");
    }
  }

  async function saveProviderDraft(provider: PublicProvider) {
    if (!providerNameDraft.trim() || !providerBaseURLDraft.trim()) {
      return;
    }
    const hasChanges =
      providerNameDraft.trim() !== provider.name ||
      normalizeBaseURLDraft(providerBaseURLDraft) !== provider.baseURL ||
      Boolean(providerApiKeyDraft.trim());
    if (!hasChanges) {
      return;
    }
    try {
      await runProviderAction("PUT", {
        id: provider.id,
        name: providerNameDraft,
        baseURL: providerBaseURLDraft,
        apiKey: providerApiKeyDraft,
      });
      setProviderApiKeyDraft("");
      setUiError(null);
    } catch (error) {
      showUiError(error, "供应商保存失败。");
    }
  }

  async function handleDeleteProvider(provider: PublicProvider) {
    const providerModels = workspace?.models.filter((model) => model.providerId === provider.id) ?? [];
    setConfirmDialog({
      title: "删除供应商",
      description: `将删除“${provider.name}”及其下 ${providerModels.length} 个模型。已使用这些模型的对话会自动迁移到剩余模型之一。`,
      confirmLabel: "删除供应商",
      tone: "danger",
      onConfirm: async () => {
        if ((workspace?.models.some((model) => model.providerId !== provider.id) ?? false) === false) {
          throw new Error("至少需要保留一个其他供应商下的模型。");
        }
        await runProviderAction("DELETE", undefined, provider.id);
        await loadProviders();
        const nextWorkspaceResponse = await loadWorkspace();
        setModelFormProviderId((current) => (current === provider.id ? null : current));
        setProviderDetailMode("view");
        setSelectedProviderId((current) => {
          if (current !== provider.id) {
            return current;
          }
          return nextWorkspaceResponse.workspace.models[0]?.providerId || "";
        });
        const fallback = nextWorkspaceResponse.workspace.models[0];
        if (fallback && !nextWorkspaceResponse.workspace.models.some((model) => model.id === lastModelId)) {
          setLastModelId(fallback.id);
          window.localStorage.setItem(LAST_MODEL_KEY, fallback.id);
        }
      },
    });
  }

  async function handleUpdateModel(event: FormEvent) {
    event.preventDefault();
    const currentModel = workspace?.models.find((model) => model.id === editingModelId);
    if (!editingModelId || !editingModelName.trim() || !editingModelModel.trim() || !currentModel) {
      return;
    }
    try {
      await runWorkspaceAction({
        type: "updateModel",
        modelId: editingModelId,
        name: editingModelName,
        model: editingModelModel,
        providerId: currentModel.providerId,
      });
      setEditingModelId(null);
      setEditingModelName("");
      setEditingModelModel("");
      setUiError(null);
    } catch (error) {
      showUiError(error, "模型保存失败。");
    }
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
              <Image src={appIcon} alt="" width={36} height={36} unoptimized className="brand-icon" />
              <strong>Chat Web</strong>
            </div>
          </div>

          <div className="new-chat-row">
            <button className="new-chat-button" type="button" onClick={() => handleCreateChat()}>
              <MessageSquarePlus size={17} />
              新建对话
            </button>
          </div>

          <section className="sidebar-section">
            <div className="sidebar-section-title">
              <span>对话分组</span>
              <div className="group-create-anchor" ref={groupFormRef}>
                <button
                  className="link-icon-button"
                  type="button"
                  title="新分组"
                  aria-expanded={groupFormOpen}
                  onClick={() => setGroupFormOpen((open) => !open)}
                >
                  <Plus size={16} />
                </button>
                {groupFormOpen && (
                  <form className="group-create-popover" onSubmit={handleCreateGroup}>
                    <label htmlFor="new-group-name">分组名</label>
                    <input
                      id="new-group-name"
                      autoFocus
                      value={newGroupName}
                      onChange={(event) => setNewGroupName(event.target.value)}
                      placeholder="输入分组名"
                    />
                    <div className="group-create-actions">
                      <button className="text-button muted" type="button" onClick={handleCancelCreateGroup}>
                        取消
                      </button>
                      <button className="primary-button" type="submit" disabled={!newGroupName.trim()}>
                        确认
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
            <div className="group-list">
              {workspace.groups.length === 0 ? (
                <div className="sidebar-empty">暂无分组</div>
              ) : (
                workspace.groups.map((group) => (
                  <SidebarGroupRow
                    key={group.id}
                    group={group}
                    active={view.type === "group" && view.groupId === group.id}
                    onOpen={() => {
                      navigateToView({ type: "group", groupId: group.id });
                      setSidebarOpen(false);
                    }}
                    onRename={(name) => handleRenameGroup(group, name)}
                    onDelete={() => handleDeleteGroup(group)}
                  />
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
                          navigateToView({ type: "chat", chatId: chat.id });
                          setSidebarOpen(false);
                        }}
                        groups={[workspace.defaultGroup, ...workspace.groups]}
                        onRename={(title) => handleRenameChat(chat, title)}
                        onMove={(groupId) => handleMoveChat(chat, groupId)}
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
            </div>

            <div className="header-actions">
              <TooltipIconButton label="设置" onClick={() => setSettingsOpen(true)}>
                <Settings2 size={18} />
              </TooltipIconButton>
            </div>
          </header>

          {(view.type === "home" || view.type === "new") && <HomeView selectedModelName={selectedModel.name} />}

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
              onCreateChat={() => handleCreateChat(activeGroup.id)}
              onOpenChat={(chatId) => navigateToView({ type: "chat", chatId })}
              groups={[workspace.defaultGroup, ...workspace.groups]}
              onRenameChat={handleRenameChat}
              onMoveChat={handleMoveChat}
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
              onCopyText={handleCopyText}
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

          {copyNotice && (
            <div className="copy-toast" role="status" aria-live="polite">
              {copyNotice}
            </div>
          )}

          <Composer
            draft={draft}
            models={workspace.models}
            providers={providers}
            selectedModelId={selectedModel.id}
            selectedModelName={selectedModel.name}
            streaming={activeChat ? activePending?.status === "streaming" : false}
            deepThinkingEnabled={deepThinkingEnabled}
            onDraftChange={setDraft}
            onModelChange={handleModelChange}
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
                <Dialog.Description className="settings-description">管理模型提供方、模型和默认对话设置。</Dialog.Description>
                <SettingsNavButton
                  active={settingsTab === "providers"}
                  icon={<KeyRound size={17} />}
                  label="模型提供方"
                  onClick={() => {
                    setSettingsTab("providers");
                    setProviderDetailMode("view");
                  }}
                />
                <SettingsNavButton
                  active={settingsTab === "chat"}
                  icon={<Settings2 size={17} />}
                  label="对话设置"
                  onClick={() => setSettingsTab("chat")}
                />
              </aside>

              {settingsTab === "providers" && (
                <aside className="settings-provider-list">
                  <div className="settings-column-header">
                    <span>模型提供方</span>
                    <button
                      className="icon-button"
                      type="button"
                      title="添加供应商"
                      onClick={() => {
                        setProviderDetailMode("create");
                        setSelectedProviderId("");
                        setNewProviderId("");
                        setNewProviderName("");
                        setNewProviderBaseURL("");
                        setNewProviderApiKey("");
                        setEditingModelId(null);
                        setModelFormProviderId(null);
                      }}
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                  <div className="provider-picker-list">
                    {providers.length === 0 ? (
                      <div className="empty-inline">还没有供应商。</div>
                    ) : (
                      providers.map((provider) => (
                        <button
                          key={provider.id}
                          className={
                            providerDetailMode === "view" && selectedProvider?.id === provider.id
                              ? "provider-picker-item active"
                              : "provider-picker-item"
                          }
                          type="button"
                          onClick={() => {
                            setProviderDetailMode("view");
                            setSelectedProviderId(provider.id);
                            setEditingModelId(null);
                            setModelFormProviderId(null);
                          }}
                        >
                          <ProviderAvatar name={provider.name} />
                          <span>{provider.name}</span>
                        </button>
                      ))
                    )}
                  </div>
                </aside>
              )}

              <section className={settingsTab === "providers" ? "settings-panel provider-settings-panel" : "settings-panel chat-settings-panel"}>
                <button className="dialog-close" type="button" title="关闭设置" onClick={() => setSettingsOpen(false)}>
                  <X size={18} />
                </button>

                {settingsTab === "chat" && (
                  <div className="settings-content">
                    <div className="settings-panel-header">
                      <div>
                        <h2>对话设置</h2>
                        <p>配置默认对话分组在后续请求中使用的系统提示词。</p>
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
                  <div className="settings-content provider-detail-content">
                    {providerDetailMode === "create" ? (
                      <>
                        <div className="settings-panel-header">
                          <div>
                            <h2>新建供应商</h2>
                            <p>供应商 ID 创建后不可修改。</p>
                          </div>
                        </div>
                        <form className="settings-form" onSubmit={handleAddProvider}>
                          <label className="field-block">
                            <span>供应商 ID</span>
                            <input value={newProviderId} onChange={(event) => setNewProviderId(event.target.value)} />
                          </label>
                          <label className="field-block">
                            <span>名称</span>
                            <input value={newProviderName} onChange={(event) => setNewProviderName(event.target.value)} />
                          </label>
                          <label className="field-block">
                            <span>Base URL</span>
                            <input value={newProviderBaseURL} onChange={(event) => setNewProviderBaseURL(event.target.value)} />
                          </label>
                          <label className="field-block">
                            <span>API Key</span>
                            <input
                              type="password"
                              value={newProviderApiKey}
                              onChange={(event) => setNewProviderApiKey(event.target.value)}
                              autoComplete="new-password"
                            />
                          </label>
                          <div className="settings-form-actions">
                            <button
                              className="text-button muted"
                              type="button"
                              onClick={() => setProviderDetailMode("view")}
                            >
                              取消
                            </button>
                            <button className="primary-button" type="submit">
                              保存
                            </button>
                          </div>
                        </form>
                      </>
                    ) : selectedProvider ? (
                      <>
                        <div className="settings-panel-header provider-detail-header">
                          <div>
                            <h2>{selectedProvider.name}</h2>
                            <p>ID: {selectedProvider.id}</p>
                          </div>
                          <TooltipIconButton label="删除供应商" tone="danger" onClick={() => handleDeleteProvider(selectedProvider)}>
                            <Trash2 size={16} />
                          </TooltipIconButton>
                        </div>

                        <div className="settings-form">
                          <label className="field-block">
                            <span>名称</span>
                            <input
                              value={providerNameDraft}
                              onChange={(event) => setProviderNameDraft(event.target.value)}
                              onBlur={() => void saveProviderDraft(selectedProvider)}
                            />
                          </label>
                          <label className="field-block">
                            <span>Base URL</span>
                            <input
                              value={providerBaseURLDraft}
                              onChange={(event) => setProviderBaseURLDraft(event.target.value)}
                              onBlur={() => void saveProviderDraft(selectedProvider)}
                            />
                          </label>
                          <label className="field-block">
                            <span>API Key</span>
                            <input
                              type="password"
                              value={providerApiKeyDraft || (selectedProvider.hasApiKey ? API_KEY_MASK : "")}
                              onChange={(event) => {
                                setProviderApiKeyDraft(event.target.value === API_KEY_MASK ? "" : event.target.value);
                              }}
                              onFocus={(event) => {
                                if (selectedProvider.hasApiKey && !providerApiKeyDraft) {
                                  event.currentTarget.select();
                                }
                              }}
                              onBlur={() => void saveProviderDraft(selectedProvider)}
                              placeholder="未配置"
                              autoComplete="new-password"
                            />
                          </label>
                        </div>

                        <div className="model-section">
                          <div className="model-section-header">
                            <h3>模型</h3>
                            <button
                              className="text-button compact"
                              type="button"
                              onClick={() => {
                                setEditingModelId(null);
                                setModelName("");
                                setModelId("");
                                setModelFormProviderId(modelFormProviderId === selectedProvider.id ? null : selectedProvider.id);
                              }}
                            >
                              <Plus size={15} />
                              新建
                            </button>
                          </div>

                          {modelFormProviderId === selectedProvider.id && (
                            <form className="model-form inline" onSubmit={(event) => handleAddModel(event, selectedProvider.id)}>
                              <input placeholder="显示名称" value={modelName} onChange={(event) => setModelName(event.target.value)} />
                              <input placeholder="模型 ID" value={modelId} onChange={(event) => setModelId(event.target.value)} />
                              <div className="model-form-actions">
                                <button className="text-button compact muted" type="button" onClick={handleCancelAddModel}>
                                  取消
                                </button>
                                <button className="primary-button" type="submit">
                                  添加模型
                                </button>
                              </div>
                            </form>
                          )}

                          <div className="model-list detail-model-list">
                            {selectedProviderModels.length === 0 ? (
                              <div className="empty-inline">还没有模型。</div>
                            ) : (
                              selectedProviderModels.map((model) => (
                                <ModelRow
                                  key={model.id}
                                  model={model}
                                  active={model.id === selectedModel.id}
                                  editing={editingModelId === model.id}
                                  editingName={editingModelName}
                                  editingModel={editingModelModel}
                                  onEditingNameChange={setEditingModelName}
                                  onEditingModelChange={setEditingModelModel}
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
                      </>
                    ) : (
                      <div className="empty-inline">添加一个供应商后即可配置模型。</div>
                    )}
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

function ProviderAvatar({ name }: { name: string }) {
  const label = name.trim().slice(0, 1).toUpperCase() || "?";
  return <span className="provider-avatar">{label}</span>;
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

function SidebarGroupRow({
  group,
  active,
  onOpen,
  onRename,
  onDelete,
}: {
  group: ChatGroup;
  active: boolean;
  onOpen: () => void;
  onRename: (name: string) => Promise<void> | void;
  onDelete: () => void;
}) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [draft, setDraft] = useState(group.name);
  const renamePopoverRef = useRef<HTMLDivElement | null>(null);
  const menuAnchorRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useFocusWhenEditing(renameOpen);

  useEffect(() => {
    if (!renameOpen) {
      setDraft(group.name);
    }
  }, [group.name, renameOpen]);

  useDismissFloatingForm(renameOpen, renamePopoverRef, () => {
    setRenameOpen(false);
    setDraft(group.name);
  });

  async function submitRename(event: FormEvent) {
    event.preventDefault();
    const next = draft.trim();
    if (!next) {
      return;
    }
    if (next !== group.name) {
      await onRename(next);
    }
    setRenameOpen(false);
  }

  function cancelRename() {
    setDraft(group.name);
    setRenameOpen(false);
  }

  return (
    <div className={active ? "group-row active" : "group-row"}>
      <button className="group-title" type="button" onClick={onOpen}>
        <span>{group.name}</span>
        <small>{group.chats.length}</small>
      </button>
      <div className="row-menu-anchor" ref={menuAnchorRef}>
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger asChild>
            <button className="row-menu-button" type="button" title="更多">
              <MoreHorizontal size={16} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="dropdown-content" side="right" sideOffset={8} align="start">
              <DropdownMenu.Item className="dropdown-item" onSelect={() => openFloatingRename(setRenameOpen)}>
                <Pencil size={14} />
                重命名
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="dropdown-separator" />
              <DropdownMenu.Item className="dropdown-item danger" onSelect={onDelete}>
                <Trash2 size={14} />
                删除分组
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        {renameOpen && (
          <RenamePopover
            refObject={renamePopoverRef}
            inputRef={inputRef}
            title="重命名分组"
            value={draft}
            placeholder="输入分组名"
            onValueChange={setDraft}
            onSubmit={submitRename}
            onCancel={cancelRename}
            anchorRef={menuAnchorRef}
          />
        )}
      </div>
    </div>
  );
}

function SidebarChatRow({
  chat,
  active,
  groups,
  onOpen,
  onRename,
  onMove,
  onDelete,
}: {
  chat: ChatSession;
  active: boolean;
  groups: ChatGroup[];
  onOpen: () => void;
  onRename: (title: string) => Promise<void> | void;
  onMove: (groupId: string) => Promise<void> | void;
  onDelete: () => void;
}) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [draft, setDraft] = useState(formatChatTitle(chat.title));
  const renamePopoverRef = useRef<HTMLDivElement | null>(null);
  const menuAnchorRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useFocusWhenEditing(renameOpen);

  useEffect(() => {
    if (!renameOpen) {
      setDraft(formatChatTitle(chat.title));
    }
  }, [chat.title, renameOpen]);

  useDismissFloatingForm(renameOpen, renamePopoverRef, () => {
    setRenameOpen(false);
    setDraft(formatChatTitle(chat.title));
  });

  async function submitRename(event: FormEvent) {
    event.preventDefault();
    const next = draft.trim();
    if (!next) {
      return;
    }
    if (next !== formatChatTitle(chat.title)) {
      await onRename(next);
    }
    setRenameOpen(false);
  }

  function cancelRename() {
    setDraft(formatChatTitle(chat.title));
    setRenameOpen(false);
  }

  return (
    <div className={active ? "chat-row active" : "chat-row"}>
      <button className="chat-title" type="button" onClick={onOpen}>
        {formatChatTitle(chat.title)}
      </button>
      <div className="row-menu-anchor" ref={menuAnchorRef}>
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger asChild>
            <button className="row-menu-button" type="button" title="更多">
              <MoreHorizontal size={16} />
            </button>
          </DropdownMenu.Trigger>
          <ChatRowMenu
            chat={chat}
            groups={groups}
            onRename={() => openFloatingRename(setRenameOpen)}
            onMove={onMove}
            onDelete={onDelete}
          />
        </DropdownMenu.Root>
        {renameOpen && (
          <RenamePopover
            refObject={renamePopoverRef}
            inputRef={inputRef}
            title="重命名对话"
            value={draft}
            placeholder="输入对话名"
            onValueChange={setDraft}
            onSubmit={submitRename}
            onCancel={cancelRename}
            anchorRef={menuAnchorRef}
          />
        )}
      </div>
    </div>
  );
}

function ChatRowMenu({
  chat,
  groups,
  onRename,
  onMove,
  onDelete,
}: {
  chat: ChatSession;
  groups: ChatGroup[];
  onRename: () => void;
  onMove: (groupId: string) => Promise<void> | void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content className="dropdown-content" side="right" sideOffset={8} align="start">
        <DropdownMenu.Item className="dropdown-item" onSelect={onRename}>
          <Pencil size={14} />
          重命名
        </DropdownMenu.Item>
        <DropdownMenu.Sub>
          <DropdownMenu.SubTrigger className="dropdown-item">
            <ChevronDown size={14} />
            移动到分组
          </DropdownMenu.SubTrigger>
          <DropdownMenu.Portal>
            <DropdownMenu.SubContent className="dropdown-content" sideOffset={6} alignOffset={-4}>
              {groups.map((group) => (
                <DropdownMenu.Item
                  key={group.id}
                  className="dropdown-item"
                  disabled={chat.groupId === group.id}
                  onSelect={() => onMove(group.id)}
                >
                  {group.kind === "default" ? "最近对话" : group.name}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.SubContent>
          </DropdownMenu.Portal>
        </DropdownMenu.Sub>
        <DropdownMenu.Separator className="dropdown-separator" />
        <DropdownMenu.Item className="dropdown-item danger" onSelect={onDelete}>
          <Trash2 size={14} />
          删除对话
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
}

function useFocusWhenEditing(editing: boolean) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!editing) {
      return;
    }
    let focusFrame = 0;
    const frame = requestAnimationFrame(() => {
      focusFrame = requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(focusFrame);
    };
  }, [editing]);
  return inputRef;
}

function useTextareaFocusWhenEditing(editing: boolean) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (!editing) {
      return;
    }
    let focusFrame = 0;
    const frame = requestAnimationFrame(() => {
      focusFrame = requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.select();
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(focusFrame);
    };
  }, [editing]);
  return textareaRef;
}

function openFloatingRename(setOpen: (open: boolean) => void) {
  requestAnimationFrame(() => setOpen(true));
}

function useDismissFloatingForm(open: boolean, ref: RefObject<HTMLElement>, onDismiss: () => void) {
  useEffect(() => {
    if (!open) {
      return;
    }
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node) || ref.current?.contains(target)) {
        return;
      }
      onDismiss();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [onDismiss, open, ref]);
}

function useFloatingFormPosition(anchorRef?: RefObject<HTMLElement>) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!anchorRef) {
      setPosition(null);
      return;
    }
    const anchor = anchorRef;

    function updatePosition() {
      const element = anchor.current;
      if (!element) {
        return;
      }
      const rect = element.getBoundingClientRect();
      setPosition({
        top: Math.max(8, rect.top - 6),
        left: rect.right + 8,
      });
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchorRef]);

  return position;
}

function useFloatingBelowPosition(anchorRef: RefObject<HTMLElement>) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    function updatePosition() {
      const element = anchorRef.current;
      if (!element) {
        return;
      }
      const rect = element.getBoundingClientRect();
      const panelWidth = Math.min(420, window.innerWidth - 24);
      setPosition({
        top: rect.bottom + 8,
        left: Math.min(Math.max(12, rect.left), window.innerWidth - panelWidth - 12),
      });
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchorRef]);

  return position;
}

function RenamePopover({
  refObject,
  inputRef,
  anchorRef,
  title,
  value,
  placeholder,
  onValueChange,
  onSubmit,
  onCancel,
}: {
  refObject: RefObject<HTMLDivElement>;
  inputRef: RefObject<HTMLInputElement>;
  anchorRef?: RefObject<HTMLElement>;
  title: string;
  value: string;
  placeholder: string;
  onValueChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
}) {
  const position = useFloatingFormPosition(anchorRef);
  const style: CSSProperties | undefined = anchorRef
    ? {
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        visibility: position ? "visible" : "hidden",
      }
    : undefined;
  const popover = (
    <div className={anchorRef ? "rename-popover-anchor floating" : "rename-popover-anchor"} ref={refObject} style={style}>
      <form className="rename-popover" onSubmit={onSubmit}>
        <label>
          {title}
          <input
            ref={inputRef}
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            placeholder={placeholder}
          />
        </label>
        <div className="rename-popover-actions">
          <button className="text-button muted" type="button" onClick={onCancel}>
            取消
          </button>
          <button className="primary-button" type="submit" disabled={!value.trim()}>
            确认
          </button>
        </div>
      </form>
    </div>
  );
  if (anchorRef && typeof document !== "undefined") {
    return createPortal(popover, document.body);
  }
  return popover;
}

function InstructionPopover({
  refObject,
  anchorRef,
  textareaRef,
  value,
  onValueChange,
  onSubmit,
  onCancel,
}: {
  refObject: RefObject<HTMLDivElement>;
  anchorRef: RefObject<HTMLElement>;
  textareaRef: RefObject<HTMLTextAreaElement>;
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
}) {
  const position = useFloatingBelowPosition(anchorRef);
  const popover = (
    <div
      className="instruction-popover-panel"
      ref={refObject}
      style={{
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        visibility: position ? "visible" : "hidden",
      }}
    >
      <form className="rename-popover instruction-popover" onSubmit={onSubmit}>
        <label>
          编辑指令
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            placeholder="输入这个分组的系统指令"
            rows={5}
          />
        </label>
        <div className="rename-popover-actions">
          <button className="text-button muted" type="button" onClick={onCancel}>
            取消
          </button>
          <button className="primary-button" type="submit">
            确认
          </button>
        </div>
      </form>
    </div>
  );
  if (typeof document !== "undefined") {
    return createPortal(popover, document.body);
  }
  return popover;
}

function ModelSelect({
  models,
  providers,
  selectedModelId,
  disabled,
  onModelChange,
}: {
  models: ModelConfig[];
  providers: PublicProvider[];
  selectedModelId: string;
  disabled?: boolean;
  onModelChange: (modelId: string) => void;
}) {
  const selectedModel = models.find((model) => model.id === selectedModelId) ?? models[0];
  const selectedProvider =
    selectedModel && (providers.find((provider) => provider.id === selectedModel.providerId) ?? null);
  const providerGroups = providers
    .map((provider) => ({
      provider,
      models: models.filter((model) => model.providerId === provider.id),
    }))
    .filter((group) => group.models.length > 0);
  const missingProviderModels = models.filter((model) => !providers.some((provider) => provider.id === model.providerId));

  if (!selectedModel) {
    return null;
  }

  return (
    <Select.Root value={selectedModel.id} onValueChange={onModelChange} disabled={disabled}>
      <Select.Trigger className="model-select-trigger composer-model-trigger" aria-label="选择模型">
        <ProviderAvatar name={selectedProvider?.name ?? selectedModel.providerId} />
        <span className="composer-model-name">{selectedModel.name}</span>
        <Select.Icon>
          <ChevronDown size={15} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="select-content" position="popper" sideOffset={8}>
          <Select.Viewport className="select-viewport">
            {providerGroups.map(({ provider, models: providerModels }) => (
              <Select.Group key={provider.id}>
                <Select.Label className="select-group-label">{provider.name}</Select.Label>
                {providerModels.map((model) => (
                  <Select.Item key={model.id} className="select-item model-select-item" value={model.id}>
                    <ProviderAvatar name={provider.name} />
                    <Select.ItemText>
                      <span className="model-select-item-text">
                        <strong>{model.name}</strong>
                        <small>{model.model}</small>
                      </span>
                    </Select.ItemText>
                    <Select.ItemIndicator className="select-item-indicator">
                      <Check size={14} />
                    </Select.ItemIndicator>
                  </Select.Item>
                ))}
              </Select.Group>
            ))}
            {missingProviderModels.length > 0 && (
              <Select.Group>
                <Select.Label className="select-group-label">其他</Select.Label>
                {missingProviderModels.map((model) => (
                  <Select.Item key={model.id} className="select-item model-select-item" value={model.id}>
                    <ProviderAvatar name={model.providerId} />
                    <Select.ItemText>
                      <span className="model-select-item-text">
                        <strong>{model.name}</strong>
                        <small>{model.model}</small>
                      </span>
                    </Select.ItemText>
                    <Select.ItemIndicator className="select-item-indicator">
                      <Check size={14} />
                    </Select.ItemIndicator>
                  </Select.Item>
                ))}
              </Select.Group>
            )}
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
  groups,
  onRenameChat,
  onMoveChat,
  onDeleteChat,
}: {
  group: ChatGroup;
  onUpdateGroup: (patch: { name: string; systemPrompt: string }) => Promise<void> | void;
  onError: (error: unknown) => void;
  onDeleteGroup: () => void;
  onCreateChat: () => void;
  onOpenChat: (chatId: string) => void;
  groups: ChatGroup[];
  onRenameChat: (chat: ChatSession, title: string) => Promise<void> | void;
  onMoveChat: (chat: ChatSession, groupId: string) => Promise<void> | void;
  onDeleteChat: (chat: ChatSession) => void;
}) {
  const [systemPromptDraft, setSystemPromptDraft] = useState(group.systemPrompt);
  const [instructionOpen, setInstructionOpen] = useState(false);
  const instructionPopoverRef = useRef<HTMLDivElement | null>(null);
  const instructionAnchorRef = useRef<HTMLDivElement | null>(null);
  const instructionInputRef = useTextareaFocusWhenEditing(instructionOpen);

  useEffect(() => {
    setSystemPromptDraft(group.systemPrompt);
    setInstructionOpen(false);
  }, [group.id, group.name, group.systemPrompt]);

  useDismissFloatingForm(instructionOpen, instructionPopoverRef, () => {
    setSystemPromptDraft(group.systemPrompt);
    setInstructionOpen(false);
  });

  async function submitInstruction(event: FormEvent) {
    event.preventDefault();
    try {
      if (systemPromptDraft !== group.systemPrompt) {
        await onUpdateGroup({ name: group.name, systemPrompt: systemPromptDraft });
      }
      setInstructionOpen(false);
    } catch (error) {
      onError(error);
    }
  }

  function cancelInstructionEdit() {
    setSystemPromptDraft(group.systemPrompt);
    setInstructionOpen(false);
  }

  return (
    <div className="workspace-home">
      <header className="group-hero">
        <div className="group-title-row">
          <h1>{group.name}</h1>
          <div className="group-instruction">
            <span>指令：</span>
            <p>{group.systemPrompt.trim() || "这个分组尚未设置系统提示词"}</p>
            <div className="instruction-edit-anchor" ref={instructionAnchorRef}>
              <button
                className="inline-icon-button"
                type="button"
                title="编辑指令"
                aria-expanded={instructionOpen}
                onClick={() => setInstructionOpen((open) => !open)}
              >
                <Pencil size={13} />
              </button>
              {instructionOpen && (
                <InstructionPopover
                  refObject={instructionPopoverRef}
                  anchorRef={instructionAnchorRef}
                  textareaRef={instructionInputRef}
                  value={systemPromptDraft}
                  onValueChange={setSystemPromptDraft}
                  onSubmit={submitInstruction}
                  onCancel={cancelInstructionEdit}
                />
              )}
            </div>
            <span className="group-instruction-divider" aria-hidden="true" />
            <div className="group-instruction-actions">
              <button className="group-instruction-button" type="button" title="新对话" onClick={onCreateChat}>
                <MessageSquarePlus size={13} />
              </button>
              <button className="group-instruction-button danger" type="button" title="删除分组" onClick={onDeleteGroup}>
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        </div>
      </header>

      <ChatListPanel
        chats={group.chats}
        emptyText="这个分组还没有对话。"
        onOpenChat={onOpenChat}
        groups={groups}
        onRenameChat={onRenameChat}
        onMoveChat={onMoveChat}
        onDeleteChat={onDeleteChat}
      />
    </div>
  );
}

function ChatListPanel({
  chats,
  emptyText,
  onOpenChat,
  groups,
  onRenameChat,
  onMoveChat,
  onDeleteChat,
}: {
  chats: ChatSession[];
  emptyText: string;
  onOpenChat: (chatId: string) => void;
  groups: ChatGroup[];
  onRenameChat: (chat: ChatSession, title: string) => Promise<void> | void;
  onMoveChat: (chat: ChatSession, groupId: string) => Promise<void> | void;
  onDeleteChat: (chat: ChatSession) => void;
}) {
  return (
    <section className="chat-table-section">
      {chats.length === 0 ? (
        <div className="empty-inline">{emptyText}</div>
      ) : (
        <div className="compact-chat-list">
          {chats.map((chat) => (
            <CompactChatRow
              key={chat.id}
              chat={chat}
              groups={groups}
              onOpen={() => onOpenChat(chat.id)}
              onRename={(title) => onRenameChat(chat, title)}
              onMove={(groupId) => onMoveChat(chat, groupId)}
              onDelete={() => onDeleteChat(chat)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function CompactChatRow({
  chat,
  groups,
  onOpen,
  onRename,
  onMove,
  onDelete,
}: {
  chat: ChatSession;
  groups: ChatGroup[];
  onOpen: () => void;
  onRename: (title: string) => Promise<void> | void;
  onMove: (groupId: string) => Promise<void> | void;
  onDelete: () => void;
}) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [draft, setDraft] = useState(formatChatTitle(chat.title));
  const renamePopoverRef = useRef<HTMLDivElement | null>(null);
  const menuAnchorRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useFocusWhenEditing(renameOpen);

  useEffect(() => {
    if (!renameOpen) {
      setDraft(formatChatTitle(chat.title));
    }
  }, [chat.title, renameOpen]);

  useDismissFloatingForm(renameOpen, renamePopoverRef, () => {
    setRenameOpen(false);
    setDraft(formatChatTitle(chat.title));
  });

  async function submitRename(event: FormEvent) {
    event.preventDefault();
    const next = draft.trim();
    if (!next) {
      return;
    }
    if (next !== formatChatTitle(chat.title)) {
      await onRename(next);
    }
    setRenameOpen(false);
  }

  function cancelRename() {
    setDraft(formatChatTitle(chat.title));
    setRenameOpen(false);
  }

  return (
    <div className="compact-chat-row">
      <button className="compact-chat-title" type="button" onClick={onOpen}>
        <div>
          <strong>{formatChatTitle(chat.title)}</strong>
          <p>{getChatPreview(chat)}</p>
        </div>
        <time>{formatDate(chat.updatedAt)}</time>
      </button>
      <div className="row-menu-anchor" ref={menuAnchorRef}>
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger asChild>
            <button className="row-menu-button" type="button" title="更多">
              <MoreHorizontal size={16} />
            </button>
          </DropdownMenu.Trigger>
          <ChatRowMenu
            chat={chat}
            groups={groups}
            onRename={() => openFloatingRename(setRenameOpen)}
            onMove={onMove}
            onDelete={onDelete}
          />
        </DropdownMenu.Root>
        {renameOpen && (
          <RenamePopover
            refObject={renamePopoverRef}
            inputRef={inputRef}
            title="重命名对话"
            value={draft}
            placeholder="输入对话名"
            onValueChange={setDraft}
            onSubmit={submitRename}
            onCancel={cancelRename}
            anchorRef={menuAnchorRef}
          />
        )}
      </div>
    </div>
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
  onCopyText,
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
  onCopyText: (text: string) => void;
  onStickToBottomChange: (sticks: boolean) => void;
}) {
  const previousScrollTop = useRef(0);
  const previousChatId = useRef(chat.id);

  useEffect(() => {
    previousChatId.current = chat.id;
    previousScrollTop.current = 0;
  }, [chat.id]);

  return (
    <div
      className="message-list"
      ref={messageListRef}
      onScroll={(event) => {
        const element = event.currentTarget;
        const chatChanged = previousChatId.current !== chat.id;
        const movedUp = !chatChanged && element.scrollTop < previousScrollTop.current;
        previousChatId.current = chat.id;
        previousScrollTop.current = element.scrollTop;
        onStickToBottomChange(movedUp ? false : isNearBottom(element));
      }}
    >
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
            onCopyText={onCopyText}
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
  providers,
  selectedModelId,
  selectedModelName,
  streaming,
  deepThinkingEnabled,
  onDraftChange,
  onModelChange,
  onDeepThinkingChange,
  onSubmit,
  onStop,
}: {
  draft: string;
  models: ModelConfig[];
  providers: PublicProvider[];
  selectedModelId: string;
  selectedModelName: string;
  streaming: boolean;
  deepThinkingEnabled: boolean;
  onDraftChange: (draft: string) => void;
  onModelChange: (modelId: string) => void;
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
        <div className="composer-toolbar-left">
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
        <div className="composer-toolbar-right">
          <ModelSelect
            models={models}
            providers={providers}
            selectedModelId={selectedModelId}
            disabled={streaming}
            onModelChange={onModelChange}
          />
          {streaming ? (
            <button className="send-button stop" type="button" title="停止生成" onClick={onStop}>
              <Square size={17} />
            </button>
          ) : (
            <button className="send-button" disabled={!draft.trim()} title="发送">
              <Send size={19} />
            </button>
          )}
        </div>
      </div>
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
  onCopyText,
}: {
  message: ChatMessage;
  editingMessageId: string | null;
  editingContent: string;
  onEditingContentChange: (content: string) => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onResend: () => void;
  onCopyText: (text: string) => void;
}) {
  const isEditing = editingMessageId === message.id;
  const [reasoningOpen, setReasoningOpen] = useState(message.status === "streaming");
  const hasReasoning = message.role === "assistant" && Boolean(message.reasoningContent?.trim());
  const label = message.role === "assistant" ? "助手" : "";

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
      <div className="message-shell">
        <div className="message-meta">
          {label && <strong>{label}</strong>}
          {message.status !== "done" && <span>{formatMessageStatus(message.status)}</span>}
          <time dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>
        </div>

        <div className="message-body">
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
                  onCopyText={onCopyText}
                />
              )}
              <div className="markdown-body">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={createMarkdownComponents(onCopyText)}>
                  {message.content || (message.status === "streaming" ? " " : "")}
                </ReactMarkdown>
              </div>
            </>
          ) : (
            <p>{message.content}</p>
          )}
          {message.error && <div className="message-error">{message.error}</div>}
        </div>

        <div className="message-actions">
          {message.role === "assistant" ? (
            <>
              <button className="message-action-button" type="button" title="复制消息" onClick={() => onCopyText(message.content)}>
                <Clipboard size={13} />
              </button>
              <button className="message-action-button" type="button" title="重新生成" onClick={onResend}>
                <RefreshCcw size={13} />
              </button>
            </>
          ) : isEditing ? (
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
                <Pencil size={13} />
              </button>
              <button className="message-action-button" type="button" title="复制消息" onClick={() => onCopyText(message.content)}>
                <Clipboard size={13} />
              </button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

function ReasoningPanel({
  message,
  open,
  onOpenChange,
  onCopyText,
}: {
  message: ChatMessage;
  open: boolean;
  onOpenChange: () => void;
  onCopyText: (text: string) => void;
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
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={createMarkdownComponents(onCopyText)}>
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
  editing,
  editingName,
  editingModel,
  onEditingNameChange,
  onEditingModelChange,
  onSubmitEdit,
  onStartEdit,
  onCancelEdit,
  onSelect,
  onDelete,
}: {
  model: ModelConfig;
  active: boolean;
  editing: boolean;
  editingName: string;
  editingModel: string;
  onEditingNameChange: (value: string) => void;
  onEditingModelChange: (value: string) => void;
  onSubmitEdit: (event: FormEvent) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSelect: () => void;
  onDelete: () => void;
}) {
  if (editing) {
    return (
      <form className="model-edit-row" onSubmit={onSubmitEdit}>
        <input placeholder="显示名称" value={editingName} onChange={(event) => onEditingNameChange(event.target.value)} />
        <input placeholder="模型 ID" value={editingModel} onChange={(event) => onEditingModelChange(event.target.value)} />
        <div className="model-edit-actions">
          <button className="icon-button" title="保存模型">
            <Check size={15} />
          </button>
          <button className="icon-button cancel-icon-button" type="button" title="取消" onClick={onCancelEdit}>
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
        <span>{model.model}</span>
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

function createMarkdownComponents(onCopyText: (text: string) => void): Components {
  return {
    pre({ children }) {
      const text = extractText(children);
      return (
        <div className="code-block">
          <button className="code-copy" type="button" title="复制代码" onClick={() => onCopyText(text)}>
            <Clipboard size={14} />
          </button>
          <pre>{children}</pre>
        </div>
      );
    },
    code({ children, className }) {
      const code = extractText(children).replace(/\n$/, "");
      const language = extractCodeLanguage(className);
      if (!language && !code.includes("\n")) {
        return <code className={className}>{children}</code>;
      }
      const highlighted = highlightCode(code, language);
      return (
        <code
          className={language ? `hljs language-${language}` : "hljs"}
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
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
}

function extractCodeLanguage(className?: string) {
  return className
    ?.split(/\s+/)
    .find((name) => name.startsWith("language-"))
    ?.replace("language-", "")
    .toLowerCase();
}

function highlightCode(code: string, language?: string) {
  if (language && hljs.getLanguage(language)) {
    return hljs.highlight(code, { language, ignoreIllegals: true }).value;
  }
  return hljs.highlightAuto(code).value;
}

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
  await fetch(apiUrl("/api/providers"), { cache: "no-store" });
}

function apiUrl(path: string) {
  return `${GATEWAY_PREFIX}${path}`;
}

function normalizeGatewayPrefix(value?: string) {
  if (!value || value === "/") {
    return "";
  }

  return `/${value.replace(/^\/+|\/+$/g, "")}`;
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

async function copyText(text: string) {
  const permissionsPolicy = (
    document as Document & { permissionsPolicy?: { allowsFeature: (feature: string) => boolean } }
  ).permissionsPolicy;
  if (navigator.clipboard?.writeText && permissionsPolicy?.allowsFeature("clipboard-write") !== false) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back to selection-based copying for browsers that reject Clipboard API access.
    }
  }

  if (!copyTextWithSelection(text)) {
    throw new Error("当前浏览器不允许写入剪贴板。");
  }
}

function copyTextWithSelection(text: string) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  try {
    return document.execCommand("copy");
  } finally {
    textarea.remove();
  }
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

function formatMessageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const pad = (unit: number) => String(unit).padStart(2, "0");
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
  ].join(" ");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

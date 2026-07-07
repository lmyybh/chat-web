export type ChatRole = "system" | "user" | "assistant";

export type MessageStatus = "done" | "streaming" | "error" | "stopped";

export type ProviderConfig = {
  id: string;
  name: string;
  baseURL: string;
  apiKey?: string | null;
  apiKeyEnv?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type PublicProvider = Pick<ProviderConfig, "id" | "name" | "baseURL"> & {
  hasApiKey: boolean;
};

export type ModelConfig = {
  id: string;
  name: string;
  model: string;
  providerId: string;
  createdAt: string;
  updatedAt: string;
};

export type ChatMessage = {
  id: string;
  chatId: string;
  role: ChatRole;
  content: string;
  modelId: string | null;
  modelNameSnapshot: string | null;
  status: MessageStatus;
  error: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
};

export type ChatSession = {
  id: string;
  groupId: string;
  title: string;
  titleSource: "auto" | "manual";
  modelId: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
};

export type ChatGroup = {
  id: string;
  kind: "default" | "user";
  name: string;
  systemPrompt: string;
  chats: ChatSession[];
  createdAt: string;
  updatedAt: string;
};

export type Workspace = {
  models: ModelConfig[];
  defaultGroup: ChatGroup;
  groups: ChatGroup[];
};

export type CompletionMessage = {
  role: ChatRole;
  content: string;
};

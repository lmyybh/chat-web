import { NextResponse } from "next/server";
import { validateApiMutationRequest, withApiSession } from "../../lib/api-security";
import {
  appendMessage,
  createChat,
  createGroup,
  createModel,
  deleteChat,
  deleteGroup,
  deleteModel,
  editUserMessageAndTruncate,
  getWorkspace,
  renameChat,
  setChatModel,
  updateDefaultSystemPrompt,
  updateGroup,
  updateModel,
  updateMessageContent,
  updateMessageStatus,
} from "../../lib/repository";

export const dynamic = "force-dynamic";

type WorkspaceAction =
  | { type: "createGroup" }
  | { type: "updateGroup"; groupId: string; name: string; systemPrompt: string }
  | { type: "updateDefaultSystemPrompt"; systemPrompt: string }
  | { type: "deleteGroup"; groupId: string }
  | { type: "createChat"; groupId?: string; modelId?: string }
  | { type: "deleteChat"; chatId: string }
  | { type: "renameChat"; chatId: string; title: string }
  | { type: "setChatModel"; chatId: string; modelId: string }
  | { type: "createModel"; name: string; model: string; providerId: string }
  | { type: "updateModel"; modelId: string; name: string; model: string; providerId: string }
  | { type: "deleteModel"; modelId: string }
  | {
      type: "appendMessage";
      chatId: string;
      role: "system" | "user" | "assistant";
      content: string;
      modelId?: string | null;
      status?: "done" | "streaming" | "error" | "stopped";
      error?: string | null;
    }
  | { type: "editUserMessageAndTruncate"; messageId: string; content: string }
  | { type: "updateMessageContent"; messageId: string; content: string }
  | {
      type: "updateMessageStatus";
      messageId: string;
      status: "done" | "streaming" | "error" | "stopped";
      error?: string | null;
    };

export async function GET(request: Request) {
  try {
    return withApiSession(NextResponse.json({ workspace: getWorkspace() }), request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load workspace.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const guard = validateApiMutationRequest(request, { requireJson: true });
  if (guard) {
    return guard;
  }

  let action: WorkspaceAction;
  try {
    action = (await request.json()) as WorkspaceAction;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const result = runAction(action);
    return NextResponse.json({ workspace: getWorkspace(), result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Workspace action failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

function runAction(action: WorkspaceAction) {
  switch (action.type) {
    case "createGroup":
      return createGroup();
    case "updateGroup":
      return updateGroup(action.groupId, {
        name: action.name,
        systemPrompt: action.systemPrompt,
      });
    case "updateDefaultSystemPrompt":
      return updateDefaultSystemPrompt(action.systemPrompt);
    case "deleteGroup":
      return deleteGroup(action.groupId);
    case "createChat":
      return createChat(action.groupId, action.modelId);
    case "deleteChat":
      return deleteChat(action.chatId);
    case "renameChat":
      return renameChat(action.chatId, action.title);
    case "setChatModel":
      return setChatModel(action.chatId, action.modelId);
    case "createModel":
      return createModel({
        name: action.name,
        model: action.model,
        providerId: action.providerId,
      });
    case "updateModel":
      return updateModel(action.modelId, {
        name: action.name,
        model: action.model,
        providerId: action.providerId,
      });
    case "deleteModel":
      return deleteModel(action.modelId);
    case "appendMessage":
      return appendMessage({
        chatId: action.chatId,
        role: action.role,
        content: action.content,
        modelId: action.modelId,
        status: action.status,
        error: action.error,
      });
    case "editUserMessageAndTruncate":
      return editUserMessageAndTruncate(action.messageId, action.content);
    case "updateMessageContent":
      return updateMessageContent(action.messageId, action.content);
    case "updateMessageStatus":
      return updateMessageStatus(action.messageId, action.status, action.error);
    default:
      return assertNever(action);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported workspace action: ${JSON.stringify(value)}`);
}

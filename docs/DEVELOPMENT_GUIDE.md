# Chat Web Development Guide

This document is the implementation guide for the next version of Chat Web. It supersedes the current localStorage prototype.

## Product Direction

Chat Web is a personal local web tool for OpenAI-compatible chat models.

Core goals:

- ChatGPT-like interface.
- Multiple model providers.
- Conversation groups that share one live system prompt.
- Editable user history with resend from any user message.
- Durable local data that is not lost when browser storage is cleared.

Non-goals for v1:

- Multi-user accounts or permissions.
- Cloud sync.
- Search.
- Automatic backups.
- Migration from the old localStorage prototype.

## Architecture Decisions

- Keep Next.js + React + TypeScript.
- Replace localStorage as the source of truth with SQLite.
- Use `better-sqlite3` with hand-written repository functions and SQL migrations.
- Store the SQLite file at `data/chat-web.sqlite`.
- Ignore SQLite runtime files in git:
  - `data/*.sqlite`
  - `data/*.sqlite-wal`
  - `data/*.sqlite-shm`
- Use localStorage only for non-critical UI preferences such as the last selected model.
- Keep provider configuration server-side. The browser must never send arbitrary `baseURL` to `/api/chat`.

## Provider Model

Support multiple OpenAI-compatible providers. Providers are stored in SQLite, managed from the global settings drawer, and exposed to the UI without API keys.

Provider fields:

- `id`
- `name`
- `baseURL`
- `apiKey`
- `apiKeyEnv` for optional initial environment-based seed data

Rules:

- `/api/providers` returns only public provider fields: `id`, `name`, `baseURL`, and `hasApiKey`.
- `/api/providers` supports adding and deleting providers.
- `/api/chat` accepts `providerId`, `model`, and `messages`.
- `/api/chat` looks up `providerId` server-side to find `baseURL`.
- Provider API keys are stored server-side in SQLite and are never returned to the browser.
- Empty provider API key means do not send `Authorization`, for local unauthenticated providers.

Example `.env.local`:

```bash
OPENAI_API_KEY=...
LOCAL_API_KEY=
OPENAI_COMPATIBLE_PROVIDERS='[
  {"id":"openai","name":"OpenAI","baseURL":"https://api.openai.com/v1","apiKeyEnv":"OPENAI_API_KEY"},
  {"id":"local","name":"Local SGLang","baseURL":"http://localhost:30000/v1","apiKeyEnv":""}
]'
```

If `OPENAI_COMPATIBLE_PROVIDERS` is not set in a fresh database, create a default provider:

- `id`: `openai`
- `name`: `OpenAI`
- `baseURL`: `OPENAI_BASE_URL || https://api.openai.com/v1`
- `apiKey`: `OPENAI_API_KEY` when present

## Data Model

Recommended SQLite tables:

- `models`
  - `id`
  - `name`
  - `model`
  - `provider_id`
  - `created_at`
  - `updated_at`
- `groups`
  - `id`
  - `kind` as `"default" | "user"`
  - `name`
  - `system_prompt`
  - `created_at`
  - `updated_at`
- `chats`
  - `id`
  - `group_id`
  - `title`
  - `title_source` as `"auto" | "manual"`
  - `model_id`
  - `created_at`
  - `updated_at`
- `messages`
  - `id`
  - `chat_id`
  - `role` as `"user" | "assistant" | "system"`
  - `content`
  - `model_id`
  - `model_name_snapshot`
  - `status` as `"done" | "streaming" | "error" | "stopped"`
  - `error`
  - `position`
  - `created_at`
  - `updated_at`

Repository layer:

- `getWorkspace()`
- `createGroup()`
- `deleteGroup()`
- `updateGroup()`
- `createChat()`
- `deleteChat()`
- `renameChat()`
- `createModel()`
- `deleteModel()`
- `appendMessage()`
- `editUserMessageAndTruncate()`
- `updateMessageContent()`
- `updateMessageStatus()`

API routes should call repository functions instead of writing SQL inline.

## Conversation Rules

System prompt:

- `groups.system_prompt` is the only system prompt source for all chats in that group.
- The internal default group stores the default system prompt for Home/Chats.
- Chats do not store system prompt snapshots.
- Changing a group system prompt affects future sends and resends for every chat in the group.
- Historical messages are not rewritten.

Models:

- `chats.model_id` is the current model for that chat.
- Switching models happens in the composer toolbar and affects future sends/resends in the current chat.
- New chats use the globally remembered last selected model.
- Messages store `model_name_snapshot` so history remains accurate after model deletion.
- Deleting a model moves affected chats to a fallback model.

Editing and resending:

- Only `user` messages are editable.
- Saving and resending a user message updates that message, deletes every following message, and sends the truncated context.
- Do not preserve branch trees in v1.
- Resend uses the current group system prompt and current chat model.

Chat titles:

- New chats start as `New chat`.
- The first user message generates an automatic title from the first 42 characters.
- If the first user message is edited and `title_source === "auto"`, update the title.
- Users can manually rename chats.
- Manual rename sets `title_source = "manual"` and prevents automatic overwrites.

Deletion:

- Deleting a chat always removes that chat.
- Deleting a chat does not create a blank replacement.
- Deleting a group requires confirmation and deletes all chats/messages in that group.
- The internal default group always exists but is not shown in the group list.
- User groups are optional; deleting the last user group is allowed.
- Deleting a pending chat or group must abort related requests and ignore late stream deltas.

## Streaming Chat

Use OpenAI-compatible streaming for v1.

Server behavior:

- `/api/chat` sends `stream: true` to the provider.
- It reads provider SSE chunks and forwards assistant deltas to the browser.
- It must not expose provider base URLs or API keys.

Client behavior:

- Manage pending/error/abort state per chat, not globally.
- Same chat: only one active request.
- Different chats: concurrent requests are allowed.
- Sending flow:
  1. Append the user message.
  2. Append an empty assistant message with `status: "streaming"`.
  3. Append each received delta to that assistant message.
  4. On natural completion, set `status: "done"`.
  5. On provider/network failure, keep partial content and set `status: "error"` with `error`.
  6. On user stop, keep partial content and set `status: "stopped"`.
- The composer send button becomes a stop button while the active chat is streaming.
- Stop uses `AbortController.abort()`.

## UI Direction

Use a ChatGPT-like layout:

- Left sidebar:
  - New group button.
  - Settings button.
  - Group list.
  - Home/Chats entry.
  - Default-group chat list.
  - New default chat button.
- Main conversation:
  - Home/Chats view with default chat list and composer.
  - Group home view with group name, group system prompt, delete group, group chat list, and composer.
  - Chat view with editable chat title and message list.
  - Composer at the bottom.
- Composer:
  - Model selector in the composer toolbar.
- Global settings drawer:
  - Edit default system prompt for Home/Chats.
  - Manage providers.
  - Manage models.
  - Select provider when adding/editing a model.

Mobile:

- Sidebar and settings should become overlays or drawers.
- Conversation remains the primary view.

Message rendering:

- Assistant messages render Markdown/GFM.
- User messages render as plain text.
- Support lists, tables, links, quotes, inline code, and code blocks.
- Do not support raw HTML, Mermaid, LaTeX, or syntax highlighting in v1.
- Code blocks have copy buttons.
- Every message has a copy button.
- Assistant copy uses the raw Markdown source, not rendered HTML.

## Implementation Order

1. Add dependencies: `better-sqlite3`, `react-markdown`, and `remark-gfm`.
2. Add SQLite data layer, migrations, seed data, and repository tests.
3. Add provider config parser and `/api/providers`.
4. Replace localStorage state with workspace CRUD API.
5. Rewrite `/api/chat` for provider allowlist and streaming.
6. Rebuild the page state around per-chat pending/error/abort.
7. Rework layout into sidebar + main conversation + settings drawer.
8. Add Markdown rendering, code copy, and message copy.
9. Update README and environment examples.

## Testing Guidance

Repository tests:

- Database initializes from an empty file.
- Default provider/model/group/chat seed correctly.
- Create/delete group preserves at least one group.
- Create/delete chat preserves at least one chat per active group.
- Edit user message truncates following messages.
- Manual chat title prevents automatic title overwrite.
- Deleted model does not corrupt message history display.

API tests:

- `/api/providers` does not expose `baseURL` or `apiKeyEnv`.
- `/api/chat` rejects unknown provider IDs.
- `/api/chat` returns clear missing-key errors.
- `/api/chat` does not accept arbitrary `baseURL`.
- Streaming forwards deltas and handles provider errors.

UI/manual checks:

- Add provider-backed models and switch per chat.
- Create, rename, and delete groups.
- Create, rename, and delete chats.
- Edit a historical user message and resend.
- Stop generation and verify the message becomes `stopped`.
- Simulate provider failure and verify partial content is preserved as `error`.
- Clear browser storage and verify SQLite data remains.

# Chat Web

A local-first, ChatGPT-style web assistant for OpenAI-compatible chat models.

## Development Guide

The next implementation phase is defined in [docs/DEVELOPMENT_GUIDE.md](docs/DEVELOPMENT_GUIDE.md).

That guide records the agreed product decisions: SQLite persistence, provider/model management, streaming responses, per-chat pending state, Home/Group/Chat views, Markdown rendering, and deletion/editing behavior.

## Development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000.

## Environment

Set `OPENAI_API_KEY` on the server for the first default OpenAI provider seed. `OPENAI_BASE_URL` is optional and defaults to `https://api.openai.com/v1`.

Data is stored locally in `data/chat-web.sqlite`.

Multiple OpenAI-compatible providers can be added and deleted in the settings drawer. Keys entered in the settings drawer are stored in SQLite and are never returned to the browser. The default OpenAI provider keeps `OPENAI_API_KEY` as an environment-backed key instead of copying it into SQLite. Browser API mutations use a same-origin session cookie/header guard. `OPENAI_COMPATIBLE_PROVIDERS` is still supported as an initial seed source for a fresh database.

The app always opens to the Home/Chats view. Chats shown there are stored in an internal default group that is not shown in the group list. User-created groups have their own group home pages with group settings, group chat lists, and a composer that creates a chat in that group.

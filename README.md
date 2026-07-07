# Chat Web

A local-first, ChatGPT-style web assistant for OpenAI-compatible chat models.

## Development Guide

The next implementation phase is defined in [docs/DEVELOPMENT_GUIDE.md](docs/DEVELOPMENT_GUIDE.md).

That guide records the agreed product decisions: SQLite persistence, provider allowlists, streaming responses, per-chat pending state, settings drawer UI, Markdown rendering, and deletion/editing behavior.

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

Multiple OpenAI-compatible providers can be added and deleted in the settings drawer. Provider API keys are stored in SQLite and are never returned to the browser. `OPENAI_COMPATIBLE_PROVIDERS` is still supported as an initial seed source for a fresh database.

# Copilot CLI Mobile

> **GitHub Copilot CLI from your phone** — a lightweight, self-hosted web app powered by the official [GitHub Copilot SDK](https://github.com/github/copilot-sdk).

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-22%2B-339933?logo=nodedotjs&logoColor=white" alt="Node.js 22+">
  <img src="https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Copilot_SDK-0.1.32-000000?logo=github&logoColor=white" alt="Copilot SDK">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT License">
</p>

---

## What Is This?

The same Copilot CLI experience you get on your terminal — but accessible from a mobile browser. Authenticate with GitHub, pick a model, and start chatting. The app uses the official `@github/copilot-sdk` under the hood, so it has full parity with the desktop Copilot CLI — including built-in tools for the GitHub API, file access, and shell.

## Copilot SDK Implementation

The core of the app is a thin WebSocket layer on top of `@github/copilot-sdk`. Each browser connection gets its own SDK lifecycle:

1. **Client per connection** — `CopilotClient` is instantiated per WebSocket connection. The SDK spawns a `@github/copilot` CLI subprocess behind the scenes, communicating via JSON-RPC over stdio.

2. **Session management** — On connect (or "new chat"), the server calls `client.createSession()` with a `SessionConfig` object that includes the selected model, reasoning effort, custom instructions, the GitHub MCP server, and the permission handler.

3. **Streaming events** — The SDK session emits events (`assistant.message_delta`, `assistant.reasoning_delta`, `tool.execution_start`, etc.) which the server forwards over WebSocket as typed JSON messages. The browser renders them in real time.

4. **Lifecycle cleanup** — On WebSocket close, the server destroys the session and calls `client.stop()` to terminate the CLI subprocess.

### SDK Features Implemented

| SDK Feature | API Used | How It's Exposed |
|-------------|----------|-------------------|
| **Model selection** | `SessionConfig.model` + `client.listModels()` | Dropdown in the status bar. Populated dynamically from the Copilot API. Mid-session model switching via `session.setModel()` |
| **Reasoning effort** | `SessionConfig.reasoningEffort` (`low` / `medium` / `high` / `xhigh`) | Toggle button group, visible only for reasoning-capable models (o-series, thinking). Changing it restarts the session |
| **Streaming** | `SessionConfig.streaming: true` + `assistant.message_delta` events | Token-by-token rendering with a typing cursor. Throttled at 50ms for smooth mobile performance |
| **Extended thinking** | `assistant.reasoning_delta` / `assistant.reasoning` events | Collapsible "Thinking…" block with live content. Auto-collapses when reasoning is done |
| **Modes** | `session.rpc.mode.set()` — `interactive` / `plan` / `autopilot` | Three-button toggle (ask / plan / auto) matching the CLI's `/mode` command |
| **Custom instructions** | `SessionConfig.systemMessage` in `append` mode | Textarea in the Settings panel. Instructions are appended to the SDK's system prompt without replacing security guardrails |
| **MCP Server** | `SessionConfig.mcpServers` — GitHub HTTP MCP with `tools: ['*']` | All GitHub MCP tools available (readonly). Authenticated with the user's GitHub token |
| **Permission handling** | `SessionConfig.onPermissionRequest: approveAll` | Auto-approves all tool calls, matching the desktop CLI's default behavior |
| **User input requests** | `SessionConfig.onUserInputRequest` callback returning a Promise | Interactive UI with choice buttons + freeform text input. The SDK's `ask_user` tool triggers a prompt in the chat |
| **Tool execution lifecycle** | `tool.execution_start` / `tool.execution_progress` / `tool.execution_complete` | Spinner animation with tool name and progress text. Checkmark on completion |
| **Intent display** | `assistant.intent` event | Arrow (→) line showing the model's inferred intent before acting |
| **Token usage** | `assistant.usage` event | Info line after each response: `tokens — in: X · out: Y · reasoning: Z` |
| **Session title** | `session.title_changed` event | Displayed as an info line below the environment section |
| **Subagent orchestration** | `subagent.started` / `subagent.completed` events | Tool-style display: `agent/<name>` with spinner and status |
| **Session warnings/errors** | `session.warning` / `session.error` events | Yellow/red styled messages in the chat |
| **Abort** | `session.abort()` | Stop button (visible during streaming) sends abort to the SDK |

### SDK Features Not Used

| SDK Feature | Why Not |
|-------------|---------|
| `provider` (BYOK) | This app targets users with a Copilot license — custom providers are out of scope |
| `availableTools` / `excludedTools` | All tools are enabled, matching the desktop CLI default |
| `systemMessage: { mode: 'replace' }` | Only `append` mode is used to preserve SDK safety guardrails |
| `hooks` (`onPreToolUse`, `onPostToolUse`, etc.) | Not needed — `approveAll` covers the permission model |
| `customAgents` / `skillDirectories` | Desktop-only features that require local filesystem access |
| `infiniteSessions` | Default SDK behavior (auto-compaction) is used as-is |
| `workingDirectory` / `configDir` | The app runs in a container; no user workspace to reference |

## Features

| Feature | Description |
|---------|-------------|
| **Full Copilot CLI parity** | Same engine, same models, same tools as `copilot` in your terminal |
| **Mobile-first UI** | Dark theme, responsive layout, virtual keyboard handling, touch-optimized controls |
| **Real-time streaming** | Token-by-token responses over WebSocket with typing indicator |
| **GitHub Device Flow auth** | Same auth as `gh auth login` — enter a short code, no client secret needed |
| **Settings persistence** | Model, mode, reasoning effort, and custom instructions saved in localStorage |
| **Settings panel** | Custom instructions (appended to system prompt), preference persistence |
| **Markdown rendering** | Full GFM support with syntax-highlighted code blocks and copy buttons |
| **Docker-ready** | Single `docker compose up` to run locally |
| **2 env vars** | Only `SESSION_SECRET` and `GITHUB_CLIENT_ID` required |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Mobile / Desktop Browser                          │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────────────┐   │
│  │  Device Flow UI  │  │   Chat UI (SPA) │  │  Markdown + Highlight   │   │
│  │  (login screen)  │  │  (chat screen)  │  │  (marked + DOMPurify)   │   │
│  └────────┬─────────┘  └───────┬─────────┘  └──────────────────────────┘   │
│           │ HTTP                │ WebSocket (ws/wss)                       │
└───────────┼────────────────────┼──────────────────────────────────────────┘
            │                    │
            ▼                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Express + TypeScript Server                           │
│  ┌──────────┐  ┌──────────┐  ┌─────────────┐  ┌────────────────────────┐  │
│  │  Helmet   │  │  Rate    │  │  Session    │  │  Static File Server   │  │
│  │  (CSP)    │  │  Limiter │  │  (file/mem) │  │  (public/)            │  │
│  └──────────┘  └──────────┘  └──────┬──────┘  └────────────────────────┘  │
│                                     │                                     │
│  ┌──────────────────────────────────┼──────────────────────────────────┐  │
│  │  Routes                          │                                  │  │
│  │  /auth/* ─── Device Flow ────────┤                                  │  │
│  │  /api/*  ─── Models (guarded) ───┤                                  │  │
│  │  /ws     ─── WebSocket ──────────┘                                  │  │
│  └──────────────────────────────────┬──────────────────────────────────┘  │
│                                     │                                     │
│  ┌──────────────────────────────────┴──────────────────────────────────┐  │
│  │  Copilot SDK                                                        │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌────────────────────┐  │  │
│  │  │  CopilotClient   │  │  Session +       │  │  MCP GitHub       │  │  │
│  │  │  (per connection) │  │  Model Config    │  │  HTTP Server      │  │  │
│  │  └────────┬─────────┘  └─────────────────┘  └────────────────────┘  │  │
│  │           │ JSON-RPC (stdio)                                        │  │
│  │           ▼                                                         │  │
│  │  ┌─────────────────┐                                                │  │
│  │  │  @github/copilot │ ← CLI subprocess (one per connection)         │  │
│  │  │  CLI process      │                                               │  │
│  │  └─────────────────┘                                                │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────┐
│  github.com              │
│  ├─ Device Flow OAuth    │
│  ├─ Copilot API          │
│  └─ REST API (via MCP)   │
└──────────────────────────┘
```

**How it works:**

1. User opens the app → GitHub Device Flow starts (enter a code at `github.com/login/device`)
2. After auth → GitHub token stored server-side in Express session (never sent to browser)
3. Chat screen appears — user picks a model, WebSocket connection opens
4. Server creates a `CopilotClient` per WebSocket connection (the SDK spawns a `@github/copilot` CLI subprocess communicating via JSON-RPC over stdio)
5. A `SessionConfig` is built with the selected model, reasoning effort, custom instructions (`systemMessage: append`), the GitHub MCP server, and `approveAll` as the permission handler
6. `client.createSession(config)` starts the session — the server subscribes to all SDK events (`assistant.message_delta`, `tool.execution_start`, `assistant.reasoning_delta`, `session.title_changed`, etc.)
7. User sends a message → server calls `session.sendAndWait({ prompt })` → SDK emits events → each event is forwarded over WebSocket as typed JSON → browser renders in real time
8. On disconnect → `session.destroy()` + `client.stop()` terminates the CLI subprocess

## Getting Started

### Prerequisites

- **Node.js 22+** — required by `@github/copilot-sdk`
- **GitHub account** with an active [Copilot license](https://github.com/features/copilot#pricing) (free tier works)

### 1. Register a GitHub OAuth App

The app uses [GitHub Device Authorization Flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow) — the same flow as `gh auth login`. **No client secret needed.**

1. Go to [GitHub → Settings → Developer settings → OAuth Apps](https://github.com/settings/developers)
2. Click **New OAuth App**:
   - **Application name**: `Copilot CLI Mobile`
   - **Homepage URL**: `http://localhost:3000`
   - **Authorization callback URL**: `http://localhost:3000` (device flow never uses it)
3. Click **Register application**
4. Copy the **Client ID** → that's your `GITHUB_CLIENT_ID`

> No client secret, no redirect URI configuration, and no updates needed when the URL changes.

### 2. Set Environment Variables

Create a `.env` file:

```env
GITHUB_CLIENT_ID=<your-client-id>
SESSION_SECRET=<run: openssl rand -hex 32>

# Optional: restrict access to specific GitHub users (comma-separated)
# ALLOWED_GITHUB_USERS=user1,user2,user3

# Optional: token freshness lifetime in ms (default: 24 hours)
# TOKEN_MAX_AGE_MS=86400000
```

### 3. Run With Docker

```bash
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000) — enter the code on GitHub, and start chatting.

### 4. Run Directly (Without Docker)

```bash
npm install
npm run build
npm start
```

Or for development with hot reload:

```bash
npm run dev:local
```

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GITHUB_CLIENT_ID` | Yes | — | GitHub OAuth App client ID |
| `SESSION_SECRET` | Yes | — | Random string for session encryption (`openssl rand -hex 32`) |
| `PORT` | No | `3000` | HTTP server port |
| `BASE_URL` | No | `http://localhost:3000` | Full app URL (used for cookies) |
| `NODE_ENV` | No | `development` | Set to `production` for secure cookies |
| `SESSION_STORE_PATH` | No | `.sessions` | Directory for file-based session store |

## Security

- **Server-side token storage** — GitHub token is stored in the Express session, never sent to the browser
- **Security headers** — Helmet sets CSP, HSTS, X-Frame-Options, X-Content-Type-Options
- **Rate limiting** — per-IP request throttling (200 req / 15 min)
- **Secure cookies** — `httpOnly`, `secure` (in production), `sameSite: lax`
- **Origin validation** — WebSocket connections are validated against the configured `BASE_URL` in production
- **Input limits** — Messages capped at 10,000 chars; custom instructions at 2,000 chars (server-enforced)
- **XSS prevention** — All rendered markdown sanitized through DOMPurify
- **System prompt safety** — Custom instructions use `append` mode only, preserving SDK security guardrails
- **Full Copilot CLI parity** — SDK built-in tools (GitHub API, file access, shell) are approved via `approveAll`, matching the desktop CLI

## Project Structure

```
copilot-cli-mobile/
├── src/
│   ├── index.ts              # Entry point — HTTP server + WebSocket setup
│   ├── config.ts             # Env var validation (fail-fast on missing)
│   ├── server.ts             # Express app, middleware stack, routes
│   ├── security-log.ts       # Structured security event logging
│   ├── auth/
│   │   ├── github.ts         # GitHub Device Flow OAuth (fetch-based)
│   │   └── middleware.ts     # requireGitHub session guard
│   ├── copilot/
│   │   ├── client.ts         # CopilotClient factory (one per WS connection)
│   │   └── session.ts        # SessionConfig builder — model, reasoning, MCP, custom instructions
│   ├── routes/
│   │   ├── auth.ts           # /auth/* (device/start, device/poll, logout, status)
│   │   └── api.ts            # /api/* (models, version, client-error) — behind requireGitHub
│   ├── ws/
│   │   └── handler.ts        # WebSocket handler — message routing, SDK event forwarding
│   └── types/
│       └── session.d.ts      # Express session type augmentation
├── public/
│   ├── index.html            # SPA shell (login screen + chat screen + settings panel)
│   ├── css/style.css         # Dark theme, mobile-first, CSS custom properties
│   └── js/
│       ├── app.js            # App init, auth orchestration, settings panel wiring
│       ├── auth.js           # Device flow API client
│       └── chat.js           # WebSocket client, markdown rendering, streaming, localStorage persistence
├── infra/                    # Azure Bicep IaC (Container Apps, ACR, Key Vault)
├── .github/workflows/        # CI (lint + build) + CD (Docker → ACR → Container Apps)
├── Dockerfile                # Multi-stage build (Node 24 + Copilot CLI)
├── docker-compose.yml        # Local development with volume mounts
├── entrypoint.sh             # Container entry — validates Copilot CLI availability
├── package.json
└── tsconfig.json
```

### WebSocket Message Protocol

Messages between client and server use typed JSON. Here's the full protocol:

**Client → Server:**

| Message Type | Purpose |
|------------|---------|
| `new_session` | Create a session with `{ model, reasoningEffort?, customInstructions? }` |
| `message` | Send user prompt `{ content }` (max 10,000 chars) |
| `list_models` | Request available models from Copilot API |
| `set_mode` | Switch mode: `interactive`, `plan`, or `autopilot` |
| `set_model` | Change model mid-session |
| `set_reasoning` | Update reasoning effort for next session |
| `abort` | Cancel the current streaming response |
| `user_input_response` | Reply to an SDK `ask_user` tool prompt |

**Server → Client:**

| Message Type | SDK Event Source | Purpose |
|------------|------------------|---------|
| `connected` | — | Connection established, includes GitHub username |
| `session_created` | — | Session ready, input enabled |
| `delta` | `assistant.message_delta` | Streamed token chunk |
| `reasoning_delta` | `assistant.reasoning_delta` | Extended thinking chunk |
| `reasoning_done` | `assistant.reasoning` | Reasoning block complete |
| `intent` | `assistant.intent` | Model's inferred intent |
| `turn_start` / `turn_end` | `assistant.turn_start/end` | Turn lifecycle |
| `tool_start` | `tool.execution_start` | Tool execution begins (name, MCP server) |
| `tool_progress` | `tool.execution_progress` | Tool status update |
| `tool_end` | `tool.execution_complete` | Tool finished |
| `mode_changed` | `session.mode_changed` | Mode switch confirmed |
| `model_changed` | — | Model switch confirmed |
| `title_changed` | `session.title_changed` | Auto-generated session title |
| `usage` | `assistant.usage` | Token counts (input, output, reasoning) |
| `warning` | `session.warning` | Session warning |
| `error` | `session.error` | Error message |
| `subagent_start/end` | `subagent.started/completed` | Subagent lifecycle |
| `user_input_request` | `onUserInputRequest` callback | SDK asks user for input/choice |
| `models` | `client.listModels()` | Available model list |
| `done` | — | Response complete, input re-enabled |
| `aborted` | — | Response cancelled |

## Deployment

The app is a standard Docker container. Deploy it anywhere that runs containers — a VPS, a home server, or any cloud provider:

```bash
docker build -t copilot-cli-mobile .
docker run -p 3000:3000 \
  -e GITHUB_CLIENT_ID=<id> \
  -e SESSION_SECRET=<secret> \
  -e NODE_ENV=production \
  copilot-cli-mobile
```

Azure deployment infrastructure (Bicep templates for Container Apps) is included in the `infra/` directory for `azd up` if desired.

## License

MIT

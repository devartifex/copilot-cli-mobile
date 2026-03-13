# Architecture

> Copilot Unleashed — SvelteKit 5 full-stack architecture

## High-Level Overview

```
Browser (Svelte 5 SPA)
    │
    ├── SSR ──────────▶ SvelteKit Server (adapter-node)
    │                       │
    ├── WebSocket ──────────┤── JSON-RPC ──▶ @github/copilot CLI subprocess
    │                       │                      │
    │  Device Flow auth     │  Session pool        │  Copilot API
    │  Rune-based stores    │  SDK event wiring    │  GitHub MCP tools
    │  Component rendering  │  Permission hooks    │  File access, shell
    ▼                       ▼                      ▼
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 24 (node:24-slim in Docker) |
| Language | TypeScript 5.7 (strict mode, ES2022) |
| Framework | SvelteKit 5 with `adapter-node` |
| Reactivity | Svelte 5 runes ($state, $derived, $effect, $props) |
| AI Engine | `@github/copilot-sdk` ^0.1.32 |
| Real-time | WebSocket (`ws` ^8.18) via custom `server.js` entry |
| Markdown | `marked` + `dompurify` + `highlight.js` |
| Security | Helmet (CSP, HSTS), rate limiting, DOMPurify |
| Sessions | express-session bridged to SvelteKit via `x-session-id` header |
| Build | Vite → `build/` via adapter-node |
| Container | Multi-stage Dockerfile (builder + runtime) |
| IaC | Bicep (Container Apps, ACR, Managed Identity) |
| CI/CD | GitHub Actions (ci.yml + deploy.yml) |
| Testing | Playwright (desktop + mobile viewports) |

## Project Structure

```
src/
├── app.html                    # SvelteKit shell (meta tags, viewport, theme)
├── app.css                     # Global CSS reset, design tokens, highlight.js theme
├── app.d.ts                    # TypeScript ambient declarations
├── hooks.server.ts             # Server hooks: session bridge, CSP, rate limiting
│
├── lib/
│   ├── components/             # 17 Svelte 5 components
│   │   ├── Banner.svelte           # Welcome banner with Copilot icon
│   │   ├── ChatInput.svelte        # Auto-expanding textarea, file attachments, status bar
│   │   ├── ChatMessage.svelte      # Message renderer (10 roles: user, assistant, tool, etc.)
│   │   ├── CustomToolsEditor.svelte # Webhook tool CRUD editor
│   │   ├── DeviceFlowLogin.svelte  # GitHub Device Flow auth UI
│   │   ├── EnvInfo.svelte          # Environment info (models, tools, context usage)
│   │   ├── MessageList.svelte      # Scrollable message container with smart auto-scroll
│   │   ├── PermissionPrompt.svelte # Tool permission request with countdown
│   │   ├── PlanPanel.svelte        # Collapsible plan viewer/editor
│   │   ├── QuotaDot.svelte         # Color-coded quota indicator
│   │   ├── ReasoningBlock.svelte   # Collapsible "Thinking..." block with shimmer
│   │   ├── SessionsSheet.svelte    # Bottom sheet for session history
│   │   ├── SettingsModal.svelte    # Accordion settings (instructions, tools, agents, quota)
│   │   ├── Sidebar.svelte          # Slide-out menu (mode, model, reasoning, actions)
│   │   ├── ToolCall.svelte         # Animated tool execution with Braille spinner
│   │   └── UserInputPrompt.svelte  # Elicitation UI (choices + freeform)
│   │
│   ├── stores/                 # Svelte 5 rune stores (factory functions)
│   │   ├── auth.svelte.ts          # Auth state, device flow polling, countdown
│   │   ├── chat.svelte.ts          # Messages, streaming, tools, models, plan, quota
│   │   ├── settings.svelte.ts      # Persisted settings (localStorage)
│   │   └── ws.svelte.ts            # WebSocket connection, typed send helpers
│   │
│   ├── server/                 # Server-only code (not bundled to client)
│   │   ├── auth/
│   │   │   ├── github.ts              # Device Flow OAuth (fetch-based)
│   │   │   └── guard.ts               # Auth middleware
│   │   ├── copilot/
│   │   │   ├── client.ts              # CopilotClient factory
│   │   │   └── session.ts             # Session config (model, reasoning, tools, hooks)
│   │   ├── ws/
│   │   │   ├── handler.ts             # WebSocket handler: 22+ message types, SDK events
│   │   │   └── session-pool.ts        # Per-user session pool with TTL + buffer
│   │   ├── config.ts                  # Env var validation (fail-fast)
│   │   ├── security-log.ts            # Structured security event logging
│   │   └── session-store.ts           # Express session ↔ SvelteKit bridge
│   │
│   ├── types/
│   │   └── index.ts            # All types: server messages, client messages, state
│   │
│   └── utils/
│       └── markdown.ts         # renderMarkdown, highlightCodeBlocks, addCopyButtons
│
├── routes/
│   ├── +layout.server.ts       # Root layout: auth check from session
│   ├── +layout.svelte          # Root layout: imports app.css
│   ├── +page.server.ts         # Page data: auth + user
│   ├── +page.svelte            # Main page: login or chat (wires all components + stores)
│   ├── +error.svelte           # Error page
│   ├── auth/
│   │   ├── device/start/+server.ts   # POST: start device flow
│   │   ├── device/poll/+server.ts    # POST: poll device flow
│   │   ├── logout/+server.ts         # POST: destroy session
│   │   └── status/+server.ts         # GET: auth status + user info
│   ├── api/
│   │   ├── models/+server.ts         # GET: list models (authed)
│   │   ├── version/+server.ts        # GET: SDK version
│   │   ├── upload/+server.ts         # POST: file upload (multipart)
│   │   ├── sessions/sync/+server.ts  # GET/POST: session delta sync (Bearer auth)
│   │   └── client-error/+server.ts   # POST: client error reporting
│   └── health/+server.ts             # GET: health check

server.js                       # Custom Node.js entry: HTTP + WebSocket + SvelteKit handler
svelte.config.js                # SvelteKit config (adapter-node)
vite.config.ts                  # Vite config
```

## Data Flow

### Authentication

```
1. Browser loads / → SvelteKit SSR checks session → no token → renders DeviceFlowLogin
2. DeviceFlowLogin calls POST /auth/device/start → gets user_code
3. User enters code at github.com/login/device
4. DeviceFlowLogin polls POST /auth/device/poll → gets access_token
5. Token stored in server-side Express session (never sent to browser)
6. Page reloads → SSR finds token → renders chat screen
```

### Chat Message Flow

```
1. +page.svelte creates wsStore + chatStore + settingsStore
2. wsStore.connect() opens WebSocket to /ws
3. Server validates token, creates/reattaches CopilotClient
4. User types message → wsStore.sendMessage() → WS { type: 'message', content }
5. Server calls session.sendAndWait({ prompt }) with optional attachments
6. SDK streams events → handler.ts maps to typed messages → poolSend to client
7. wsStore dispatches to chatStore.handleServerMessage()
8. chatStore updates reactive state → Svelte re-renders components
```

### Session Pool

Each authenticated user gets one `PoolEntry` in the session pool:

```typescript
interface PoolEntry {
  client: CopilotClient;          // SDK client (owns CLI subprocess)
  session: CopilotSession | null; // Active session (one at a time)
  ws: WebSocket | null;           // Current browser connection
  messageBuffer: [];              // Buffered messages during disconnection
  ttlTimer: Timeout | null;       // Cleanup timer when disconnected
  permissionResolve: Function | null;  // Pending permission response
  permissionPreferences: Map;     // Remembered tool permissions
  userInputResolve: Function | null;   // Pending user input response
  isProcessing: boolean;          // Currently processing a message
}
```

On disconnect, a TTL timer starts. On reconnect, buffered messages are replayed.

### Session State & CLI Interop

Sessions are persisted by the SDK to `~/.copilot/session-state/{sessionId}/` (configurable via `COPILOT_CONFIG_DIR`):

```
session-state/{UUID}/
├── workspace.yaml       # Metadata: id, cwd, git context, summary, timestamps
├── checkpoints/
│   ├── index.md         # Checkpoint history table
│   └── 001-{title}.md   # Numbered checkpoint files
├── plan.md              # Execution plan (optional)
├── files/               # Workspace artifacts
└── events.jsonl         # Full conversation event log
```

Both the **Copilot CLI** and **Copilot Unleashed** share this directory. Sessions created in either interface can be resumed in the other — the SDK's `resumeSession()` automatically restores checkpoints and plan context. The session listing is enriched with filesystem metadata (checkpoint count, plan status, git context) for the UI.

**Bidirectional plan sync**: On resume, the filesystem `plan.md` is injected as a `systemMessage` (append mode) so the agent has full plan context. When the agent modifies the plan during a session, the `session.plan_changed` event triggers a read via `session.rpc.plan.read()` and the content is written back to `plan.md` on disk — enabling the CLI to pick up changes made in the browser.

## Component Architecture

### Store Pattern

All stores use Svelte 5 runes with the factory function pattern:

```typescript
export function createChatStore(wsStore: WsStore): ChatStore {
  let messages = $state<ChatMessage[]>([]);
  let isStreaming = $state(false);
  const canSend = $derived(isConnected && !isStreaming && wsStore.sessionReady);

  function handleServerMessage(msg: ServerMessage): void { /* switch on msg.type */ }

  return {
    get messages() { return messages; },
    get canSend() { return canSend; },
    handleServerMessage,
  };
}
```

### Message Type System

Discriminated unions on `type` field for all messages:

- **ServerMessage** (34 types): `connected`, `delta`, `tool_start`, `permission_request`, etc.
- **ClientMessage** (19 types): `new_session`, `message`, `set_mode`, `permission_response`, etc.
- **ChatMessage** (10 roles): `user`, `assistant`, `tool`, `info`, `warning`, `error`, `intent`, `usage`, `skill`, `subagent`

## Security

| Layer | Measure |
|-------|---------|
| CSP | self + unsafe-inline (Svelte), ws/wss, GitHub avatars |
| Rate limiting | 200 req / 15 min / IP (Map-based in hooks.server.ts) |
| Session | httpOnly, secure (prod), sameSite: lax, server-side only |
| Token | Freshness check + GitHub API validation on WS connect |
| WebSocket | Origin validation in production |
| Input | 10K char messages, 2K char instructions, message type whitelist |
| XSS | DOMPurify on all rendered markdown |
| Upload | 10MB/5 files limit, extension allowlist, path traversal prevention |
| SSRF | Internal IP range blocklist for custom webhook tools |
| Permissions | Per-tool allow/deny/always_allow with 30s timeout |

## Environment Variables

| Variable | Required | Default | Purpose |
|----------|:--------:|---------|---------|
| `GITHUB_CLIENT_ID` | Yes | — | GitHub OAuth App client ID |
| `SESSION_SECRET` | Yes | — | Session cookie encryption |
| `PORT` | — | `3000` | HTTP server port |
| `BASE_URL` | — | `http://localhost:3000` | Cookie domain + WS origin |
| `NODE_ENV` | — | `development` | Dev vs prod behavior |
| `ALLOWED_GITHUB_USERS` | — | — | Comma-separated login allowlist |
| `TOKEN_MAX_AGE_MS` | — | `86400000` | Force re-auth interval (24h) |

## Deployment

- **Docker**: `npm run build` → `node build/index.js` (adapter-node output)
- **Azure**: `azd up` → Container Apps + ACR + Managed Identity + monitoring
- **CI/CD**: GitHub Actions — ci.yml (check + build), deploy.yml (Docker → ACR → ACA)

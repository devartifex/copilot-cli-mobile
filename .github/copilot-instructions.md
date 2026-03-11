# Copilot Unleashed — Project Instructions

## Project Overview

Self-hosted multi-model AI chat platform powered by the official `@github/copilot-sdk`. A modern alternative to ChatGPT, Claude, and Gemini — with access to all Copilot models (GPT-4.1, o-series, Claude, Gemini) through a single interface. Users authenticate with GitHub Device Flow, pick a model, and chat over WebSocket with real-time token streaming.

> See [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) for full architecture details, data flow diagrams, and component inventory.

## Architecture

- **Full-stack**: SvelteKit 5 with `adapter-node` (replaces Express + vanilla JS)
- **Frontend**: 17 Svelte 5 components with rune-based stores — dark theme, mobile-first
- **Real-time**: WebSocket via custom `server.js` entry, per-user `CopilotClient` lifecycle
- **Auth**: GitHub Device Flow only (no client secret, no redirect URI)
- **Session**: Express sessions bridged to SvelteKit via `x-session-id` header in `hooks.server.ts`
- **Deployment**: Docker container → Azure Container Apps via `azd up` or GitHub Actions

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 24 (node:24-slim in Docker) |
| Language | TypeScript 5.7 (strict mode, ES2022) |
| Framework | SvelteKit 5 with `adapter-node` |
| Reactivity | Svelte 5 runes ($state, $derived, $effect, $props) |
| AI Engine | `@github/copilot-sdk` ^0.1.32 |
| WebSocket | `ws` ^8.18 via custom server.js |
| Markdown | `marked` + `dompurify` + `highlight.js` (npm, bundled by Vite) |
| Security | Helmet-like CSP in hooks.server.ts, rate limiting, DOMPurify |
| Sessions | express-session bridged to SvelteKit locals |
| Build | `vite build` → `build/` via adapter-node |
| Testing | Playwright (desktop + mobile viewports) |
| Container | Multi-stage Dockerfile (builder + runtime) |
| IaC | Bicep (Container Apps, ACR, Managed Identity) |

## Project Structure

```
server.js                       # Custom entry: HTTP + express-session + WebSocket + SvelteKit handler
svelte.config.js                # SvelteKit config (adapter-node)
vite.config.ts                  # Vite config

src/
├── app.html                    # SvelteKit shell (viewport, theme-color, PWA meta)
├── app.css                     # Global reset, design tokens, highlight.js theme
├── hooks.server.ts             # Session bridge, CSP headers, rate limiting
│
├── lib/
│   ├── components/             # 17 Svelte 5 components (see ARCHITECTURE.md)
│   ├── stores/                 # Rune stores: auth, chat, settings, ws
│   ├── server/                 # Server-only: auth, copilot, ws handler, config
│   ├── types/index.ts          # All types: 34 server + 19 client message types
│   └── utils/markdown.ts       # Shared markdown pipeline
│
├── routes/
│   ├── +page.svelte            # Main page: login or full chat screen
│   ├── +layout.server.ts       # Root: auth check from session
│   ├── auth/device/…           # Device Flow endpoints
│   ├── api/…                   # Models, upload, version, client-error
│   └── health/+server.ts       # Health check
```

## Conventions

### Code Style
- **TypeScript**: camelCase for functions/variables, PascalCase for types
- **Files**: kebab-case (e.g., `session-pool.ts`, `auth.svelte.ts`)
- **CSS**: Component-scoped `<style>` blocks, CSS custom properties for theming
- **Framework**: Svelte 5 with runes — do not introduce React, Vue, or other frameworks
- **ES Modules**: `"type": "module"` in package.json; use `.js` extensions in imports

### Svelte Patterns
- **Runes**: `$state()` for local state, `$derived()` for computed, `$effect()` for side effects only
- **Props**: `$props()` with TypeScript interface annotations
- **Stores**: Factory functions returning getter-based interfaces (not classes)
- **Components**: Small, focused, single responsibility, component-scoped CSS
- **Lists**: Keyed `{#each}` blocks, `{#snippet}` for reusable template logic

### Backend Patterns
- **Factory functions** over classes (e.g., `createCopilotClient()`, `createChatStore()`)
- **Named exports** only (no default exports)
- **Fail-fast validation** in `config.ts` — throw on missing required env vars
- **Try-catch** in route handlers and WebSocket — return JSON errors to client
- **Message type whitelist** — WebSocket handler validates against `VALID_MESSAGE_TYPES` Set
- **Session disconnect** — use `session.disconnect()` (not deprecated `destroy()`)

### Security
- CSP in hooks.server.ts: self + unsafe-inline (Svelte) + ws/wss + GitHub avatars
- Rate limiting: 200 requests per 15 minutes per IP (Map-based)
- Session cookies: httpOnly, secure (prod), sameSite: lax
- XSS prevention: DOMPurify sanitizes all rendered markdown
- Max message length: 10,000 chars (server-enforced)
- Upload limits: 10MB per file, 5 files max, extension allowlist
- SSRF prevention: internal IP range blocklist for custom webhook tools
- Token revalidation on WebSocket connect (catches revoked tokens)

### Environment Variables
| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `GITHUB_CLIENT_ID` | Yes | — | GitHub OAuth App client ID |
| `SESSION_SECRET` | Yes | — | Session cookie encryption |
| `PORT` | No | 3000 | HTTP server port |
| `BASE_URL` | No | http://localhost:3000 | Cookie domain + WS origin validation |
| `NODE_ENV` | No | development | Dev vs prod behavior |
| `ALLOWED_GITHUB_USERS` | No | — | Comma-separated GitHub usernames |
| `TOKEN_MAX_AGE_MS` | No | 86400000 | Force re-auth interval (24h) |

## Build & Run

```bash
# Docker (recommended)
docker compose up --build

# Local (requires Node 24+)
npm install && npm run build && npm start

# Development
npm run dev                      # Vite dev server

# Type check
npm run check                    # svelte-check

# Tests
npx playwright test              # E2E tests (desktop + mobile)
```

## Important Notes

- The Copilot SDK spawns a CLI subprocess per connection — each `CopilotClient` must be `.stop()`'d on disconnect
- `server.js` is the custom entry: registers express-session, sets `x-session-id` header, upgrades WebSocket, then delegates to SvelteKit handler
- WebSocket connections validate the GitHub token against GitHub's API on connect
- Model defaults to `gpt-4.1` if not specified
- Permission hooks: `approveAll` in autopilot mode, interactive prompts in other modes
- Custom tools use webhook HTTP calls with SSRF protection
- The SDK's `@github/copilot` CLI needs `node:sqlite` which ships with Node 24

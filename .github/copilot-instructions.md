# Copilot Unleashed — Project Instructions

## Project Overview

Self-hosted multi-model AI chat platform powered by the official `@github/copilot-sdk`. A modern alternative to ChatGPT, Claude, and Gemini — with access to all Copilot models (GPT-4.1, o-series, Claude, Gemini) through a single interface. Users authenticate with GitHub Device Flow, pick a model, and chat over WebSocket with real-time token streaming.

> See [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) for full architecture details, data flow diagrams, and component inventory.

## Architecture

- **Full-stack**: SvelteKit 5 with `adapter-node` (replaces Express + vanilla JS)
- **Frontend**: 20 Svelte 5 components with 4 rune-based stores — dark theme, mobile-first
- **Real-time**: WebSocket via custom `server.js` entry, per-user `CopilotClient` lifecycle
- **Auth**: GitHub Device Flow only (no client secret, no redirect URI)
- **Session**: Express sessions bridged to SvelteKit via `x-session-id` header in `hooks.server.ts`
- **Skills**: `skills/` directory with `SKILL.md` definitions, discovered server-side and passed to the SDK via `skillDirectories`
- **Settings**: Persisted server-side via `/api/settings` and mirrored in `localStorage`
- **Deployment**: Docker container → Azure Container Apps via `azd up`

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
| Build | `npm run build` (`tsc -p tsconfig.node.json` + `vite build`) → `build/` via adapter-node |
| Testing | Vitest (colocated `*.test.ts`) + Playwright (Desktop Chrome, Pixel 7, iPhone 14) |
| Container | Multi-stage Dockerfile (builder + runtime) |
| IaC | Bicep (Azure Container Apps) |

## Project Structure

```
server.js                       # Custom entry: HTTP + express-session + WebSocket + SvelteKit handler
skills/                         # SDK skill definitions (currently 1 skill)
└── git-commit/SKILL.md         # Built-in git commit workflow skill
tests/                          # Playwright E2E suites and helpers
svelte.config.js                # SvelteKit config (adapter-node)
vite.config.ts                  # Vite config
vitest.config.ts                # Vitest config for colocated unit tests

src/
├── app.html                    # SvelteKit shell (viewport, theme-color, PWA meta)
├── app.css                     # Global reset, design tokens, highlight.js theme
├── hooks.server.ts             # Session bridge, CSP headers, rate limiting
├── hooks.server.test.ts        # Example colocated unit test pattern
│
├── lib/
│   ├── components/             # 20 Svelte 5 components (see ARCHITECTURE.md)
│   ├── stores/                 # 4 rune stores: auth, chat, settings, ws
│   ├── server/                 # 22 server files: auth, copilot, settings, skills, ws, security
│   ├── types/index.ts          # All message types: 60 server + 18 client = 78 total
│   └── utils/markdown.ts       # Shared markdown pipeline
│
├── routes/
│   ├── +page.svelte            # Main page: login or full chat screen (1 page route)
│   ├── +layout.svelte          # App shell layout
│   ├── +layout.server.ts       # Root auth/session bootstrap
│   ├── +error.svelte           # Route error boundary
│   ├── auth/
│   │   ├── device/start/+server.ts
│   │   ├── device/poll/+server.ts
│   │   ├── logout/+server.ts
│   │   └── status/+server.ts
│   ├── api/
│   │   ├── client-error/+server.ts
│   │   ├── models/+server.ts
│   │   ├── settings/+server.ts
│   │   ├── skills/+server.ts
│   │   ├── upload/+server.ts
│   │   ├── version/+server.ts
│   │   └── sessions/sync/+server.ts
│   └── health/+server.ts       # 12 +server.ts endpoint routes total
│
└── **/*.test.ts                # Vitest unit tests live next to source files
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
npm run dev                      # Docker Compose development stack
npm run dev:local                # Local Vite dev server after building server-side TypeScript

# Type check
npm run check                    # svelte-check

# Unit tests (Vitest, colocated as *.test.ts)
npm run test:unit
npm run test:unit:coverage

# E2E tests (Playwright: Desktop Chrome, Pixel 7, iPhone 14)
npx playwright test
```

## Important Notes

- The Copilot SDK spawns a CLI subprocess per connection — each `CopilotClient` must be `.stop()`'d on disconnect
- `server.js` is the custom entry: registers express-session, sets `x-session-id` header, upgrades WebSocket, then delegates to SvelteKit handler
- WebSocket connections validate the GitHub token against GitHub's API on connect
- Model defaults to `gpt-4.1` if not specified
- Permission hooks: `approveAll` in autopilot mode, interactive prompts in other modes
- Settings sync through `/api/settings`: authenticated users get a server-side source of truth, while the client mirrors sanitized data in `localStorage`
- Skills are discovered from `skills/*/SKILL.md`, exposed via `/api/skills`, and passed into SDK sessions through `skillDirectories`
- Custom tools use webhook HTTP calls with SSRF protection
- The SDK's `@github/copilot` CLI needs `node:sqlite` which ships with Node 24
- Unit tests live next to source as `*.test.ts`; Playwright E2E suites live in `tests/`

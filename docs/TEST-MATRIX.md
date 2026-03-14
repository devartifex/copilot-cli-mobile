# Test Coverage Matrix

> **Living document** — update whenever a feature is added, changed, or removed.
> Last updated: 2026-03-13

## Coverage Summary

| Layer | Framework | Command | Status |
|-------|-----------|---------|--------|
| Unit | Vitest | `npm run test:unit` | ✅ Active (223 tests) |
| Integration | Vitest | `npm run test:unit` | ✅ Active |
| Component | Vitest + @testing-library/svelte | `npm run test:unit` | 🔜 Planned |
| E2E | Playwright | `npx playwright test` | ✅ Active (100 tests) |

## Feature Coverage

| Feature Area | Files Involved | Unit | Integration | Component | E2E | Status | Notes |
|---|---|---|---|---|---|---|---|
| Authentication & access control | guard.ts, session-utils.ts, device-flow routes | ✅ | ✅ | ❌ | ✅ | **Good** | auth-flow.spec.ts covers full device flow + logout |
| Chat application shell | TopBar, Sidebar, Banner, stores | ❌ | ❌ | ❌ | ✅ | Partial | chat-messaging.spec.ts + responsive-chat.spec.ts |
| Real-time messaging & streaming | ws/handler.ts, chat.svelte.ts, markdown.ts | ✅ | ❌ | ❌ | ✅ | **Good** | chat-messaging.spec.ts covers deltas, streaming, stop; chat.test.ts covers all 49 SDK event types |
| Model selection & mode switching | ModelSheet, chat store | ❌ | ❌ | ❌ | ✅ | Partial | model-selection.spec.ts covers sheet, switch, reasoning |
| Plan mode & persistence | PlanPanel, plan handlers | ✅ | ❌ | ❌ | ✅ | **Good** | plan-mode.spec.ts covers CRUD, collapse, two-step delete |
| Session management | session-metadata.ts, session-pool.ts, SessionsSheet | ✅ | ❌ | ❌ | ✅ | **Good** | session-management.spec.ts covers list/search/resume/delete |
| Tools, MCP, permissions, agents | copilot/session.ts, PermissionPrompt, SettingsModal | ✅ | ❌ | ❌ | ✅ | **Good** | settings.spec.ts covers tools/agents, chat covers tool calls |
| Skills (SKILL.md modules) | skills/scanner.ts, session.ts, SettingsModal, TopBar | ✅ | ❌ | ❌ | ❌ | Partial | scanner.test.ts covers discovery/parsing/caching; session.test.ts covers SDK wiring |
| File attachments | upload route, ChatInput | ❌ | ✅ | ❌ | ❌ | Partial | Integration tests only |
| Quota & usage telemetry | quota display, usage events | ❌ | ❌ | ❌ | ✅ | Partial | chat-messaging.spec.ts covers usage display |
| Operational safety | hooks.server.ts, health, config | ✅ | ✅ | N/A | ✅ | **Good** | error-handling.spec.ts covers errors, health, 404 |

## Test Files Index

### Unit Tests (`src/**/*.test.ts`)
| Test File | Source File | Cases | Coverage |
|---|---|---|---|
| `src/lib/server/config.test.ts` | `src/lib/server/config.ts` | Env validation, defaults, allowlist | ✅ |
| `src/lib/server/auth/guard.test.ts` | `src/lib/server/auth/guard.ts` | checkAuth, token expiry, sessions | ✅ |
| `src/lib/server/auth/session-utils.test.ts` | `src/lib/server/auth/session-utils.ts` | Save/clear helpers | ✅ |
| `src/lib/server/settings-store.test.ts` | `src/lib/server/settings-store.ts` | JSON persistence, size cap | ✅ |
| `src/lib/server/copilot/session-metadata.test.ts` | `src/lib/server/copilot/session-metadata.ts` | Listing, parsing, counting | ✅ |
| `src/lib/server/copilot/session.test.ts` | `src/lib/server/copilot/session.ts` | SSRF protection, session lifecycle, skills wiring | ✅ |
| `src/lib/server/skills/scanner.test.ts` | `src/lib/server/skills/scanner.ts` | Skill discovery, frontmatter parsing, caching | ✅ |
| `src/lib/server/ws/session-pool.test.ts` | `src/lib/server/ws/session-pool.ts` | Lifecycle, TTL, eviction | ✅ |
| `src/lib/utils/markdown.test.ts` | `src/lib/utils/markdown.ts` | Rendering, XSS, highlighting | ✅ |
| `src/lib/utils/notifications.test.ts` | `src/lib/utils/notifications.ts` | Browser notification helpers | ✅ |
| `src/lib/utils/smoke.test.ts` | `src/lib/utils/smoke.ts` | Smoke test utilities | ✅ |
| `src/lib/stores/auth.test.ts` | `src/lib/stores/auth.svelte.ts` | Device flow state machine, logout | ✅ |
| `src/lib/stores/chat.test.ts` | `src/lib/stores/chat.svelte.ts` | Message reducer, plan handling | ✅ |
| `src/lib/stores/settings.test.ts` | `src/lib/stores/settings.svelte.ts` | Settings defaults, sync | ✅ |
| `src/hooks.server.test.ts` | `src/hooks.server.ts` | CSP headers, rate limiting | ✅ |

### Integration Tests (`src/routes/**/*.test.ts`)
| Test File | Source File | Cases | Coverage |
|---|---|---|---|
| `src/routes/health/server.test.ts` | `src/routes/health/+server.ts` | Health endpoint | ✅ |
| `src/routes/api/version/server.test.ts` | `src/routes/api/version/+server.ts` | Version endpoint | ✅ |
| `src/routes/api/models/server.test.ts` | `src/routes/api/models/+server.ts` | Models endpoint, auth guard | ✅ |
| `src/routes/api/upload/server.test.ts` | `src/routes/api/upload/+server.ts` | Upload limits, extensions, path traversal | ✅ |
| `src/routes/api/settings/server.test.ts` | `src/routes/api/settings/+server.ts` | Settings CRUD | ✅ |
| `src/routes/api/sessions/sync/server.test.ts` | `src/routes/api/sessions/sync/+server.ts` | Session sync, bearer auth | ✅ |
| `src/routes/api/client-error/server.test.ts` | `src/routes/api/client-error/+server.ts` | Error reporting | ✅ |
| `src/routes/auth/device/start/server.test.ts` | `src/routes/auth/device/start/+server.ts` | Device flow start | ✅ |
| `src/routes/auth/device/poll/server.test.ts` | `src/routes/auth/device/poll/+server.ts` | Device flow polling | ✅ |

### E2E Tests (`tests/*.spec.ts`)
| Test File | Tests | Coverage |
|---|---|---|
| `tests/auth-flow.spec.ts` | 7 | Device flow journey, error/expired/denied states, logout |
| `tests/chat-messaging.spec.ts` | 10 | Send/receive, streaming, tool calls, reasoning, usage, stop |
| `tests/model-selection.spec.ts` | 8 | Model sheet, switch, reasoning effort, mode switching |
| `tests/session-management.spec.ts` | 8 | Sessions list, search, detail, resume, delete, empty state |
| `tests/settings.spec.ts` | 10 | Settings modal, accordions, custom instructions, tools, agents |
| `tests/plan-mode.spec.ts` | 10 | Plan display, markdown, collapse, edit, delete, server updates |
| `tests/error-handling.spec.ts` | 10 | Server errors, warnings, 404, health, auth status, JS errors |
| `tests/responsive-chat.spec.ts` | 10 | Auth chat at mobile/tablet/desktop, sidebar, overflow |
| `tests/chat.spec.ts` | 8 | Unauthenticated smoke tests, API endpoints |
| `tests/login.spec.ts` | 10 | Device flow UI, copy button, error state, hero section |
| `tests/messages.spec.ts` | 5 | Structural checks, error page, login layout |
| `tests/responsive.spec.ts` | 5 | Login screen at multiple viewports |
| `tests/screenshots.spec.ts` | 9 | Visual regression (CI-skipped) |
| **Total** | **~110** | **All 10 feature areas covered** |

### Shared Test Infrastructure
| File | Purpose |
|---|---|
| `tests/helpers.ts` | Authenticated page mocks, WebSocket helpers, test data |
| `vitest.config.ts` | Vitest config with V8 coverage, SvelteKit aliases |
| `playwright.config.ts` | Playwright config: desktop, mobile, iPhone projects |

## How to Update This Document

When adding or modifying a feature:
1. Add/update the row in **Feature Coverage**
2. Add/update the entry in **Test Files Index**
3. Update the status emoji: ✅ covered, ❌ not covered, 🔜 planned

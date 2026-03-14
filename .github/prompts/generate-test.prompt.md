---
description: 'Generate tests for a component or module'
---

Generate comprehensive tests for the specified target:

## Detection Rules
- **Svelte component** (`src/lib/components/*.svelte`) → Generate Playwright E2E test in `tests/`
- **Server module** (`src/lib/server/**/*.ts`) → Generate Vitest unit test as sibling `*.test.ts`
- **Store** (`src/lib/stores/*.svelte.ts`) → Generate Vitest unit test as sibling `*.test.ts`
- **API route** (`src/routes/**/*.ts`) → Generate Vitest unit test as sibling `server.test.ts`

## Test Standards
- Use role-based locators (`getByRole`, `getByLabel`, `getByText`) for Playwright
- Use `test.describe()` blocks with descriptive names
- Test happy path, error cases, and edge cases
- For Playwright: test across desktop and mobile viewports
- For Vitest: mock at system boundaries, use `vi.fn()` for dependencies
- Follow patterns in existing test files (check `tests/helpers.ts` for E2E helpers)

## Project Context
- Framework: SvelteKit 5 with Svelte 5 runes
- Unit tests: Vitest with jsdom (stores/utils) or node (server) environment
- E2E tests: Playwright with 3 projects (desktop, mobile/Pixel 7, iphone/iPhone 14)
- Auth helper: `createAuthenticatedPage()` from `tests/helpers.ts`
- WS mock: `mockWebSocket()` from `tests/helpers.ts`

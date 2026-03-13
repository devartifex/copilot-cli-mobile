# Contributing to Copilot Unleashed

Thank you for your interest in contributing! This project is a self-hosted, multi-model AI chat platform powered by the GitHub Copilot SDK.

## Getting Started

1. Fork the repo and clone it
2. Install dependencies: `npm install`
3. Create a `.env` file (see README for required variables)
4. Run in development mode: `npm run dev:local`

## Development

| Command | Purpose |
|---------|---------|
| `npm run dev:local` | Start Vite dev server |
| `npm run dev` | Start via Docker Compose |
| `npm run build` | Production build |
| `npm run check` | Type check with svelte-check |
| `npm run test:unit` | Run unit and integration tests with Vitest |
| `npm run test:unit:coverage` | Run Vitest with coverage reporting |
| `npm run test:unit:watch` | Run Vitest in watch mode |
| `npx playwright test` | Run E2E tests |

### Requirements

- **Node.js 24+** (required for `node:sqlite` used by the Copilot SDK)
- **GitHub OAuth App** — [register one](https://github.com/settings/developers) (Device Flow, no client secret needed)
- **Copilot license** — free tier works

## Testing

Use the following commands when validating changes locally:

- Run unit and integration tests: `npm run test:unit`
- Run unit tests with coverage: `npm run test:unit:coverage`
- Run E2E tests: `npx playwright test`
- Run Vitest in watch mode during development: `npm run test:unit:watch`

### Test Organization

- Keep test files next to the source they cover using the `*.test.ts` naming pattern
- Update or add tests for all new code and any behavior you modify
- Update `docs/TEST-MATRIX.md` whenever a feature area is added, changed, or removed

### Best Practices

- Write test names that describe the behavior being verified
- Mock at system boundaries instead of mocking internal implementation details
- Cover error paths and failure states, not just the happy path

## Code Style

- **TypeScript** — strict mode, no `any`
- **Svelte 5** — runes only (`$state`, `$derived`, `$effect`, `$props`)
- **Factory functions** over classes
- **Named exports** only
- **kebab-case** filenames
- **Component-scoped CSS** with custom properties for theming

## Pull Requests

1. Create a feature branch from `main`
2. Make your changes with clear, focused commits
3. Ensure `npm run check` and `npm run build` pass
4. Open a PR with a clear description of what and why

## Reporting Issues

- Use the issue templates when available
- Include steps to reproduce for bugs
- Include browser/OS info for UI issues

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

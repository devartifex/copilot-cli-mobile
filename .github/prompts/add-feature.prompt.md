---
description: 'Add a new feature following project conventions'
---

Implement the requested feature following these project conventions:

## Architecture
- **Backend**: Factory functions in `src/lib/server/`, named exports only
- **Frontend**: Svelte 5 components with runes ($state, $derived, $effect, $props)
- **Real-time**: WebSocket messages defined in `src/lib/types/index.ts`
- **State**: Rune-based stores in `src/lib/stores/`

## Implementation Checklist
1. Define types in `src/lib/types/index.ts` (discriminated unions for messages)
2. Implement server logic in `src/lib/server/`
3. Wire WebSocket messages in `src/lib/server/ws/handler.ts`
4. Update store handlers in `src/lib/stores/chat.svelte.ts`
5. Create/update Svelte components in `src/lib/components/`
6. Add unit tests (Vitest, sibling `*.test.ts`)
7. Add E2E tests (Playwright, in `tests/`)
8. Run `npm run check` and `npm run build`
9. Update `docs/TEST-MATRIX.md`

## Code Standards
- TypeScript strict mode, no `any`
- kebab-case filenames, camelCase variables, PascalCase types
- Component-scoped CSS with CSS custom properties
- Fail-fast validation, try-catch in handlers
- DOMPurify for any rendered HTML

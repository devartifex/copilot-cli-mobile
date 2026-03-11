---
description: 'TypeScript 5.x / ES2022 development standards'
applyTo: '**/*.ts'
---

# TypeScript Development

## Core
- TypeScript 5.x / ES2022, pure ES modules
- Avoid `any`; prefer `unknown` plus narrowing
- Discriminated unions for events and state machines
- PascalCase for types, camelCase for everything else
- kebab-case filenames
- Factory functions over classes
- Named exports only

## Patterns
- async/await with try/catch structured errors
- Guard edge cases early (fail-fast)
- Immutable data and pure functions when practical
- Lazy-load heavy deps, dispose when done
- Batch/debounce high-frequency events

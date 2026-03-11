---
description: 'Svelte 5 and SvelteKit development standards and best practices'
applyTo: '**/*.svelte, **/*.ts, **/*.js, **/*.css'
---

# Svelte 5 and SvelteKit Development Instructions

## Core Concepts
- Use Svelte 5 runes system ($state, $derived, $effect, $props, $bindable)
- SvelteKit for full-stack with file-based routing
- TypeScript with strict mode
- Component-scoped styling with CSS custom properties

## Reactivity and State
- Use `$state()` for reactive local state
- Use `$derived()` for computed values (prefer over $effect for derived state)
- Use `$derived.by()` for complex computations
- Use `$effect()` sparingly — only for side effects (analytics, logging, DOM manipulation)
- Define props with `$props()` and TypeScript annotations
- Use `$bindable()` for two-way binding
- Use context API for sharing reactive state down trees
- Avoid global $state modules for SSR — use context

## SvelteKit Patterns
- `+page.svelte` for page components
- `+page.server.ts` for server-side data loading
- `+server.ts` for API endpoints
- `+layout.svelte` for shared layouts
- Form actions for mutations, `use:enhance` for progressive enhancement
- `hooks.server.ts` for middleware

## Component Design
- `<script lang="ts">` with runes syntax
- Small, focused components (single responsibility)
- `{#snippet}` for reusable template logic
- `children` snippet for parent-child composition
- Keyed `{#each}` blocks for lists

## Styling
- Component-scoped `<style>` blocks
- CSS custom properties for theming
- `class:` directive for conditional styling
- `:global()` sparingly
- Mobile-first responsive design

## TypeScript
- Strict mode, no `any`
- Discriminated unions for events/state machines
- PascalCase for types, camelCase for functions/variables
- kebab-case filenames
- Named exports only

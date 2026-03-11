<script lang="ts">
  import type { ToolCallState } from '$lib/types/index.js';

  interface Props {
    tool: ToolCallState;
  }

  const BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

  const { tool }: Props = $props();

  let spinnerIndex = $state(0);
  let expanded = $state(false);

  const isActive = $derived(tool.status === 'running' || tool.status === 'progress');
  const hasProgress = $derived((tool.progressMessages?.length ?? 0) > 0);

  const icon = $derived.by(() => {
    if (tool.status === 'complete') return '✓';
    if (tool.status === 'failed') return '✕';
    return BRAILLE_FRAMES[spinnerIndex];
  });

  const displayName = $derived(
    tool.mcpServerName && tool.mcpToolName
      ? `${tool.mcpServerName}/${tool.mcpToolName}`
      : tool.name,
  );

  const statusText = $derived.by(() => {
    if (tool.status === 'progress' && tool.message) return tool.message;
    if (tool.status === 'complete') return 'done';
    if (tool.status === 'failed') return 'failed';
    return '';
  });

  function toggle() {
    if (hasProgress) expanded = !expanded;
  }

  $effect(() => {
    if (!isActive) return;

    const interval = setInterval(() => {
      spinnerIndex = (spinnerIndex + 1) % BRAILLE_FRAMES.length;
    }, 80);

    return () => clearInterval(interval);
  });
</script>

<div class="tool-call-wrapper" class:expanded>
  {#if hasProgress}
    <button
      class="tool-call"
      class:completed={tool.status === 'complete'}
      class:failed={tool.status === 'failed'}
      class:expandable={true}
      type="button"
      aria-expanded={expanded}
      onclick={toggle}
    >
      <span class="tool-chevron">▼</span>
      <span class="tool-icon">{icon}</span>
      <span class="tool-name">{displayName}</span>
      {#if statusText}
        <span class="tool-status">{statusText}</span>
      {/if}
    </button>
    <div class="tool-progress-list">
      {#each tool.progressMessages ?? [] as msg}
        <div class="tool-progress-item">{msg}</div>
      {/each}
    </div>
  {:else}
    <div
      class="tool-call"
      class:completed={tool.status === 'complete'}
      class:failed={tool.status === 'failed'}
    >
      <span class="tool-icon">{icon}</span>
      <span class="tool-name">{displayName}</span>
      {#if statusText}
        <span class="tool-status">{statusText}</span>
      {/if}
    </div>
  {/if}
</div>

<style>
  .tool-call-wrapper {
    animation: fade-in 0.25s ease;
  }

  .tool-call {
    color: var(--fg-muted);
    font-size: 0.82em;
    padding: 2px 0 2px var(--sp-3);
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    min-height: 24px;
    background: none;
    border: none;
    font-family: inherit;
    font-size: inherit;
    width: 100%;
    text-align: left;
  }

  .tool-call.expandable {
    cursor: pointer;
    user-select: none;
  }

  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .tool-chevron {
    color: var(--fg-dim);
    font-size: 0.65em;
    transition: transform 0.2s ease;
    display: inline-block;
    flex-shrink: 0;
  }

  .tool-call-wrapper:not(.expanded) .tool-chevron {
    transform: rotate(-90deg);
  }

  .tool-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .tool-status {
    color: var(--fg-dim);
    flex-shrink: 0;
    font-size: 0.9em;
  }

  .tool-icon {
    color: var(--yellow);
    flex-shrink: 0;
    width: 1em;
    text-align: center;
  }

  .tool-call.completed .tool-icon {
    color: var(--green);
  }

  .tool-call.completed .tool-name {
    color: var(--fg-dim);
  }

  .tool-call.failed .tool-icon {
    color: var(--red);
  }

  .tool-call.failed .tool-name {
    color: var(--fg-dim);
  }

  .tool-progress-list {
    max-height: 0;
    overflow: hidden;
    opacity: 0;
    padding-left: calc(var(--sp-3) + 1.4em);
    transition: max-height 0.3s ease, opacity 0.3s ease, padding 0.3s ease;
  }

  .expanded .tool-progress-list {
    max-height: 300px;
    overflow-y: auto;
    opacity: 1;
    padding-top: var(--sp-1);
    padding-bottom: var(--sp-1);
  }

  .tool-progress-item {
    color: var(--fg-dim);
    font-size: 0.78em;
    line-height: 1.5;
    padding: 1px 0;
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>

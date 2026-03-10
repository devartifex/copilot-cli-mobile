<script lang="ts">
  import type { ToolCallState } from '$lib/types/index.js';

  interface Props {
    tool: ToolCallState;
  }

  const BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

  const { tool }: Props = $props();

  let spinnerIndex = $state(0);

  const isActive = $derived(tool.status === 'running' || tool.status === 'progress');

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

  $effect(() => {
    if (!isActive) return;

    const interval = setInterval(() => {
      spinnerIndex = (spinnerIndex + 1) % BRAILLE_FRAMES.length;
    }, 80);

    return () => clearInterval(interval);
  });
</script>

<div class="tool-call" class:completed={tool.status === 'complete'} class:failed={tool.status === 'failed'}>
  <span class="tool-icon">{icon}</span>
  <span class="tool-name">{displayName}</span>
  {#if statusText}
    <span class="tool-status">{statusText}</span>
  {/if}
</div>

<style>
  .tool-call {
    color: var(--fg-muted);
    font-size: 0.82em;
    padding: 2px 0 2px var(--sp-3);
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    min-height: 24px;
    animation: fade-in 0.25s ease;
  }

  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
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
</style>

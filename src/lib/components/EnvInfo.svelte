<script lang="ts">
  import type { ContextInfo } from '$lib/types/index.js';

  interface Props {
    modelCount: number;
    toolCount: number;
    mcpServerCount: number;
    currentAgent: string | null;
    sessionTitle: string | null;
    contextInfo: ContextInfo | null;
  }

  const { modelCount, toolCount, mcpServerCount, currentAgent, sessionTitle, contextInfo }: Props =
    $props();

  const contextDisplay = $derived.by(() => {
    if (!contextInfo) return null;
    const currentK = Math.round(contextInfo.currentTokens / 1000);
    const limitK = Math.round(contextInfo.tokenLimit / 1000);
    const percentage =
      contextInfo.tokenLimit > 0
        ? Math.round((contextInfo.currentTokens / contextInfo.tokenLimit) * 100)
        : 0;
    return `ctx: ${currentK}k/${limitK}k (${percentage}%)`;
  });

  const toolLine = $derived.by(() => {
    let line = `${toolCount} tools active`;
    if (mcpServerCount > 0) {
      line += ` · ${mcpServerCount} MCP servers`;
    }
    return line;
  });
</script>

<div class="env-lines">
  <div class="env-line"><span class="dot green"></span> {modelCount} models available</div>
  {#if toolCount > 0}
    <div class="env-line"><span class="dot cyan"></span> {toolLine}</div>
  {/if}
  {#if currentAgent}
    <div class="env-line"><span class="dot purple"></span> agent: @{currentAgent}</div>
  {/if}
  {#if sessionTitle}
    <div class="env-line session-title-line"><span class="dot blue"></span> {sessionTitle}</div>
  {/if}
  {#if contextDisplay}
    <div class="env-line">{contextDisplay}</div>
  {/if}
</div>

<style>
  .env-lines {
    margin-bottom: var(--sp-1);
    font-size: 0.88em;
    padding: var(--sp-1) 0;
  }

  .env-line {
    color: var(--fg-dim);
    font-size: 0.82em;
    padding: 1px 0;
    display: flex;
    align-items: center;
    gap: var(--sp-2);
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .dot.green  { background: var(--green); }
  .dot.cyan   { background: var(--cyan); }
  .dot.purple { background: var(--purple); }
  .dot.blue   { background: var(--blue); }

  .session-title-line {
    font-style: italic;
  }
</style>

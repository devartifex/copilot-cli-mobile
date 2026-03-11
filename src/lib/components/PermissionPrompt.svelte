<script lang="ts">
  interface Props {
    requestId: string;
    toolName: string;
    toolArgs: Record<string, unknown>;
    onRespond: (requestId: string, decision: 'allow' | 'deny' | 'always_allow') => void;
  }

  const { requestId, toolName, toolArgs, onRespond }: Props = $props();

  const COUNTDOWN_SECONDS = 30;

  let secondsLeft = $state(COUNTDOWN_SECONDS);
  let argsExpanded = $state(false);

  const argsJson = $derived(JSON.stringify(toolArgs, null, 2));
  const isLargeArgs = $derived(argsJson.length > 120);

  $effect(() => {
    const interval = setInterval(() => {
      secondsLeft -= 1;
      if (secondsLeft <= 0) {
        clearInterval(interval);
        onRespond(requestId, 'deny');
      }
    }, 1000);

    return () => clearInterval(interval);
  });
</script>

<div class="permission-prompt">
  <div class="permission-tool-name">🔐 {toolName}</div>

  {#if isLargeArgs}
    <button
      class="permission-toggle"
      onclick={() => argsExpanded = !argsExpanded}
    >
      {argsExpanded ? '▾ Hide arguments' : '▸ Show arguments'}
    </button>
  {/if}

  {#if !isLargeArgs || argsExpanded}
    <pre class="permission-args">{argsJson}</pre>
  {/if}

  <div class="permission-actions">
    <button class="permission-btn allow" onclick={() => onRespond(requestId, 'allow')}>
      Allow
    </button>
    <button class="permission-btn deny" onclick={() => onRespond(requestId, 'deny')}>
      Deny
    </button>
    <button class="permission-btn always" onclick={() => onRespond(requestId, 'always_allow')}>
      Always Allow
    </button>
  </div>

  <div class="permission-countdown">Auto-deny in {secondsLeft}s</div>
</div>

<style>
  .permission-prompt {
    background: rgba(110, 64, 201, 0.06);
    border: 1px solid var(--yellow);
    border-radius: var(--radius-sm);
    padding: var(--sp-3);
    animation: msg-in 0.3s ease;
  }

  @keyframes msg-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .permission-tool-name {
    color: var(--yellow);
    font-weight: 600;
    font-size: 0.9em;
  }

  .permission-toggle {
    background: none;
    border: none;
    color: var(--fg-dim);
    font-family: var(--font-mono);
    font-size: 0.78em;
    cursor: pointer;
    padding: var(--sp-1) 0;
  }

  .permission-args {
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: var(--sp-2);
    font-size: 0.78em;
    color: var(--fg-dim);
    max-height: 120px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-all;
    margin: var(--sp-2) 0;
  }

  .permission-actions {
    display: flex;
    gap: var(--sp-1);
    flex-wrap: wrap;
  }

  .permission-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: 100px;
    color: var(--fg);
    padding: var(--sp-1) var(--sp-3);
    font-family: var(--font-mono);
    font-size: 0.85em;
    cursor: pointer;
  }

  .permission-btn.allow {
    border-color: var(--green);
    color: var(--green);
  }

  .permission-btn.deny {
    border-color: var(--red);
    color: var(--red);
  }

  .permission-btn.always {
    border-color: var(--blue);
    color: var(--blue);
  }

  .permission-countdown {
    font-size: 0.75em;
    color: var(--fg-dim);
    margin-top: var(--sp-1);
  }
</style>

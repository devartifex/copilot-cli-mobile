<script lang="ts">
  interface Props {
    requestId: string;
    kind: string;
    toolName: string;
    toolArgs: Record<string, unknown>;
    onRespond: (requestId: string, decision: 'allow' | 'deny' | 'always_allow') => void;
  }

  const { requestId, kind, toolName, toolArgs, onRespond }: Props = $props();

  const COUNTDOWN_SECONDS = 300; // 5 minutes

  let secondsLeft = $state(COUNTDOWN_SECONDS);
  let argsExpanded = $state(false);
  let promptEl: HTMLDivElement | undefined = $state();

  const argsJson = $derived(JSON.stringify(toolArgs, null, 2));
  const hasArgs = $derived(Object.keys(toolArgs).length > 0);
  const isLargeArgs = $derived(argsJson.length > 120);
  const isUrgent = $derived(secondsLeft <= 30);

  const kindIcon: Record<string, string> = {
    shell: '💻',
    write: '✏️',
    read: '📖',
    mcp: '🔌',
    url: '🌐',
    'custom-tool': '🔧',
    memory: '🧠',
  };
  const icon = $derived(kindIcon[kind] ?? '🔐');

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

  // Browser notification when the prompt appears (user may have switched tabs)
  $effect(() => {
    if (typeof Notification === 'undefined') return;

    const fire = () => {
      const notif = new Notification(`Tool approval needed: ${kind}`, {
        body: toolName,
        icon: '/favicon.png',
        tag: requestId,
        requireInteraction: true,
      });
      notif.onclick = () => {
        window.focus();
        notif.close();
      };
      return () => notif.close();
    };

    if (Notification.permission === 'granted') {
      return fire();
    } else if (Notification.permission === 'default') {
      Notification.requestPermission().then((perm) => {
        if (perm === 'granted') fire();
      });
    }
  });

  // Auto-scroll into view when the prompt appears
  $effect(() => {
    if (promptEl) {
      promptEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
</script>

<div class="permission-prompt" class:urgent={isUrgent} bind:this={promptEl}>
  <div class="permission-header">
    <span class="permission-kind-badge">{icon} {kind}</span>
    <span class="permission-tool-name">{toolName}</span>
  </div>

  {#if hasArgs}
    {#if isLargeArgs}
      <button
        class="permission-toggle"
        onclick={() => argsExpanded = !argsExpanded}
      >
        {argsExpanded ? '▾ Hide details' : '▸ Show details'}
      </button>
    {/if}

    {#if !isLargeArgs || argsExpanded}
      <pre class="permission-args">{argsJson}</pre>
    {/if}
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

  <div class="permission-countdown">Auto-deny in {secondsLeft >= 60 ? `${Math.floor(secondsLeft / 60)}m ${secondsLeft % 60}s` : `${secondsLeft}s`}</div>
</div>

<style>
  .permission-prompt {
    background: rgba(110, 64, 201, 0.06);
    border: 1px solid var(--yellow);
    border-radius: var(--radius-sm);
    padding: var(--sp-3);
    margin: var(--sp-2) var(--sp-3);
    animation: permission-in 0.4s cubic-bezier(0.22, 1, 0.36, 1);
    box-shadow: 0 0 12px rgba(210, 153, 34, 0.15);
  }

  .permission-prompt.urgent {
    border-color: var(--red);
    box-shadow: 0 0 16px rgba(248, 81, 73, 0.25);
    animation: permission-pulse 1s ease-in-out infinite;
  }

  @keyframes permission-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes permission-pulse {
    0%, 100% { box-shadow: 0 0 12px rgba(248, 81, 73, 0.15); }
    50% { box-shadow: 0 0 20px rgba(248, 81, 73, 0.35); }
  }

  .permission-header {
    display: flex;
    align-items: baseline;
    gap: var(--sp-2);
    margin-bottom: var(--sp-1);
    flex-wrap: wrap;
  }

  .permission-kind-badge {
    background: rgba(210, 153, 34, 0.15);
    color: var(--yellow);
    font-weight: 600;
    font-size: 0.8em;
    font-family: var(--font-mono);
    padding: 1px 7px;
    border-radius: 100px;
    white-space: nowrap;
  }

  .permission-tool-name {
    color: var(--fg);
    font-size: 0.88em;
    font-family: var(--font-mono);
    word-break: break-all;
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

  .permission-prompt.urgent .permission-countdown {
    color: var(--red);
    font-weight: 600;
  }
</style>

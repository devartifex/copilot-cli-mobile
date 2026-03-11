<script lang="ts">
  interface Props {
    content: string;
    isStreaming: boolean;
  }

  const { content, isStreaming }: Props = $props();

  let collapsed = $state(false);

  const headerLabel = $derived(isStreaming ? 'Thinking…' : 'Thought');

  function toggle() {
    collapsed = !collapsed;
  }
</script>

<div class="reasoning-block" class:collapsed>
  <button class="reasoning-header" onclick={toggle} type="button">
    <span class="reasoning-chevron">▼</span>
    <span class="reasoning-icon" class:thinking={isStreaming}>💭</span>
    <span>{headerLabel}</span>
  </button>
  <div class="reasoning-content">{content}</div>
</div>

<style>
  .reasoning-block {
    margin: var(--sp-1) 0;
    padding-left: var(--sp-3);
    font-size: 0.82em;
  }

  .reasoning-header {
    color: var(--fg-muted);
    cursor: pointer;
    user-select: none;
    padding: var(--sp-1) 0;
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    min-height: 32px;
    background: none;
    border: none;
    font-family: inherit;
    font-size: inherit;
  }

  .reasoning-chevron {
    color: var(--fg-dim);
    font-size: 0.75em;
    transition: transform 0.2s ease;
    display: inline-block;
  }

  .collapsed .reasoning-chevron {
    transform: rotate(-90deg);
  }

  .reasoning-icon {
    display: inline-block;
    color: var(--yellow);
    font-size: 0.9em;
  }

  .reasoning-icon.thinking {
    animation: shimmer 1.5s ease-in-out infinite;
  }

  @keyframes shimmer {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  .reasoning-content {
    color: var(--fg-dim);
    white-space: pre-wrap;
    word-wrap: break-word;
    padding: var(--sp-1) 0 var(--sp-1) var(--sp-5);
    max-height: 160px;
    overflow-y: auto;
    line-height: 1.5;
    font-size: 0.95em;
    transition: max-height 0.3s ease, opacity 0.3s ease, padding 0.3s ease;
  }

  .collapsed .reasoning-content {
    max-height: 0;
    opacity: 0;
    padding: 0 0 0 var(--sp-5);
    overflow: hidden;
  }
</style>

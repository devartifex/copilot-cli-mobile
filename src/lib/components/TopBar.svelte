<script lang="ts">
  import type { SessionMode, ConnectionState, QuotaSnapshots } from '$lib/types/index.js';
  import QuotaDot from './QuotaDot.svelte';

  interface Props {
    mode: SessionMode;
    currentModel: string;
    connectionState: ConnectionState;
    quotaSnapshots: QuotaSnapshots | null;
    onToggleSidebar: () => void;
    onSetMode: (mode: SessionMode) => void;
    onOpenModelSheet: () => void;
    onNewChat: () => void;
  }

  const {
    mode,
    currentModel,
    connectionState,
    quotaSnapshots,
    onToggleSidebar,
    onSetMode,
    onOpenModelSheet,
    onNewChat,
  }: Props = $props();

  const modes: { value: SessionMode; label: string }[] = [
    { value: 'interactive', label: 'Ask' },
    { value: 'plan', label: 'Plan' },
    { value: 'autopilot', label: 'Auto' },
  ];

  const connectionDotClass = $derived.by(() => {
    switch (connectionState) {
      case 'connected': return 'dot-connected';
      case 'connecting': return 'dot-connecting';
      default: return 'dot-disconnected';
    }
  });

  const displayModel = $derived(currentModel || 'Select model');
</script>

<div class="top-bar">
  <button class="tb-btn hamburger-btn" onclick={onToggleSidebar} aria-label="Open menu">
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
      <line x1="3" y1="5" x2="15" y2="5"/>
      <line x1="3" y1="9" x2="15" y2="9"/>
      <line x1="3" y1="13" x2="15" y2="13"/>
    </svg>
  </button>

  <div class="mode-toggle">
    {#each modes as m (m.value)}
      <button
        class="mode-opt"
        class:active={mode === m.value}
        data-mode={m.value}
        onclick={() => onSetMode(m.value)}
      >
        {m.label}
      </button>
    {/each}
  </div>

  <button class="model-pill" onclick={onOpenModelSheet} aria-label="Select model">
    <span class="conn-dot {connectionDotClass}"></span>
    <span class="model-name">{displayModel}</span>
    <QuotaDot {quotaSnapshots} />
    <svg class="chevron" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M2.5 4 L5 6.5 L7.5 4"/>
    </svg>
  </button>

  <button class="tb-btn newchat-btn" onclick={onNewChat} aria-label="New chat">
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
      <line x1="9" y1="4" x2="9" y2="14"/>
      <line x1="4" y1="9" x2="14" y2="9"/>
    </svg>
  </button>
</div>

<style>
  .top-bar {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    padding: var(--sp-2) var(--sp-3);
    padding-top: calc(var(--sp-2) + var(--safe-top));
    border-bottom: 1px solid var(--border);
    background: var(--bg);
    flex-shrink: 0;
    min-height: 48px;
  }

  .tb-btn {
    background: none;
    border: none;
    color: var(--fg-muted);
    padding: 0;
    cursor: pointer;
    min-height: 36px;
    min-width: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    flex-shrink: 0;
    -webkit-tap-highlight-color: transparent;
  }

  .tb-btn:active {
    background: var(--border);
    color: var(--fg);
  }

  /* ── Mode toggle ───────────────────────────────────────────────── */
  .mode-toggle {
    display: flex;
    align-items: center;
    border: 1px solid var(--border);
    border-radius: 100px;
    overflow: hidden;
    flex-shrink: 0;
  }

  .mode-opt {
    background: transparent;
    border: none;
    color: var(--fg-dim);
    padding: var(--sp-1) var(--sp-2);
    font-family: var(--font-mono);
    font-size: 0.78em;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
    min-height: 32px;
    min-width: 40px;
    -webkit-tap-highlight-color: transparent;
  }

  .mode-opt.active {
    background: var(--border-accent);
    color: var(--purple);
  }

  .mode-opt[data-mode='interactive'].active {
    background: rgba(255, 255, 255, 0.1);
    color: #e6edf3;
  }

  .mode-opt[data-mode='plan'].active {
    background: rgba(88, 166, 255, 0.15);
    color: var(--blue);
  }

  .mode-opt[data-mode='autopilot'].active {
    background: rgba(63, 185, 80, 0.15);
    color: var(--green);
  }

  .mode-opt:active {
    transform: scale(0.95);
  }

  /* ── Model pill ────────────────────────────────────────────────── */
  .model-pill {
    display: flex;
    align-items: center;
    gap: var(--sp-1);
    background: var(--bg-overlay);
    border: 1px solid var(--border);
    border-radius: 100px;
    padding: var(--sp-1) var(--sp-2) var(--sp-1) var(--sp-2);
    cursor: pointer;
    min-height: 32px;
    margin-left: auto;
    max-width: 160px;
    -webkit-tap-highlight-color: transparent;
  }

  .model-pill:active {
    background: var(--border);
  }

  .model-name {
    font-family: var(--font-mono);
    font-size: 0.78em;
    color: var(--fg-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .chevron {
    flex-shrink: 0;
    color: var(--fg-dim);
  }

  /* ── Connection dot ────────────────────────────────────────────── */
  .conn-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .dot-connected {
    background: var(--green);
  }

  .dot-connecting {
    background: var(--yellow);
    animation: pulse 1.5s ease-in-out infinite;
  }

  .dot-disconnected {
    background: var(--red);
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  /* ── Responsive ────────────────────────────────────────────────── */
  @media (min-width: 768px) {
    .top-bar {
      max-width: 800px;
      margin: 0 auto;
      width: 100%;
      padding-left: var(--sp-6);
      padding-right: var(--sp-6);
    }
  }

  @media (min-width: 1024px) {
    .top-bar {
      max-width: 880px;
    }
  }
</style>

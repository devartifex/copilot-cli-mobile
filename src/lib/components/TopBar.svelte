<script lang="ts">
  import type { ConnectionState, QuotaSnapshots } from '$lib/types/index.js';
  import QuotaDot from '$lib/components/QuotaDot.svelte';

  interface Props {
    currentModel: string;
    connectionState: ConnectionState;
    sessionTitle: string | null;
    quotaSnapshots: QuotaSnapshots | null;
    activeSkillCount: number;
    onToggleSidebar: () => void;
    onOpenModelSheet: () => void;
    onNewChat: () => void;
  }

  const {
    currentModel,
    connectionState,
    sessionTitle,
    quotaSnapshots,
    activeSkillCount,
    onToggleSidebar,
    onOpenModelSheet,
    onNewChat,
  }: Props = $props();

  const connectionDotClass = $derived.by(() => {
    switch (connectionState) {
      case 'connected': return 'dot-connected';
      case 'connecting': return 'dot-connecting';
      default: return 'dot-disconnected';
    }
  });

  const displayModel = $derived(currentModel || 'Select model');
  const displayTitle = $derived(sessionTitle || 'Copilot Unleashed');
</script>

<div class="top-bar">
  <button class="tb-btn hamburger-btn" onclick={onToggleSidebar} aria-label="Open menu">
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
      <line x1="3" y1="5" x2="15" y2="5"/>
      <line x1="3" y1="9" x2="15" y2="9"/>
      <line x1="3" y1="13" x2="15" y2="13"/>
    </svg>
  </button>

  {#if sessionTitle}
    <span class="title-text" title={sessionTitle}>{sessionTitle}</span>
  {:else}
    <span class="brand-group" aria-label="Copilot Unleashed">
      <img src="/img/logo.png" alt="" class="brand-icon" width="22" height="22" aria-hidden="true" />
      <span class="brand-name">Copilot <span class="brand-accent">Unleashed</span></span>
    </span>
  {/if}

  <button class="model-pill" onclick={onOpenModelSheet} aria-label="Select model">
    <span class="conn-dot {connectionDotClass}"></span>
    {#if currentModel}
      <span class="model-name">{displayModel}</span>
    {:else}
      <span class="model-name loading-text">{displayModel}</span>
    {/if}
    <QuotaDot {quotaSnapshots} />
    <svg class="chevron" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M2.5 4 L5 6.5 L7.5 4"/>
    </svg>
  </button>

  {#if activeSkillCount > 0}
    <span class="skill-badge" title="{activeSkillCount} skill{activeSkillCount > 1 ? 's' : ''} active">
      ⚡ {activeSkillCount}
    </span>
  {/if}

  <button class="tb-btn newchat-btn" onclick={onNewChat} aria-label="New chat">
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 13.5V16H5.5L14 7.5L11 4.5L3 13.5Z"/>
      <path d="M14 2L16 4L14 7.5L11 4.5L14 2Z"/>
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
    background: var(--bg);
    flex-shrink: 0;
    min-height: 48px;
  }

  .tb-btn {
    background: none;
    border: none;
    color: var(--fg-dim);
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
    transition: color 0.15s ease;
  }

  .tb-btn:hover {
    color: var(--fg);
  }

  .tb-btn:active {
    color: var(--fg);
    transform: scale(0.92);
  }

  /* ── Session title ──────────────────────────────────────────────── */
  .title-text {
    font-family: var(--font-mono);
    font-size: 0.82em;
    color: var(--fg-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    flex: 1;
    font-weight: 500;
  }

  /* ── Brand group (shown when no session title) ── */
  .brand-group {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    flex: 1;
    overflow: hidden;
  }

  .brand-icon {
    flex-shrink: 0;
    border-radius: 4px;
    filter: drop-shadow(0 0 6px rgba(147, 51, 234, 0.55));
  }

  .brand-name {
    font-family: var(--font-mono);
    font-size: 0.95em;
    font-weight: 700;
    color: var(--fg);
    letter-spacing: 0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .brand-accent {
    background: linear-gradient(90deg, #a78bfa, #22d3ee);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  /* ── Model pill ────────────────────────────────────────────────── */
  .model-pill {
    display: flex;
    align-items: center;
    gap: 6px;
    background: transparent;
    border: none;
    border-radius: var(--radius-md);
    padding: 5px 10px;
    cursor: pointer;
    min-height: 30px;
    max-width: 200px;
    -webkit-tap-highlight-color: transparent;
    transition: background 0.15s ease;
  }

  .model-pill:hover {
    background: var(--bg-overlay);
  }

  .model-pill:active {
    background: var(--bg-overlay);
    transform: scale(0.97);
  }

  .model-name {
    font-family: var(--font-mono);
    font-size: 0.78em;
    color: var(--fg-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    font-weight: 500;
  }

  @keyframes pulse-text {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 1; }
  }

  .model-name.loading-text {
    animation: pulse-text 1.5s ease-in-out infinite;
  }

  .chevron {
    flex-shrink: 0;
    color: var(--fg-dim);
    opacity: 0.6;
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
    box-shadow: 0 0 4px var(--green);
  }

  .dot-connecting {
    background: var(--yellow);
    box-shadow: 0 0 4px var(--yellow);
    animation: pulse 1.5s ease-in-out infinite;
  }

  .dot-disconnected {
    background: var(--red);
    box-shadow: 0 0 4px var(--red);
  }

  /* ── Skill badge ──────────────────────────────────────────────── */
  .skill-badge {
    font-family: var(--font-mono);
    font-size: 0.7em;
    color: var(--yellow);
    background: rgba(250, 204, 21, 0.1);
    border: 1px solid rgba(250, 204, 21, 0.25);
    border-radius: var(--radius-sm);
    padding: 2px 6px;
    white-space: nowrap;
    flex-shrink: 0;
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

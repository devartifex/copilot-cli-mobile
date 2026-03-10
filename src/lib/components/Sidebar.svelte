<script lang="ts">
  import type {
    SessionMode,
    ReasoningEffort,
    ModelInfo,
  } from '$lib/types/index.js';

  interface Props {
    open: boolean;
    mode: SessionMode;
    models: Map<string, ModelInfo>;
    currentModel: string;
    reasoningEffort: ReasoningEffort | null;
    currentAgent: string | null;
    onClose: () => void;
    onNewChat: () => void;
    onOpenSessions: () => void;
    onOpenSettings: () => void;
    onSetMode: (mode: SessionMode) => void;
    onSetModel: (model: string) => void;
    onSetReasoning: (effort: ReasoningEffort) => void;
    onLogout: () => void;
  }

  const {
    open,
    mode,
    models,
    currentModel,
    reasoningEffort,
    currentAgent,
    onClose,
    onNewChat,
    onOpenSessions,
    onOpenSettings,
    onSetMode,
    onSetModel,
    onSetReasoning,
    onLogout,
  }: Props = $props();

  const modes: { value: SessionMode; label: string }[] = [
    { value: 'interactive', label: 'Ask' },
    { value: 'plan', label: 'Plan' },
    { value: 'autopilot', label: 'Auto' },
  ];

  const reasoningLevels: { value: ReasoningEffort; label: string }[] = [
    { value: 'low', label: 'low' },
    { value: 'medium', label: 'med' },
    { value: 'high', label: 'high' },
    { value: 'xhigh', label: 'max' },
  ];

  const supportsReasoning = $derived(
    models.get(currentModel)?.capabilities?.supports?.reasoningEffort === true,
  );

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }

  function formatMultiplier(info: ModelInfo): string {
    const mult = info.billing?.multiplier;
    return mult != null ? `${info.id} · ${mult}×` : info.id;
  }

  function handleModelChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    onSetModel(target.value);
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div class="sidebar-overlay" role="presentation" onclick={handleBackdropClick}>
    <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
    <div class="sidebar-panel" role="presentation" onclick={(e: MouseEvent) => e.stopPropagation()}>
      <div class="sidebar-header">
        <span class="sidebar-title">Menu</span>
        <button class="sidebar-close" onclick={onClose}>✕</button>
      </div>

      <div class="sidebar-body">
        <!-- Mode section -->
        <div class="sidebar-section">
          <span class="sidebar-label">Mode</span>
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
        </div>

        <!-- Model section -->
        <div class="sidebar-section">
          <span class="sidebar-label">Model</span>
          <select class="sidebar-select" value={currentModel} onchange={handleModelChange}>
            {#each [...models.values()] as info (info.id)}
              <option value={info.id}>{formatMultiplier(info)}</option>
            {/each}
          </select>
        </div>

        <!-- Reasoning section (conditional) -->
        {#if supportsReasoning}
          <div class="sidebar-section">
            <span class="sidebar-label">Reasoning</span>
            <div class="reasoning-toggle">
              {#each reasoningLevels as level (level.value)}
                <button
                  class="reasoning-opt"
                  class:active={reasoningEffort === level.value}
                  onclick={() => onSetReasoning(level.value)}
                >
                  {level.label}
                </button>
              {/each}
            </div>
          </div>
        {/if}

        <div class="sidebar-divider"></div>

        <!-- Actions section -->
        <div class="sidebar-section">
          <button class="sidebar-action" onclick={onNewChat}>
            <span class="sidebar-action-icon">＋</span>
            New Chat
          </button>
          <button class="sidebar-action" onclick={onOpenSessions}>
            <span class="sidebar-action-icon">☰</span>
            Sessions
          </button>
          <button class="sidebar-action" onclick={onOpenSettings}>
            <span class="sidebar-action-icon">⚙</span>
            Settings
          </button>
        </div>

        {#if currentAgent}
          <div class="sidebar-section">
            <span class="sidebar-label">Agent</span>
            <span class="sidebar-agent-name">{currentAgent}</span>
          </div>
        {/if}

        <div class="sidebar-divider"></div>

        <!-- Sign out -->
        <div class="sidebar-section">
          <button class="sidebar-action sidebar-action-danger" onclick={onLogout}>
            <span class="sidebar-action-icon">⏻</span>
            Sign Out
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .sidebar-overlay {
    position: fixed;
    inset: 0;
    z-index: 90;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(2px);
  }
  .sidebar-panel {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(280px, 80vw);
    background: var(--bg-raised);
    border-left: 1px solid var(--border);
    z-index: 91;
    display: flex;
    flex-direction: column;
    transform: translateX(0);
    transition: transform 0.25s ease;
    padding-top: env(safe-area-inset-top);
    padding-bottom: env(safe-area-inset-bottom);
  }
  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sp-3) var(--sp-4);
    border-bottom: 1px solid var(--border);
  }
  .sidebar-title {
    font-family: var(--font-mono);
    font-size: 0.95em;
    font-weight: 600;
    color: var(--fg);
  }
  .sidebar-close {
    background: none;
    border: none;
    color: var(--fg-muted);
    font-size: 1.1em;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: var(--radius-sm);
    min-height: 36px;
    min-width: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .sidebar-close:active {
    background: var(--border);
  }
  .sidebar-body {
    flex: 1;
    overflow-y: auto;
    padding: var(--sp-3) var(--sp-4);
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
  }
  .sidebar-section {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
  }
  .sidebar-label {
    font-family: var(--font-mono);
    font-size: 0.75em;
    color: var(--fg-dim);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 600;
  }
  .sidebar-divider {
    height: 1px;
    background: var(--border);
  }

  /* Mode toggle */
  .mode-toggle {
    display: flex;
    align-items: center;
    gap: 0;
    border: 1px solid var(--border);
    border-radius: 100px;
    overflow: hidden;
    width: 100%;
  }
  .mode-opt {
    background: transparent;
    border: none;
    color: var(--fg-dim);
    padding: var(--sp-1) var(--sp-2);
    font-family: var(--font-mono);
    font-size: 0.88em;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
    min-height: 40px;
    flex: 1;
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
    transform: scale(0.96);
  }

  /* Model select */
  .sidebar-select {
    width: 100%;
    background: var(--bg-overlay);
    color: var(--fg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: var(--sp-2) var(--sp-3);
    font-family: var(--font-mono);
    font-size: 0.85em;
    cursor: pointer;
    min-height: 40px;
  }
  .sidebar-select:focus {
    border-color: var(--purple);
  }
  .sidebar-select option {
    background: var(--bg);
  }

  /* Reasoning toggle */
  .reasoning-toggle {
    display: flex;
    align-items: center;
    gap: 0;
    border: 1px solid var(--border);
    border-radius: 100px;
    overflow: hidden;
    width: 100%;
  }
  .reasoning-opt {
    background: transparent;
    border: none;
    color: var(--fg-dim);
    padding: var(--sp-1) var(--sp-2);
    font-family: var(--font-mono);
    font-size: 0.85em;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
    min-height: 40px;
    flex: 1;
  }
  .reasoning-opt.active {
    background: rgba(240, 136, 62, 0.18);
    color: var(--orange);
  }
  .reasoning-opt:active {
    transform: scale(0.96);
  }

  /* Action buttons */
  .sidebar-action {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    background: none;
    border: none;
    color: var(--fg);
    font-family: var(--font-mono);
    font-size: 0.88em;
    padding: var(--sp-2) var(--sp-1);
    border-radius: var(--radius-sm);
    cursor: pointer;
    min-height: 44px;
    width: 100%;
    text-align: left;
  }
  .sidebar-action:active {
    background: var(--border);
  }
  .sidebar-action-icon {
    width: 24px;
    text-align: center;
    font-size: 1.1em;
    flex-shrink: 0;
  }
  .sidebar-action-danger {
    color: var(--red);
  }

  .sidebar-agent-name {
    font-family: var(--font-mono);
    font-size: 0.85em;
    color: var(--purple);
  }
</style>

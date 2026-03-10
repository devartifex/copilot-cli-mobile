<script lang="ts">
  interface Props {
    open: boolean;
    currentAgent: string | null;
    onClose: () => void;
    onNewChat: () => void;
    onOpenSessions: () => void;
    onOpenSettings: () => void;
    onLogout: () => void;
  }

  const {
    open,
    currentAgent,
    onClose,
    onNewChat,
    onOpenSessions,
    onOpenSettings,
    onLogout,
  }: Props = $props();

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      onClose();
    }
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
        <!-- Actions section -->
        <div class="sidebar-section">
          <button class="sidebar-action" onclick={onNewChat}>
            <span class="sidebar-action-icon">+</span>
            New Chat
          </button>
          <button class="sidebar-action" onclick={onOpenSessions}>
            <span class="sidebar-action-icon">↻</span>
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
    left: 0;
    bottom: 0;
    width: min(280px, 80vw);
    background: var(--bg-raised);
    border-right: 1px solid var(--border);
    z-index: 91;
    display: flex;
    flex-direction: column;
    animation: slideInLeft 0.2s ease;
    padding-top: env(safe-area-inset-top);
    padding-bottom: env(safe-area-inset-bottom);
  }
  @keyframes slideInLeft {
    from { transform: translateX(-100%); }
    to { transform: translateX(0); }
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

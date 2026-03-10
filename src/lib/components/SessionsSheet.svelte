<script lang="ts">
  import type { SessionSummary } from '$lib/types/index.js';

  interface Props {
    open: boolean;
    sessions: SessionSummary[];
    onClose: () => void;
    onResume: (sessionId: string) => void;
    onDelete?: (sessionId: string) => void;
  }

  const { open, sessions, onClose, onResume, onDelete }: Props = $props();

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }

  function handleResume(sessionId: string) {
    const confirmed = window.confirm('Resume this session? Current conversation will end.');
    if (confirmed) {
      onResume(sessionId);
    }
  }

  function handleDelete(e: MouseEvent, sessionId: string, title: string) {
    e.stopPropagation();
    if (window.confirm(`Delete session "${title}"? This cannot be undone.`)) {
      onDelete?.(sessionId);
    }
  }

  function formatRelativeTime(dateStr: string | undefined): string {
    if (!dateStr) return '';

    const now = Date.now();
    let timestamp: number;
    try {
      timestamp = new Date(dateStr).getTime();
    } catch {
      return dateStr;
    }
    if (Number.isNaN(timestamp)) return dateStr;

    const diffMs = now - timestamp;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);

    if (diffSec < 60) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;
    if (diffDay < 30) return `${Math.floor(diffDay / 7)}w ago`;
    return `${Math.floor(diffDay / 30)}mo ago`;
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div class="sheet-overlay" role="presentation" onclick={handleBackdropClick}>
    <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
    <div class="sheet-panel" role="presentation" onclick={(e: MouseEvent) => e.stopPropagation()}>
      <div class="sheet-header">
        <span class="sheet-title">Sessions</span>
        <button class="sheet-close" onclick={onClose}>✕</button>
      </div>

      <div class="sheet-body">
        {#if sessions.length === 0}
          <p class="sheet-empty">No previous sessions found.</p>
        {:else}
          <div class="session-list">
            {#each sessions as session (session.id)}
              <button
                class="session-item"
                onclick={() => handleResume(session.id)}
              >
                <span class="session-item-info">
                  <span class="session-item-title">{session.title ?? session.id}</span>
                  <span class="session-item-meta">
                    {#if session.model}<span>{session.model}</span>{/if}
                    {#if session.updatedAt}<span>{formatRelativeTime(session.updatedAt)}</span>{/if}
                  </span>
                </span>
                {#if onDelete}
                  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
                  <span
                    class="session-delete-btn"
                    role="button"
                    tabindex="0"
                    onclick={(e: MouseEvent) => handleDelete(e, session.id, session.title ?? 'Untitled')}
                    onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleDelete(e as unknown as MouseEvent, session.id, session.title ?? 'Untitled'); } }}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 9a1 1 0 001 1h6a1 1 0 001-1l1-9"/>
                    </svg>
                  </span>
                {/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .sheet-overlay {
    position: fixed;
    inset: 0;
    z-index: 95;
    background: var(--bg);
    display: flex;
    flex-direction: column;
    animation: fadeIn 0.15s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .sheet-panel {
    width: 100%;
    max-width: 600px;
    margin: 0 auto;
    background: var(--bg);
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .sheet-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sp-3) var(--sp-4);
    padding-top: calc(var(--sp-3) + var(--safe-top));
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .sheet-title {
    font-family: var(--font-mono);
    font-size: 0.9em;
    font-weight: 600;
    color: var(--fg);
  }

  .sheet-close {
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

  .sheet-close:active {
    background: var(--border);
  }

  .sheet-body {
    flex: 1;
    overflow-y: auto;
    padding: 0 var(--sp-4) var(--sp-3);
    padding-bottom: calc(var(--sp-3) + var(--safe-bottom));
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
    min-height: 0;
  }
  .sheet-body::-webkit-scrollbar { width: 4px; }
  .sheet-body::-webkit-scrollbar-track { background: transparent; }
  .sheet-body::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
  .sheet-body::-webkit-scrollbar-thumb:hover { background: var(--fg-dim); }

  .sheet-empty {
    font-family: var(--font-mono);
    font-size: 0.82em;
    color: var(--fg-dim);
    text-align: center;
    padding: var(--sp-4);
  }

  .session-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .session-item {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    background: none;
    border: none;
    color: var(--fg);
    font-family: var(--font-mono);
    font-size: 0.85em;
    padding: var(--sp-2) var(--sp-3);
    border-radius: var(--radius-sm);
    cursor: pointer;
    text-align: left;
    width: 100%;
    min-height: 52px;
    -webkit-tap-highlight-color: transparent;
  }

  .session-item:active {
    background: var(--border);
  }

  .session-item-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .session-item-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg);
  }

  .session-item-meta {
    display: flex;
    gap: var(--sp-2);
    font-size: 0.78em;
    color: var(--fg-dim);
  }

  .session-delete-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--fg-dim);
    cursor: pointer;
    padding: var(--sp-1);
    border-radius: var(--radius-sm);
    min-width: 32px;
    min-height: 32px;
    flex-shrink: 0;
    -webkit-tap-highlight-color: transparent;
  }

  .session-delete-btn:active {
    color: var(--red);
    background: rgba(248, 81, 73, 0.1);
  }
</style>

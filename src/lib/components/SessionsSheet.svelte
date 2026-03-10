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
  <div class="sessions-overlay" role="presentation" onclick={handleBackdropClick}>
    <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
    <div class="sessions-sheet" role="presentation" onclick={(e: MouseEvent) => e.stopPropagation()}>
      <div class="sessions-header">
        <span class="sessions-title">Sessions</span>
        <button class="sessions-close" onclick={onClose}>✕</button>
      </div>

      <div class="sessions-body">
        {#if sessions.length === 0}
          <p class="sessions-empty">No previous sessions found.</p>
        {:else}
          {#each sessions as session (session.id)}
            <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
            <div class="session-item" role="button" tabindex="0" onclick={() => handleResume(session.id)} onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') handleResume(session.id); }}>
              <div class="session-item-row">
                <div class="session-item-info">
                  <div class="session-item-title">
                    {session.title ?? session.id}
                  </div>
                  <div class="session-item-meta">
                    {#if session.model}
                      <span>{session.model}</span>
                    {/if}
                    {#if session.updatedAt}
                      <span>{formatRelativeTime(session.updatedAt)}</span>
                    {/if}
                  </div>
                </div>
                {#if onDelete}
                  <button class="session-delete-btn" onclick={(e) => handleDelete(e, session.id, session.title ?? 'Untitled')}>✕</button>
                {/if}
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .sessions-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 110;
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }
  .sessions-sheet {
    background: var(--bg-raised);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    width: 100%;
    max-width: 480px;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    animation: slideUp 0.25s ease;
  }
  @keyframes slideUp {
    from { transform: translateY(100%); }
    to { transform: translateY(0); }
  }
  .sessions-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sp-3) var(--sp-4);
    border-bottom: 1px solid var(--border);
  }
  .sessions-title {
    font-family: var(--font-mono);
    font-size: 0.9em;
    font-weight: 600;
    color: var(--fg);
  }
  .sessions-close {
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
  .sessions-body {
    flex: 1;
    overflow-y: auto;
    padding: var(--sp-3) var(--sp-4);
  }
  .session-item {
    padding: var(--sp-3) var(--sp-2);
    cursor: pointer;
    border-radius: var(--radius-sm);
    border-bottom: 1px solid rgba(48, 54, 61, 0.5);
  }
  .session-item:last-child {
    border-bottom: none;
  }
  .session-item:active {
    background: var(--bg-overlay);
  }
  .session-item-row {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
  }
  .session-item-info {
    flex: 1;
    min-width: 0;
  }
  .session-item-title {
    font-size: 0.85em;
    color: var(--fg);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .session-item-meta {
    display: flex;
    gap: var(--sp-2);
    font-size: 0.72em;
    color: var(--fg-dim);
    margin-top: 2px;
  }
  .session-delete-btn {
    background: none;
    border: none;
    color: var(--fg-dim);
    font-size: 0.9em;
    cursor: pointer;
    padding: var(--sp-1);
    border-radius: var(--radius-sm);
    min-width: 28px;
    min-height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: color 0.15s ease;
  }
  .session-delete-btn:active {
    color: var(--red);
    background: rgba(248, 81, 73, 0.1);
  }
  .sessions-empty {
    font-family: var(--font-mono);
    font-size: 0.82em;
    color: var(--fg-dim);
    text-align: center;
    padding: var(--sp-4);
  }
</style>

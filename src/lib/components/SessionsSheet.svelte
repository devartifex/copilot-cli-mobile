<script lang="ts">
  import type { SessionSummary, SessionDetail } from '$lib/types/index.js';
  import SessionPreview from './SessionPreview.svelte';

  interface Props {
    open: boolean;
    sessions: SessionSummary[];
    sessionDetail: SessionDetail | null;
    loading?: boolean;
    onClose: () => void;
    onResume: (sessionId: string) => void;
    onDelete?: (sessionId: string) => void;
    onRequestDetail?: (sessionId: string) => void;
  }

  const { open, sessions, sessionDetail = null, loading = false, onClose, onResume, onDelete, onRequestDetail }: Props = $props();

  let searchQuery = $state('');
  let selectedSessionId = $state<string | null>(null);

  function sessionTime(s: SessionSummary): number {
    return s.updatedAt ? new Date(s.updatedAt).getTime() : 0;
  }

  const filteredSessions = $derived.by(() => {
    const list = !searchQuery.trim()
      ? [...sessions]
      : sessions.filter((s) => {
          const q = searchQuery.toLowerCase();
          return (
            (s.title ?? s.id).toLowerCase().includes(q) ||
            s.repository?.toLowerCase().includes(q) ||
            s.branch?.toLowerCase().includes(q) ||
            s.cwd?.toLowerCase().includes(q)
          );
        });
    // Sort by updatedAt descending (newest first)
    list.sort((a, b) => sessionTime(b) - sessionTime(a));
    return list;
  });

  // Group sessions by repository, sorted newest-first within each group
  const groupedSessions = $derived.by(() => {
    const groups = new Map<string, SessionSummary[]>();
    for (const s of filteredSessions) {
      const key = s.repository ?? 'Other';
      const group = groups.get(key);
      if (group) {
        group.push(s);
      } else {
        groups.set(key, [s]);
      }
    }

    // Sort sessions within each group by updatedAt descending
    for (const group of groups.values()) {
      group.sort((a, b) => sessionTime(b) - sessionTime(a));
    }

    // Sort groups so the repo with the most recent session comes first
    const sorted = new Map(
      [...groups.entries()].sort(([, a], [, b]) => sessionTime(b[0]) - sessionTime(a[0])),
    );
    return sorted;
  });

  // Determine whether to show groups (only if multiple repos exist)
  const showGroups = $derived(groupedSessions.size > 1 || (groupedSessions.size === 1 && !groupedSessions.has('Other')));

  const selectedSession = $derived(selectedSessionId ? sessions.find((s) => s.id === selectedSessionId) : undefined);

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  }

  function handleClose() {
    selectedSessionId = null;
    searchQuery = '';
    onClose();
  }

  function handleSessionClick(sessionId: string) {
    selectedSessionId = sessionId;
    onRequestDetail?.(sessionId);
  }

  function handleResume(sessionId: string) {
    const confirmed = window.confirm('Resume this session? Current conversation will end.');
    if (confirmed) {
      selectedSessionId = null;
      onResume(sessionId);
    }
  }

  function handleDelete(e: MouseEvent, sessionId: string, title: string) {
    e.stopPropagation();
    if (window.confirm(`Delete session "${title}"? This cannot be undone.`)) {
      if (selectedSessionId === sessionId) selectedSessionId = null;
      onDelete?.(sessionId);
    }
  }

  function handleBackToList() {
    selectedSessionId = null;
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

  function formatPath(cwd: string | undefined): string {
    if (!cwd) return '';
    // Show last 2 path segments
    const parts = cwd.split('/').filter(Boolean);
    return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : cwd;
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div class="sheet-overlay" role="presentation" onclick={handleBackdropClick}>
    <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
    <div class="sheet-panel" role="presentation" onclick={(e: MouseEvent) => e.stopPropagation()}>
      <div class="sheet-header">
        {#if selectedSessionId}
          <button class="sheet-back" onclick={handleBackToList}>← Sessions</button>
        {:else}
          <span class="sheet-title">Sessions</span>
        {/if}
        <button class="sheet-close" onclick={handleClose}>✕</button>
      </div>

      {#if selectedSessionId}
        <div class="sheet-detail">
          <SessionPreview
            detail={sessionDetail?.id === selectedSessionId ? sessionDetail : null}
          />
          <div class="sheet-resume-footer">
            <button class="resume-btn" onclick={() => handleResume(selectedSessionId!)}>
              {selectedSession?.source === 'filesystem' ? 'Continue from Context' : 'Resume Session'}
            </button>
          </div>
        </div>
      {:else}
        <div class="sheet-body">
          {#if !loading && sessions.length > 5}
            <div class="search-bar">
              <input
                class="search-input"
                type="text"
                placeholder="Search sessions…"
                bind:value={searchQuery}
              />
            </div>
          {/if}

          {#if loading}
            <div class="session-list">
              {#each Array(4) as _, i (i)}
                <div class="session-skeleton">
                  <div class="skeleton skeleton-title"></div>
                  <div class="session-skeleton-meta">
                    <div class="skeleton skeleton-meta-item"></div>
                    <div class="skeleton skeleton-meta-time"></div>
                  </div>
                </div>
              {/each}
            </div>
          {:else if filteredSessions.length === 0}
            <p class="sheet-empty">{searchQuery ? 'No matching sessions.' : 'No previous sessions found.'}</p>
          {:else if showGroups}
            {#each [...groupedSessions.entries()] as [repo, groupSessions] (repo)}
              <div class="session-group">
                <div class="session-group-header">
                  <span class="session-group-name">{repo}</span>
                  <span class="session-group-count">{groupSessions.length}</span>
                </div>
                <div class="session-list">
                  {#each groupSessions as session (session.id)}
                    {@render sessionItem(session)}
                  {/each}
                </div>
              </div>
            {/each}
          {:else}
            <div class="session-list">
              {#each filteredSessions as session (session.id)}
                {@render sessionItem(session)}
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}

{#snippet sessionItem(session: SessionSummary)}
  <button
    class="session-item"
    onclick={() => handleSessionClick(session.id)}
  >
    <span class="session-item-info">
      <span class="session-item-title">{session.title ?? session.id}</span>
      <span class="session-item-meta">
        {#if session.repository}
          <span class="meta-badge">{session.repository}</span>
        {/if}
        {#if session.branch}
          <span class="meta-badge meta-branch">{session.branch}</span>
        {:else if session.cwd}
          <span class="meta-path">{formatPath(session.cwd)}</span>
        {/if}
        {#if session.model}<span>{session.model}</span>{/if}
        {#if session.updatedAt}<span>{formatRelativeTime(session.updatedAt)}</span>{/if}
      </span>
      <span class="session-item-indicators">
        {#if session.checkpointCount && session.checkpointCount > 0}
          <span class="indicator" title="{session.checkpointCount} checkpoint{session.checkpointCount > 1 ? 's' : ''}">
            🔖 {session.checkpointCount}
          </span>
        {/if}
        {#if session.hasPlan}
          <span class="indicator" title="Has plan">📋</span>
        {/if}
        {#if session.isRemote}
          <span class="indicator" title="Remote session">☁️</span>
        {/if}
        {#if session.source === 'filesystem'}
          <span class="indicator" title="Bundled session — will resume with context">📦</span>
        {/if}
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
{/snippet}

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

  .sheet-back {
    background: none;
    border: none;
    color: var(--accent);
    font-family: var(--font-mono);
    font-size: 0.85em;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: var(--radius-sm);
    min-height: 36px;
  }

  .sheet-back:active {
    opacity: 0.7;
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

  .sheet-detail {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }

  .sheet-resume-footer {
    padding: var(--sp-3) var(--sp-4);
    padding-bottom: calc(var(--sp-3) + var(--safe-bottom));
    border-top: 1px solid var(--border);
    flex-shrink: 0;
    background: var(--bg);
  }

  .resume-btn {
    width: 100%;
    background: var(--blue);
    color: var(--bg);
    border: none;
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 0.85em;
    font-weight: 600;
    padding: var(--sp-2) var(--sp-3);
    min-height: 44px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }

  .resume-btn:active {
    opacity: 0.85;
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

  /* ── Search ──────────────────────────────────────────────────── */
  .search-bar {
    padding: var(--sp-2) 0;
    position: sticky;
    top: 0;
    background: var(--bg);
    z-index: 1;
  }

  .search-input {
    width: 100%;
    background: var(--bg-secondary, var(--border));
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--fg);
    font-family: var(--font-mono);
    font-size: 0.82em;
    padding: var(--sp-2) var(--sp-3);
    outline: none;
  }

  .search-input::placeholder {
    color: var(--fg-dim);
  }

  .search-input:focus {
    border-color: var(--accent);
  }

  /* ── Session groups ──────────────────────────────────────────── */
  .session-group {
    margin-bottom: var(--sp-2);
  }

  .session-group-header {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    padding: var(--sp-2) var(--sp-3);
    padding-top: var(--sp-3);
  }

  .session-group-name {
    font-family: var(--font-mono);
    font-size: 0.75em;
    font-weight: 600;
    color: var(--fg-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .session-group-count {
    font-family: var(--font-mono);
    font-size: 0.7em;
    color: var(--fg-dim);
    background: var(--border);
    padding: 1px 6px;
    border-radius: 8px;
  }

  /* ── Session list ────────────────────────────────────────────── */
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
    flex-wrap: wrap;
    gap: var(--sp-1);
    font-size: 0.78em;
    color: var(--fg-dim);
  }

  .meta-badge {
    background: var(--border);
    padding: 0 4px;
    border-radius: 3px;
    font-size: 0.9em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 160px;
  }

  .meta-branch {
    color: var(--accent);
  }

  .meta-path {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 160px;
  }

  .session-item-indicators {
    display: flex;
    gap: var(--sp-1);
    font-size: 0.75em;
    color: var(--fg-dim);
  }

  .indicator {
    white-space: nowrap;
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

  /* ── Skeleton loading ──────────────────────────────────────────── */
  .session-skeleton {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: var(--sp-2) var(--sp-3);
    min-height: 52px;
    justify-content: center;
  }

  .skeleton-title {
    height: 14px;
    width: 75%;
  }

  .session-skeleton-meta {
    display: flex;
    gap: var(--sp-2);
  }

  .skeleton-meta-item {
    height: 10px;
    width: 80px;
  }

  .skeleton-meta-time {
    height: 10px;
    width: 40px;
  }
</style>

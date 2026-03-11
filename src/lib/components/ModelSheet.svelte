<script lang="ts">
  import type { ModelInfo, ReasoningEffort } from '$lib/types/index.js';

  interface Props {
    open: boolean;
    models: Map<string, ModelInfo>;
    currentModel: string;
    reasoningEffort: ReasoningEffort | null;
    onSetModel: (model: string) => void;
    onSetReasoning: (effort: ReasoningEffort) => void;
    onClose: () => void;
  }

  const {
    open,
    models,
    currentModel,
    reasoningEffort,
    onSetModel,
    onSetReasoning,
    onClose,
  }: Props = $props();

  const reasoningLevels: { value: ReasoningEffort; label: string; desc: string; color: string }[] = [
    { value: 'low',    label: 'Low',  desc: 'Faster',   color: 'var(--blue)' },
    { value: 'medium', label: 'Med',  desc: 'Balanced', color: 'var(--yellow)' },
    { value: 'high',   label: 'High', desc: 'Thorough', color: 'var(--orange)' },
    { value: 'xhigh',  label: 'Max',  desc: 'Deepest',  color: 'var(--red)' },
  ];

  const selectedModelInfo = $derived(models.get(currentModel));
  const supportsReasoning = $derived(
    selectedModelInfo?.capabilities?.supports?.reasoningEffort === true,
  );

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }

  function selectModel(id: string) {
    onSetModel(id);
    const info = models.get(id);
    if (info?.capabilities?.supports?.reasoningEffort) {
      if (info.defaultReasoningEffort) {
        onSetReasoning(info.defaultReasoningEffort);
      }
    } else {
      onClose();
    }
  }

  function formatMultiplier(info: ModelInfo): string {
    const mult = info.billing?.multiplier;
    return mult != null ? `${mult}×` : '';
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div class="sheet-overlay" role="presentation" onclick={handleBackdropClick}>
    <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
    <div class="sheet-panel" role="presentation" onclick={(e: MouseEvent) => e.stopPropagation()}>
      <div class="sheet-header">
        <span class="sheet-title">Models</span>
        <button class="sheet-close" onclick={onClose}>✕</button>
      </div>

      <div class="sheet-body">
        <div class="reasoning-section" class:disabled={!supportsReasoning}>
          <span class="reasoning-label">Reasoning Effort</span>
          <div class="reasoning-toggle">
            {#each reasoningLevels as level (level.value)}
              <button
                class="reasoning-opt"
                class:active={supportsReasoning && reasoningEffort === level.value}
                disabled={!supportsReasoning}
                style="--level-color: {level.color}"
                onclick={() => onSetReasoning(level.value)}
              >
                <span class="reasoning-opt-label">{level.label}</span>
              </button>
            {/each}
          </div>
        </div>

        <div class="model-list">
          {#if models.size === 0}
            {#each Array(6) as _, i (i)}
              <div class="model-skeleton">
                <div class="skeleton skeleton-name"></div>
                {#if i % 2 === 0}
                  <div class="skeleton skeleton-badge"></div>
                {/if}
              </div>
            {/each}
          {:else}
            {#each [...models.values()] as info (info.id)}
              <button
                class="model-item"
                class:selected={currentModel === info.id}
                onclick={() => selectModel(info.id)}
              >
                <span class="model-item-name">
                  {info.id}
                  {#if info.capabilities?.supports?.reasoningEffort}
                    <span class="model-item-badge">reasoning</span>
                  {/if}
                </span>
                <span class="model-item-right">
                  {#if formatMultiplier(info)}
                    <span class="model-item-mult">{formatMultiplier(info)}</span>
                  {/if}
                  {#if currentModel === info.id}
                    <svg class="model-item-check" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M3 8.5 L6.5 12 L13 4"/>
                    </svg>
                  {/if}
                </span>
              </button>
            {/each}
          {/if}
        </div>
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

  /* ── Model list ────────────────────────────────────────────────── */
  .model-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .model-skeleton {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    padding: var(--sp-2) var(--sp-3);
    min-height: 44px;
  }

  .skeleton-name {
    height: 14px;
    width: 60%;
  }

  .skeleton-badge {
    height: 18px;
    width: 64px;
    border-radius: 100px;
    margin-left: auto;
  }

  .model-item {
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
    min-height: 44px;
    -webkit-tap-highlight-color: transparent;
  }

  .model-item:active {
    background: var(--border);
  }

  .model-item.selected {
    background: rgba(110, 64, 201, 0.12);
  }

  .model-item-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
  }

  .model-item-right {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    flex-shrink: 0;
    min-width: 48px;
    justify-content: flex-end;
  }

  .model-item-mult {
    color: var(--fg-dim);
    font-size: 0.85em;
    flex-shrink: 0;
    text-align: right;
  }

  .model-item-badge {
    font-size: 0.68em;
    color: var(--fg-dim);
    opacity: 0.5;
    flex-shrink: 0;
  }

  .model-item-check {
    color: var(--purple);
    flex-shrink: 0;
  }

  /* ── Reasoning section ─────────────────────────────────────────── */
  .reasoning-section {
    margin: var(--sp-4) 0;
    padding-bottom: var(--sp-4);
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
  }

  .reasoning-section.disabled {
    opacity: 0.4;
    pointer-events: none;
  }

  .reasoning-label {
    font-family: var(--font-mono);
    font-size: 0.75em;
    color: var(--fg-dim);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 600;
  }

  .reasoning-toggle {
    display: flex;
    align-items: center;
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
    font-size: 0.82em;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
    min-height: 36px;
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    -webkit-tap-highlight-color: transparent;
  }

  .reasoning-opt.active {
    background: color-mix(in srgb, var(--level-color) 18%, transparent);
    color: var(--level-color);
  }

  .reasoning-opt:active {
    transform: scale(0.96);
  }

  .reasoning-opt-label {
    font-weight: 500;
  }
</style>

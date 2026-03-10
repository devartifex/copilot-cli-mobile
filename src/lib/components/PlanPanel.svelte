<script lang="ts">
  import type { PlanState } from '$lib/types/index.js';
  import { renderMarkdown } from '$lib/utils/markdown.js';

  interface Props {
    plan: PlanState;
    onUpdatePlan: (content: string) => void;
    onDeletePlan: () => void;
  }

  const { plan, onUpdatePlan, onDeletePlan }: Props = $props();

  let collapsed = $state(false);
  let editing = $state(false);
  let editContent = $state('');
  let confirmingDelete = $state(false);

  const renderedContent = $derived(renderMarkdown(plan.content));

  function toggleCollapse(): void {
    collapsed = !collapsed;
  }

  function startEdit(): void {
    editContent = plan.content;
    editing = true;
    confirmingDelete = false;
  }

  function cancelEdit(): void {
    editing = false;
  }

  function saveEdit(): void {
    onUpdatePlan(editContent);
    editing = false;
  }

  function requestDelete(): void {
    if (confirmingDelete) {
      onDeletePlan();
      confirmingDelete = false;
    } else {
      confirmingDelete = true;
    }
  }

  function cancelDelete(): void {
    confirmingDelete = false;
  }
</script>

{#if plan.exists}
  <div class="plan-panel" class:collapsed>
    <div class="plan-header">
      <span class="plan-title">📋 Plan{plan.path ? `: ${plan.path}` : ''}</span>
      <div class="plan-actions">
        {#if !editing}
          <button class="action-btn" onclick={startEdit}>Edit</button>
          {#if confirmingDelete}
            <button class="action-btn danger" onclick={requestDelete}>Confirm</button>
            <button class="action-btn" onclick={cancelDelete}>Cancel</button>
          {:else}
            <button class="action-btn danger" onclick={requestDelete}>Delete</button>
          {/if}
        {/if}
        <button class="plan-collapse-btn" onclick={toggleCollapse} title={collapsed ? 'Expand' : 'Collapse'}>
          ▼
        </button>
      </div>
    </div>
    <div class="plan-body">
      {#if editing}
        <textarea
          class="plan-textarea"
          bind:value={editContent}
          rows="6"
        ></textarea>
        <div class="plan-edit-actions">
          <button class="action-btn" onclick={cancelEdit}>Cancel</button>
          <button class="action-btn" onclick={saveEdit}>Save</button>
        </div>
      {:else}
        <div class="plan-content">
          {@html renderedContent}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .plan-panel {
    border: 1px solid var(--border-accent);
    border-radius: var(--radius-sm);
    margin: var(--sp-1) 0;
    background: rgba(110, 64, 201, 0.04);
    overflow: hidden;
  }

  .plan-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sp-2) var(--sp-3);
    border-bottom: 1px solid var(--border);
  }

  .plan-title {
    font-size: 0.82em;
    color: var(--purple);
    font-weight: 600;
  }

  .plan-actions {
    display: flex;
    gap: var(--sp-1);
    align-items: center;
  }

  .plan-collapse-btn {
    background: none;
    border: none;
    color: var(--fg-dim);
    cursor: pointer;
    font-size: 0.75em;
    padding: var(--sp-1);
    transition: transform 0.2s ease;
  }

  .collapsed .plan-collapse-btn {
    transform: rotate(-90deg);
  }

  .collapsed .plan-body {
    display: none;
  }

  .plan-body {
    padding: var(--sp-2) var(--sp-3);
    max-height: 200px;
    overflow-y: auto;
  }

  .plan-content {
    font-size: 0.82em;
    color: var(--fg);
    line-height: 1.5;
  }

  .plan-content :global(p) {
    margin-bottom: var(--sp-1);
  }

  .plan-content :global(ul),
  .plan-content :global(ol) {
    padding-left: var(--sp-4);
    margin: var(--sp-1) 0;
  }

  .plan-content :global(li) {
    margin-bottom: 2px;
  }

  .plan-textarea {
    width: 100%;
    background: var(--bg);
    color: var(--fg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: var(--sp-2);
    font-family: var(--font-mono);
    font-size: 0.82em;
    line-height: 1.5;
    resize: vertical;
    min-height: 80px;
    outline: none;
  }

  .plan-textarea:focus {
    border-color: var(--purple);
  }

  .plan-edit-actions {
    display: flex;
    gap: var(--sp-1);
    margin-top: var(--sp-2);
    justify-content: flex-end;
  }

  .action-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: 100px;
    color: var(--fg-dim);
    padding: var(--sp-1) var(--sp-2);
    font-family: var(--font-mono);
    font-size: 0.75em;
    cursor: pointer;
    min-height: 22px;
  }

  .action-btn.danger {
    color: var(--red);
    border-color: var(--red);
  }
</style>

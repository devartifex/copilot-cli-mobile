<script lang="ts">
  import type { CustomToolDefinition } from '$lib/types/index.js';

  interface Props {
    tools: CustomToolDefinition[];
    onSave: (tools: CustomToolDefinition[]) => void;
  }

  const { tools, onSave }: Props = $props();

  const MAX_TOOLS = 10;
  const NAME_PATTERN = /^[a-zA-Z0-9_]{1,64}$/;

  let expandedIndex = $state<number | null>(null);
  let showAddForm = $state(false);
  let deleteConfirmIndex = $state<number | null>(null);

  // ── Draft state for add/edit forms ────────────────────────────────────
  let draftName = $state('');
  let draftDescription = $state('');
  let draftMethod = $state<'GET' | 'POST'>('POST');
  let draftUrl = $state('');
  let draftHeaders = $state<Array<{ key: string; value: string }>>([]);
  let draftParams = $state<Array<{ name: string; type: string; description: string }>>([]);
  let formError = $state('');

  const canAddMore = $derived(tools.length < MAX_TOOLS);

  function resetDraft(): void {
    draftName = '';
    draftDescription = '';
    draftMethod = 'POST';
    draftUrl = '';
    draftHeaders = [];
    draftParams = [];
    formError = '';
  }

  function loadToolIntoDraft(tool: CustomToolDefinition): void {
    draftName = tool.name;
    draftDescription = tool.description;
    draftMethod = tool.method;
    draftUrl = tool.webhookUrl;
    draftHeaders = Object.entries(tool.headers).map(([key, value]) => ({ key, value }));
    draftParams = Object.entries(tool.parameters).map(([name, p]) => ({
      name,
      type: p.type,
      description: p.description,
    }));
    formError = '';
  }

  function validateUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
      return isLocalhost ? true : parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function validateDraft(): string | null {
    if (!NAME_PATTERN.test(draftName)) {
      return 'Name must be alphanumeric/underscore, max 64 chars';
    }
    if (!draftDescription.trim()) {
      return 'Description is required';
    }
    if (!draftUrl.trim()) {
      return 'Webhook URL is required';
    }
    if (!validateUrl(draftUrl)) {
      return 'URL must be https:// (or http://localhost for dev)';
    }
    return null;
  }

  function buildToolFromDraft(): CustomToolDefinition {
    const headers: Record<string, string> = {};
    for (const h of draftHeaders) {
      if (h.key.trim()) headers[h.key.trim()] = h.value;
    }
    const parameters: Record<string, { type: string; description: string }> = {};
    for (const p of draftParams) {
      if (p.name.trim()) {
        parameters[p.name.trim()] = { type: p.type || 'string', description: p.description };
      }
    }
    return {
      name: draftName.trim(),
      description: draftDescription.trim(),
      webhookUrl: draftUrl.trim(),
      method: draftMethod,
      headers,
      parameters,
    };
  }

  function handleAddTool(): void {
    showAddForm = true;
    expandedIndex = null;
    resetDraft();
  }

  function handleSaveNew(): void {
    const error = validateDraft();
    if (error) { formError = error; return; }

    // Check duplicate name
    if (tools.some((t) => t.name === draftName.trim())) {
      formError = 'A tool with this name already exists';
      return;
    }

    const newTool = buildToolFromDraft();
    onSave([...tools, newTool]);
    showAddForm = false;
    resetDraft();
  }

  function handleSaveEdit(index: number): void {
    const error = validateDraft();
    if (error) { formError = error; return; }

    // Check duplicate name (excluding current)
    if (tools.some((t, i) => i !== index && t.name === draftName.trim())) {
      formError = 'A tool with this name already exists';
      return;
    }

    const updated = [...tools];
    updated[index] = buildToolFromDraft();
    onSave(updated);
    expandedIndex = null;
    resetDraft();
  }

  function handleExpandTool(index: number): void {
    if (expandedIndex === index) {
      expandedIndex = null;
      return;
    }
    showAddForm = false;
    expandedIndex = index;
    loadToolIntoDraft(tools[index]);
  }

  function handleDeleteTool(index: number): void {
    const updated = tools.filter((_, i) => i !== index);
    onSave(updated);
    deleteConfirmIndex = null;
    expandedIndex = null;
  }

  function handleAddHeader(): void {
    draftHeaders = [...draftHeaders, { key: '', value: '' }];
  }

  function handleRemoveHeader(index: number): void {
    draftHeaders = draftHeaders.filter((_, i) => i !== index);
  }

  function handleAddParam(): void {
    draftParams = [...draftParams, { name: '', type: 'string', description: '' }];
  }

  function handleRemoveParam(index: number): void {
    draftParams = draftParams.filter((_, i) => i !== index);
  }

  function handleCancelAdd(): void {
    showAddForm = false;
    resetDraft();
  }
</script>

<div class="custom-tools">
  {#each tools as tool, index (tool.name)}
    <div class="custom-tool-item">
      <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
      <div class="custom-tool-header" role="button" tabindex="0" onclick={() => handleExpandTool(index)} onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') handleExpandTool(index); }}>
        <div>
          <div class="custom-tool-name">{tool.name}</div>
          <div class="custom-tool-url">{tool.method} {tool.webhookUrl}</div>
        </div>
        <span class="accordion-chevron" class:expanded={expandedIndex === index}>▸</span>
      </div>

      {#if expandedIndex === index}
        <div class="custom-tool-form">
          <span class="custom-tool-label">Name</span>
          <input class="custom-tool-input" bind:value={draftName} placeholder="my_tool" maxlength="64" />

          <span class="custom-tool-label">Description</span>
          <input class="custom-tool-input" bind:value={draftDescription} placeholder="What this tool does" />

          <span class="custom-tool-label">Method</span>
          <select class="custom-tool-input" bind:value={draftMethod}>
            <option value="GET">GET</option>
            <option value="POST">POST</option>
          </select>

          <span class="custom-tool-label">Webhook URL</span>
          <input class="custom-tool-input" bind:value={draftUrl} placeholder="https://example.com/api" />

          <span class="custom-tool-label">Headers</span>
          {#each draftHeaders as header, hi (hi)}
            <div class="kv-row">
              <input class="custom-tool-input kv-key" bind:value={header.key} placeholder="Key" />
              <input class="custom-tool-input kv-value" bind:value={header.value} placeholder="Value" />
              <button class="remove-btn" onclick={() => handleRemoveHeader(hi)}>✕</button>
            </div>
          {/each}
          <button class="add-kv-btn" onclick={handleAddHeader}>+ Header</button>

          <span class="custom-tool-label">Parameters</span>
          {#each draftParams as param, pi (pi)}
            <div class="param-row">
              <input class="custom-tool-input param-name" bind:value={param.name} placeholder="Name" />
              <select class="custom-tool-input param-type" bind:value={param.type}>
                <option value="string">string</option>
                <option value="number">number</option>
                <option value="boolean">boolean</option>
              </select>
              <input class="custom-tool-input param-desc" bind:value={param.description} placeholder="Description" />
              <button class="remove-btn" onclick={() => handleRemoveParam(pi)}>✕</button>
            </div>
          {/each}
          <button class="add-kv-btn" onclick={handleAddParam}>+ Parameter</button>

          {#if formError}
            <div class="form-error">{formError}</div>
          {/if}

          <div class="form-actions">
            <button class="action-btn save" onclick={() => handleSaveEdit(index)}>Save</button>
            {#if deleteConfirmIndex === index}
              <button class="action-btn delete-confirm" onclick={() => handleDeleteTool(index)}>Confirm Delete</button>
              <button class="action-btn" onclick={() => deleteConfirmIndex = null}>Cancel</button>
            {:else}
              <button class="action-btn delete" onclick={() => deleteConfirmIndex = index}>Delete</button>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  {/each}

  {#if showAddForm}
    <div class="custom-tool-item">
      <div class="custom-tool-form" style="border-top: none;">
        <span class="custom-tool-label">Name</span>
        <input class="custom-tool-input" bind:value={draftName} placeholder="my_tool" maxlength="64" />

        <span class="custom-tool-label">Description</span>
        <input class="custom-tool-input" bind:value={draftDescription} placeholder="What this tool does" />

        <span class="custom-tool-label">Method</span>
        <select class="custom-tool-input" bind:value={draftMethod}>
          <option value="GET">GET</option>
          <option value="POST">POST</option>
        </select>

        <span class="custom-tool-label">Webhook URL</span>
        <input class="custom-tool-input" bind:value={draftUrl} placeholder="https://example.com/api" />

        <span class="custom-tool-label">Headers</span>
        {#each draftHeaders as header, hi (hi)}
          <div class="kv-row">
            <input class="custom-tool-input kv-key" bind:value={header.key} placeholder="Key" />
            <input class="custom-tool-input kv-value" bind:value={header.value} placeholder="Value" />
            <button class="remove-btn" onclick={() => handleRemoveHeader(hi)}>✕</button>
          </div>
        {/each}
        <button class="add-kv-btn" onclick={handleAddHeader}>+ Header</button>

        <span class="custom-tool-label">Parameters</span>
        {#each draftParams as param, pi (pi)}
          <div class="param-row">
            <input class="custom-tool-input param-name" bind:value={param.name} placeholder="Name" />
            <select class="custom-tool-input param-type" bind:value={param.type}>
              <option value="string">string</option>
              <option value="number">number</option>
              <option value="boolean">boolean</option>
            </select>
            <input class="custom-tool-input param-desc" bind:value={param.description} placeholder="Description" />
            <button class="remove-btn" onclick={() => handleRemoveParam(pi)}>✕</button>
          </div>
        {/each}
        <button class="add-kv-btn" onclick={handleAddParam}>+ Parameter</button>

        {#if formError}
          <div class="form-error">{formError}</div>
        {/if}

        <div class="form-actions">
          <button class="action-btn save" onclick={handleSaveNew}>Save</button>
          <button class="action-btn" onclick={handleCancelAdd}>Cancel</button>
        </div>
      </div>
    </div>
  {/if}

  {#if canAddMore && !showAddForm}
    <button class="add-tool-btn" onclick={handleAddTool}>+ Add Tool</button>
  {/if}

  {#if !canAddMore && !showAddForm}
    <div class="form-error" style="text-align: center; margin-top: var(--sp-2);">
      Maximum of {MAX_TOOLS} tools reached
    </div>
  {/if}
</div>

<style>
  .custom-tools {
    padding: var(--sp-2) 0;
  }
  .custom-tool-item {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    margin-bottom: var(--sp-2);
    overflow: hidden;
  }
  .custom-tool-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sp-2) var(--sp-3);
    cursor: pointer;
    background: var(--bg-overlay);
  }
  .custom-tool-name {
    font-size: 0.85em;
    color: var(--fg);
    font-weight: 500;
  }
  .custom-tool-url {
    font-size: 0.72em;
    color: var(--fg-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .custom-tool-form {
    padding: var(--sp-3);
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
  }
  .custom-tool-input {
    width: 100%;
    background: var(--bg);
    color: var(--fg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: var(--sp-1) var(--sp-2);
    font-family: var(--font-mono);
    font-size: 0.82em;
    outline: none;
  }
  .custom-tool-input:focus {
    border-color: var(--purple);
  }
  .custom-tool-label {
    font-size: 0.75em;
    color: var(--fg-dim);
    text-transform: uppercase;
  }
  .add-tool-btn {
    background: none;
    border: 1px dashed var(--border);
    border-radius: var(--radius-sm);
    color: var(--fg-muted);
    padding: var(--sp-2);
    font-family: var(--font-mono);
    font-size: 0.85em;
    cursor: pointer;
    width: 100%;
    text-align: center;
  }
  .add-tool-btn:active {
    background: var(--bg-overlay);
  }

  .accordion-chevron {
    color: var(--fg-dim);
    font-size: 0.8em;
    transition: transform 0.2s ease;
    flex-shrink: 0;
  }
  .accordion-chevron.expanded {
    transform: rotate(90deg);
  }

  .kv-row,
  .param-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-1);
    align-items: center;
  }
  .kv-key {
    flex: 1;
    min-width: 80px;
  }
  .kv-value {
    flex: 2;
    min-width: 100px;
  }
  .param-name {
    flex: 1;
    min-width: 70px;
  }
  .param-type {
    flex: 0 0 auto;
    width: 80px;
  }
  .param-desc {
    flex: 2;
    min-width: 100px;
  }
  .remove-btn {
    background: none;
    border: none;
    color: var(--fg-dim);
    cursor: pointer;
    font-size: 0.85em;
    padding: var(--sp-1);
    flex-shrink: 0;
  }
  .remove-btn:hover {
    color: var(--red);
  }
  .add-kv-btn {
    background: none;
    border: none;
    color: var(--fg-muted);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 0.75em;
    text-align: left;
    padding: var(--sp-1) 0;
  }
  .add-kv-btn:hover {
    color: var(--purple);
  }

  .form-error {
    font-size: 0.75em;
    color: var(--red);
    font-family: var(--font-mono);
  }

  .form-actions {
    display: flex;
    gap: var(--sp-2);
    justify-content: flex-end;
    margin-top: var(--sp-1);
  }
  .action-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: 100px;
    color: var(--fg-dim);
    padding: var(--sp-1) var(--sp-2);
    font-family: var(--font-mono);
    font-size: 0.82em;
    cursor: pointer;
    white-space: nowrap;
  }
  .action-btn.save {
    color: var(--purple);
    border-color: var(--purple-dim);
  }
  .action-btn.delete {
    color: var(--red);
    border-color: rgba(248, 81, 73, 0.3);
  }
  .action-btn.delete-confirm {
    color: var(--red);
    border-color: var(--red);
    font-weight: 600;
  }
</style>

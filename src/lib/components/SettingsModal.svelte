<script lang="ts">
  import type {
    ToolInfo,
    AgentInfo,
    QuotaSnapshots,
    QuotaSnapshot,
    CustomToolDefinition,
    McpServerDefinition,
    SkillDefinition,
  } from '$lib/types/index.js';
  import { pickPrimaryQuota } from '$lib/types/index.js';
  import CustomToolsEditor from './CustomToolsEditor.svelte';

  interface Props {
    open: boolean;
    tools: ToolInfo[];
    agents: (AgentInfo | string)[];
    currentAgent: string | null;
    quotaSnapshots: QuotaSnapshots | null;
    customInstructions: string;
    excludedTools: string[];
    customTools: CustomToolDefinition[];
    mcpServers: McpServerDefinition[];
    availableSkills: SkillDefinition[];
    disabledSkills: string[];
    onClose: () => void;
    onSaveInstructions: (instructions: string) => void;
    onToggleTool: (toolName: string, enabled: boolean) => void;
    onSaveCustomTools: (tools: CustomToolDefinition[]) => void;
    onSaveMcpServers: (servers: McpServerDefinition[]) => void;
    onToggleSkill: (skillName: string, enabled: boolean) => void;
    onSelectAgent: (name: string) => void;
    onDeselectAgent: () => void;
    onCompact: () => void;
    onFetchTools: () => void;
    onFetchAgents: () => void;
    onFetchQuota: () => void;
    onFetchSkills: () => void;
  }

  const {
    open,
    tools,
    agents,
    currentAgent,
    quotaSnapshots,
    customInstructions,
    excludedTools,
    customTools,
    mcpServers,
    availableSkills,
    disabledSkills,
    onClose,
    onSaveInstructions,
    onToggleTool,
    onSaveCustomTools,
    onSaveMcpServers,
    onToggleSkill,
    onSelectAgent,
    onDeselectAgent,
    onCompact,
    onFetchTools,
    onFetchAgents,
    onFetchQuota,
    onFetchSkills,
  }: Props = $props();

  type AccordionSection = 'instructions' | 'tools' | 'mcp' | 'custom-tools' | 'agents' | 'skills' | 'quota' | 'compact' | null;

  let activeSection = $state<AccordionSection>(null);
  let instructionsDraft = $state('');

  // ── MCP server editor state ─────────────────────────────────────────
  const MAX_MCP_SERVERS = 10;
  let mcpShowAddForm = $state(false);
  let mcpExpandedIndex = $state<number | null>(null);
  let mcpDeleteConfirmIndex = $state<number | null>(null);
  let mcpDraftName = $state('');
  let mcpDraftUrl = $state('');
  let mcpDraftType = $state<'http' | 'sse'>('http');
  let mcpDraftHeaders = $state<Array<{ key: string; value: string }>>([]);
  let mcpDraftTools = $state('');
  let mcpDraftEnabled = $state(true);
  let mcpFormError = $state('');

  const canAddMoreMcp = $derived(mcpServers.length < MAX_MCP_SERVERS);

  function mcpResetDraft(): void {
    mcpDraftName = '';
    mcpDraftUrl = '';
    mcpDraftType = 'http';
    mcpDraftHeaders = [];
    mcpDraftTools = '';
    mcpDraftEnabled = true;
    mcpFormError = '';
  }

  function mcpLoadIntoDraft(server: McpServerDefinition): void {
    mcpDraftName = server.name;
    mcpDraftUrl = server.url;
    mcpDraftType = server.type;
    mcpDraftHeaders = Object.entries(server.headers).map(([key, value]) => ({ key, value }));
    mcpDraftTools = server.tools.length > 0 ? server.tools.join(', ') : '';
    mcpDraftEnabled = server.enabled;
    mcpFormError = '';
  }

  function mcpValidateUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function mcpValidateDraft(): string | null {
    if (!mcpDraftName.trim()) return 'Name is required';
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(mcpDraftName.trim())) return 'Name must be alphanumeric/underscore/dash, max 64 chars';
    if (!mcpDraftUrl.trim()) return 'URL is required';
    if (!mcpValidateUrl(mcpDraftUrl)) return 'URL must be https://';
    return null;
  }

  function mcpBuildFromDraft(): McpServerDefinition {
    const headers: Record<string, string> = {};
    for (const h of mcpDraftHeaders) {
      if (h.key.trim()) headers[h.key.trim()] = h.value;
    }
    const tools = mcpDraftTools.trim()
      ? mcpDraftTools.split(',').map(t => t.trim()).filter(Boolean)
      : [];
    return {
      name: mcpDraftName.trim(),
      url: mcpDraftUrl.trim(),
      type: mcpDraftType,
      headers,
      tools,
      enabled: mcpDraftEnabled,
    };
  }

  function mcpHandleAdd(): void {
    const err = mcpValidateDraft();
    if (err) { mcpFormError = err; return; }
    const server = mcpBuildFromDraft();
    if (mcpServers.some(s => s.name === server.name)) {
      mcpFormError = 'A server with this name already exists';
      return;
    }
    onSaveMcpServers([...mcpServers, server]);
    mcpResetDraft();
    mcpShowAddForm = false;
  }

  function mcpHandleUpdate(index: number): void {
    const err = mcpValidateDraft();
    if (err) { mcpFormError = err; return; }
    const server = mcpBuildFromDraft();
    const existing = mcpServers.findIndex((s, i) => s.name === server.name && i !== index);
    if (existing >= 0) { mcpFormError = 'A server with this name already exists'; return; }
    const updated = [...mcpServers];
    updated[index] = server;
    onSaveMcpServers(updated);
    mcpExpandedIndex = null;
    mcpResetDraft();
  }

  function mcpHandleDelete(index: number): void {
    const updated = mcpServers.filter((_, i) => i !== index);
    onSaveMcpServers(updated);
    mcpDeleteConfirmIndex = null;
    mcpExpandedIndex = null;
  }

  function mcpToggleEnabled(index: number): void {
    const updated = [...mcpServers];
    updated[index] = { ...updated[index], enabled: !updated[index].enabled };
    onSaveMcpServers(updated);
  }

  // Sync draft when prop changes (including initial value)
  $effect(() => {
    instructionsDraft = customInstructions;
  });

  const groupedTools = $derived.by(() => {
    const groups = new Map<string, ToolInfo[]>();
    for (const tool of tools) {
      const server = tool.mcpServerName ?? 'built-in';
      const list = groups.get(server) ?? [];
      list.push(tool);
      groups.set(server, list);
    }
    return groups;
  });

  const primaryQuota = $derived(pickPrimaryQuota(quotaSnapshots));

  const quotaPercentUsed = $derived(
    primaryQuota?.snapshot?.percentageUsed ?? 0,
  );

  const quotaBarColor = $derived(
    quotaPercentUsed > 90 ? 'red' : quotaPercentUsed > 70 ? 'yellow' : 'green',
  );

  function toggleSection(section: AccordionSection) {
    if (activeSection === section) {
      activeSection = null;
      return;
    }
    activeSection = section;

    if (section === 'tools') onFetchTools();
    if (section === 'agents') onFetchAgents();
    if (section === 'quota') onFetchQuota();
    if (section === 'skills') onFetchSkills();
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }

  function handleSaveInstructions() {
    onSaveInstructions(instructionsDraft);
  }

  function isToolEnabled(toolName: string): boolean {
    return !excludedTools.includes(toolName);
  }

  function handleToolToggle(toolName: string, e: Event) {
    const target = e.target as HTMLInputElement;
    onToggleTool(toolName, target.checked);
  }

  function getAgentName(agent: AgentInfo | string): string {
    return typeof agent === 'string' ? agent : agent.name;
  }

  function getAgentDescription(agent: AgentInfo | string): string | undefined {
    return typeof agent === 'string' ? undefined : agent.description;
  }

  function handleAgentClick(name: string) {
    if (currentAgent === name) {
      onDeselectAgent();
    } else {
      onSelectAgent(name);
    }
  }

  function formatResetDate(dateStr: string | undefined): string {
    if (!dateStr) return '';
    try {
      return new Date(dateStr).toLocaleDateString();
    } catch {
      return dateStr;
    }
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div class="settings-overlay" role="presentation" onclick={handleBackdropClick}>
    <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
    <div class="settings-panel" role="presentation" onclick={(e: MouseEvent) => e.stopPropagation()}>
      <div class="settings-header">
        <span class="settings-title">Settings</span>
        <button class="settings-close" onclick={onClose}>✕</button>
      </div>

      <div class="settings-body">
        <!-- Custom Instructions -->
        <div class="settings-accordion">
          <button
            class="settings-accordion-btn"
            class:open={activeSection === 'instructions'}
            onclick={() => toggleSection('instructions')}
          >
            Custom Instructions
            <span class="accordion-chevron">▸</span>
          </button>
          {#if activeSection === 'instructions'}
            <div class="settings-accordion-body">
              <p class="settings-hint">
                Add instructions that Copilot should follow in every response.
              </p>
              <textarea
                class="settings-textarea"
                bind:value={instructionsDraft}
                placeholder="e.g. Always respond in TypeScript..."
                rows="4"
              ></textarea>
              <div style="margin-top: var(--sp-2); display: flex; justify-content: flex-end;">
                <button class="action-btn save" onclick={handleSaveInstructions}>Save</button>
              </div>
            </div>
          {/if}
        </div>

        <!-- Tools -->
        <div class="settings-accordion">
          <button
            class="settings-accordion-btn"
            class:open={activeSection === 'tools'}
            onclick={() => toggleSection('tools')}
          >
            Tools
            <span class="accordion-chevron">▸</span>
          </button>
          {#if activeSection === 'tools'}
            <div class="settings-accordion-body">
              {#if tools.length === 0}
                <p class="settings-hint">No tools available.</p>
              {:else}
                {#each [...groupedTools.entries()] as [server, serverTools] (server)}
                  <div class="tools-group">
                    <div class="tools-group-header">{server}</div>
                    {#each serverTools as tool (tool.namespacedName ?? tool.name)}
                      <div class="tool-item">
                        <label class="tool-toggle-label">
                          <input
                            type="checkbox"
                            class="tool-toggle-check"
                            checked={isToolEnabled(tool.namespacedName ?? tool.name)}
                            onchange={(e: Event) => handleToolToggle(tool.namespacedName ?? tool.name, e)}
                          />
                          <span class="tool-toggle-name">{tool.name}</span>
                        </label>
                        {#if tool.description}
                          <div class="tool-toggle-desc">{tool.description}</div>
                        {/if}
                      </div>
                    {/each}
                  </div>
                {/each}
              {/if}
            </div>
          {/if}
        </div>

        <!-- MCP Servers -->
        <div class="settings-accordion">
          <button
            class="settings-accordion-btn"
            class:open={activeSection === 'mcp'}
            onclick={() => toggleSection('mcp')}
          >
            MCP Servers
            <span class="accordion-chevron">▸</span>
          </button>
          {#if activeSection === 'mcp'}
            <div class="settings-accordion-body">
              <!-- Built-in GitHub server (non-removable) -->
              <div class="mcp-server-item">
                <div class="mcp-server-header">
                  <span class="mcp-server-name">GitHub</span>
                  <span class="mcp-server-badge">built-in</span>
                </div>
                <div class="tool-toggle-desc">api.githubcopilot.com — always active with full access</div>
              </div>

              <!-- User-defined servers -->
              {#each mcpServers as server, i (server.name)}
                <div class="mcp-server-item">
                  <div class="mcp-server-header">
                    <label class="tool-toggle-label" style="flex:1">
                      <input
                        type="checkbox"
                        class="tool-toggle-check"
                        checked={server.enabled}
                        onchange={() => mcpToggleEnabled(i)}
                      />
                      <span class="mcp-server-name">{server.name}</span>
                    </label>
                    <span class="mcp-server-badge">{server.type}</span>
                    <button class="mcp-edit-btn" onclick={() => {
                      if (mcpExpandedIndex === i) {
                        mcpExpandedIndex = null;
                      } else {
                        mcpLoadIntoDraft(server);
                        mcpExpandedIndex = i;
                        mcpShowAddForm = false;
                      }
                    }}>✎</button>
                  </div>
                  <div class="tool-toggle-desc">{server.url}</div>

                  {#if mcpExpandedIndex === i}
                    <div class="mcp-form">
                      {#if mcpFormError}
                        <div class="mcp-form-error">{mcpFormError}</div>
                      {/if}
                      <input class="mcp-input" bind:value={mcpDraftName} placeholder="Name" />
                      <input class="mcp-input" bind:value={mcpDraftUrl} placeholder="https://..." />
                      <select class="mcp-input" bind:value={mcpDraftType}>
                        <option value="http">HTTP (Streamable)</option>
                        <option value="sse">SSE</option>
                      </select>
                      <input class="mcp-input" bind:value={mcpDraftTools} placeholder="Tools filter (comma-separated, empty = all)" />

                      <div class="mcp-headers-label">Headers</div>
                      {#each mcpDraftHeaders as header, hi (hi)}
                        <div class="mcp-header-row">
                          <input class="mcp-input mcp-input-half" bind:value={header.key} placeholder="Key" />
                          <input class="mcp-input mcp-input-half" bind:value={header.value} placeholder="Value" />
                          <button class="mcp-remove-btn" onclick={() => { mcpDraftHeaders = mcpDraftHeaders.filter((_, idx) => idx !== hi); }}>✕</button>
                        </div>
                      {/each}
                      <button class="mcp-link-btn" onclick={() => { mcpDraftHeaders = [...mcpDraftHeaders, { key: '', value: '' }]; }}>+ Add header</button>

                      <div class="mcp-form-actions">
                        <button class="action-btn save" onclick={() => mcpHandleUpdate(i)}>Save</button>
                        {#if mcpDeleteConfirmIndex === i}
                          <button class="action-btn delete" onclick={() => mcpHandleDelete(i)}>Confirm delete</button>
                        {:else}
                          <button class="action-btn delete" onclick={() => { mcpDeleteConfirmIndex = i; }}>Delete</button>
                        {/if}
                        <button class="action-btn" onclick={() => { mcpExpandedIndex = null; mcpResetDraft(); }}>Cancel</button>
                      </div>
                    </div>
                  {/if}
                </div>
              {/each}

              <!-- Add new server form -->
              {#if mcpShowAddForm}
                <div class="mcp-form">
                  {#if mcpFormError}
                    <div class="mcp-form-error">{mcpFormError}</div>
                  {/if}
                  <input class="mcp-input" bind:value={mcpDraftName} placeholder="Name (e.g. my-server)" />
                  <input class="mcp-input" bind:value={mcpDraftUrl} placeholder="https://..." />
                  <select class="mcp-input" bind:value={mcpDraftType}>
                    <option value="http">HTTP (Streamable)</option>
                    <option value="sse">SSE</option>
                  </select>
                  <input class="mcp-input" bind:value={mcpDraftTools} placeholder="Tools filter (comma-separated, empty = all)" />

                  <div class="mcp-headers-label">Headers</div>
                  {#each mcpDraftHeaders as header, hi (hi)}
                    <div class="mcp-header-row">
                      <input class="mcp-input mcp-input-half" bind:value={header.key} placeholder="Key" />
                      <input class="mcp-input mcp-input-half" bind:value={header.value} placeholder="Value" />
                      <button class="mcp-remove-btn" onclick={() => { mcpDraftHeaders = mcpDraftHeaders.filter((_, idx) => idx !== hi); }}>✕</button>
                    </div>
                  {/each}
                  <button class="mcp-link-btn" onclick={() => { mcpDraftHeaders = [...mcpDraftHeaders, { key: '', value: '' }]; }}>+ Add header</button>

                  <div class="mcp-form-actions">
                    <button class="action-btn save" onclick={mcpHandleAdd}>Add Server</button>
                    <button class="action-btn" onclick={() => { mcpShowAddForm = false; mcpResetDraft(); }}>Cancel</button>
                  </div>
                </div>
              {:else if canAddMoreMcp}
                <button class="mcp-link-btn" style="margin-top: var(--sp-2)" onclick={() => { mcpResetDraft(); mcpShowAddForm = true; mcpExpandedIndex = null; }}>+ Add MCP server</button>
              {/if}
            </div>
          {/if}
        </div>

        <!-- Agents -->
        <div class="settings-accordion">
          <button
            class="settings-accordion-btn"
            class:open={activeSection === 'agents'}
            onclick={() => toggleSection('agents')}
          >
            Agents
            <span class="accordion-chevron">▸</span>
          </button>
          {#if activeSection === 'agents'}
            <div class="settings-accordion-body">
              {#if agents.length === 0}
                <p class="settings-hint">No agents available.</p>
              {:else}
                {#each agents as agent (getAgentName(agent))}
                  {@const name = getAgentName(agent)}
                  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
                  <div
                    class="agent-item"
                    class:active={currentAgent === name}
                    role="button"
                    tabindex="0"
                    onclick={() => handleAgentClick(name)}
                    onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') handleAgentClick(name); }}
                  >
                    <span class="agent-name">{name}</span>
                    {#if getAgentDescription(agent)}
                      <span class="agent-desc">{getAgentDescription(agent)}</span>
                    {/if}
                    {#if currentAgent === name}
                      <span class="agent-current">active</span>
                    {/if}
                  </div>
                {/each}
              {/if}
            </div>
          {/if}
        </div>

        <!-- Custom Tools -->
        <div class="settings-accordion">
          <button
            class="settings-accordion-btn"
            class:open={activeSection === 'custom-tools'}
            onclick={() => toggleSection('custom-tools')}
          >
            Custom Tools
            <span class="accordion-chevron">▸</span>
          </button>
          {#if activeSection === 'custom-tools'}
            <div class="settings-accordion-body">
              <p class="settings-hint">
                Define webhook-based tools that Copilot can invoke during conversations.
              </p>
              <CustomToolsEditor tools={customTools} onSave={onSaveCustomTools} />
            </div>
          {/if}
        </div>

        <!-- Skills -->
        <div class="settings-accordion">
          <button
            class="settings-accordion-btn"
            class:open={activeSection === 'skills'}
            onclick={() => toggleSection('skills')}
          >
            Skills
            <span class="accordion-chevron">▸</span>
          </button>
          {#if activeSection === 'skills'}
            <div class="settings-accordion-body">
              <p class="settings-hint">
                Skills are reusable prompt modules (SKILL.md) that inject specialized instructions into the session context.
              </p>
              {#if availableSkills.length === 0}
                <p class="settings-hint">No skills available.</p>
              {:else}
                {#each availableSkills as skill (skill.name)}
                  {@const isEnabled = !disabledSkills.includes(skill.name)}
                  <div class="skill-item">
                    <label class="skill-toggle">
                      <input
                        type="checkbox"
                        checked={isEnabled}
                        onchange={() => onToggleSkill(skill.name, !isEnabled)}
                      />
                      <span class="skill-name">{skill.name}</span>
                    </label>
                    {#if skill.description}
                      <p class="skill-desc">{skill.description}</p>
                    {/if}
                    {#if skill.license}
                      <span class="skill-meta">{skill.license}</span>
                    {/if}
                  </div>
                {/each}
              {/if}
            </div>
          {/if}
        </div>

        <!-- Quota -->
        <div class="settings-accordion">
          <button
            class="settings-accordion-btn"
            class:open={activeSection === 'quota'}
            onclick={() => toggleSection('quota')}
          >
            Quota
            <span class="accordion-chevron">▸</span>
          </button>
          {#if activeSection === 'quota'}
            <div class="settings-accordion-body">
              {#if primaryQuota}
                <div class="quota-label">{primaryQuota.label}</div>
                {#if primaryQuota.snapshot.isUnlimitedEntitlement}
                  <div class="quota-text">
                    Unlimited
                    {#if primaryQuota.snapshot.usedRequests != null}
                      · {primaryQuota.snapshot.usedRequests} requests used
                    {/if}
                    {#if primaryQuota.snapshot.resetDate}
                      · Resets {formatResetDate(primaryQuota.snapshot.resetDate)}
                    {/if}
                  </div>
                {:else}
                  <div class="quota-bar-container">
                    <div
                      class="quota-bar {quotaBarColor}"
                      style="width: {Math.min(quotaPercentUsed, 100)}%"
                    ></div>
                  </div>
                  <div class="quota-text">
                    {#if primaryQuota.snapshot.usedRequests != null && primaryQuota.snapshot.entitlementRequests != null}
                      {primaryQuota.snapshot.usedRequests} / {primaryQuota.snapshot.entitlementRequests} requests used
                    {:else}
                      {quotaPercentUsed.toFixed(1)}% used
                    {/if}
                    {#if primaryQuota.snapshot.resetDate}
                      · Resets {formatResetDate(primaryQuota.snapshot.resetDate)}
                    {/if}
                  </div>
                  {#if primaryQuota.snapshot.overage != null && primaryQuota.snapshot.overage > 0}
                    <div class="quota-text" style="color: var(--red); margin-top: var(--sp-1);">
                      ⚠ {primaryQuota.snapshot.overage} overage requests
                    </div>
                  {/if}
                {/if}
              {:else}
                <p class="settings-hint">No quota information available.</p>
              {/if}
            </div>
          {/if}
        </div>

        <!-- Compaction -->
        <div class="settings-accordion">
          <button
            class="settings-accordion-btn"
            class:open={activeSection === 'compact'}
            onclick={() => toggleSection('compact')}
          >
            Compaction
            <span class="accordion-chevron">▸</span>
          </button>
          {#if activeSection === 'compact'}
            <div class="settings-accordion-body">
              <p class="settings-hint">
                Compact the conversation to reduce context size while preserving key information.
              </p>
              <button class="action-btn" onclick={onCompact}>Compact Now</button>
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .settings-overlay {
    position: fixed;
    inset: 0;
    background: var(--bg);
    z-index: 100;
    display: flex;
    flex-direction: column;
    animation: fadeIn 0.15s ease;
  }
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  .settings-panel {
    background: var(--bg);
    width: 100%;
    max-width: 600px;
    margin: 0 auto;
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .settings-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sp-3) var(--sp-4);
    padding-top: calc(var(--sp-3) + var(--safe-top));
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .settings-title {
    font-family: var(--font-mono);
    font-size: 0.9em;
    color: var(--fg);
    font-weight: 600;
  }
  .settings-close {
    background: none;
    border: none;
    color: var(--fg-dim);
    font-size: 1.1em;
    cursor: pointer;
    padding: var(--sp-1);
  }
  .settings-body {
    padding: var(--sp-4);
    padding-bottom: calc(var(--sp-4) + var(--safe-bottom));
    overflow-y: auto;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    min-height: 0;
  }

  /* Accordion */
  .settings-accordion {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .settings-accordion-btn {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--bg-overlay);
    border: none;
    color: var(--fg);
    padding: var(--sp-3);
    font-family: var(--font-mono);
    font-size: 0.85em;
    cursor: pointer;
  }
  .settings-accordion-btn:active {
    background: var(--border);
  }
  .accordion-chevron {
    color: var(--fg-dim);
    font-size: 0.8em;
    transition: transform 0.2s ease;
  }
  .settings-accordion-btn.open .accordion-chevron {
    transform: rotate(90deg);
  }
  .settings-accordion-body {
    padding: var(--sp-3);
    border-top: 1px solid var(--border);
    max-height: 250px;
    overflow-y: auto;
  }

  /* Tools */
  .tools-group {
    margin-bottom: var(--sp-3);
  }
  .tools-group-header {
    font-size: 0.75em;
    color: var(--purple);
    font-weight: 600;
    margin-bottom: var(--sp-1);
    text-transform: uppercase;
  }
  .tool-item {
    padding: var(--sp-1) 0;
    border-bottom: 1px solid rgba(48, 54, 61, 0.5);
  }
  .tool-item:last-child {
    border-bottom: none;
  }
  .tool-toggle-label {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    cursor: pointer;
    min-height: 28px;
  }
  .tool-toggle-check {
    accent-color: var(--green);
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }
  .tool-toggle-name {
    font-size: 0.82em;
    color: var(--fg);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tool-toggle-desc {
    font-size: 0.72em;
    color: var(--fg-dim);
    padding-left: 24px;
    margin-top: 1px;
  }
  .mcp-server-item {
    padding: var(--sp-2) 0;
    border-bottom: 1px solid rgba(48, 54, 61, 0.5);
  }
  .mcp-server-item:last-child {
    border-bottom: none;
  }
  .mcp-server-header {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
  }
  .mcp-server-name {
    font-size: 0.85em;
    font-weight: 600;
    color: var(--purple);
  }
  .mcp-server-badge {
    font-size: 0.65em;
    color: var(--fg-dim);
    background: var(--bg-overlay);
    padding: 1px 6px;
    border-radius: 8px;
    border: 1px solid var(--border);
  }
  .mcp-edit-btn {
    background: none;
    border: none;
    color: var(--fg-dim);
    cursor: pointer;
    font-size: 0.85em;
    padding: 2px 6px;
  }
  .mcp-form {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    margin-top: var(--sp-2);
    padding: var(--sp-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
  }
  .mcp-form-error {
    font-size: 0.75em;
    color: var(--red);
  }
  .mcp-input {
    width: 100%;
    background: var(--bg-overlay);
    color: var(--fg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: var(--sp-1) var(--sp-2);
    font-family: var(--font-mono);
    font-size: 0.8em;
    outline: none;
  }
  .mcp-input:focus {
    border-color: var(--purple);
  }
  .mcp-input-half {
    width: calc(50% - var(--sp-1));
  }
  .mcp-headers-label {
    font-size: 0.72em;
    color: var(--fg-dim);
    margin-top: var(--sp-1);
  }
  .mcp-header-row {
    display: flex;
    gap: var(--sp-1);
    align-items: center;
  }
  .mcp-remove-btn {
    background: none;
    border: none;
    color: var(--fg-dim);
    cursor: pointer;
    font-size: 0.8em;
    padding: 2px;
    flex-shrink: 0;
  }
  .mcp-link-btn {
    background: none;
    border: none;
    color: var(--purple);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 0.78em;
    padding: var(--sp-1) 0;
    text-align: left;
  }
  .mcp-form-actions {
    display: flex;
    gap: var(--sp-2);
    margin-top: var(--sp-1);
  }
  .action-btn.delete {
    color: var(--red);
    border-color: var(--red);
  }

  /* Agents */
  .agent-item {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    padding: var(--sp-2) var(--sp-1);
    cursor: pointer;
    border-radius: var(--radius-sm);
    min-height: 36px;
  }
  .agent-item:active {
    background: var(--bg-overlay);
  }
  .agent-item.active {
    background: rgba(210, 168, 255, 0.08);
    border: 1px solid var(--border-accent);
  }
  .agent-name {
    font-size: 0.85em;
    color: var(--fg);
    font-weight: 500;
  }
  .agent-desc {
    font-size: 0.75em;
    color: var(--fg-dim);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .agent-current {
    font-size: 0.72em;
    color: var(--green);
    flex-shrink: 0;
  }

  /* Quota */
  .quota-label {
    font-size: 0.82em;
    color: var(--fg-muted);
    margin-bottom: var(--sp-1);
  }
  .quota-bar-container {
    width: 100%;
    height: 8px;
    background: var(--bg);
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: var(--sp-1);
    border: 1px solid var(--border);
  }
  .quota-bar {
    height: 100%;
    border-radius: 4px;
    transition: width 0.5s ease;
  }
  .quota-bar.green {
    background: var(--green);
  }
  .quota-bar.yellow {
    background: var(--yellow);
  }
  .quota-bar.red {
    background: var(--red);
  }
  .quota-text {
    font-size: 0.75em;
    color: var(--fg-dim);
  }

  .settings-hint {
    font-family: var(--font-mono);
    font-size: 0.75em;
    color: var(--fg-dim);
    margin-bottom: var(--sp-2);
    line-height: 1.5;
  }
  .settings-textarea {
    width: 100%;
    background: var(--bg);
    color: var(--fg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: var(--sp-2) var(--sp-3);
    font-family: var(--font-mono);
    font-size: 0.85em;
    line-height: 1.5;
    resize: vertical;
    min-height: 60px;
    max-height: 200px;
    outline: none;
  }
  .settings-textarea:focus {
    border-color: var(--purple);
  }
  .action-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: 100px;
    color: var(--fg-dim);
    padding: var(--sp-1) var(--sp-2);
    font-family: var(--font-mono);
    font-size: 0.9em;
    cursor: pointer;
    white-space: nowrap;
    min-height: 26px;
    display: flex;
    align-items: center;
    gap: var(--sp-1);
  }
  .action-btn.save {
    color: var(--purple);
    border-color: var(--purple-dim);
  }

  /* ── Skills ─────────────────────────────────────────────────────────────── */
  .skill-item {
    padding: var(--sp-2) var(--sp-1);
    border-bottom: 1px solid var(--border);
  }
  .skill-item:last-child {
    border-bottom: none;
  }
  .skill-toggle {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    cursor: pointer;
  }
  .skill-toggle input[type="checkbox"] {
    accent-color: var(--purple);
    width: 16px;
    height: 16px;
    cursor: pointer;
  }
  .skill-name {
    font-size: 0.85em;
    font-weight: 500;
    color: var(--fg);
  }
  .skill-desc {
    font-size: 0.75em;
    color: var(--fg-dim);
    margin: var(--sp-1) 0 0 calc(16px + var(--sp-2));
    line-height: 1.4;
  }
  .skill-meta {
    display: inline-block;
    font-size: 0.7em;
    color: var(--fg-dim);
    margin-left: calc(16px + var(--sp-2));
    margin-top: var(--sp-1);
    padding: 1px 6px;
    background: var(--bg-overlay);
    border-radius: var(--radius-sm);
  }
</style>

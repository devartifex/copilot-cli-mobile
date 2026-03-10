<script lang="ts">
  import type {
    ToolInfo,
    AgentInfo,
    QuotaSnapshots,
    QuotaSnapshot,
    CustomToolDefinition,
  } from '$lib/types/index.js';
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
    onClose: () => void;
    onSaveInstructions: (instructions: string) => void;
    onToggleTool: (toolName: string, enabled: boolean) => void;
    onSaveCustomTools: (tools: CustomToolDefinition[]) => void;
    onSelectAgent: (name: string) => void;
    onDeselectAgent: () => void;
    onCompact: () => void;
    onFetchTools: () => void;
    onFetchAgents: () => void;
    onFetchQuota: () => void;
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
    onClose,
    onSaveInstructions,
    onToggleTool,
    onSaveCustomTools,
    onSelectAgent,
    onDeselectAgent,
    onCompact,
    onFetchTools,
    onFetchAgents,
    onFetchQuota,
  }: Props = $props();

  type AccordionSection = 'instructions' | 'tools' | 'custom-tools' | 'agents' | 'quota' | 'compact' | null;

  let activeSection = $state<AccordionSection>(null);
  let instructionsDraft = $state('');

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

  const primaryQuota = $derived.by((): { label: string; snapshot: QuotaSnapshot } | null => {
    if (!quotaSnapshots) return null;
    if (quotaSnapshots.copilot_premium)
      return { label: 'Premium Usage', snapshot: quotaSnapshots.copilot_premium };
    if (quotaSnapshots.premium_requests)
      return { label: 'Premium Requests', snapshot: quotaSnapshots.premium_requests };
    if (quotaSnapshots.chat)
      return { label: 'Chat Usage', snapshot: quotaSnapshots.chat };
    return null;
  });

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
</style>

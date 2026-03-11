<script lang="ts">
import type { ChatMessage } from '$lib/types/index.js';
  import { renderMarkdown, highlightCodeBlocks, addCopyButtons } from '$lib/utils/markdown.js';
  import ToolCall from '$lib/components/ToolCall.svelte';
  import ReasoningBlock from '$lib/components/ReasoningBlock.svelte';

  interface Props {
    message: ChatMessage;
    username?: string;
  }

  const { message, username }: Props = $props();

  let contentEl: HTMLDivElement | undefined = $state();

  const renderedHtml = $derived(
    message.role === 'assistant' ? renderMarkdown(message.content) : '',
  );

  const usageText = $derived.by(() => {
    if (message.role !== 'usage') return '';
    const parts: string[] = [];
    if (message.inputTokens != null) parts.push(`in: ${message.inputTokens}`);
    if (message.outputTokens != null) parts.push(`out: ${message.outputTokens}`);
    if (message.reasoningTokens != null) parts.push(`reasoning: ${message.reasoningTokens}`);
    if (message.cost != null) parts.push(`cost: ${message.cost}×`);
    return parts.length > 0 ? `tokens — ${parts.join(' · ')}` : '';
  });

  const skillLabel = $derived(
    message.role === 'skill' ? `skill/${message.skillName ?? message.content} invoked` : '',
  );

  const subagentIcon = $derived.by(() => {
    if (message.role !== 'subagent') return '';
    return message.content.endsWith('completed') ? '✓' : '◐';
  });

  const toolState = $derived.by(() => {
    if (message.role !== 'tool') return null;
    return {
      id: message.toolCallId ?? message.id,
      name: message.toolName ?? message.content,
      mcpServerName: message.mcpServerName,
      mcpToolName: message.mcpToolName,
      status: message.toolStatus ?? 'running',
      message: message.toolProgressMessage,
      progressMessages: message.toolProgressMessages,
    };
  });

  // Highlight code blocks and add copy buttons after assistant content renders
  $effect(() => {
    if (message.role !== 'assistant' || !contentEl) return;
    // Track renderedHtml to re-run when content changes
    renderedHtml;
    highlightCodeBlocks(contentEl);
    addCopyButtons(contentEl);
  });
</script>

{#if message.role === 'user'}
  <div class="message user">
    <span class="user-marker">{username ?? 'You'}</span>
    <div class="user-text">{message.content}</div>
  </div>

{:else if message.role === 'assistant'}
  <div class="message assistant">
    <span class="assistant-marker">◆ Copilot</span>
    <div class="content" bind:this={contentEl}>
      {@html renderedHtml}
    </div>
  </div>

{:else if message.role === 'info'}
  <div class="info-line">{message.content}</div>

{:else if message.role === 'warning'}
  <div class="message warning">⚠ {message.content}</div>

{:else if message.role === 'error'}
  <div class="message error"> {message.content}</div>

{:else if message.role === 'intent'}
  <div class="intent-line">
    <span class="intent-icon">→</span>
    <span>{message.content}</span>
  </div>

{:else if message.role === 'usage'}
  <div class="usage-line">{usageText}</div>

{:else if message.role === 'skill'}
  <div class="skill-line">
    <span class="skill-icon">⚡</span>
    <span>{skillLabel}</span>
  </div>

{:else if message.role === 'subagent'}
  <div class="subagent-line">
    <span class="subagent-icon">{subagentIcon}</span>
    <span>agent/{message.content}</span>
  </div>

{:else if message.role === 'tool' && toolState}
  <ToolCall tool={toolState} />

{:else if message.role === 'reasoning'}
  <ReasoningBlock content={message.content} isStreaming={false} />
{/if}

<style>
  /* ── message animation ─────────────────────────────────────────────────── */
  .message {
    animation: msg-in 0.3s cubic-bezier(0.22, 1, 0.36, 1);
  }

  @keyframes msg-in {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* ── user message ──────────────────────────────────────────────────────── */
  .message.user {
    margin-top: var(--sp-2);
    padding: var(--sp-2) var(--sp-3);
    align-self: flex-start;
    max-width: 92%;
    background: var(--mode-user-bg, rgba(110, 64, 201, 0.12));
    border-left: 3px solid var(--mode-user-border, rgba(110, 64, 201, 0.35));
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    transition: background 0.3s ease, border-color 0.3s ease;
  }

  .user-marker {
    color: var(--mode-color, var(--purple));
    font-weight: 700;
    font-size: 0.85em;
    display: block;
    margin-bottom: var(--sp-1);
    opacity: 0.7;
    transition: color 0.3s ease;
  }

  .user-text {
    color: var(--fg);
    white-space: pre-wrap;
    font-weight: 500;
    font-size: 0.95em;
    line-height: 1.65;
  }

  /* ── assistant message ─────────────────────────────────────────────────── */
  .message.assistant {
    padding: var(--sp-2) var(--sp-3);
    align-self: flex-start;
    max-width: 92%;
    border-left: 3px solid var(--mode-border, var(--border-accent));
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    background: rgba(22, 27, 34, 0.6);
    transition: border-color 0.3s ease;
  }

  .assistant-marker {
    color: var(--mode-color, var(--purple));
    font-weight: 700;
    font-size: 0.85em;
    display: block;
    margin-bottom: var(--sp-1);
    opacity: 0.7;
    transition: color 0.3s ease;
  }

  .content {
    color: var(--fg);
    font-size: 0.95em;
    line-height: 1.65;
  }

  /* ── assistant markdown content ────────────────────────────────────────── */
  .content :global(p) {
    margin: 0 0 var(--sp-2);
  }

  .content :global(p:last-child) {
    margin-bottom: 0;
  }

  .content :global(pre) {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: var(--sp-3);
    overflow-x: auto;
    margin: var(--sp-2) 0;
    position: relative;
    font-size: 0.9em;
    line-height: 1.5;
  }

  .content :global(code) {
    font-family: var(--font-mono);
    font-size: 0.9em;
  }

  .content :global(:not(pre) > code) {
    background: var(--bg-overlay);
    padding: 1px 5px;
    border-radius: 3px;
    border: 1px solid var(--border);
    font-size: 0.88em;
  }

  .content :global(a) {
    color: var(--blue);
    text-decoration: none;
  }

  .content :global(a:hover) {
    text-decoration: underline;
  }

  .content :global(ul),
  .content :global(ol) {
    margin: var(--sp-2) 0;
    padding-left: var(--sp-5);
  }

  .content :global(li) {
    margin-bottom: var(--sp-1);
  }

  .content :global(h1),
  .content :global(h2),
  .content :global(h3),
  .content :global(h4) {
    color: var(--fg);
    font-weight: 600;
    margin: var(--sp-3) 0 var(--sp-1);
  }

  .content :global(h1) { font-size: 1.3em; }
  .content :global(h2) { font-size: 1.15em; }
  .content :global(h3) { font-size: 1.05em; }
  .content :global(h4) { font-size: 1em; }

  .content :global(blockquote) {
    border-left: 3px solid var(--border);
    padding-left: var(--sp-3);
    color: var(--fg-muted);
    margin: var(--sp-2) 0;
    font-style: italic;
  }

  .content :global(table) {
    border-collapse: collapse;
    width: 100%;
    margin: var(--sp-2) 0;
    font-size: 0.9em;
  }

  .content :global(th),
  .content :global(td) {
    border: 1px solid var(--border);
    padding: var(--sp-1) var(--sp-2);
    text-align: left;
  }

  .content :global(th) {
    background: var(--bg-overlay);
    font-weight: 600;
  }

  .content :global(hr) {
    border: none;
    border-top: 1px solid var(--border);
    margin: var(--sp-3) 0;
  }

  /* ── copy button ───────────────────────────────────────────────────────── */
  .content :global(.copy-btn) {
    position: absolute;
    top: var(--sp-2);
    right: var(--sp-2);
    background: var(--bg-overlay);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--fg-dim);
    padding: var(--sp-1) var(--sp-2);
    font-size: 0.75em;
    font-family: var(--font-mono);
    cursor: pointer;
    min-height: 28px;
    min-width: 44px;
    text-align: center;
  }

  @media (hover: hover) {
    .content :global(.copy-btn) {
      opacity: 0;
    }

    .content :global(pre:hover .copy-btn) {
      opacity: 1;
    }
  }

  /* ── error ─────────────────────────────────────────────────────────────── */
  .message.error {
    color: var(--red);
    font-size: 0.85em;
    padding: var(--sp-1) var(--sp-3);
  }

  .message.error::before {
    content: '✗';
    color: var(--red);
    font-weight: 700;
  }

  /* ── warning ───────────────────────────────────────────────────────────── */
  .message.warning {
    color: var(--yellow);
    font-size: 0.85em;
    padding: var(--sp-1) var(--sp-2);
    opacity: 0.9;
  }

  /* ── info ───────────────────────────────────────────────────────────────── */
  .info-line {
    font-size: 0.8em;
    color: var(--fg-dim);
    padding: 2px var(--sp-2);
    font-style: italic;
  }

  /* ── intent ────────────────────────────────────────────────────────────── */
  .intent-line {
    color: var(--fg-muted);
    font-size: 0.82em;
    padding: 2px 0 2px var(--sp-3);
    display: flex;
    align-items: flex-start;
    gap: var(--sp-2);
  }

  .intent-icon {
    color: var(--cyan);
    font-weight: 700;
  }

  /* ── usage ─────────────────────────────────────────────────────────────── */
  .usage-line {
    font-size: 0.75em;
    color: var(--fg-dim);
    opacity: 0.6;
    padding: 2px var(--sp-2);
  }

  /* ── skill ─────────────────────────────────────────────────────────────── */
  .skill-line {
    color: var(--green);
    font-size: 0.82em;
    padding: 2px 0 2px var(--sp-3);
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    animation: msg-in 0.3s cubic-bezier(0.22, 1, 0.36, 1);
  }

  .skill-icon {
    flex-shrink: 0;
  }

  /* ── subagent ──────────────────────────────────────────────────────────── */
  .subagent-line {
    color: var(--fg-muted);
    font-size: 0.82em;
    padding: 2px 0 2px var(--sp-3);
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    animation: msg-in 0.3s cubic-bezier(0.22, 1, 0.36, 1);
  }

  .subagent-icon {
    flex-shrink: 0;
    color: var(--purple);
    font-weight: 700;
  }

  /* ── typing cursor ────────────────────────────────────────────────────── */
  :global(.typing-indicator) {
    display: inline;
    color: var(--fg-dim);
  }

  :global(.typing-indicator)::after {
    content: '▋';
    animation: blink-cursor 1s step-end infinite;
  }

  @keyframes blink-cursor {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }
</style>

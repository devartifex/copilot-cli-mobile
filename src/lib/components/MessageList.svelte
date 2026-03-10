<script lang="ts">
  import type { ChatStore } from '$lib/stores/chat.svelte.js';
  import type { ToolCallState } from '$lib/types/index.js';
  import { renderMarkdown, highlightCodeBlocks, addCopyButtons } from '$lib/utils/markdown.js';
  import ChatMessage from '$lib/components/ChatMessage.svelte';
  import ReasoningBlock from '$lib/components/ReasoningBlock.svelte';
  import ToolCall from '$lib/components/ToolCall.svelte';

  interface Props {
    chatStore: ChatStore;
  }

  const { chatStore }: Props = $props();

  let messagesEl: HTMLDivElement | undefined = $state();
  let streamContentEl: HTMLDivElement | undefined = $state();

  const hasMessages = $derived(
    chatStore.messages.length > 0 ||
    chatStore.isStreaming ||
    chatStore.currentStreamContent.length > 0,
  );

  const streamHtml = $derived(
    chatStore.currentStreamContent
      ? renderMarkdown(chatStore.currentStreamContent)
      : '',
  );

  const activeTools = $derived.by((): ToolCallState[] => {
    const tools: ToolCallState[] = [];
    for (const tool of chatStore.activeToolCalls.values()) {
      tools.push(tool);
    }
    return tools;
  });

  const hasReasoningContent = $derived(chatStore.currentReasoningContent.length > 0);

  function isNearBottom(): boolean {
    const el = messagesEl;
    if (!el) return true;
    const threshold = 100;
    return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }

  function scrollToBottom() {
    const el = messagesEl;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }

  // Auto-scroll when new messages arrive or stream content updates
  $effect(() => {
    // Track reactive dependencies
    chatStore.messages.length;
    chatStore.currentStreamContent;
    chatStore.activeToolCalls;

    if (isNearBottom()) {
      // Use tick-like delay to scroll after DOM update
      requestAnimationFrame(() => scrollToBottom());
    }
  });

  // Highlight code blocks in streaming content
  $effect(() => {
    if (!streamContentEl || !chatStore.currentStreamContent) return;
    streamHtml;
    highlightCodeBlocks(streamContentEl);
    addCopyButtons(streamContentEl);
  });
</script>

<div class="messages" bind:this={messagesEl}>
  {#if !hasMessages}
    <div class="empty-state">
      <div class="empty-state-icon">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
          <path d="M24 4L4 24l20 20 20-20L24 4z" stroke="var(--purple)" stroke-width="1.5" fill="rgba(110,64,201,0.08)"/>
          <path d="M24 12l-12 12 12 12 12-12-12-12z" stroke="var(--purple-dim)" stroke-width="1" fill="none" opacity="0.5"/>
        </svg>
      </div>
      <div class="empty-state-text">
        Start a conversation with GitHub Copilot
      </div>
    </div>
  {:else}
    {#each chatStore.messages as msg (msg.id)}
      <ChatMessage message={msg} />
    {/each}

    {#if hasReasoningContent}
      <ReasoningBlock
        content={chatStore.currentReasoningContent}
        isStreaming={chatStore.isStreaming}
      />
    {/if}

    {#each activeTools as tool (tool.id)}
      <ToolCall {tool} />
    {/each}

    {#if chatStore.currentStreamContent}
      <div class="message assistant streaming">
        <span class="assistant-marker">◆ Copilot</span>
        <div class="content" bind:this={streamContentEl}>
          {@html streamHtml}
          <span class="typing-indicator"></span>
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
  .messages {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    scroll-behavior: smooth;
    padding: var(--sp-2) 0;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
    scroll-padding-bottom: 80px;
  }

  .messages::-webkit-scrollbar {
    width: 4px;
  }

  .messages::-webkit-scrollbar-track {
    background: transparent;
  }

  .messages::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 2px;
  }

  /* ── empty state ───────────────────────────────────────────────────────── */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    padding: var(--sp-6);
    text-align: center;
    gap: var(--sp-3);
    opacity: 0.6;
  }

  .empty-state-icon {
    color: var(--purple);
    opacity: 0.7;
  }

  .empty-state-text {
    color: var(--fg-muted);
    font-size: 0.85em;
    max-width: 280px;
  }

  /* ── streaming assistant message ───────────────────────────────────────── */
  .message.assistant {
    padding: var(--sp-2) var(--sp-3);
    align-self: flex-start;
    max-width: 92%;
    border-left: 3px solid var(--border-accent);
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    background: rgba(22, 27, 34, 0.6);
    animation: msg-in 0.3s cubic-bezier(0.22, 1, 0.36, 1);
  }

  .assistant-marker {
    color: var(--purple);
    font-weight: 700;
    font-size: 0.85em;
    display: block;
    margin-bottom: var(--sp-1);
    opacity: 0.7;
  }

  .content {
    color: var(--fg);
    font-size: 0.95em;
    line-height: 1.65;
  }

  /* Markdown styles for streaming content */
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

  /* ── typing cursor ────────────────────────────────────────────────────── */
  .typing-indicator {
    display: inline;
    color: var(--fg-dim);
  }

  .typing-indicator::after {
    content: '▋';
    animation: blink-cursor 1s step-end infinite;
  }

  @keyframes msg-in {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @keyframes blink-cursor {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }
</style>

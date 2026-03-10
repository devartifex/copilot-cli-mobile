<script lang="ts">
  import type { ConnectionState, SessionMode } from '$lib/types/index.js';

  interface Props {
    connectionState: ConnectionState;
    sessionReady: boolean;
    isStreaming: boolean;
    mode: SessionMode;
    currentModel: string;
    onSend: (content: string) => void;
    onAbort: () => void;
    onToggleSidebar: () => void;
  }

  const MAX_LENGTH = 10_000;
  const MAX_TEXTAREA_HEIGHT = 120;

  const {
    connectionState,
    sessionReady,
    isStreaming,
    mode,
    currentModel,
    onSend,
    onAbort,
    onToggleSidebar,
  }: Props = $props();

  let inputValue = $state('');
  let textareaEl: HTMLTextAreaElement | undefined = $state();

  const isDisabled = $derived(
    connectionState !== 'connected' || isStreaming || !sessionReady,
  );

  const statusClass = $derived.by(() => {
    if (connectionState === 'connecting') return 'connecting';
    if (connectionState === 'connected') return 'connected';
    return 'disconnected';
  });

  const statusText = $derived.by(() => {
    switch (connectionState) {
      case 'connecting':
        return 'Connecting…';
      case 'connected':
        return isStreaming ? 'Streaming…' : sessionReady ? 'Ready' : 'Starting session…';
      case 'disconnected':
        return 'Disconnected';
      case 'error':
        return 'Connection error';
    }
  });

  const placeholder = $derived.by(() => {
    if (connectionState === 'connecting') return 'Connecting…';
    if (connectionState !== 'connected') return 'Not connected';
    if (!sessionReady) return 'Starting session…';
    if (isStreaming) return 'Waiting for response…';
    return 'Ask Copilot…';
  });

  function autoResize() {
    const el = textareaEl;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  function send() {
    const trimmed = inputValue.trim();
    if (!trimmed || isDisabled) return;
    onSend(trimmed);
    inputValue = '';
    if (textareaEl) {
      textareaEl.style.height = 'auto';
    }
  }

  function handleInput() {
    if (inputValue.length > MAX_LENGTH) {
      inputValue = inputValue.slice(0, MAX_LENGTH);
    }
    autoResize();
  }

  // Auto-resize when inputValue changes externally
  $effect(() => {
    inputValue;
    autoResize();
  });

  // Virtual keyboard handling — update --vh CSS variable
  $effect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    function onResize() {
      const vh = (viewport?.height ?? window.innerHeight) * 0.01;
      document.documentElement.style.setProperty('--vh', `${vh}px`);
    }

    onResize();
    viewport.addEventListener('resize', onResize);

    return () => {
      viewport.removeEventListener('resize', onResize);
    };
  });
</script>

<div class="input-area">
  <div class="input-container">
    <div class="prompt-line">
      <span class="term-prompt {statusClass}" data-mode={mode}>❯</span>
      <textarea
        bind:this={textareaEl}
        bind:value={inputValue}
        {placeholder}
        disabled={isDisabled}
        maxlength={MAX_LENGTH}
        rows={1}
        oninput={handleInput}
        onkeydown={handleKeydown}
      ></textarea>
    </div>
    <div class="status-bar">
      <div class="status-left">
        <span class="status-text">{statusText}</span>
      </div>
      <div class="status-right">
        {#if isStreaming}
          <button class="action-btn stop-btn" onclick={onAbort}>■ Stop</button>
        {/if}
        <span class="model-label">{currentModel}</span>
        <button class="sidebar-toggle-btn" onclick={onToggleSidebar}>☰</button>
      </div>
    </div>
  </div>
</div>

<style>
  .input-area {
    flex-shrink: 0;
    padding-bottom: var(--safe-bottom);
    border-top: 1px solid var(--border);
    background: var(--bg);
    position: relative;
  }

  .input-container {
    padding: var(--sp-3) 0 0;
  }

  .prompt-line {
    display: flex;
    align-items: flex-start;
    gap: 0;
  }

  .prompt-line .term-prompt {
    padding-top: 3px;
    line-height: 1.5;
    transition: color 0.2s ease;
  }

  .prompt-line .term-prompt.connected[data-mode='interactive'] {
    color: #e6edf3;
  }

  .prompt-line .term-prompt.connected[data-mode='plan'] {
    color: var(--blue);
  }

  .prompt-line .term-prompt.connected[data-mode='autopilot'] {
    color: var(--green);
  }

  .prompt-line .term-prompt.disconnected {
    color: var(--red);
  }

  .prompt-line .term-prompt.connecting {
    color: var(--yellow);
    animation: pulse 1.5s ease-in-out infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.3;
    }
  }

  textarea {
    flex: 1;
    background: none;
    border: none;
    color: var(--fg);
    font-size: max(16px, var(--font-size));
    font-family: var(--font-mono);
    resize: none;
    outline: none;
    max-height: 100px;
    line-height: 1.5;
    padding: 2px 0;
    -webkit-appearance: none;
    appearance: none;
  }

  textarea::placeholder {
    color: var(--fg-dim);
    font-size: 0.85em;
  }

  textarea:disabled {
    opacity: 0.4;
  }

  textarea:disabled::placeholder {
    animation: inputLoading 1.5s ease-in-out infinite;
  }

  @keyframes inputLoading {
    0%,
    100% {
      opacity: 0.4;
    }
    50% {
      opacity: 0.8;
    }
  }

  .status-bar {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    margin-top: var(--sp-2);
    padding: var(--sp-2) 0;
    font-size: 0.82em;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .status-bar::-webkit-scrollbar {
    display: none;
  }

  .status-left {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    flex-shrink: 0;
    min-width: 0;
    color: var(--fg-dim);
  }

  .status-right {
    display: flex;
    align-items: center;
    gap: var(--sp-1);
    flex-shrink: 0;
    margin-left: auto;
  }

  .model-label {
    color: var(--fg-dim);
    font-family: var(--font-mono);
    font-size: 0.85em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 120px;
  }

  .sidebar-toggle-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--fg-muted);
    font-size: 1.1em;
    padding: 4px 10px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    line-height: 1;
    min-height: 36px;
    min-width: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .sidebar-toggle-btn:active {
    background: var(--border);
    color: var(--fg);
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

  .action-btn.stop-btn {
    color: var(--red);
    border-color: var(--red);
  }

  .action-btn.stop-btn:active {
    background: var(--red);
    color: var(--bg);
  }
</style>

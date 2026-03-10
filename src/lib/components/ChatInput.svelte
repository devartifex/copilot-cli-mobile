<script lang="ts">
  import type { ConnectionState, FileAttachment } from '$lib/types/index.js';

  interface Props {
    connectionState: ConnectionState;
    sessionReady: boolean;
    isStreaming: boolean;
    onSend: (content: string, attachments?: Array<{ path: string; name: string; type: string }>) => void;
    onAbort: () => void;
  }

  const MAX_LENGTH = 10_000;
  const MAX_TEXTAREA_HEIGHT = 120;
  const MAX_FILES = 5;
  const ACCEPTED_EXTENSIONS = [
    '.jpg', '.jpeg', '.png', '.gif', '.webp',
    '.ts', '.js', '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.cs', '.rb', '.php',
    '.md', '.txt', '.json', '.yaml', '.yml', '.xml', '.html', '.css', '.csv', '.sql',
  ];

  const {
    connectionState,
    sessionReady,
    isStreaming,
    onSend,
    onAbort,
  }: Props = $props();

  let inputValue = $state('');
  let textareaEl: HTMLTextAreaElement | undefined = $state();
  let fileInputEl: HTMLInputElement | undefined = $state();
  let selectedFiles = $state<File[]>([]);
  let isUploading = $state(false);

  const isDisabled = $derived(
    connectionState !== 'connected' || isStreaming || !sessionReady || isUploading,
  );

  const canSend = $derived(
    !isDisabled && (inputValue.trim().length > 0 || selectedFiles.length > 0),
  );

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

  function handleFileSelect() {
    fileInputEl?.click();
  }

  function handleFilesChanged(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files) return;

    const newFiles = Array.from(input.files);
    const combined = [...selectedFiles, ...newFiles].slice(0, MAX_FILES);
    selectedFiles = combined;

    // Reset input so same file can be re-selected
    input.value = '';
  }

  function removeFile(index: number) {
    selectedFiles = selectedFiles.filter((_, i) => i !== index);
  }

  async function uploadFiles(files: File[]): Promise<FileAttachment[]> {
    const formData = new FormData();
    for (const file of files) {
      formData.append('files', file);
    }

    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({ message: 'Upload failed' }));
      throw new Error(body.message ?? 'Upload failed');
    }

    const data = await response.json();
    return data.files as FileAttachment[];
  }

  async function send() {
    const trimmed = inputValue.trim();
    if ((!trimmed && selectedFiles.length === 0) || isDisabled) return;

    let attachments: Array<{ path: string; name: string; type: string }> | undefined;

    if (selectedFiles.length > 0) {
      isUploading = true;
      try {
        const uploaded = await uploadFiles(selectedFiles);
        attachments = uploaded.map((f) => ({ path: f.path, name: f.name, type: f.type }));
      } catch (err) {
        console.error('Upload failed:', err);
        isUploading = false;
        return;
      }
      isUploading = false;
    }

    const content = trimmed || 'See attached files';
    onSend(content, attachments);
    inputValue = '';
    selectedFiles = [];
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

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
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
      const vh = viewport?.height ?? window.innerHeight;
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
    {#if selectedFiles.length > 0}
      <div class="file-preview-row">
        {#each selectedFiles as file, i (file.name + i)}
          <div class="file-chip">
            <span class="file-chip-name">{file.name}</span>
            <span class="file-chip-size">{formatFileSize(file.size)}</span>
            <button class="file-chip-remove" onclick={() => removeFile(i)} aria-label="Remove {file.name}">×</button>
          </div>
        {/each}
      </div>
    {/if}

    <div class="prompt-row">
      <input
        bind:this={fileInputEl}
        type="file"
        multiple
        accept={ACCEPTED_EXTENSIONS.join(',')}
        onchange={handleFilesChanged}
        class="file-input-hidden"
        aria-hidden="true"
        tabindex={-1}
      />
      <button
        class="circle-btn attach-btn"
        onclick={handleFileSelect}
        disabled={isDisabled || selectedFiles.length >= MAX_FILES}
        aria-label="Attach files"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <line x1="9" y1="4" x2="9" y2="14"/>
          <line x1="4" y1="9" x2="14" y2="9"/>
        </svg>
      </button>

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

      {#if isStreaming}
        <button class="circle-btn stop-btn" onclick={onAbort} aria-label="Stop generating">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <rect x="2" y="2" width="10" height="10" rx="2"/>
          </svg>
        </button>
      {:else}
        <button
          class="circle-btn send-btn"
          onclick={send}
          disabled={!canSend}
          aria-label="Send message"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 12 L8 4"/>
            <path d="M4 7 L8 3 L12 7"/>
          </svg>
        </button>
      {/if}
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
    padding: var(--sp-2) 0 var(--sp-2);
  }

  /* ── Prompt row: [ + attach ] [ textarea ] [ send/stop ] ─────── */
  .prompt-row {
    display: flex;
    align-items: flex-end;
    gap: var(--sp-2);
  }

  textarea {
    flex: 1;
    background: var(--bg-overlay);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    color: var(--fg);
    font-size: max(16px, var(--font-size));
    font-family: var(--font-mono);
    resize: none;
    outline: none;
    max-height: 120px;
    line-height: 1.5;
    padding: var(--sp-2) var(--sp-3);
    -webkit-appearance: none;
    appearance: none;
    min-height: 40px;
  }

  textarea:focus {
    border-color: var(--purple-dim);
  }

  textarea::placeholder {
    color: var(--fg-dim);
    font-size: 0.88em;
  }

  textarea:disabled {
    opacity: 0.4;
  }

  textarea:disabled::placeholder {
    animation: inputLoading 1.5s ease-in-out infinite;
  }

  @keyframes inputLoading {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 0.8; }
  }

  /* ── Circle buttons (attach, send, stop) ───────────────────────── */
  .circle-btn {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all 0.15s ease;
    -webkit-tap-highlight-color: transparent;
  }

  .circle-btn:active {
    transform: scale(0.92);
  }

  /* Attach */
  .attach-btn {
    background: var(--bg-overlay);
    color: var(--fg-muted);
    border: 1px solid var(--border);
  }

  .attach-btn:active {
    background: var(--border);
    color: var(--fg);
  }

  .attach-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  /* Send */
  .send-btn {
    background: var(--purple);
    color: var(--bg);
  }

  .send-btn:disabled {
    background: var(--bg-overlay);
    color: var(--fg-dim);
    opacity: 0.5;
    cursor: not-allowed;
  }

  .send-btn:not(:disabled):active {
    background: var(--purple-dim);
  }

  /* Stop */
  .stop-btn {
    background: var(--red);
    color: #fff;
  }

  .stop-btn:active {
    opacity: 0.8;
  }

  /* ── Hidden file input ─────────────────────────────────────────── */
  .file-input-hidden {
    position: absolute;
    width: 0;
    height: 0;
    overflow: hidden;
    opacity: 0;
    pointer-events: none;
  }

  /* ── File preview chips ────────────────────────────────────────── */
  .file-preview-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-1);
    padding: 0 0 var(--sp-2);
    overflow-x: auto;
    scrollbar-width: none;
  }

  .file-preview-row::-webkit-scrollbar {
    display: none;
  }

  .file-chip {
    display: flex;
    align-items: center;
    gap: var(--sp-1);
    background: var(--bg-overlay);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 2px var(--sp-2);
    font-size: 0.78em;
    font-family: var(--font-mono);
    color: var(--fg-dim);
    max-width: 180px;
  }

  .file-chip-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .file-chip-size {
    flex-shrink: 0;
    opacity: 0.7;
  }

  .file-chip-remove {
    background: none;
    border: none;
    color: var(--fg-muted);
    font-size: 1.1em;
    padding: 0 2px;
    cursor: pointer;
    line-height: 1;
    flex-shrink: 0;
  }

  .file-chip-remove:active {
    color: var(--red);
  }
</style>

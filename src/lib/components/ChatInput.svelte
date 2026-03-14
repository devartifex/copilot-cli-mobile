<script lang="ts">
  import type { ConnectionState, FileAttachment, SessionMode, UserInputState } from '$lib/types/index.js';

  interface Props {
    connectionState: ConnectionState;
    sessionReady: boolean;
    isStreaming: boolean;
    isWaiting: boolean;
    mode: SessionMode;
    pendingUserInput: UserInputState | null;
    onSend: (content: string, attachments?: Array<{ path: string; name: string; type: string }>) => void;
    onAbort: () => void;
    onSetMode: (mode: SessionMode) => void;
    onUserInputResponse: (answer: string, wasFreeform: boolean) => void;
    onFleet?: (prompt: string) => void;
  }

  const MAX_LENGTH = 10_000;
  const MAX_TEXTAREA_HEIGHT = 200;
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
    isWaiting,
    mode,
    pendingUserInput,
    onSend,
    onAbort,
    onSetMode,
    onUserInputResponse,
    onFleet,
  }: Props = $props();

  const modes: { value: SessionMode; label: string }[] = [
    { value: 'interactive', label: 'Ask' },
    { value: 'plan', label: 'Plan' },
    { value: 'autopilot', label: 'Agent' },
  ];

  let inputValue = $state('');
  let textareaEl: HTMLTextAreaElement | undefined = $state();
  let fileInputEl: HTMLInputElement | undefined = $state();
  let cameraInputEl: HTMLInputElement | undefined = $state();
  let selectedFiles = $state<File[]>([]);
  let isUploading = $state(false);
  let attachMenuOpen = $state(false);

  const isDisabled = $derived(
    !pendingUserInput && (connectionState !== 'connected' || !sessionReady || isUploading),
  );

  const canSend = $derived(
    pendingUserInput
      ? inputValue.trim().length > 0
      : !isDisabled && (inputValue.trim().length > 0 || selectedFiles.length > 0),
  );

  const inputPlaceholder = $derived.by(() => {
    if (pendingUserInput) return 'Type your answer…';
    if (connectionState === 'connecting') return 'Connecting…';
    if (connectionState !== 'connected') return 'Not connected';
    if (!sessionReady) return 'Starting session…';
    if (isStreaming) return 'Steer or queue a follow-up…';
    return 'Ask anything…';
  });

  const showSteeringIndicator = $derived(
    !pendingUserInput && isStreaming && inputValue.trim().length > 0,
  );

  const showSlashHint = $derived(
    !pendingUserInput && inputValue === '/' && !isDisabled,
  );

  function autoResize() {
    const el = textareaEl;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (pendingUserInput) {
        submitUserInput();
      } else {
        send();
      }
    }
  }

  function submitUserInput(): void {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    onUserInputResponse(trimmed, true);
    inputValue = '';
    if (textareaEl) textareaEl.style.height = 'auto';
  }

  function handleChoiceClick(choice: string): void {
    onUserInputResponse(choice, false);
    inputValue = '';
    if (textareaEl) textareaEl.style.height = 'auto';
  }

  function handleFileSelect() {
    attachMenuOpen = false;
    fileInputEl?.click();
  }

  function handleCameraCapture() {
    attachMenuOpen = false;
    cameraInputEl?.click();
  }

  function handleGallerySelect() {
    attachMenuOpen = false;
    // Use file input with image accept for gallery
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/*,video/*';
    input.onchange = (e) => handleFilesChanged(e);
    input.click();
  }

  function toggleAttachMenu() {
    attachMenuOpen = !attachMenuOpen;
  }

  function closeAttachMenu() {
    attachMenuOpen = false;
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

  // Focus textarea when user input request appears
  $effect(() => {
    if (pendingUserInput && textareaEl) {
      textareaEl.focus();
    }
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
  <input
    bind:this={cameraInputEl}
    type="file"
    accept="image/*"
    capture="environment"
    onchange={handleFilesChanged}
    class="file-input-hidden"
    aria-hidden="true"
    tabindex={-1}
  />

  <div class="input-container" class:user-input-active={!!pendingUserInput}>
    {#if pendingUserInput}
      <div class="user-input-banner">
        <span class="user-input-question">{pendingUserInput.question}</span>
        {#if pendingUserInput.choices && pendingUserInput.choices.length > 0}
          <div class="user-input-choices">
            {#each pendingUserInput.choices as choice (choice)}
              <button class="user-input-choice" onclick={() => handleChoiceClick(choice)}>{choice}</button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

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

    <textarea
      bind:this={textareaEl}
      bind:value={inputValue}
      placeholder={inputPlaceholder}
      disabled={!pendingUserInput && isDisabled}
      maxlength={MAX_LENGTH}
      rows={2}
      oninput={handleInput}
      onkeydown={handleKeydown}
    ></textarea>

    {#if showSlashHint}
      <div class="slash-hint" role="listbox" aria-label="Slash commands">
        <button class="slash-option" role="option" aria-selected="false" onclick={() => { inputValue = '/fleet '; textareaEl?.focus(); }}>
          <span class="slash-cmd">/fleet</span>
          <span class="slash-desc">Run parallel sub-agents on a task</span>
        </button>
      </div>
    {/if}

    {#if showSteeringIndicator}
      <div class="steering-indicator" role="status" aria-live="polite">
        Sending now will steer the current response.
      </div>
    {/if}

    <div class="toolbar">
      <div class="toolbar-left">
        {#if !pendingUserInput}
          <div class="attach-wrapper">
          <button
            class="icon-btn attach-btn"
            onclick={toggleAttachMenu}
            disabled={isDisabled || selectedFiles.length >= MAX_FILES}
            aria-label="Attach"
            aria-expanded={attachMenuOpen}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <line x1="9" y1="4" x2="9" y2="14"/>
              <line x1="4" y1="9" x2="14" y2="9"/>
            </svg>
          </button>

          {#if attachMenuOpen}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="attach-backdrop" onclick={closeAttachMenu} onkeydown={(e) => e.key === 'Escape' && closeAttachMenu()} role="presentation"></div>
            <div class="attach-menu" role="menu">
              <button class="attach-menu-item" role="menuitem" onclick={handleCameraCapture}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="1" y="4" width="14" height="10" rx="2"/>
                  <circle cx="8" cy="9" r="2.5"/>
                  <path d="M5.5 4 L6.5 2 L9.5 2 L10.5 4"/>
                </svg>
                Camera
              </button>
              <button class="attach-menu-item" role="menuitem" onclick={handleGallerySelect}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="1" y="2" width="14" height="12" rx="2"/>
                  <circle cx="5" cy="6" r="1.5"/>
                  <path d="M1 12 L5 8 L8 11 L11 7 L15 12"/>
                </svg>
                Gallery
              </button>
              <button class="attach-menu-item" role="menuitem" onclick={handleFileSelect}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M9 1 L3 1 C2.4 1 2 1.4 2 2 L2 14 C2 14.6 2.4 15 3 15 L13 15 C13.6 15 14 14.6 14 14 L14 6 Z"/>
                  <path d="M9 1 L9 6 L14 6"/>
                </svg>
                File
              </button>
            </div>
          {/if}
        </div>

        {/if}

        <div class="mode-selector">
          {#each modes as m (m.value)}
            <button
              class="mode-btn"
              class:active={mode === m.value}
              onclick={() => onSetMode(m.value)}
              disabled={isDisabled && !pendingUserInput}
              aria-label="{m.label} mode"
            >
              {m.label}
            </button>
          {/each}
          {#if onFleet}
            <button
              class="mode-btn fleet-btn"
              class:active={mode === 'autopilot' && inputValue.startsWith('/fleet')}
              onclick={() => { onSetMode('autopilot'); inputValue = '/fleet '; textareaEl?.focus(); }}
              disabled={isDisabled && !pendingUserInput}
              aria-label="Fleet mode"
              title="Switch to Agent mode and run parallel sub-agents"
            >
              ⚡ Fleet
            </button>
          {/if}
        </div>
      </div>

      <div class="toolbar-right">
        {#if isStreaming || isWaiting}
          {#if isStreaming && !pendingUserInput && canSend}
            <button class="circle-btn send-btn" onclick={send} aria-label="Steer response">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M8 12 L8 4"/>
                <path d="M4 7 L8 3 L12 7"/>
              </svg>
            </button>
          {/if}
          <button class="circle-btn stop-btn" onclick={onAbort} aria-label="Stop generating">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <rect x="2" y="2" width="10" height="10" rx="2"/>
            </svg>
          </button>
        {:else}
          <button
            class="circle-btn send-btn"
            onclick={pendingUserInput ? submitUserInput : send}
            disabled={!canSend}
            aria-label={pendingUserInput ? 'Send answer' : 'Send message'}
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
</div>

<style>
  .input-area {
    flex-shrink: 0;
    padding: var(--sp-2) var(--sp-2) calc(var(--sp-2) + var(--safe-bottom));
    background: var(--bg);
    position: relative;
  }

  .input-container {
    background: var(--bg-overlay);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
    transition: border-color 0.15s ease;
  }

  .input-container:focus-within {
    border-color: var(--mode-color, var(--purple-dim));
  }

  .input-container.user-input-active {
    border-color: var(--purple);
  }

  /* ── User input prompt (inline) ─────────────────────────────────── */
  .user-input-banner {
    padding: var(--sp-2) var(--sp-3) 0;
    animation: userInputIn 0.2s ease;
  }

  @keyframes userInputIn {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .user-input-question {
    display: block;
    color: var(--purple);
    font-weight: 500;
    font-size: 0.85em;
    font-family: var(--font-mono);
    line-height: 1.4;
  }

  .user-input-choices {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-1);
    margin-top: var(--sp-2);
  }

  .user-input-choice {
    background: rgba(110, 64, 201, 0.12);
    border: 1px solid rgba(110, 64, 201, 0.30);
    border-radius: var(--radius-sm);
    color: var(--purple);
    font-family: var(--font-mono);
    font-size: 0.78em;
    padding: 4px 10px;
    cursor: pointer;
    transition: all 0.12s ease;
    -webkit-tap-highlight-color: transparent;
    min-height: 32px;
  }

  .user-input-choice:active {
    background: rgba(110, 64, 201, 0.25);
    transform: scale(0.96);
  }

  /* ── Textarea ───────────────────────────────────────────────────── */
  textarea {
    display: block;
    width: 100%;
    background: transparent;
    border: none;
    color: var(--fg);
    font-size: max(16px, var(--font-size));
    font-family: var(--font-mono);
    resize: none;
    outline: none;
    max-height: 200px;
    line-height: 1.5;
    padding: var(--sp-3) var(--sp-4) var(--sp-1);
    -webkit-appearance: none;
    appearance: none;
    min-height: 52px;
    /* Hide scrollbar but keep scrolling */
    scrollbar-width: none;
  }

  textarea::-webkit-scrollbar {
    display: none;
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

  /* ── Toolbar row: [ +attach / mode selector ] ─────────── [ send/stop ] ─ */
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sp-1) var(--sp-2) var(--sp-2);
    gap: var(--sp-2);
  }

  .toolbar-left {
    display: flex;
    align-items: center;
    gap: var(--sp-1);
    flex: 1;
    min-width: 0;
  }

  .steering-indicator {
    padding: 0 var(--sp-4);
    color: var(--fg-dim);
    font-family: var(--font-mono);
    font-size: 0.75em;
    line-height: 1.4;
  }

  .slash-hint {
    position: absolute;
    bottom: 100%;
    left: var(--sp-2);
    right: var(--sp-2);
    background: var(--bg-overlay);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: var(--sp-1);
    margin-bottom: var(--sp-1);
    z-index: 10;
    animation: userInputIn 0.15s ease;
  }

  .slash-option {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    width: 100%;
    padding: var(--sp-2) var(--sp-3);
    border: none;
    border-radius: var(--radius);
    background: transparent;
    color: var(--fg);
    cursor: pointer;
    text-align: left;
    font-size: 0.85em;
  }

  .slash-option:hover {
    background: var(--bg-secondary);
  }

  .slash-cmd {
    font-family: var(--font-mono);
    font-weight: 600;
    color: var(--purple);
  }

  .slash-desc {
    color: var(--fg-muted);
  }

  .fleet-btn {
    color: var(--purple) !important;
  }

  .toolbar-right {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    flex-shrink: 0;
  }

  /* ── Icon button (attach) ──────────────────────────────────────── */
  .icon-btn {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    border: none;
    background: transparent;
    color: var(--fg-muted);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all 0.15s ease;
    -webkit-tap-highlight-color: transparent;
  }

  .icon-btn:hover {
    background: var(--border);
    color: var(--fg);
  }

  .icon-btn:active {
    transform: scale(0.92);
    background: var(--border);
    color: var(--fg);
  }

  .icon-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  /* ── Mode selector (inline pill toggle) ─────────────────────────── */
  .mode-selector {
    display: flex;
    align-items: center;
    gap: 2px;
    background: rgba(255, 255, 255, 0.06);
    border-radius: var(--radius-sm);
    padding: 2px;
  }

  .mode-btn {
    background: transparent;
    border: none;
    color: var(--fg-dim);
    font-family: var(--font-mono);
    font-size: 0.8em;
    padding: 4px 10px;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s ease;
    -webkit-tap-highlight-color: transparent;
    white-space: nowrap;
    line-height: 1.4;
  }

  .mode-btn.active {
    background: var(--mode-color, var(--purple-dim));
    color: var(--bg);
  }

  .mode-btn:not(.active):hover {
    color: var(--fg-muted);
    background: rgba(255, 255, 255, 0.06);
  }

  .mode-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  /* ── Circle buttons (send, stop) ───────────────────────────────── */
  .circle-btn {
    width: 34px;
    height: 34px;
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

  /* ── Attach menu ───────────────────────────────────────────────── */
  .attach-wrapper {
    position: relative;
    flex-shrink: 0;
  }

  .attach-backdrop {
    position: fixed;
    inset: 0;
    z-index: 10;
  }

  .attach-menu {
    position: absolute;
    bottom: calc(100% + var(--sp-2));
    left: 0;
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    overflow: hidden;
    z-index: 11;
    min-width: 160px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    animation: menuFadeIn 0.12s ease;
  }

  @keyframes menuFadeIn {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .attach-menu-item {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    width: 100%;
    background: none;
    border: none;
    color: var(--fg);
    font-family: var(--font-mono);
    font-size: 0.85em;
    padding: var(--sp-2) var(--sp-3);
    cursor: pointer;
    min-height: 44px;
    text-align: left;
    -webkit-tap-highlight-color: transparent;
  }

  .attach-menu-item:active {
    background: var(--border);
  }

  .attach-menu-item + .attach-menu-item {
    border-top: 1px solid var(--border);
  }

  /* Send */
  .send-btn {
    background: var(--mode-color, var(--purple));
    color: var(--bg);
  }

  .send-btn:disabled {
    background: transparent;
    color: var(--fg-dim);
    opacity: 0.4;
    cursor: not-allowed;
  }

  .send-btn:not(:disabled):active {
    opacity: 0.85;
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

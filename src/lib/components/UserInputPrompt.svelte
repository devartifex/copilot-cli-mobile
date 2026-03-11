<script lang="ts">
  interface Props {
    question: string;
    choices?: string[];
    allowFreeform: boolean;
    onRespond: (answer: string, wasFreeform: boolean) => void;
  }

  const { question, choices, allowFreeform, onRespond }: Props = $props();

  let freeformText = $state('');
  let inputRef: HTMLInputElement | undefined = $state();

  $effect(() => {
    if (allowFreeform && inputRef) {
      inputRef.focus();
    }
  });

  function handleChoice(choice: string): void {
    onRespond(choice, false);
  }

  function submitFreeform(): void {
    const trimmed = freeformText.trim();
    if (!trimmed) return;
    onRespond(trimmed, true);
    freeformText = '';
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitFreeform();
    }
  }
</script>

<div class="user-input-request">
  <div class="user-input-question">{question}</div>

  {#if choices && choices.length > 0}
    <div class="user-input-choices">
      {#each choices as choice (choice)}
        <button class="user-input-choice" onclick={() => handleChoice(choice)}>
          {choice}
        </button>
      {/each}
    </div>
  {/if}

  {#if allowFreeform}
    <div class="user-input-freeform">
      <input
        bind:this={inputRef}
        class="user-input-text"
        type="text"
        bind:value={freeformText}
        onkeydown={handleKeydown}
        placeholder="Type your answer…"
      />
      <button class="user-input-submit" onclick={submitFreeform}>Send</button>
    </div>
  {/if}
</div>

<style>
  .user-input-request {
    background: rgba(110, 64, 201, 0.06);
    border: 1px solid var(--purple);
    border-radius: var(--radius-sm);
    padding: var(--sp-3);
    animation: msg-in 0.3s ease;
  }

  @keyframes msg-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .user-input-question {
    margin-bottom: var(--sp-2);
    color: var(--purple);
    font-weight: 500;
  }

  .user-input-choices {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-1);
    margin-bottom: var(--sp-2);
  }

  .user-input-choice {
    background: none;
    border: 1px solid var(--border);
    border-radius: 100px;
    color: var(--fg);
    padding: var(--sp-1) var(--sp-3);
    font-family: var(--font-mono);
    font-size: 0.85em;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .user-input-choice:active {
    border-color: var(--purple);
    color: var(--purple);
  }

  .user-input-freeform {
    display: flex;
    gap: var(--sp-1);
  }

  .user-input-text {
    flex: 1;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--fg);
    padding: var(--sp-1) var(--sp-2);
    font-family: var(--font-mono);
    font-size: 0.85em;
    outline: none;
  }

  .user-input-text:focus {
    border-color: var(--purple);
  }

  .user-input-submit {
    background: var(--purple);
    border: none;
    border-radius: var(--radius-sm);
    color: #fff;
    padding: var(--sp-1) var(--sp-3);
    font-family: var(--font-mono);
    font-size: 0.85em;
    cursor: pointer;
  }
</style>

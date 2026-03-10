<script lang="ts">
  interface Props {
    visible: boolean;
  }

  const { visible }: Props = $props();
</script>

{#if visible}
  <div class="banner-box">
    <div class="banner-inner">
      <div class="banner-art">
        <svg class="copilot-icon" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L2 12l10 10 10-10L12 2zm0 3.41L19.59 12 12 19.59 4.41 12 12 5.41z" />
        </svg>
        <span class="banner-title">Copilot CLI Mobile</span>
      </div>
      <span class="banner-sub">Describe a task to get started</span>
    </div>
  </div>
{/if}

<style>
  .banner-box {
    border: 1px solid var(--border-accent);
    border-radius: var(--radius-md);
    margin: var(--sp-2) 0;
    background: linear-gradient(135deg, rgba(110, 64, 201, 0.08), transparent 60%);
    overflow: hidden;
  }

  .banner-inner {
    padding: var(--sp-3) var(--sp-4);
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }

  .banner-art {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    font-size: 1em;
    line-height: 1;
    margin: 0 0 var(--sp-2) 0;
  }

  .copilot-icon {
    width: 36px;
    height: 36px;
    color: var(--purple);
    flex-shrink: 0;
  }

  .banner-title {
    font-size: 1.1em;
    font-weight: 700;
    color: var(--fg);
  }

  .banner-sub {
    color: var(--fg-muted);
    font-size: 0.88em;
    margin-top: var(--sp-1);
  }

  @media (max-width: 599px) {
    .banner-sub {
      display: none;
    }
  }
</style>

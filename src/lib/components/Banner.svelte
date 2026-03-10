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
        <img class="banner-logo" src="/img/logo.png" alt="" width="36" height="36" />
        <span class="banner-title">Copilot CLI Mobile</span>
      </div>
      <span class="banner-sub">Describe a task to get started</span>
      <span class="banner-tip">Tip: Open the menu to switch modes</span>
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

  .banner-logo {
    flex-shrink: 0;
    filter: drop-shadow(0 0 10px rgba(210, 168, 255, 0.2));
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

  .banner-tip {
    color: var(--fg-dim);
    font-size: 0.78em;
    margin-top: var(--sp-2);
  }

  @media (max-width: 599px) {
    .banner-sub {
      display: none;
    }
  }
</style>

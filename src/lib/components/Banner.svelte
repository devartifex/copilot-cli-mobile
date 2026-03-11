<script lang="ts">
  // no props needed — banner is always rendered
</script>

<div class="banner-box">
  <div class="banner-inner">
    <div class="banner-header">
      <span class="banner-version">Copilot SDK v0.1.32</span>
    </div>
    <div class="banner-sub">Describe a task to get started.</div>
    <div class="banner-tip">Switch modes or models from the top bar.</div>
    <div class="banner-warn">Copilot uses AI. Always verify suggestions.</div>
  </div>
</div>

<style>
  .banner-box {
    border: 1px solid var(--mode-border, var(--border-accent));
    border-radius: var(--radius-md);
    margin: var(--sp-2) 0;
    background: linear-gradient(135deg, var(--mode-banner-bg, rgba(110, 64, 201, 0.08)), transparent 60%);
    overflow: hidden;
    transition: border-color 0.3s ease;
  }

  .banner-inner {
    padding: var(--sp-3) var(--sp-4);
  }

  .banner-header {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    margin-bottom: var(--sp-2);
  }

  .banner-version {
    font-size: 0.78em;
    color: var(--cyan);
    opacity: 0.7;
  }

  .banner-sub {
    color: var(--fg-muted);
    font-size: 0.88em;
    margin-top: var(--sp-1);
  }

  .banner-tip {
    color: var(--fg-dim);
    font-size: 0.82em;
    margin-top: var(--sp-2);
  }

  .banner-warn {
    color: var(--fg-dim);
    font-size: 0.78em;
    margin-top: var(--sp-1);
    opacity: 0.8;
  }
</style>

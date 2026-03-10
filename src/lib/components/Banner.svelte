<script lang="ts">
  // no props needed — banner is always rendered
</script>

<div class="banner-box">
  <div class="banner-inner">
    <div class="banner-header">
      <img class="banner-logo" src="/img/logo.png" alt="Copilot CLI Mobile" width="40" height="40" />
      <div class="banner-title-group">
        <span class="banner-title">Copilot CLI Mobile</span>
        <span class="banner-version">SDK v0.1.32</span>
      </div>
    </div>
    <div class="banner-sub">Describe a task to get started.</div>
    <div class="banner-tip">Switch modes or models from the top bar.</div>
    <div class="banner-warn">Copilot uses AI. Always verify suggestions.</div>
  </div>
</div>

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
  }

  .banner-header {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    margin-bottom: var(--sp-2);
  }

  .banner-logo {
    flex-shrink: 0;
    filter: drop-shadow(0 0 10px rgba(210, 168, 255, 0.2));
  }

  .banner-title-group {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .banner-title {
    font-size: 1.1em;
    font-weight: 700;
    color: var(--fg);
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

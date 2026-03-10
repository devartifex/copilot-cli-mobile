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

/* ── Color utility classes for ASCII art ─────────────────────────── */
  .banner-art :global(.cb)  { color: var(--fg-dim); }
  .banner-art :global(.ct)  { color: var(--cyan); opacity: 0.7; }
  .banner-art :global(.cbt) { color: var(--cyan); font-weight: 700; }
  .banner-art :global(.cbs) { color: var(--fg-dim); }
  .banner-art :global(.cg)  { color: var(--cyan); }
  .banner-art :global(.ch)  { color: var(--purple); }
  .banner-art :global(.ce)  { color: var(--green); font-weight: 700; }

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

  /* ASCII art logo — desktop */
  .banner-art {
    font-family: var(--font-mono);
    font-size: clamp(0.42em, 1.6vw, 0.82em);
    line-height: 1.15;
    margin: 0 0 var(--sp-2) 0;
    white-space: pre;
    overflow-x: auto;
    overflow-y: hidden;
    user-select: none;
    -webkit-overflow-scrolling: touch;
    text-shadow: 0 0 8px rgba(86, 212, 221, 0.15);
  }

  /* Compact mobile banner */
  .banner-compact {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    margin-bottom: var(--sp-2);
  }

  .banner-compact-icon {
    flex-shrink: 0;
    filter: drop-shadow(0 0 10px rgba(210, 168, 255, 0.2));
  }

  .banner-compact-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .banner-compact-title {
    font-size: 1.1em;
    font-weight: 700;
    color: var(--fg);
  }

  .banner-compact-version {
    font-size: 0.78em;
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

  /* Mobile < 600px: show compact, hide ASCII art */
  @media (max-width: 599px) {
    .banner-art { display: none; }
  }

  /* Desktop ≥ 600px: hide compact, show ASCII art */
  @media (min-width: 600px) {
    .banner-compact { display: none; }
  }

  /* Responsive ASCII art scaling */
  @media (min-width: 390px) {
    .banner-art { font-size: clamp(0.48em, 1.6vw, 0.82em); }
  }
  @media (min-width: 430px) {
    .banner-art { font-size: clamp(0.55em, 1.6vw, 0.82em); }
  }
  @media (min-width: 768px) {
    .banner-art { font-size: 0.82em; }
  }
</style>

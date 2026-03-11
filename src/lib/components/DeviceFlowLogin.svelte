<script lang="ts">
  import { createAuthStore } from '$lib/stores/auth.svelte';
  import { invalidateAll } from '$app/navigation';

  const auth = createAuthStore();

  let copyText = $state('copy');
  let copyHighlight = $state(false);
  let copyTimeout: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    auth.startDeviceFlow();
    return () => {
      auth.destroy();
      if (copyTimeout) clearTimeout(copyTimeout);
    };
  });

  // Re-run layout load when auth succeeds (avoids full page reload)
  $effect(() => {
    console.log(`[LOGIN] authStatus changed: ${auth.authStatus}`);
    if (auth.authStatus === 'authorized') {
      console.log(`[LOGIN] authorized! calling invalidateAll()...`);
      invalidateAll().then(() => {
        console.log(`[LOGIN] invalidateAll() resolved`);
      }).catch((err) => {
        console.error(`[LOGIN] invalidateAll() FAILED:`, err);
      });
    }
  });

  function copyCode(): void {
    if (!auth.deviceCode) return;
    navigator.clipboard.writeText(auth.deviceCode.user_code).then(() => {
      copyText = 'copied!';
      copyHighlight = true;
      if (copyTimeout) clearTimeout(copyTimeout);
      copyTimeout = setTimeout(() => {
        copyText = 'copy';
        copyHighlight = false;
      }, 2000);
    });
  }
</script>

<div class="login-screen">
  <div class="login-container">
    <!-- ── Branding hero ──────────────────────────────────────────────── -->
    <div class="hero">
      <div class="hero-logo">
        <img class="copilot-icon" src="/img/logo.png" alt="Copilot Unleashed" />
      </div>
      <h1 class="hero-title">Copilot Unleashed</h1>
      <p class="hero-tagline">Multi-model AI chat powered by GitHub Copilot SDK</p>

      <div class="hero-features">
        <div class="feature"><span class="feature-dot purple"></span>GPT, Claude, Gemini — one interface</div>
        <div class="feature"><span class="feature-dot green"></span>Real-time streaming responses</div>
        <div class="feature"><span class="feature-dot cyan"></span>GitHub tools &amp; MCP servers built-in</div>
      </div>
    </div>

    <!-- ── Divider ────────────────────────────────────────────────────── -->
    <div class="divider"></div>

    <!-- ── Login section ──────────────────────────────────────────────── -->
    <div class="login-section">
      <h2 class="login-heading">Sign in with GitHub</h2>

      {#if auth.deviceCode}
        <div class="login-instruction">
          <span class="c-yellow">●</span> Enter this code at
          <span class="c-bold">github.com/login/device</span>
        </div>
        <div class="device-code-box">
          <span class="device-code-text">{auth.deviceCode.user_code}</span>
          <button
            class="copy-code-btn"
            class:copy-success={copyHighlight}
            onclick={copyCode}
            title="Copy code"
          >
            {copyText}
          </button>
        </div>
        <a
          href={auth.deviceCode.verification_uri}
          target="_blank"
          rel="noopener noreferrer"
          class="device-link-btn"
        >
          Open github.com/login/device ↗
        </a>
      {:else}
        <div class="device-code-box loading">
          <span class="skeleton" style="height: 24px; width: 180px; border-radius: 6px;"></span>
        </div>
      {/if}

      <div class="login-status">
        {#if auth.authStatus === 'polling'}
          <span class="spinner-char">{auth.spinnerChar}</span>
          <span>{auth.errorMessage || 'Waiting for authorization…'}</span>
        {:else if auth.authStatus === 'authorized'}
          <span class="spinner-char done">✓</span>
          <span>Authorized as @{auth.user?.login}</span>
        {:else if auth.authStatus === 'expired'}
          <span class="spinner-char failed">✗</span>
          <span>Code expired — refresh the page to try again.</span>
        {:else if auth.authStatus === 'denied'}
          <span class="spinner-char failed">✗</span>
          <span>Access denied — authorization was cancelled on GitHub.</span>
        {:else if auth.authStatus === 'error'}
          <span class="spinner-char failed">✗</span>
          <span>{auth.errorMessage || 'Failed to start device flow.'}</span>
        {:else}
          <span class="spinner-char">{auth.spinnerChar}</span>
          <span>Initializing…</span>
        {/if}
      </div>

      {#if auth.authStatus === 'polling' && auth.countdown > 0}
        <div class="login-expires">
          Code expires in {auth.countdownFormatted}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .login-screen {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--sp-4);
    height: 100dvh;
    height: var(--vh, 100dvh);
    overflow-y: auto;
  }

  .login-container {
    max-width: 420px;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0;
    animation: fadeInUp 0.4s ease-out;
  }

  @keyframes fadeInUp {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* ── Hero / Branding ─────────────────────────────────────────────── */
  .hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp-2);
    width: 100%;
  }

  .hero-logo {
    margin-bottom: var(--sp-1);
  }

  .copilot-icon {
    width: 72px;
    height: 72px;
    filter: drop-shadow(0 0 24px rgba(210, 168, 255, 0.3));
    animation: logo-float 4s ease-in-out infinite;
  }

  @keyframes logo-float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-4px); }
  }

  .hero-title {
    font-family: var(--font-mono);
    font-size: 1.6em;
    font-weight: 700;
    color: var(--fg);
    letter-spacing: -0.02em;
    text-align: center;
  }

  .hero-tagline {
    color: var(--fg-muted);
    font-size: 0.88em;
    text-align: center;
    line-height: var(--line-height);
    max-width: 320px;
  }

  .hero-features {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: var(--sp-2);
    width: 100%;
  }

  .feature {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    color: var(--fg-dim);
    font-size: 0.8em;
    padding: 2px 0;
  }

  .feature-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .feature-dot.purple { background: var(--purple); }
  .feature-dot.green  { background: var(--green); }
  .feature-dot.cyan   { background: var(--cyan); }

  /* ── Divider ─────────────────────────────────────────────────────── */
  .divider {
    width: 100%;
    height: 1px;
    background: var(--border);
    margin: var(--sp-4) 0;
  }

  /* ── Login section ───────────────────────────────────────────────── */
  .login-section {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp-3);
    width: 100%;
  }

  .login-heading {
    font-family: var(--font-mono);
    font-size: 0.95em;
    font-weight: 600;
    color: var(--fg);
    text-align: center;
  }

  .login-instruction {
    color: var(--fg-muted);
    font-size: 0.85em;
    text-align: center;
    line-height: var(--line-height);
  }

  .login-status {
    color: var(--fg-muted);
    font-size: 0.85em;
    text-align: center;
  }

  .login-expires {
    color: var(--fg-dim);
    font-size: 0.8em;
    text-align: center;
  }

  .device-code-box {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--sp-3);
    margin: var(--sp-1) 0;
    padding: var(--sp-3) var(--sp-4);
    background: var(--bg-raised);
    border: 1px solid var(--border-accent);
    border-radius: var(--radius-md);
    animation: code-glow 3s ease-in-out infinite;
    width: 100%;
    min-height: 56px;
  }

  .device-code-box.loading {
    animation: none;
    border-color: var(--border);
  }

  @keyframes code-glow {
    0%, 100% { box-shadow: 0 0 0 0 rgba(210, 168, 255, 0); }
    50% { box-shadow: 0 0 24px -4px rgba(210, 168, 255, 0.15); }
  }

  .device-code-text {
    font-size: 1.6em;
    font-weight: 700;
    letter-spacing: 0.15em;
    color: var(--purple);
    user-select: all;
    flex: 1;
  }

  .copy-code-btn {
    background: var(--bg-overlay);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--fg-muted);
    cursor: pointer;
    padding: var(--sp-2) var(--sp-3);
    font-family: var(--font-mono);
    font-size: 0.8em;
    transition: all 0.2s ease;
    min-height: 36px;
    min-width: 60px;
    touch-action: manipulation;
  }

  .copy-code-btn:active {
    background: var(--border);
    transform: scale(0.96);
  }

  .copy-code-btn.copy-success {
    color: var(--green);
  }

  .device-link-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--sp-2);
    padding: var(--sp-3) var(--sp-4);
    background: var(--purple-dim);
    color: var(--fg);
    text-decoration: none;
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    font-size: 0.85em;
    font-weight: 600;
    transition: all 0.2s ease;
    min-height: 44px;
    width: 100%;
    touch-action: manipulation;
  }

  .device-link-btn:active {
    opacity: 0.8;
    transform: scale(0.98);
  }

  .spinner-char {
    display: inline-block;
    color: var(--yellow);
  }

  .spinner-char.done {
    color: var(--green);
  }

  .spinner-char.failed {
    color: var(--red);
  }

  .c-yellow {
    color: var(--yellow);
  }

  .c-bold {
    font-weight: 700;
    color: var(--fg);
  }
</style>

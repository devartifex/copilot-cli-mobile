// Browser error capture — forwards unhandled errors to the server log
(function setupErrorCapture() {
  let errorCount = 0;
  const MAX_ERRORS = 20;

  function reportError(data) {
    if (errorCount >= MAX_ERRORS) return;
    errorCount++;
    fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).catch(() => { /* ignore network failure */ });
  }

  window.onerror = function (message, source, lineno, colno, error) {
    reportError({
      type: 'error',
      message: String(message).slice(0, 500),
      source: String(source || '').slice(0, 200),
      lineno: lineno || 0,
      colno: colno || 0,
      stack: (error && error.stack) ? String(error.stack).slice(0, 2000) : '',
    });
    return false;
  };

  window.addEventListener('unhandledrejection', function (event) {
    const reason = event.reason;
    reportError({
      type: 'unhandledrejection',
      message: (reason instanceof Error) ? reason.message.slice(0, 500) : String(reason).slice(0, 500),
      source: '',
      lineno: 0,
      colno: 0,
      stack: (reason instanceof Error && reason.stack) ? String(reason.stack).slice(0, 2000) : '',
    });
  });
})();

// App entry point — GitHub device flow auth then chat
(async function init() {
  fetchAndUpdateSdkVersion();

  const status = await Auth.checkStatus();

  if (!status.authenticated) {
    showScreen('github-screen');
    await runDeviceFlow();
    return;
  }

  showScreen('chat-screen');
  initChat(status);
})();

async function fetchAndUpdateSdkVersion() {
  try {
    const res = await fetch('/api/version');
    if (!res.ok) return;
    const data = await res.json();
    if (data.sdkVersion && data.sdkVersion !== 'unknown') {
      document.querySelectorAll('.ct').forEach((el) => {
        if (el.textContent.includes('Copilot SDK')) {
          el.textContent = `Copilot SDK v${data.sdkVersion}`;
        }
      });
    }
  } catch {
    // keep static fallback in HTML
  }
}

function showScreen(id) {
  ['github-screen', 'chat-screen'].forEach((s) => {
    const el = document.getElementById(s);
    if (s === id) {
      el.style.display = 'flex';
      el.style.opacity = '0';
      requestAnimationFrame(() => { el.style.opacity = '1'; });
    } else {
      el.style.display = 'none';
    }
  });
}

async function runDeviceFlow() {
  const codeEl = document.getElementById('device-code-text');
  const statusEl = document.getElementById('device-status-text');
  const expiresEl = document.getElementById('device-expires');
  const copyBtn = document.getElementById('copy-code-btn');
  const deviceLink = document.getElementById('device-link');
  const spinnerEl = document.getElementById('device-spinner');

  // Spinner character rotation
  const spinChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧'];
  let spinIdx = 0;
  const spinInterval = setInterval(() => {
    if (spinnerEl) {
      spinnerEl.textContent = spinChars[spinIdx];
      spinIdx = (spinIdx + 1) % spinChars.length;
    }
  }, 100);

  try {
    const data = await Auth.startDeviceFlow();

    codeEl.textContent = data.user_code;
    deviceLink.href = data.verification_uri;

    // Copy button
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(data.user_code).then(() => {
        copyBtn.textContent = 'copied!';
        copyBtn.style.color = 'var(--green)';
        setTimeout(() => {
          copyBtn.textContent = 'copy';
          copyBtn.style.color = '';
        }, 2000);
      });
    });

    // Countdown timer
    const expiresAt = Date.now() + data.expires_in * 1000;
    const countdown = setInterval(() => {
      const remaining = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
      const m = Math.floor(remaining / 60);
      const s = remaining % 60;
      expiresEl.textContent = `  Code expires in ${m}:${s.toString().padStart(2, '0')}`;
      if (remaining === 0) clearInterval(countdown);
    }, 1000);

    // Poll for authorization
    let interval = (data.interval || 5) * 1000;
    const poll = async () => {
      try {
        const result = await Auth.pollDeviceFlow();

        if (result.status === 'authorized') {
          clearInterval(countdown);
          clearInterval(spinInterval);
          if (spinnerEl) spinnerEl.textContent = '✓';
          statusEl.textContent = `Authorized as @${result.githubUser}`;
          setTimeout(() => window.location.reload(), 800);
          return;
        }

        if (result.status === 'expired') {
          clearInterval(countdown);
          clearInterval(spinInterval);
          if (spinnerEl) spinnerEl.textContent = '✗';
          statusEl.textContent = 'Code expired — refresh the page to try again.';
          return;
        }

        if (result.status === 'access_denied') {
          clearInterval(countdown);
          clearInterval(spinInterval);
          if (spinnerEl) spinnerEl.textContent = '✗';
          statusEl.textContent = 'Access denied — authorization was cancelled on GitHub.';
          return;
        }

        if (result.status === 'slow_down') {
          interval += 5000;
        }

        setTimeout(poll, interval);
      } catch {
        statusEl.textContent = 'Error checking status — retrying...';
        setTimeout(poll, interval * 2);
      }
    };

    setTimeout(poll, interval);
  } catch (err) {
    clearInterval(spinInterval);
    codeEl.textContent = '--------';
    statusEl.textContent = err.message || 'Failed to start device flow. Please refresh and try again.';
    if (spinnerEl) spinnerEl.textContent = '✗';
  }
}

function initChat(status) {
  Chat.loadSettings();
  Chat.connect();

  const input = document.getElementById('message-input');

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (input.value.trim() && !Chat.isStreaming) {
        Chat.send(input.value);
        input.value = '';
        input.style.height = 'auto';
      }
    }
  });

  document.getElementById('new-chat-btn').addEventListener('click', () => Chat.newChat());

  document.getElementById('logout-btn').addEventListener('click', () => {
    if (confirm('Sign out?')) Auth.logout();
  });

  document.getElementById('model-select').addEventListener('change', (e) => {
    Chat.changeModel(e.target.value);
    Chat.updateReasoningVisibility(e.target.value);
  });

  document.getElementById('reasoning-toggle').addEventListener('click', (e) => {
    const btn = e.target.closest('.reasoning-opt');
    if (!btn || btn.classList.contains('active')) return;
    Chat.setReasoning(btn.dataset.effort);
  });

  document.getElementById('stop-btn').addEventListener('click', () => Chat.abort());

  // Mode toggle — button group replaces select
  document.getElementById('mode-toggle').addEventListener('click', (e) => {
    const btn = e.target.closest('.mode-opt');
    if (!btn || btn.classList.contains('active')) return;
    document.querySelectorAll('#mode-toggle .mode-opt').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    Chat.setMode(btn.dataset.mode);
    Chat.saveSettings();
  });

  // Settings panel
  const settingsOverlay = document.getElementById('settings-overlay');
  const settingsInstructions = document.getElementById('settings-instructions');

  // Load saved instructions into textarea
  settingsInstructions.value = Chat.customInstructions || '';

  document.getElementById('settings-btn').addEventListener('click', () => {
    settingsInstructions.value = Chat.customInstructions || '';
    settingsOverlay.style.display = 'flex';
  });

  document.getElementById('settings-close').addEventListener('click', () => {
    settingsOverlay.style.display = 'none';
  });

  // Close on overlay background click
  settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) settingsOverlay.style.display = 'none';
  });

  document.getElementById('settings-save').addEventListener('click', () => {
    Chat.customInstructions = settingsInstructions.value;
    Chat.saveSettings();
    settingsOverlay.style.display = 'none';
    Chat.addInfoMessage('Settings saved — applied on next new session');
  });

  // Settings accordion sections
  document.querySelectorAll('.settings-accordion-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sectionId = btn.dataset.section;
      const body = document.getElementById(sectionId);
      if (!body) return;
      const isOpen = body.style.display !== 'none';
      body.style.display = isOpen ? 'none' : '';
      btn.classList.toggle('open', !isOpen);

      // Fetch data when section is opened
      if (!isOpen && Chat.ws && Chat.ws.readyState === WebSocket.OPEN) {
        if (sectionId === 'tools-section') {
          const model = document.getElementById('model-select').value;
          Chat.ws.send(JSON.stringify({ type: 'list_tools', model }));
        } else if (sectionId === 'agents-section' && Chat.sessionReady) {
          Chat.ws.send(JSON.stringify({ type: 'list_agents' }));
        } else if (sectionId === 'quota-section') {
          Chat.ws.send(JSON.stringify({ type: 'get_quota' }));
        } else if (sectionId === 'sessions-section') {
          Chat.ws.send(JSON.stringify({ type: 'list_sessions' }));
        }
      }
    });
  });

  // Compact button
  document.getElementById('compact-btn').addEventListener('click', () => {
    Chat.requestCompact();
    settingsOverlay.style.display = 'none';
  });

  // Plan panel controls
  document.getElementById('plan-collapse-btn').addEventListener('click', () => {
    document.getElementById('plan-panel').classList.toggle('collapsed');
  });

  document.getElementById('plan-edit-btn').addEventListener('click', () => {
    const contentEl = document.getElementById('plan-content');
    const editEl = document.getElementById('plan-edit');
    const textarea = document.getElementById('plan-textarea');
    textarea.value = Chat._planRawContent || '';
    contentEl.style.display = 'none';
    editEl.style.display = '';
  });

  document.getElementById('plan-save-btn').addEventListener('click', () => {
    const textarea = document.getElementById('plan-textarea');
    if (Chat.ws && Chat.ws.readyState === WebSocket.OPEN) {
      Chat.ws.send(JSON.stringify({ type: 'update_plan', content: textarea.value }));
    }
    document.getElementById('plan-content').style.display = '';
    document.getElementById('plan-edit').style.display = 'none';
  });

  document.getElementById('plan-cancel-btn').addEventListener('click', () => {
    document.getElementById('plan-content').style.display = '';
    document.getElementById('plan-edit').style.display = 'none';
  });

  document.getElementById('plan-delete-btn').addEventListener('click', () => {
    if (!confirm('Delete the plan?')) return;
    if (Chat.ws && Chat.ws.readyState === WebSocket.OPEN) {
      Chat.ws.send(JSON.stringify({ type: 'delete_plan' }));
    }
  });
}

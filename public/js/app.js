// App entry point — GitHub device flow auth then chat
(async function init() {
  const status = await Auth.checkStatus();

  if (!status.authenticated) {
    showScreen('github-screen');
    await runDeviceFlow();
    return;
  }

  showScreen('chat-screen');
  initChat(status);
})();

function showScreen(id) {
  ['github-screen', 'chat-screen'].forEach((s) => {
    document.getElementById(s).style.display = s === id ? 'flex' : 'none';
  });
}

async function runDeviceFlow() {
  const codeEl = document.getElementById('device-code-text');
  const statusEl = document.getElementById('device-status-text');
  const expiresEl = document.getElementById('device-expires');
  const copyBtn = document.getElementById('copy-code-btn');
  const deviceLink = document.getElementById('device-link');

  try {
    const data = await Auth.startDeviceFlow();

    codeEl.textContent = data.user_code;
    deviceLink.href = data.verification_uri;

    // Copy button
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(data.user_code).then(() => {
        copyBtn.title = 'Copied!';
        copyBtn.style.color = 'var(--green)';
        setTimeout(() => {
          copyBtn.title = 'Copy code';
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
      expiresEl.textContent = `Code expires in ${m}:${s.toString().padStart(2, '0')}`;
      if (remaining === 0) clearInterval(countdown);
    }, 1000);

    // Poll for authorization
    let interval = (data.interval || 5) * 1000;
    const poll = async () => {
      try {
        const result = await Auth.pollDeviceFlow();

        if (result.status === 'authorized') {
          clearInterval(countdown);
          statusEl.textContent = `Authorized as @${result.githubUser} ✓`;
          document.querySelector('#device-status .spinner').style.display = 'none';
          setTimeout(() => window.location.reload(), 800);
          return;
        }

        if (result.status === 'expired') {
          clearInterval(countdown);
          statusEl.textContent = 'Code expired — refresh the page to try again.';
          document.querySelector('#device-status .spinner').style.display = 'none';
          return;
        }

        if (result.status === 'slow_down') {
          interval += 5000; // GitHub asks us to back off
        }

        setTimeout(poll, interval);
      } catch {
        statusEl.textContent = 'Error checking status — retrying...';
        setTimeout(poll, interval * 2);
      }
    };

    setTimeout(poll, interval);
  } catch (err) {
    codeEl.textContent = 'Error';
    document.getElementById('device-status-text').textContent =
      err.message || 'Failed to start device flow. Please refresh and try again.';
  }
}

function initChat(status) {
  Chat.connect();

  const input = document.getElementById('message-input');
  const sendBtn = document.getElementById('send-btn');

  input.addEventListener('input', () => {
    sendBtn.disabled = !input.value.trim() || Chat.isStreaming;
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
        sendBtn.disabled = true;
      }
    }
  });

  sendBtn.addEventListener('click', () => {
    if (input.value.trim() && !Chat.isStreaming) {
      Chat.send(input.value);
      input.value = '';
      input.style.height = 'auto';
      sendBtn.disabled = true;
    }
  });

  document.getElementById('new-chat-btn').addEventListener('click', () => Chat.newChat());

  document.getElementById('logout-btn').addEventListener('click', () => {
    if (confirm('Sign out?')) Auth.logout();
  });

  document.getElementById('model-select').addEventListener('change', () => Chat.newChat());
}

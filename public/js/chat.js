// Chat module — handles WebSocket communication and message rendering
const Chat = {
  ws: null,
  reconnectTimer: null,
  reconnectDelay: 3000,
  currentAssistantEl: null,
  currentContent: '',
  isStreaming: false,


  connect() {
    if (this.ws) {
      try { this.ws.close(); } catch (e) { /* ignore */ }
    }

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${proto}//${location.host}/ws`);
    this.setStatus('connecting');

    this.ws.onopen = () => {
      this.setStatus('connected');
      this.reconnectDelay = 3000;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
    };

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        this.handleMessage(msg);
      } catch (err) {
        console.error('WS parse error:', err);
      }
    };

    this.ws.onclose = (e) => {
      this.setStatus('disconnected');
      if (e.code === 4001) {
        window.location.reload();
        return;
      }
      this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 60000);
    };

    this.ws.onerror = () => this.setStatus('disconnected');
  },

  handleMessage(msg) {
    switch (msg.type) {
      case 'connected':
        document.getElementById('user-badge').textContent = msg.user || '';
        this.requestNewSession();
        break;

      case 'session_created':
        this.setStatus('connected');
        break;

      case 'delta':
        if (!this.currentAssistantEl) {
          this.currentAssistantEl = this.addMessage('assistant', '');
          this.currentContent = '';
          this.isStreaming = true;
        }
        this.currentContent += msg.content;
        this.renderAssistantContent();
        this.scrollToBottom();
        break;

      case 'done':
        this.isStreaming = false;
        if (this.currentAssistantEl) {
          this.renderAssistantContent();
          this.addCopyButtons(this.currentAssistantEl);
        }
        this.currentAssistantEl = null;
        this.currentContent = '';
        this.enableInput();
        break;

      case 'models':
        this.populateModels(msg.models);
        break;

      case 'error':
        this.addErrorMessage(msg.message);
        this.enableInput();
        this.isStreaming = false;
        this.currentAssistantEl = null;
        break;
    }
  },

  renderAssistantContent() {
    if (!this.currentAssistantEl) return;
    const contentEl = this.currentAssistantEl.querySelector('.content');
    if (!contentEl) return;

    try {
      const rawHtml = marked.parse(this.currentContent, {
        breaks: true,
        gfm: true,
      });
      contentEl.innerHTML = DOMPurify.sanitize(rawHtml);
      // Highlight code blocks
      contentEl.querySelectorAll('pre code').forEach((block) => {
        if (!block.dataset.highlighted) {
          try { hljs.highlightElement(block); } catch (e) { /* ignore */ }
          block.dataset.highlighted = 'true';
        }
      });
    } catch {
      contentEl.textContent = this.currentContent;
    }
  },

  addCopyButtons(messageEl) {
    const blocks = messageEl.querySelectorAll('pre');
    blocks.forEach((pre) => {
      if (pre.querySelector('.copy-btn')) return;
      const btn = document.createElement('button');
      btn.className = 'copy-btn';
      btn.textContent = 'Copy';
      btn.addEventListener('click', () => {
        const code = pre.querySelector('code');
        navigator.clipboard.writeText(code ? code.textContent : pre.textContent)
          .then(() => {
            btn.textContent = 'Copied!';
            setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
          });
      });
      pre.style.position = 'relative';
      pre.appendChild(btn);
    });
  },

  send(content) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!content.trim()) return;

    this.addMessage('user', content);
    this.disableInput();

    this.ws.send(JSON.stringify({ type: 'message', content }));
  },

  requestNewSession() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const model = document.getElementById('model-select').value;
    this.ws.send(JSON.stringify({ type: 'new_session', model }));
    this.ws.send(JSON.stringify({ type: 'list_models' }));
  },

  newChat() {
    const messagesEl = document.getElementById('messages');
    messagesEl.innerHTML = `
      <div class="welcome-message">
        <h2>How can I help you today?</h2>
        <p>Ask me anything — I'm powered by GitHub Copilot.</p>
      </div>`;
    this.currentAssistantEl = null;
    this.currentContent = '';
    this.isStreaming = false;
    this.requestNewSession();
    this.enableInput();
  },

  addMessage(role, content) {
    const messagesEl = document.getElementById('messages');
    const welcome = messagesEl.querySelector('.welcome-message');
    if (welcome) welcome.remove();

    const el = document.createElement('div');
    el.className = `message ${role}`;

    if (role === 'user') {
      el.textContent = content;
    } else {
      const contentDiv = document.createElement('div');
      contentDiv.className = 'content';
      el.appendChild(contentDiv);
    }

    messagesEl.appendChild(el);
    this.scrollToBottom();
    return el;
  },

  addErrorMessage(message) {
    const messagesEl = document.getElementById('messages');
    const el = document.createElement('div');
    el.className = 'message error';
    el.textContent = `⚠ ${message}`;
    messagesEl.appendChild(el);
    this.scrollToBottom();
  },

  populateModels(models) {
    const select = document.getElementById('model-select');
    if (!models || !Array.isArray(models) || models.length === 0) return;

    const currentValue = select.value;
    select.innerHTML = '';

    models.forEach((model) => {
      const name = typeof model === 'string' ? model : model.id || model.name;
      if (!name) return;
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    });

    if ([...select.options].some((o) => o.value === currentValue)) {
      select.value = currentValue;
    }
  },

  scrollToBottom() {
    const el = document.getElementById('messages');
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  },

  setStatus(status) {
    const dot = document.getElementById('status-indicator');
    const text = document.getElementById('status-text');
    dot.className = `status-dot ${status}`;
    const labels = {
      connected: 'Connected',
      disconnected: 'Disconnected',
      connecting: 'Connecting...',
    };
    text.textContent = labels[status] || status;
  },

  enableInput() {
    const input = document.getElementById('message-input');
    const btn = document.getElementById('send-btn');
    input.disabled = false;
    btn.disabled = !input.value.trim();
    input.focus();
  },

  disableInput() {
    document.getElementById('message-input').disabled = true;
    document.getElementById('send-btn').disabled = true;
  },
};



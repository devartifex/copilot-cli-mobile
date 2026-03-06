// Chat module — handles WebSocket communication and message rendering
const Chat = {
  ws: null,
  reconnectTimer: null,
  reconnectDelay: 3000,
  currentAssistantEl: null,
  currentContent: '',
  isStreaming: false,
  currentReasoningEl: null,
  currentReasoningContent: '',
  activeTools: new Map(),


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
      this.initViewportHandler();
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
        document.getElementById('user-badge').textContent = '@' + (msg.user || '');
        this.requestNewSession();
        break;

      case 'session_created':
        this.setStatus('connected');
        break;

      case 'turn_start':
        // Reset state for a new assistant turn
        this.currentReasoningEl = null;
        this.currentReasoningContent = '';
        this.activeTools.clear();
        break;

      case 'reasoning_delta':
        if (!this.currentReasoningEl) {
          this.currentReasoningEl = this.addReasoningBlock();
        }
        this.currentReasoningContent += msg.content;
        this.renderReasoningContent();
        this.scrollToBottom();
        break;

      case 'reasoning_done':
        if (this.currentReasoningEl) {
          this.currentReasoningEl.classList.add('collapsed');
          this.currentReasoningEl = null;
          this.currentReasoningContent = '';
        }
        break;

      case 'intent':
        this.addIntentMessage(msg.intent);
        this.scrollToBottom();
        break;

      case 'tool_start':
        this.addToolStart(msg);
        this.scrollToBottom();
        break;

      case 'tool_progress':
        this.updateToolProgress(msg);
        this.scrollToBottom();
        break;

      case 'tool_end':
        this.completeToolCall(msg.toolCallId);
        this.scrollToBottom();
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

      case 'turn_end':
      case 'done':
        this.isStreaming = false;
        if (this.currentAssistantEl) {
          this.renderAssistantContent();
          this.addCopyButtons(this.currentAssistantEl);
        }
        this.currentAssistantEl = null;
        this.currentContent = '';
        this.currentReasoningEl = null;
        this.currentReasoningContent = '';
        this.activeTools.clear();
        if (msg.type === 'done') this.enableInput();
        break;

      case 'models':
        this.populateModels(msg.models);
        break;

      case 'mode_changed':
        this.syncModeSelect(msg.mode);
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

  setMode(mode) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'set_mode', mode }));
  },

  syncModeSelect(mode) {
    const select = document.getElementById('mode-select');
    if (select && [...select.options].some((o) => o.value === mode)) {
      select.value = mode;
    }
  },

  newChat() {
    const messagesEl = document.getElementById('messages');
    messagesEl.innerHTML = '';
    this.currentAssistantEl = null;
    this.currentContent = '';
    this.isStreaming = false;
    this.currentReasoningEl = null;
    this.currentReasoningContent = '';
    this.activeTools.clear();
    this.requestNewSession();
    this.enableInput();
  },

  addMessage(role, content) {
    const messagesEl = document.getElementById('messages');

    const el = document.createElement('div');
    el.className = `message ${role}`;

    if (role === 'user') {
      // Terminal-style: ❯ user text
      const promptLine = document.createElement('div');
      promptLine.className = 'user-prompt-line';
      const prompt = document.createElement('span');
      prompt.className = 'term-prompt';
      prompt.textContent = '❯';
      const text = document.createElement('span');
      text.className = 'user-text';
      text.textContent = content;
      promptLine.appendChild(prompt);
      promptLine.appendChild(text);
      el.appendChild(promptLine);
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
    el.textContent = message;
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

    // Update env line
    const envText = document.getElementById('env-model-text');
    if (envText) {
      envText.textContent = `${models.length} model${models.length !== 1 ? 's' : ''} available`;
    }
  },

  addReasoningBlock() {
    const messagesEl = document.getElementById('messages');
    const el = document.createElement('div');
    el.className = 'reasoning-block';

    const header = document.createElement('div');
    header.className = 'reasoning-header';
    header.innerHTML = '<span class="reasoning-chevron">▼</span> <span class="reasoning-icon">◐</span> <span class="reasoning-label">Thinking…</span>';
    header.addEventListener('click', () => {
      el.classList.toggle('collapsed');
    });

    const content = document.createElement('div');
    content.className = 'reasoning-content';

    el.appendChild(header);
    el.appendChild(content);
    messagesEl.appendChild(el);
    return el;
  },

  renderReasoningContent() {
    if (!this.currentReasoningEl) return;
    const contentEl = this.currentReasoningEl.querySelector('.reasoning-content');
    if (!contentEl) return;
    contentEl.textContent = this.currentReasoningContent;
  },

  addIntentMessage(intent) {
    const messagesEl = document.getElementById('messages');
    const el = document.createElement('div');
    el.className = 'intent-line';
    el.innerHTML = '<span class="intent-icon">→</span> ' + DOMPurify.sanitize(intent);
    messagesEl.appendChild(el);
  },

  addToolStart(msg) {
    const messagesEl = document.getElementById('messages');
    const el = document.createElement('div');
    el.className = 'tool-call';
    el.dataset.toolCallId = msg.toolCallId;

    const displayName = msg.mcpToolName
      ? `${msg.mcpServerName || 'mcp'}/${msg.mcpToolName}`
      : msg.toolName;

    el.innerHTML =
      '<span class="tool-icon spinner-char">⠋</span>' +
      '<span class="tool-name">' + DOMPurify.sanitize(displayName) + '</span>' +
      '<span class="tool-status">running…</span>';

    messagesEl.appendChild(el);
    this.activeTools.set(msg.toolCallId, el);
  },

  updateToolProgress(msg) {
    const el = this.activeTools.get(msg.toolCallId);
    if (!el) return;
    const status = el.querySelector('.tool-status');
    if (status && msg.message) {
      status.textContent = ' ' + msg.message;
    }
  },

  completeToolCall(toolCallId) {
    const el = this.activeTools.get(toolCallId);
    if (!el) return;
    const icon = el.querySelector('.tool-icon');
    if (icon) {
      icon.textContent = '✓';
      icon.classList.remove('spinner-char');
    }
    const status = el.querySelector('.tool-status');
    if (status) status.textContent = ' done';
    el.classList.add('completed');
    this.activeTools.delete(toolCallId);
  },

  scrollToBottom() {
    const el = document.getElementById('messages');
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  },

  setStatus(status) {
    const prompt = document.getElementById('status-indicator');
    const text = document.getElementById('status-text');

    // Update prompt color
    prompt.className = `term-prompt ${status}`;

    const labels = {
      connected: '',
      disconnected: 'Disconnected — reconnecting...',
      connecting: 'Connecting...',
    };
    text.textContent = labels[status] || status;
  },

  enableInput() {
    const input = document.getElementById('message-input');
    input.disabled = false;
    input.focus();
  },

  disableInput() {
    document.getElementById('message-input').disabled = true;
  },

  initViewportHandler() {
    // On mobile, virtual keyboard resizes the visual viewport.
    // Adjust the app height so the input stays above the keyboard.
    if (window.visualViewport) {
      const handler = () => {
        const vvh = window.visualViewport.height;
        document.documentElement.style.setProperty('--vh', `${vvh}px`);
        this.scrollToBottom();
      };
      window.visualViewport.addEventListener('resize', handler);
      handler();
    }
  },
};



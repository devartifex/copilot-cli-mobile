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
  _renderPending: false,
  _renderTimer: null,
  _spinnerInterval: null,
  sessionReady: false,
  pendingUserInput: false,
  reasoningEffort: 'medium',
  customInstructions: '',
  excludedTools: [],
  modelsMap: new Map(),
  currentAgent: null,

  // --- localStorage persistence ---
  _storageKey: 'copilot-cli-settings',

  loadSettings() {
    try {
      const raw = localStorage.getItem(this._storageKey);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s.model) document.getElementById('model-select').value = s.model;
      if (s.mode) this.syncModeSelect(s.mode);
      if (s.reasoningEffort && ['low', 'medium', 'high', 'xhigh'].includes(s.reasoningEffort)) {
        this.reasoningEffort = s.reasoningEffort;
      }
      if (typeof s.customInstructions === 'string') {
        this.customInstructions = s.customInstructions;
      }
      if (Array.isArray(s.excludedTools)) {
        this.excludedTools = s.excludedTools;
      }
    } catch { /* ignore corrupt data */ }
  },

  saveSettings() {
    const model = document.getElementById('model-select').value;
    const modeBtn = document.querySelector('#mode-toggle .mode-opt.active');
    const mode = modeBtn ? modeBtn.dataset.mode : 'interactive';
    try {
      localStorage.setItem(this._storageKey, JSON.stringify({
        model,
        mode,
        reasoningEffort: this.reasoningEffort,
        customInstructions: this.customInstructions,
        excludedTools: this.excludedTools,
      }));
    } catch { /* ignore quota errors */ }
  },


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
        this.sessionReady = false;
        this.disableInput();
        this.requestNewSession();
        break;

      case 'session_created':
        this.sessionReady = true;
        this.setStatus('connected');
        this.enableInput();
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
          const icon = this.currentReasoningEl.querySelector('.reasoning-icon');
          if (icon) icon.classList.remove('thinking');
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
        this.scheduleRender();
        break;

      case 'turn_end':
      case 'done':
        this.isStreaming = false;
        this.flushRender();
        if (this.currentAssistantEl) {
          this.renderAssistantContent();
          this.addCopyButtons(this.currentAssistantEl);
        }
        this.currentAssistantEl = null;
        this.currentContent = '';
        this.currentReasoningEl = null;
        this.currentReasoningContent = '';
        this.activeTools.clear();
        this.hideStopButton();
        if (msg.type === 'done') this.enableInput();
        break;

      case 'models':
        this.populateModels(msg.models);
        break;

      case 'mode_changed':
        this.syncModeSelect(msg.mode);
        break;

      case 'title_changed':
        this.setSessionTitle(msg.title);
        break;

      case 'usage':
        this.showUsage(msg);
        break;

      case 'warning':
        this.addWarningMessage(msg.message);
        break;

      case 'model_changed':
        if (msg.source === 'sdk') {
          // SDK-initiated model switch — update the dropdown
          const modelSelect = document.getElementById('model-select');
          if (modelSelect && msg.model) {
            if ([...modelSelect.options].some((o) => o.value === msg.model)) {
              modelSelect.value = msg.model;
            }
            this.updateReasoningVisibility(msg.model);
          }
        }
        this.addInfoMessage('Model changed to ' + msg.model);
        break;

      case 'aborted':
        this.isStreaming = false;
        this.flushRender();
        this.currentAssistantEl = null;
        this.currentContent = '';
        this.hideStopButton();
        this.enableInput();
        this.addInfoMessage('Response stopped');
        break;

      case 'user_input_request':
        this.showUserInputRequest(msg);
        break;

      case 'subagent_start':
        this.addSubagentMessage(msg.agentName, 'started');
        this.scrollToBottom();
        break;

      case 'subagent_end':
        this.addSubagentMessage(msg.agentName, 'completed');
        this.scrollToBottom();
        break;

      case 'error':
        this.addErrorMessage(msg.message);
        this.hideStopButton();
        this.enableInput();
        this.isStreaming = false;
        this.currentAssistantEl = null;
        break;

      case 'tools':
        this.handleToolsList(msg.tools);
        break;

      case 'agents':
        this.handleAgentsList(msg.agents, msg.current);
        break;

      case 'agent_changed':
        this.currentAgent = msg.agent;
        this.updateAgentIndicator();
        this.addInfoMessage(msg.agent ? 'Agent selected: @' + msg.agent : 'Agent deselected');
        break;

      case 'quota':
        this.handleQuota(msg);
        break;

      case 'sessions':
        this.handleSessionsList(msg.sessions);
        break;

      case 'session_resumed':
        this.sessionReady = true;
        this.setStatus('connected');
        this.enableInput();
        this.addInfoMessage('Session resumed: ' + msg.sessionId);
        break;

      case 'plan':
        this.handlePlan(msg);
        break;

      case 'plan_changed':
        this.addInfoMessage('Plan updated');
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'get_plan' }));
        }
        break;

      case 'plan_updated':
        this.addInfoMessage('Plan saved');
        break;

      case 'plan_deleted':
        this.addInfoMessage('Plan deleted');
        this.handlePlan({ exists: false });
        break;

      case 'compaction_start':
        this.addInfoMessage('Compacting conversation…');
        break;

      case 'compaction_complete':
        this.addInfoMessage('Compaction complete' +
          (msg.tokensRemoved ? ': removed ' + msg.tokensRemoved + ' tokens' : '') +
          (msg.messagesRemoved ? ', ' + msg.messagesRemoved + ' messages' : ''));
        break;

      case 'compaction_result':
        this.addInfoMessage('Compaction result' +
          (msg.tokensRemoved ? ': removed ' + msg.tokensRemoved + ' tokens' : '') +
          (msg.messagesRemoved ? ', ' + msg.messagesRemoved + ' messages' : ''));
        break;

      case 'skill_invoked':
        this.addSkillMessage(msg.skillName);
        break;

      case 'subagent_failed':
        this.addErrorMessage('Sub-agent ' + (msg.agentName || 'unknown') + ' failed' + (msg.error ? ': ' + msg.error : ''));
        break;

      case 'subagent_selected':
        this.currentAgent = msg.agentName;
        this.updateAgentIndicator();
        break;

      case 'subagent_deselected':
        this.currentAgent = null;
        this.updateAgentIndicator();
        break;

      case 'info':
        this.addInfoMessage(msg.message || 'Info');
        break;

      case 'elicitation_requested':
        this.showUserInputRequest(msg);
        break;

      case 'exit_plan_mode_requested':
        this.addInfoMessage('Exiting plan mode…');
        break;

      case 'exit_plan_mode_completed':
        this.addInfoMessage('Exited plan mode');
        break;
    }
  },

  // Throttled render — schedule a markdown parse at most every 50ms
  scheduleRender() {
    if (this._renderPending) return;
    this._renderPending = true;
    this._renderTimer = setTimeout(() => {
      this._renderPending = false;
      this.renderAssistantContent();
      this.scrollToBottom();
    }, 50);
  },

  flushRender() {
    if (this._renderTimer) {
      clearTimeout(this._renderTimer);
      this._renderTimer = null;
    }
    this._renderPending = false;
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
      // Append typing cursor while still streaming
      const cursor = this.isStreaming ? '<span class="typing-indicator"></span>' : '';
      contentEl.innerHTML = DOMPurify.sanitize(rawHtml + cursor, {
        ADD_TAGS: ['span'],
        ADD_ATTR: ['class'],
      });
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
    this.showStopButton();

    this.ws.send(JSON.stringify({ type: 'message', content }));
  },

  isReasoningModel(modelId) {
    const model = this.modelsMap.get(modelId);
    if (model && model.capabilities) {
      return model.capabilities.supports && model.capabilities.supports.reasoningEffort === true;
    }
    return false;
  },

  updateReasoningVisibility(modelId) {
    const toggle = document.getElementById('reasoning-toggle');
    if (!toggle) return;
    const isReasoning = this.isReasoningModel(modelId);
    toggle.style.display = isReasoning ? '' : 'none';

    if (isReasoning) {
      const model = this.modelsMap.get(modelId);
      this.buildReasoningButtons(model);
    }
  },

  buildReasoningButtons(model) {
    const toggle = document.getElementById('reasoning-toggle');
    if (!toggle) return;

    const supportedEfforts = (model && model.supportedReasoningEfforts) || ['low', 'medium', 'high', 'xhigh'];
    const defaultEffort = (model && model.defaultReasoningEffort) || 'medium';

    const effortLabels = { low: 'low', medium: 'med', high: 'high', xhigh: 'max' };

    // Only rebuild if the effort options differ
    const currentEfforts = [...toggle.querySelectorAll('.reasoning-opt')].map((b) => b.dataset.effort);
    const currentSet = new Set(currentEfforts);
    const newSet = new Set(supportedEfforts);
    const sameEfforts = currentSet.size === newSet.size && [...currentSet].every((e) => newSet.has(e));
    if (sameEfforts) return;

    toggle.innerHTML = '';
    supportedEfforts.forEach((effort) => {
      const btn = document.createElement('button');
      btn.className = 'reasoning-opt';
      btn.dataset.effort = effort;
      btn.textContent = effortLabels[effort] || effort;
      // Use saved preference, or model default
      if (effort === this.reasoningEffort && supportedEfforts.includes(this.reasoningEffort)) {
        btn.classList.add('active');
      } else if (!supportedEfforts.includes(this.reasoningEffort) && effort === defaultEffort) {
        btn.classList.add('active');
        this.reasoningEffort = defaultEffort;
      }
      toggle.appendChild(btn);
    });

    // Ensure at least one is active
    if (!toggle.querySelector('.reasoning-opt.active') && toggle.firstChild) {
      toggle.firstChild.classList.add('active');
      this.reasoningEffort = toggle.firstChild.dataset.effort;
    }
  },

  setReasoning(effort) {
    this.reasoningEffort = effort;
    document.querySelectorAll('#reasoning-toggle .reasoning-opt').forEach((b) => {
      b.classList.toggle('active', b.dataset.effort === effort);
    });
    this.saveSettings();
    // Restart session so the new effort takes effect immediately
    this.newChat();
  },

  requestNewSession() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const model = document.getElementById('model-select').value;
    const sessionMsg = { type: 'new_session', model };
    if (this.isReasoningModel(model)) {
      sessionMsg.reasoningEffort = this.reasoningEffort;
    }
    if (this.customInstructions.trim()) {
      sessionMsg.customInstructions = this.customInstructions.trim();
    }
    if (this.excludedTools.length > 0) {
      sessionMsg.excludedTools = this.excludedTools;
    }
    this.clearSessionTitle();
    this.saveSettings();
    this.ws.send(JSON.stringify(sessionMsg));
    this.ws.send(JSON.stringify({ type: 'list_models' }));
  },

  setMode(mode) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.sessionReady) return;
    this.ws.send(JSON.stringify({ type: 'set_mode', mode }));
  },

  syncModeSelect(mode) {
    const btns = document.querySelectorAll('#mode-toggle .mode-opt');
    btns.forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    const statusIndicator = document.getElementById('status-indicator');
    if (statusIndicator) statusIndicator.dataset.mode = mode;
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
    this.sessionReady = false;
    this.disableInput();
    this.requestNewSession();
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
    this.modelsMap.clear();

    models.forEach((model) => {
      const id = typeof model === 'string' ? model : model.id || model.name;
      if (!id) return;

      // Store full model info object
      if (typeof model === 'object') {
        this.modelsMap.set(id, model);
      }

      const opt = document.createElement('option');
      opt.value = id;

      // Build display label with capability hints
      let label = id;
      if (typeof model === 'object') {
        const hints = [];
        if (model.capabilities?.supports?.vision) hints.push('👁');
        if (model.capabilities?.supports?.reasoningEffort) hints.push('🧠');
        if (model.billing?.multiplier && model.billing.multiplier > 1) hints.push(model.billing.multiplier + '×');
        if (hints.length > 0) label += ' ' + hints.join('');
      }
      opt.textContent = label;

      // Add tooltip with full model info
      if (typeof model === 'object' && model.capabilities) {
        const parts = [];
        const limits = model.capabilities.limits;
        if (limits?.max_context_window_tokens) parts.push('Context: ' + Math.round(limits.max_context_window_tokens / 1000) + 'k');
        if (limits?.max_prompt_tokens) parts.push('Max prompt: ' + Math.round(limits.max_prompt_tokens / 1000) + 'k');
        if (model.capabilities.supports?.vision) parts.push('Vision: yes');
        if (model.capabilities.supports?.reasoningEffort) parts.push('Reasoning: yes');
        if (model.billing?.multiplier) parts.push('Billing: ' + model.billing.multiplier + '×');
        if (model.supportedReasoningEfforts) parts.push('Efforts: ' + model.supportedReasoningEfforts.join(', '));
        opt.title = parts.join(' | ');
      }

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

    // Show/hide reasoning effort selector based on selected model
    this.updateReasoningVisibility(select.value);
  },

  addReasoningBlock() {
    const messagesEl = document.getElementById('messages');
    const el = document.createElement('div');
    el.className = 'reasoning-block';

    const header = document.createElement('div');
    header.className = 'reasoning-header';
    header.innerHTML = '<span class="reasoning-chevron">▼</span> <span class="reasoning-icon thinking">◐</span> <span class="reasoning-label">Thinking…</span>';
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
    this.startSpinners();
  },

  startSpinners() {
    if (this._spinnerInterval) return;
    const chars = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
    let i = 0;
    this._spinnerInterval = setInterval(() => {
      const spinners = document.querySelectorAll('.tool-call:not(.completed) .spinner-char');
      if (spinners.length === 0) {
        clearInterval(this._spinnerInterval);
        this._spinnerInterval = null;
        return;
      }
      i = (i + 1) % chars.length;
      spinners.forEach((s) => { s.textContent = chars[i]; });
    }, 80);
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
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
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

  abort() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'abort' }));
  },

  changeModel(model) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.sessionReady) return;
    this.ws.send(JSON.stringify({ type: 'set_model', model }));
    this.saveSettings();
  },

  showStopButton() {
    const btn = document.getElementById('stop-btn');
    if (btn) btn.style.display = '';
  },

  hideStopButton() {
    const btn = document.getElementById('stop-btn');
    if (btn) btn.style.display = 'none';
  },

  setSessionTitle(title) {
    const line = document.getElementById('session-title-line');
    const text = document.getElementById('session-title-text');
    if (line && text && title) {
      text.textContent = title;
      line.style.display = '';
    }
  },

  clearSessionTitle() {
    const line = document.getElementById('session-title-line');
    if (line) line.style.display = 'none';
  },

  showUsage(msg) {
    const parts = [];
    if (msg.inputTokens) parts.push(`in: ${msg.inputTokens}`);
    if (msg.outputTokens) parts.push(`out: ${msg.outputTokens}`);
    if (msg.reasoningTokens) parts.push(`reasoning: ${msg.reasoningTokens}`);
    if (parts.length === 0) return;

    const messagesEl = document.getElementById('messages');
    const el = document.createElement('div');
    el.className = 'usage-line';
    el.textContent = 'tokens — ' + parts.join(' · ');
    messagesEl.appendChild(el);
  },

  addWarningMessage(message) {
    const messagesEl = document.getElementById('messages');
    const el = document.createElement('div');
    el.className = 'message warning';
    el.textContent = '⚠ ' + message;
    messagesEl.appendChild(el);
    this.scrollToBottom();
  },

  addInfoMessage(message) {
    const messagesEl = document.getElementById('messages');
    const el = document.createElement('div');
    el.className = 'info-line';
    el.textContent = message;
    messagesEl.appendChild(el);
    this.scrollToBottom();
  },

  addSubagentMessage(agentName, status) {
    const messagesEl = document.getElementById('messages');
    const el = document.createElement('div');
    el.className = 'tool-call' + (status === 'completed' ? ' completed' : '');
    const icon = status === 'completed' ? '✓' : '⠋';
    const iconClass = status === 'completed' ? 'tool-icon' : 'tool-icon spinner-char';
    el.innerHTML =
      '<span class="' + iconClass + '">' + icon + '</span>' +
      '<span class="tool-name">agent/' + DOMPurify.sanitize(agentName || 'unknown') + '</span>' +
      '<span class="tool-status">' + status + '</span>';
    messagesEl.appendChild(el);
    if (status !== 'completed') this.startSpinners();
  },

  showUserInputRequest(msg) {
    this.pendingUserInput = true;
    const messagesEl = document.getElementById('messages');
    const el = document.createElement('div');
    el.className = 'message user-input-request';

    let html = '<div class="user-input-question">' + DOMPurify.sanitize(msg.question) + '</div>';

    if (msg.choices && msg.choices.length > 0) {
      html += '<div class="user-input-choices">';
      msg.choices.forEach((choice) => {
        html += '<button class="user-input-choice">' + DOMPurify.sanitize(choice) + '</button>';
      });
      html += '</div>';
    }

    if (msg.allowFreeform !== false) {
      html += '<div class="user-input-freeform">'
        + '<input type="text" class="user-input-text" placeholder="Type your answer…">'
        + '<button class="user-input-submit">Send</button>'
        + '</div>';
    }

    el.innerHTML = html;
    messagesEl.appendChild(el);

    // Bind choice buttons
    el.querySelectorAll('.user-input-choice').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.respondToUserInput(btn.textContent, false);
        el.remove();
      });
    });

    // Bind freeform input
    const textInput = el.querySelector('.user-input-text');
    const submitBtn = el.querySelector('.user-input-submit');
    if (textInput && submitBtn) {
      submitBtn.addEventListener('click', () => {
        if (textInput.value.trim()) {
          this.respondToUserInput(textInput.value, true);
          el.remove();
        }
      });
      textInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (textInput.value.trim()) {
            this.respondToUserInput(textInput.value, true);
            el.remove();
          }
        }
      });
      textInput.focus();
    }

    this.scrollToBottom();
  },

  respondToUserInput(answer, wasFreeform) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.pendingUserInput = false;
    this.ws.send(JSON.stringify({ type: 'user_input_response', answer, wasFreeform }));
  },

  // --- Tools management ---
  handleToolsList(tools) {
    const container = document.getElementById('settings-tools-list');
    if (!container) return;

    container.innerHTML = '';
    if (!tools || tools.length === 0) {
      container.innerHTML = '<div class="settings-hint">No tools available</div>';
      return;
    }

    // Group tools by source (MCP server vs built-in)
    const grouped = {};
    tools.forEach((tool) => {
      const group = tool.mcpServerName || 'built-in';
      if (!grouped[group]) grouped[group] = [];
      grouped[group].push(tool);
    });

    Object.keys(grouped).sort().forEach((groupName) => {
      const groupEl = document.createElement('div');
      groupEl.className = 'tools-group';
      const groupHeader = document.createElement('div');
      groupHeader.className = 'tools-group-header';
      groupHeader.textContent = groupName;
      groupEl.appendChild(groupHeader);

      grouped[groupName].forEach((tool) => {
        const toolName = tool.name || tool.toolName || 'unknown';
        const toolEl = document.createElement('div');
        toolEl.className = 'tool-item';
        const isExcluded = this.excludedTools.includes(toolName);

        const label = document.createElement('label');
        label.className = 'tool-toggle-label';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'tool-toggle-check';
        checkbox.dataset.tool = toolName;
        checkbox.checked = !isExcluded;

        const slider = document.createElement('span');
        slider.className = 'tool-toggle-slider';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'tool-toggle-name';
        nameSpan.textContent = toolName;

        label.appendChild(checkbox);
        label.appendChild(slider);
        label.appendChild(nameSpan);
        toolEl.appendChild(label);

        if (tool.description) {
          const descEl = document.createElement('div');
          descEl.className = 'tool-toggle-desc';
          descEl.textContent = tool.description;
          toolEl.appendChild(descEl);
        }

        checkbox.addEventListener('change', () => {
          if (checkbox.checked) {
            this.excludedTools = this.excludedTools.filter((t) => t !== toolName);
          } else {
            if (!this.excludedTools.includes(toolName)) {
              this.excludedTools.push(toolName);
            }
          }
          this.saveSettings();
          this.updateToolCount(tools.length);
        });

        groupEl.appendChild(toolEl);
      });

      container.appendChild(groupEl);
    });

    this.updateToolCount(tools.length);
  },

  updateToolCount(totalTools) {
    const total = totalTools || 0;
    const activeCount = Math.max(0, total - this.excludedTools.length);
    const envToolsEl = document.getElementById('env-tools-text');
    if (envToolsEl) {
      envToolsEl.textContent = activeCount + ' tool' + (activeCount !== 1 ? 's' : '') + ' active';
      const toolsLine = document.getElementById('env-tools-line');
      if (toolsLine) toolsLine.style.display = '';
    }
  },

  // --- Agent management ---
  handleAgentsList(agents, current) {
    this.currentAgent = current;
    this.updateAgentIndicator();

    const container = document.getElementById('settings-agents-list');
    if (!container) return;

    container.innerHTML = '';
    if (!agents || agents.length === 0) {
      container.innerHTML = '<div class="settings-hint">No agents available</div>';
      return;
    }

    agents.forEach((agent) => {
      const name = agent.name || agent;
      const el = document.createElement('div');
      el.className = 'agent-item' + (current === name ? ' active' : '');
      el.innerHTML =
        '<span class="agent-name">' + DOMPurify.sanitize(name) + '</span>' +
        (agent.description ? '<span class="agent-desc">' + DOMPurify.sanitize(agent.description) + '</span>' : '') +
        (current === name ? '<span class="agent-current">current</span>' : '');

      el.addEventListener('click', () => {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        if (current === name) {
          this.ws.send(JSON.stringify({ type: 'deselect_agent' }));
        } else {
          this.ws.send(JSON.stringify({ type: 'select_agent', name }));
        }
      });

      container.appendChild(el);
    });
  },

  updateAgentIndicator() {
    const el = document.getElementById('env-agent-text');
    const line = document.getElementById('env-agent-line');
    if (el && line) {
      if (this.currentAgent) {
        el.textContent = 'agent: @' + this.currentAgent;
        line.style.display = '';
      } else {
        line.style.display = 'none';
      }
    }
  },

  // --- Quota management ---
  handleQuota(data) {
    const container = document.getElementById('settings-quota-content');
    if (!container) return;

    container.innerHTML = '';

    if (data.chat) {
      const quota = data.chat;
      const used = quota.percentageUsed ?? 0;
      const remaining = 100 - used;
      const colorClass = used > 80 ? 'quota-red' : used > 50 ? 'quota-yellow' : 'quota-green';

      container.innerHTML =
        '<div class="quota-label">Chat quota</div>' +
        '<div class="quota-bar-container">' +
        '<div class="quota-bar ' + colorClass + '" style="width: ' + Math.min(used, 100) + '%"></div>' +
        '</div>' +
        '<div class="quota-text">' + Math.round(remaining) + '% remaining' +
        (quota.resetDate ? ' · resets ' + new Date(quota.resetDate).toLocaleDateString() : '') +
        '</div>';

      this.updateQuotaIndicator(used);
    } else {
      container.innerHTML = '<div class="settings-hint">Quota info not available</div>';
    }
  },

  updateQuotaIndicator(percentUsed) {
    const el = document.getElementById('quota-indicator');
    if (!el) return;
    el.style.display = '';
    el.className = 'quota-dot';
    if (percentUsed > 80) {
      el.classList.add('quota-red');
    } else if (percentUsed > 50) {
      el.classList.add('quota-yellow');
    } else {
      el.classList.add('quota-green');
    }
  },

  // --- Session history ---
  handleSessionsList(sessions) {
    const container = document.getElementById('settings-sessions-list');
    if (!container) return;

    container.innerHTML = '';
    if (!sessions || sessions.length === 0) {
      container.innerHTML = '<div class="settings-hint">No previous sessions</div>';
      return;
    }

    sessions.forEach((session) => {
      const el = document.createElement('div');
      el.className = 'session-item';
      const title = session.title || session.id || 'Untitled';
      const date = session.updatedAt ? new Date(session.updatedAt).toLocaleString() : '';
      const model = session.model || '';

      el.innerHTML =
        '<div class="session-item-title">' + DOMPurify.sanitize(title) + '</div>' +
        '<div class="session-item-meta">' +
        (model ? '<span>' + DOMPurify.sanitize(model) + '</span>' : '') +
        (date ? '<span>' + date + '</span>' : '') +
        '</div>';

      el.addEventListener('click', () => {
        if (!confirm('Resume this session? Current conversation will be replaced.')) return;
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        const messagesEl = document.getElementById('messages');
        messagesEl.innerHTML = '';
        this.ws.send(JSON.stringify({ type: 'resume_session', sessionId: session.id }));
        document.getElementById('settings-overlay').style.display = 'none';
      });

      container.appendChild(el);
    });
  },

  // --- Plan management ---
  _planRawContent: '',

  handlePlan(data) {
    const panel = document.getElementById('plan-panel');
    if (!panel) return;

    if (data.exists && data.content) {
      panel.style.display = '';
      this._planRawContent = data.content;
      const contentEl = document.getElementById('plan-content');
      if (contentEl) {
        try {
          const rawHtml = marked.parse(data.content, { breaks: true, gfm: true });
          contentEl.innerHTML = DOMPurify.sanitize(rawHtml);
        } catch {
          contentEl.textContent = data.content;
        }
      }
    } else {
      panel.style.display = 'none';
      this._planRawContent = '';
    }
  },

  // --- Compaction ---
  requestCompact() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.sessionReady) return;
    this.ws.send(JSON.stringify({ type: 'compact' }));
  },

  // --- Skill display ---
  addSkillMessage(skillName) {
    const messagesEl = document.getElementById('messages');
    const el = document.createElement('div');
    el.className = 'tool-call completed';
    el.innerHTML =
      '<span class="tool-icon">⚡</span>' +
      '<span class="tool-name">skill/' + DOMPurify.sanitize(skillName || 'unknown') + '</span>' +
      '<span class="tool-status">invoked</span>';
    messagesEl.appendChild(el);
    this.scrollToBottom();
  },
};



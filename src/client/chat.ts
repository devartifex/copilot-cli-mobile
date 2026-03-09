// Chat module — handles WebSocket communication and message rendering

interface WsMessage {
  type: string;
  [key: string]: unknown;
}

interface ModelCapabilities {
  supports?: { reasoningEffort?: boolean; vision?: boolean };
  limits?: { max_context_window_tokens?: number; max_prompt_tokens?: number };
}

interface ModelInfo {
  id?: string;
  name?: string;
  capabilities?: ModelCapabilities;
  billing?: { multiplier?: number };
  defaultReasoningEffort?: string;
  supportedReasoningEfforts?: string[];
}

interface ToolInfo {
  name?: string;
  toolName?: string;
  namespacedName?: string;
  mcpServerName?: string;
  description?: string;
}

interface AgentInfo {
  name?: string;
  description?: string;
}

interface SessionInfo {
  id?: string;
  title?: string;
  model?: string;
  updatedAt?: string;
}

interface QuotaData {
  percentageUsed?: number;
  resetDate?: string;
}

interface ChatQuota {
  chat?: QuotaData;
}

interface PlanData {
  exists?: boolean;
  content?: string;
}

interface UserInputRequestMsg {
  question: string;
  choices?: string[];
  allowFreeform?: boolean;
}

interface UsageMsg {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
}

interface ToolStartMsg {
  toolCallId: string;
  toolName?: string;
  mcpToolName?: string;
  mcpServerName?: string;
}

interface ToolProgressMsg {
  toolCallId: string;
  message?: string;
}

export const Chat = {
  ws: null as WebSocket | null,
  reconnectTimer: null as ReturnType<typeof setTimeout> | null,
  reconnectDelay: 3000,
  currentAssistantEl: null as HTMLElement | null,
  currentContent: '',
  isStreaming: false,
  currentReasoningEl: null as HTMLElement | null,
  currentReasoningContent: '',
  activeTools: new Map<string, HTMLElement>(),
  _renderPending: false,
  _renderTimer: null as ReturnType<typeof setTimeout> | null,
  _spinnerInterval: null as ReturnType<typeof setInterval> | null,
  sessionReady: false,
  pendingUserInput: false,
  reasoningEffort: 'medium',
  customInstructions: '',
  excludedTools: [] as string[],
  modelsMap: new Map<string, ModelInfo>(),
  currentAgent: null as string | null,

  // --- localStorage persistence ---
  _storageKey: 'copilot-cli-settings',

  loadSettings(): void {
    try {
      const raw = localStorage.getItem(this._storageKey);
      if (!raw) return;
      const s = JSON.parse(raw) as {
        model?: string;
        mode?: string;
        reasoningEffort?: string;
        customInstructions?: string;
        excludedTools?: string[];
      };
      if (s.model) {
        const modelSelect = document.getElementById('model-select') as HTMLSelectElement | null;
        if (modelSelect) modelSelect.value = s.model;
        const modelLabel = document.getElementById('model-label');
        if (modelLabel) modelLabel.textContent = s.model;
      }
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

  saveSettings(): void {
    const modelSelect = document.getElementById('model-select') as HTMLSelectElement | null;
    const model = modelSelect?.value ?? '';
    const modeBtn = document.querySelector('#mode-toggle .mode-opt.active') as HTMLElement | null;
    const mode = modeBtn?.dataset['mode'] ?? 'interactive';
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


  connect(): void {
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
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

    this.ws.onmessage = (e: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(e.data) as WsMessage;
        this.handleMessage(msg);
      } catch (err) {
        console.error('WS parse error:', err);
      }
    };

    this.ws.onclose = (e: CloseEvent) => {
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

  handleMessage(msg: WsMessage): void {
    switch (msg.type) {
      case 'connected':
        {
          const userBadge = document.getElementById('user-badge');
          if (userBadge) userBadge.textContent = '@' + ((msg['user'] as string) || '');
          this.sessionReady = false;
          this.disableInput();
          this.requestNewSession();
        }
        break;

      case 'session_created':
        this.sessionReady = true;
        this.setStatus('connected');
        this.enableInput();
        break;

      case 'turn_start':
        // Reset state for a new assistant turn — keep existing reasoning block if pre-created
        this.currentReasoningContent = '';
        this.activeTools.clear();
        break;

      case 'reasoning_delta':
        if (!this.currentReasoningEl) {
          this.currentReasoningEl = this.addReasoningBlock();
        }
        this.currentReasoningContent += (msg['content'] as string) ?? '';
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
        this.dismissPendingThinking();
        this.addIntentMessage((msg['intent'] as string) ?? '');
        this.scrollToBottom();
        break;

      case 'tool_start':
        this.dismissPendingThinking();
        this.addToolStart(msg as unknown as ToolStartMsg);
        this.scrollToBottom();
        break;

      case 'tool_progress':
        this.updateToolProgress(msg as unknown as ToolProgressMsg);
        this.scrollToBottom();
        break;

      case 'tool_end':
        this.completeToolCall((msg['toolCallId'] as string) ?? '');
        this.scrollToBottom();
        break;

      case 'delta':
        this.dismissPendingThinking();
        if (!this.currentAssistantEl) {
          this.currentAssistantEl = this.addMessage('assistant', '');
          this.currentContent = '';
          this.isStreaming = true;
        }
        this.currentContent += (msg['content'] as string) ?? '';
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
        this.populateModels((msg['models'] as (string | ModelInfo)[]) ?? []);
        break;

      case 'mode_changed':
        this.syncModeSelect((msg['mode'] as string) ?? '');
        break;

      case 'title_changed':
        this.setSessionTitle((msg['title'] as string) ?? '');
        break;

      case 'usage':
        this.showUsage(msg as unknown as UsageMsg);
        break;

      case 'warning':
        this.addWarningMessage((msg['message'] as string) ?? '');
        break;

      case 'model_changed':
        if (msg['source'] === 'sdk') {
          // SDK-initiated model switch — update the dropdown
          const modelSelect = document.getElementById('model-select') as HTMLSelectElement | null;
          if (modelSelect && msg['model']) {
            const modelId = msg['model'] as string;
            if ([...modelSelect.options].some((o) => o.value === modelId)) {
              modelSelect.value = modelId;
            }
            this.updateReasoningVisibility(modelId);
          }
        }
        this.addInfoMessage('Model changed to ' + (msg['model'] as string));
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
        this.showUserInputRequest(msg as unknown as UserInputRequestMsg);
        break;

      case 'subagent_start':
        this.addSubagentMessage((msg['agentName'] as string) ?? '', 'started');
        this.scrollToBottom();
        break;

      case 'subagent_end':
        this.addSubagentMessage((msg['agentName'] as string) ?? '', 'completed');
        this.scrollToBottom();
        break;

      case 'error':
        this.addErrorMessage((msg['message'] as string) ?? '');
        this.hideStopButton();
        this.enableInput();
        this.isStreaming = false;
        this.currentAssistantEl = null;
        break;

      case 'tools':
        this.handleToolsList((msg['tools'] as ToolInfo[]) ?? []);
        break;

      case 'agents':
        this.handleAgentsList(
          (msg['agents'] as AgentInfo[]) ?? [],
          (msg['current'] as string | null) ?? null,
        );
        break;

      case 'agent_changed':
        this.currentAgent = (msg['agent'] as string | null) ?? null;
        this.updateAgentIndicator();
        this.addInfoMessage(this.currentAgent ? 'Agent selected: @' + this.currentAgent : 'Agent deselected');
        break;

      case 'quota':
        this.handleQuota(msg as unknown as ChatQuota);
        break;

      case 'sessions':
        this.handleSessionsList((msg['sessions'] as SessionInfo[]) ?? []);
        break;

      case 'session_resumed':
        this.sessionReady = true;
        this.setStatus('connected');
        this.enableInput();
        this.addInfoMessage('Session resumed: ' + (msg['sessionId'] as string));
        break;

      case 'plan':
        this.handlePlan(msg as unknown as PlanData);
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
          (msg['tokensRemoved'] ? ': removed ' + String(msg['tokensRemoved']) + ' tokens' : '') +
          (msg['messagesRemoved'] ? ', ' + String(msg['messagesRemoved']) + ' messages' : ''));
        break;

      case 'compaction_result':
        this.addInfoMessage('Compaction result' +
          (msg['tokensRemoved'] ? ': removed ' + String(msg['tokensRemoved']) + ' tokens' : '') +
          (msg['messagesRemoved'] ? ', ' + String(msg['messagesRemoved']) + ' messages' : ''));
        break;

      case 'skill_invoked':
        this.addSkillMessage((msg['skillName'] as string) ?? '');
        break;

      case 'subagent_failed':
        this.addErrorMessage('Sub-agent ' + ((msg['agentName'] as string) || 'unknown') + ' failed' +
          (msg['error'] ? ': ' + String(msg['error']) : ''));
        break;

      case 'subagent_selected':
        this.currentAgent = (msg['agentName'] as string) ?? null;
        this.updateAgentIndicator();
        break;

      case 'subagent_deselected':
        this.currentAgent = null;
        this.updateAgentIndicator();
        break;

      case 'info':
        this.addInfoMessage((msg['message'] as string) || 'Info');
        break;

      case 'elicitation_requested':
        this.showUserInputRequest(msg as unknown as UserInputRequestMsg);
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
  scheduleRender(): void {
    if (this._renderPending) return;
    this._renderPending = true;
    this._renderTimer = setTimeout(() => {
      this._renderPending = false;
      this.renderAssistantContent();
      this.scrollToBottom();
    }, 50);
  },

  flushRender(): void {
    if (this._renderTimer) {
      clearTimeout(this._renderTimer);
      this._renderTimer = null;
    }
    this._renderPending = false;
  },

  renderAssistantContent(): void {
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
        const el = block as HTMLElement;
        if (!el.dataset['highlighted']) {
          try { hljs.highlightElement(el); } catch { /* ignore */ }
          el.dataset['highlighted'] = 'true';
        }
      });
    } catch {
      (contentEl as HTMLElement).textContent = this.currentContent;
    }
  },

  addCopyButtons(messageEl: HTMLElement): void {
    const blocks = messageEl.querySelectorAll('pre');
    blocks.forEach((pre) => {
      if (pre.querySelector('.copy-btn')) return;
      const btn = document.createElement('button');
      btn.className = 'copy-btn';
      btn.textContent = 'Copy';
      btn.addEventListener('click', () => {
        const code = pre.querySelector('code');
        navigator.clipboard.writeText(code ? code.textContent ?? '' : pre.textContent ?? '')
          .then(() => {
            btn.textContent = 'Copied!';
            setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
          }).catch(() => { /* ignore clipboard errors */ });
      });
      pre.style.position = 'relative';
      pre.appendChild(btn);
    });
  },

  send(content: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!content.trim()) return;

    this.addMessage('user', content);
    this.disableInput();
    this.showStopButton();

    // Show thinking indicator immediately before server responds
    this.currentReasoningEl = this.addReasoningBlock();
    this.currentReasoningContent = '';
    this.scrollToBottom();

    this.ws.send(JSON.stringify({ type: 'message', content }));
  },

  isReasoningModel(modelId: string): boolean {
    const model = this.modelsMap.get(modelId);
    if (model?.capabilities) {
      return model.capabilities.supports?.reasoningEffort === true;
    }
    return false;
  },

  updateReasoningVisibility(modelId: string): void {
    const toggle = document.getElementById('reasoning-toggle');
    if (!toggle) return;
    const isReasoning = this.isReasoningModel(modelId);
    toggle.style.display = isReasoning ? '' : 'none';

    const sidebarSection = document.getElementById('sidebar-reasoning-section');
    if (sidebarSection) sidebarSection.style.display = isReasoning ? '' : 'none';

    if (isReasoning) {
      const model = this.modelsMap.get(modelId);
      // Reset to model's default reasoning effort when switching models
      if (model?.defaultReasoningEffort) {
        this.reasoningEffort = model.defaultReasoningEffort;
      }
      this.buildReasoningButtons(model ?? null);
    }
  },

  buildReasoningButtons(model: ModelInfo | null): void {
    const toggle = document.getElementById('reasoning-toggle');
    if (!toggle) return;

    const supportedEfforts = model?.supportedReasoningEfforts ?? ['low', 'medium', 'high', 'xhigh'];
    const defaultEffort = model?.defaultReasoningEffort ?? 'medium';

    const effortLabels: Record<string, string> = { low: 'low', medium: 'med', high: 'high', xhigh: 'max' };

    // Only rebuild if the effort options differ
    const currentEfforts = [...toggle.querySelectorAll('.reasoning-opt')].map((b) => (b as HTMLElement).dataset['effort'] ?? '');
    const currentSet = new Set(currentEfforts);
    const newSet = new Set(supportedEfforts);
    const sameEfforts = currentSet.size === newSet.size && [...currentSet].every((e) => newSet.has(e));
    if (sameEfforts) return;

    toggle.innerHTML = '';
    supportedEfforts.forEach((effort) => {
      const btn = document.createElement('button');
      btn.className = 'reasoning-opt';
      btn.dataset['effort'] = effort;
      btn.textContent = effortLabels[effort] ?? effort;
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
    const firstChild = toggle.firstChild as HTMLElement | null;
    if (!toggle.querySelector('.reasoning-opt.active') && firstChild) {
      firstChild.classList.add('active');
      this.reasoningEffort = firstChild.dataset['effort'] ?? 'medium';
    }
  },

  setReasoning(effort: string): void {
    this.reasoningEffort = effort;
    document.querySelectorAll('#reasoning-toggle .reasoning-opt').forEach((b) => {
      const btn = b as HTMLElement;
      btn.classList.toggle('active', btn.dataset['effort'] === effort);
    });
    this.saveSettings();
    // Restart session so the new effort takes effect immediately
    this.newChat();
  },

  requestNewSession(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const modelSelect = document.getElementById('model-select') as HTMLSelectElement | null;
    const model = modelSelect?.value ?? '';
    const sessionMsg: Record<string, unknown> = { type: 'new_session', model };
    if (this.isReasoningModel(model)) {
      sessionMsg['reasoningEffort'] = this.reasoningEffort;
    }
    if (this.customInstructions.trim()) {
      sessionMsg['customInstructions'] = this.customInstructions.trim();
    }
    if (this.excludedTools.length > 0) {
      sessionMsg['excludedTools'] = this.excludedTools;
    }
    this.clearSessionTitle();
    this.saveSettings();
    this.ws.send(JSON.stringify(sessionMsg));
    this.ws.send(JSON.stringify({ type: 'list_models' }));
  },

  setMode(mode: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.sessionReady) return;
    this.ws.send(JSON.stringify({ type: 'set_mode', mode }));
  },

  syncModeSelect(mode: string): void {
    const btns = document.querySelectorAll('#mode-toggle .mode-opt');
    btns.forEach((b) => {
      const btn = b as HTMLElement;
      btn.classList.toggle('active', btn.dataset['mode'] === mode);
    });
    const statusIndicator = document.getElementById('status-indicator') as HTMLElement | null;
    if (statusIndicator) statusIndicator.dataset['mode'] = mode;
  },

  newChat(): void {
    const messagesEl = document.getElementById('messages');
    if (messagesEl) messagesEl.innerHTML = '';
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

  addMessage(role: string, content: string): HTMLElement {
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
      const activeMode = document.querySelector('#mode-toggle .mode-opt.active') as HTMLElement | null;
      if (activeMode) prompt.dataset['mode'] = activeMode.dataset['mode'] ?? '';
      const text = document.createElement('span');
      text.className = 'user-text';
      text.textContent = content;
      promptLine.appendChild(prompt);
      promptLine.appendChild(text);
      el.appendChild(promptLine);
    } else {
      // Assistant message with role marker
      const markerSpan = document.createElement('span');
      markerSpan.className = 'assistant-marker';
      markerSpan.textContent = '◆';
      el.appendChild(markerSpan);
      const contentDiv = document.createElement('div');
      contentDiv.className = 'content';
      el.appendChild(contentDiv);
    }

    messagesEl?.appendChild(el);
    this.scrollToBottom();
    return el;
  },

  addErrorMessage(message: string): void {
    const messagesEl = document.getElementById('messages');
    const el = document.createElement('div');
    el.className = 'message error';
    el.textContent = message;
    messagesEl?.appendChild(el);
    this.scrollToBottom();
  },

  populateModels(models: (string | ModelInfo)[]): void {
    const select = document.getElementById('model-select') as HTMLSelectElement | null;
    if (!select) return;
    if (!models || !Array.isArray(models) || models.length === 0) return;

    const currentValue = select.value;
    select.innerHTML = '';
    this.modelsMap.clear();

    models.forEach((model) => {
      const id = typeof model === 'string' ? model : model.id ?? model.name;
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
        const hints: string[] = [];
        if (model.capabilities?.supports?.vision) hints.push('👁');
        if (model.capabilities?.supports?.reasoningEffort) hints.push('🧠');
        if (model.billing?.multiplier && model.billing.multiplier > 1) hints.push(model.billing.multiplier + '×');
        if (hints.length > 0) label += ' ' + hints.join('');
      }
      opt.textContent = label;

      // Add tooltip with full model info
      if (typeof model === 'object' && model.capabilities) {
        const parts: string[] = [];
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

    // Sync inline model label
    const modelLabel = document.getElementById('model-label');
    if (modelLabel) modelLabel.textContent = select.value;

    // Show/hide reasoning effort selector based on selected model
    this.updateReasoningVisibility(select.value);
  },

  // Remove the pre-created thinking block if the response doesn't use reasoning
  dismissPendingThinking(): void {
    if (this.currentReasoningEl && !this.currentReasoningContent) {
      this.currentReasoningEl.remove();
      this.currentReasoningEl = null;
    }
  },

  addReasoningBlock(): HTMLElement {
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
    messagesEl?.appendChild(el);
    return el;
  },

  renderReasoningContent(): void {
    if (!this.currentReasoningEl) return;
    const contentEl = this.currentReasoningEl.querySelector('.reasoning-content');
    if (!contentEl) return;
    contentEl.textContent = this.currentReasoningContent;
  },

  addIntentMessage(intent: string): void {
    const messagesEl = document.getElementById('messages');
    const el = document.createElement('div');
    el.className = 'intent-line';
    el.innerHTML = '<span class="intent-icon">→</span> ' + DOMPurify.sanitize(intent);
    messagesEl?.appendChild(el);
  },

  addToolStart(msg: ToolStartMsg): void {
    const messagesEl = document.getElementById('messages');
    const el = document.createElement('div');
    el.className = 'tool-call';
    el.dataset['toolCallId'] = msg.toolCallId;

    const displayName = msg.mcpToolName
      ? `${msg.mcpServerName ?? 'mcp'}/${msg.mcpToolName}`
      : msg.toolName ?? '';

    el.innerHTML =
      '<span class="tool-icon spinner-char">⠋</span>' +
      '<span class="tool-name">' + DOMPurify.sanitize(displayName) + '</span>' +
      '<span class="tool-status">running…</span>';

    messagesEl?.appendChild(el);
    this.activeTools.set(msg.toolCallId, el);
    this.startSpinners();
  },

  startSpinners(): void {
    if (this._spinnerInterval) return;
    const chars = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
    let i = 0;
    this._spinnerInterval = setInterval(() => {
      const spinners = document.querySelectorAll('.tool-call:not(.completed) .spinner-char');
      if (spinners.length === 0) {
        if (this._spinnerInterval) {
          clearInterval(this._spinnerInterval);
          this._spinnerInterval = null;
        }
        return;
      }
      i = (i + 1) % chars.length;
      spinners.forEach((s) => { s.textContent = chars[i] ?? ''; });
    }, 80);
  },

  updateToolProgress(msg: ToolProgressMsg): void {
    const el = this.activeTools.get(msg.toolCallId);
    if (!el) return;
    const status = el.querySelector('.tool-status');
    if (status && msg.message) {
      status.textContent = ' ' + msg.message;
    }
  },

  completeToolCall(toolCallId: string): void {
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

  scrollToBottom(): void {
    const el = document.getElementById('messages');
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    });
  },

  setStatus(status: string): void {
    const prompt = document.getElementById('status-indicator');
    const text = document.getElementById('status-text');

    // Update prompt color
    if (prompt) prompt.className = `term-prompt ${status}`;

    const labels: Record<string, string> = {
      connected: '',
      disconnected: 'Disconnected — reconnecting...',
      connecting: 'Connecting...',
    };
    if (text) text.textContent = labels[status] ?? status;
  },

  enableInput(): void {
    const input = document.getElementById('message-input') as HTMLTextAreaElement | null;
    if (!input) return;
    input.disabled = false;
    input.focus();
  },

  disableInput(): void {
    const input = document.getElementById('message-input') as HTMLTextAreaElement | null;
    if (input) input.disabled = true;
  },

  initViewportHandler(): void {
    // On mobile, virtual keyboard resizes the visual viewport.
    // Adjust the app height so the input stays above the keyboard.
    if (window.visualViewport) {
      const handler = () => {
        const vvh = window.visualViewport?.height ?? window.innerHeight;
        document.documentElement.style.setProperty('--vh', `${vvh}px`);
        this.scrollToBottom();
      };
      window.visualViewport.addEventListener('resize', handler);
      handler();
    }
  },

  abort(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'abort' }));
  },

  changeModel(model: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.sessionReady) return;
    this.ws.send(JSON.stringify({ type: 'set_model', model }));
    const modelLabel = document.getElementById('model-label');
    if (modelLabel) modelLabel.textContent = model;
    this.saveSettings();
  },

  showStopButton(): void {
    const btn = document.getElementById('stop-btn');
    if (btn) btn.style.display = '';
  },

  hideStopButton(): void {
    const btn = document.getElementById('stop-btn');
    if (btn) btn.style.display = 'none';
  },

  setSessionTitle(title: string): void {
    const line = document.getElementById('session-title-line');
    const text = document.getElementById('session-title-text');
    if (line && text && title) {
      text.textContent = title;
      line.style.display = '';
    }
  },

  clearSessionTitle(): void {
    const line = document.getElementById('session-title-line');
    if (line) line.style.display = 'none';
  },

  showUsage(msg: UsageMsg): void {
    const parts: string[] = [];
    if (msg.inputTokens) parts.push(`in: ${msg.inputTokens}`);
    if (msg.outputTokens) parts.push(`out: ${msg.outputTokens}`);
    if (msg.reasoningTokens) parts.push(`reasoning: ${msg.reasoningTokens}`);
    if (parts.length === 0) return;

    const messagesEl = document.getElementById('messages');
    const el = document.createElement('div');
    el.className = 'usage-line';
    el.textContent = 'tokens — ' + parts.join(' · ');
    messagesEl?.appendChild(el);
  },

  addWarningMessage(message: string): void {
    const messagesEl = document.getElementById('messages');
    const el = document.createElement('div');
    el.className = 'message warning';
    el.textContent = '⚠ ' + message;
    messagesEl?.appendChild(el);
    this.scrollToBottom();
  },

  addInfoMessage(message: string): void {
    const messagesEl = document.getElementById('messages');
    const el = document.createElement('div');
    el.className = 'info-line';
    el.textContent = message;
    messagesEl?.appendChild(el);
    this.scrollToBottom();
  },

  addSubagentMessage(agentName: string, status: string): void {
    const messagesEl = document.getElementById('messages');
    const el = document.createElement('div');
    el.className = 'tool-call' + (status === 'completed' ? ' completed' : '');
    const icon = status === 'completed' ? '✓' : '⠋';
    const iconClass = status === 'completed' ? 'tool-icon' : 'tool-icon spinner-char';
    el.innerHTML =
      '<span class="' + iconClass + '">' + icon + '</span>' +
      '<span class="tool-name">agent/' + DOMPurify.sanitize(agentName || 'unknown') + '</span>' +
      '<span class="tool-status">' + status + '</span>';
    messagesEl?.appendChild(el);
    if (status !== 'completed') this.startSpinners();
  },

  showUserInputRequest(msg: UserInputRequestMsg): void {
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
    messagesEl?.appendChild(el);

    // Bind choice buttons
    el.querySelectorAll('.user-input-choice').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.respondToUserInput(btn.textContent ?? '', false);
        el.remove();
      });
    });

    // Bind freeform input
    const textInput = el.querySelector('.user-input-text') as HTMLInputElement | null;
    const submitBtn = el.querySelector('.user-input-submit');
    if (textInput && submitBtn) {
      submitBtn.addEventListener('click', () => {
        if (textInput.value.trim()) {
          this.respondToUserInput(textInput.value, true);
          el.remove();
        }
      });
      textInput.addEventListener('keydown', (e: Event) => {
        const ke = e as KeyboardEvent;
        if (ke.key === 'Enter') {
          ke.preventDefault();
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

  respondToUserInput(answer: string, wasFreeform: boolean): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.pendingUserInput = false;
    this.ws.send(JSON.stringify({ type: 'user_input_response', answer, wasFreeform }));
  },

  // --- Tools management ---
  handleToolsList(tools: ToolInfo[]): void {
    const container = document.getElementById('settings-tools-list');
    if (!container) return;

    container.innerHTML = '';
    if (!tools || tools.length === 0) {
      container.innerHTML = '<div class="settings-hint">No tools available</div>';
      return;
    }

    // Group tools by source (MCP server vs built-in)
    const grouped: Record<string, ToolInfo[]> = {};
    tools.forEach((tool) => {
      // Derive MCP server name from namespacedName (e.g. "github/tool_name")
      let group = 'built-in';
      if (tool.mcpServerName) {
        group = tool.mcpServerName;
      } else if (tool.namespacedName?.includes('/')) {
        group = tool.namespacedName.split('/')[0] ?? 'built-in';
      }
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

      (grouped[groupName] ?? []).forEach((tool) => {
        const toolName = tool.name ?? tool.toolName ?? 'unknown';
        const toolEl = document.createElement('div');
        toolEl.className = 'tool-item';
        const isExcluded = this.excludedTools.includes(toolName);

        const label = document.createElement('label');
        label.className = 'tool-toggle-label';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'tool-toggle-check';
        checkbox.dataset['tool'] = toolName;
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

    this.updateToolCount(tools.length, grouped);
  },

  updateToolCount(totalTools: number, grouped?: Record<string, ToolInfo[]>): void {
    const total = totalTools || 0;
    const activeCount = Math.max(0, total - this.excludedTools.length);
    const envToolsEl = document.getElementById('env-tools-text');
    if (envToolsEl) {
      let text = activeCount + ' tool' + (activeCount !== 1 ? 's' : '') + ' active';
      if (grouped) {
        const mcpCount = Object.keys(grouped).filter((g) => g !== 'built-in').length;
        if (mcpCount > 0) {
          text += ' · ' + mcpCount + ' MCP server' + (mcpCount !== 1 ? 's' : '');
        }
      }
      envToolsEl.textContent = text;
      const toolsLine = document.getElementById('env-tools-line');
      if (toolsLine) toolsLine.style.display = '';
    }
  },

  // --- Agent management ---
  handleAgentsList(agents: AgentInfo[], current: string | null): void {
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
      const name = agent.name ?? String(agent);
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

  updateAgentIndicator(): void {
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
  handleQuota(data: ChatQuota): void {
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

  updateQuotaIndicator(percentUsed: number): void {
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
  handleSessionsList(sessions: SessionInfo[]): void {
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
      const title = session.title ?? session.id ?? 'Untitled';
      const date = session.updatedAt ? new Date(session.updatedAt).toLocaleString() : '';
      const model = session.model ?? '';

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
        if (messagesEl) messagesEl.innerHTML = '';
        this.ws.send(JSON.stringify({ type: 'resume_session', sessionId: session.id }));
        const settingsOverlay = document.getElementById('settings-overlay');
        if (settingsOverlay) settingsOverlay.style.display = 'none';
      });

      container.appendChild(el);
    });
  },

  // --- Plan management ---
  _planRawContent: '',

  handlePlan(data: PlanData): void {
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
  requestCompact(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.sessionReady) return;
    this.ws.send(JSON.stringify({ type: 'compact' }));
  },

  // --- Skill display ---
  addSkillMessage(skillName: string): void {
    const messagesEl = document.getElementById('messages');
    const el = document.createElement('div');
    el.className = 'tool-call completed';
    el.innerHTML =
      '<span class="tool-icon">⚡</span>' +
      '<span class="tool-name">skill/' + DOMPurify.sanitize(skillName || 'unknown') + '</span>' +
      '<span class="tool-status">invoked</span>';
    messagesEl?.appendChild(el);
    this.scrollToBottom();
  },
};

<script lang="ts">
  import DeviceFlowLogin from '$lib/components/DeviceFlowLogin.svelte';
  import MessageList from '$lib/components/MessageList.svelte';
  import ChatInput from '$lib/components/ChatInput.svelte';
  import Banner from '$lib/components/Banner.svelte';
  import EnvInfo from '$lib/components/EnvInfo.svelte';
  import PlanPanel from '$lib/components/PlanPanel.svelte';
  import PermissionPrompt from '$lib/components/PermissionPrompt.svelte';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import SettingsModal from '$lib/components/SettingsModal.svelte';
  import SessionsSheet from '$lib/components/SessionsSheet.svelte';
  import TopBar from '$lib/components/TopBar.svelte';
  import ModelSheet from '$lib/components/ModelSheet.svelte';
  import { createWsStore } from '$lib/stores/ws.svelte.js';
  import { createChatStore } from '$lib/stores/chat.svelte.js';
  import { createSettingsStore } from '$lib/stores/settings.svelte.js';
  import type { Attachment, SessionMode, ReasoningEffort } from '$lib/types/index.js';

  let { data } = $props();

  // ── Stores ─────────────────────────────────────────────────────────────
  const wsStore = createWsStore();
  const chatStore = createChatStore(wsStore);
  const settings = createSettingsStore();

  // ── UI state ───────────────────────────────────────────────────────────
  let sidebarOpen = $state(false);
  let settingsOpen = $state(false);
  let sessionsOpen = $state(false);
  let modelSheetOpen = $state(false);
  let sessionsLoading = $state(false);

  const modelCount = $derived(chatStore.models.size);
  const toolCount = $derived(chatStore.tools.length);
  const mcpServerCount = $derived(
    new Set(chatStore.tools.filter(t => t.mcpServerName).map(t => t.mcpServerName)).size
  );

  const activeSkillCount = $derived(
    settings.availableSkills.length - settings.disabledSkills.length
  );

  const modeStyle = $derived.by(() => {
    switch (chatStore.mode) {
      case 'plan':
        return '--mode-color:#58a6ff;--mode-border:rgba(88,166,255,0.45);--mode-user-bg:rgba(88,166,255,0.10);--mode-user-border:rgba(88,166,255,0.22);--mode-banner-bg:rgba(88,166,255,0.07)';
      case 'autopilot':
        return '--mode-color:#3fb950;--mode-border:rgba(63,185,80,0.45);--mode-user-bg:rgba(63,185,80,0.10);--mode-user-border:rgba(63,185,80,0.22);--mode-banner-bg:rgba(63,185,80,0.07)';
      default:
        return '--mode-color:#d2a8ff;--mode-border:#5a3e8e;--mode-user-bg:rgba(110,64,201,0.12);--mode-user-border:rgba(110,64,201,0.20);--mode-banner-bg:rgba(110,64,201,0.08)';
    }
  });

  // ── Debug: trace data.authenticated changes ──────────────────────────
  $effect(() => {
    console.log(`[PAGE] data.authenticated=${data.authenticated} user=${JSON.stringify(data.user)}`);
  });

  // ── Lifecycle ──────────────────────────────────────────────────────────
  $effect(() => {
    if (data.authenticated) {
      console.log(`[PAGE] authenticated=true, loading settings & connecting WS`);
      settings.load();
      settings.syncFromServer();
      settings.fetchSkills();
      wsStore.connect();

      // Wire WS messages → chat store
      const unsub = wsStore.onMessage((msg) => {
        console.log(`[PAGE] WS message received: type=${msg.type}`, msg);
        chatStore.handleServerMessage(msg);

        // Auto-request new session on first connect
        if (msg.type === 'connected') {
          console.log('[PAGE] Got connected, calling requestNewSession()');
          requestNewSession();
        }

        // Auto-request new session if reconnected without one
        if (msg.type === 'session_reconnected' && !msg.hasSession) {
          console.log('[PAGE] Got session_reconnected without session, calling requestNewSession()');
          requestNewSession();
        }

        // Auto-request models on session created
        if (msg.type === 'session_created' || msg.type === 'session_reconnected') {
          console.log('[PAGE] Got session_created/reconnected, calling listModels()');
          wsStore.listModels();
        }

        // Auto-request models, plan, tools, and agents on session resumed
        if (msg.type === 'session_resumed') {
          wsStore.listModels();
          wsStore.getPlan();
          wsStore.listTools();
          wsStore.listAgents();
        }

        // Sync mode from SDK to settings on mode_changed (covers resumed sessions)
        if (msg.type === 'mode_changed') {
          settings.selectedMode = msg.mode;
        }

        // Clear sessions loading state
        if (msg.type === 'sessions') {
          sessionsLoading = false;
        }
      });

      return () => {
        console.log('[PAGE] effect cleanup: unsubscribing and disconnecting WS');
        unsub();
        wsStore.disconnect();
      };
    } else {
      console.log(`[PAGE] authenticated=false, showing login screen`);
    }
  });

  // Auto-refresh session list while the panel is open
  $effect(() => {
    if (!sessionsOpen) return;

    const interval = setInterval(() => {
      wsStore.listSessions();
    }, 30_000);

    return () => clearInterval(interval);
  });

  // ── Helpers ────────────────────────────────────────────────────────────
  function requestNewSession(): void {
    const model = settings.selectedModel || 'gpt-4.1';
    const modelInfo = chatStore.models.get(model);
    const isReasoning = modelInfo?.capabilities?.supports?.reasoningEffort;

    wsStore.newSession({
      model,
      mode: settings.selectedMode,
      ...(isReasoning && { reasoningEffort: settings.reasoningEffort }),
      ...(settings.customInstructions.trim() && { customInstructions: settings.customInstructions.trim() }),
      ...(settings.excludedTools.length > 0 && { excludedTools: settings.excludedTools }),
      ...(settings.customTools.length > 0 && { customTools: settings.customTools }),
      ...(settings.customAgents.length > 0 && { customAgents: settings.customAgents }),
      ...(settings.mcpServers.length > 0 && { mcpServers: settings.mcpServers.filter(s => s.enabled) }),
      ...(settings.disabledSkills.length > 0 && { disabledSkills: settings.disabledSkills }),
      infiniteSessions: settings.infiniteSessions,
    });
  }

  function handleSend(content: string, attachments?: Attachment[]): void {
    const trimmed = content.trim();

    // Handle /fleet command — with or without trailing space
    if (trimmed === '/fleet' || trimmed.startsWith('/fleet ')) {
      const prompt = trimmed.slice(6).trim();
      if (!prompt) {
        chatStore.addUserMessage(content);
        chatStore.handleServerMessage({ type: 'error', message: 'Usage: /fleet <prompt> — describe the task for parallel agents' } as any);
        return;
      }
      chatStore.addUserMessage(content);
      wsStore.send({ type: 'start_fleet', prompt });
      return;
    }

    chatStore.addUserMessage(content, attachments);
    const mode = chatStore.isStreaming ? 'immediate' : undefined;
    wsStore.sendMessage(content, attachments, mode);
  }

  function handleNewChat(): void {
    chatStore.clearMessages();
    requestNewSession();
    sidebarOpen = false;
  }

  function handleSetMode(mode: SessionMode): void {
    wsStore.setMode(mode);
    settings.selectedMode = mode;
  }

  function handleSetModel(model: string): void {
    wsStore.setModel(model);
    settings.selectedModel = model;
  }

  function handleSetReasoning(effort: ReasoningEffort): void {
    settings.reasoningEffort = effort;
    // Restart session with new reasoning effort
    chatStore.clearMessages();
    requestNewSession();
  }

  function handleLogout(): void {
    sidebarOpen = false;
    fetch('/auth/logout', { method: 'POST' }).then(() => {
      window.location.reload();
    });
  }

  function handleOpenSessions(): void {
    sidebarOpen = false;
    sessionsOpen = true;
    sessionsLoading = true;
    wsStore.listSessions();
  }

  function handleResumeSession(sessionId: string): void {
    chatStore.clearMessages();
    wsStore.resumeSession(sessionId, settings.mcpServers);
    sessionsOpen = false;
  }

  function handleOpenSettings(): void {
    sidebarOpen = false;
    settingsOpen = true;
  }

  function handleUserInputResponse(answer: string, wasFreeform: boolean): void {
    wsStore.respondToUserInput(answer, wasFreeform);
    chatStore.clearPendingUserInput();
  }

  function handlePermissionResponse(requestId: string, decision: 'allow' | 'deny' | 'always_allow'): void {
    const kind = chatStore.pendingPermission?.kind ?? '';
    const toolName = chatStore.pendingPermission?.toolName ?? '';
    wsStore.respondToPermission(requestId, kind, toolName, decision);
    chatStore.clearPendingPermission();
  }

  function handleToggleSkill(skillName: string, enabled: boolean): void {
    if (enabled) {
      settings.disabledSkills = settings.disabledSkills.filter(s => s !== skillName);
    } else {
      settings.disabledSkills = [...settings.disabledSkills, skillName];
    }
  }
</script>

<svelte:head>
  <title>{chatStore.sessionTitle ? `${chatStore.sessionTitle} — Copilot Unleashed` : 'Copilot Unleashed'}</title>
</svelte:head>

{#if data.authenticated}
  <div class="screen" style={modeStyle}>
    <TopBar
      currentModel={chatStore.currentModel}
      connectionState={wsStore.connectionState}
      sessionTitle={chatStore.sessionTitle}
      quotaSnapshots={chatStore.quotaSnapshots}
      {activeSkillCount}
      onToggleSidebar={() => sidebarOpen = true}
      onOpenModelSheet={() => modelSheetOpen = true}
      onNewChat={handleNewChat}
    />

    <div class="terminal">
      {#if chatStore.plan.exists}
        <PlanPanel
          plan={chatStore.plan}
          onUpdatePlan={(content) => wsStore.updatePlan(content)}
          onDeletePlan={() => wsStore.deletePlan()}
        />
      {/if}

      <MessageList {chatStore} username={data.user?.login}>
        {#if chatStore.messages.length === 0}
          <Banner />
        {/if}
        <EnvInfo
          modelCount={modelCount}
          toolCount={toolCount}
          mcpServerCount={mcpServerCount}
          currentAgent={chatStore.currentAgent}
          sessionTitle={chatStore.sessionTitle}
          contextInfo={chatStore.contextInfo}
          sessionTotals={chatStore.sessionTotals}
        />
      </MessageList>

      {#if chatStore.pendingPermission}
        <PermissionPrompt
          requestId={chatStore.pendingPermission.requestId}
          kind={chatStore.pendingPermission.kind}
          toolName={chatStore.pendingPermission.toolName}
          toolArgs={chatStore.pendingPermission.toolArgs}
          onRespond={handlePermissionResponse}
        />
      {/if}

      <ChatInput
        connectionState={wsStore.connectionState}
        sessionReady={wsStore.sessionReady}
        isStreaming={chatStore.isStreaming}
        isWaiting={chatStore.isWaiting}
        mode={chatStore.mode}
        pendingUserInput={chatStore.pendingUserInput}
        onSend={handleSend}
        onAbort={() => wsStore.abort()}
        onSetMode={handleSetMode}
        onUserInputResponse={handleUserInputResponse}
        onFleet={(prompt) => {
          chatStore.addUserMessage(`/fleet ${prompt}`);
          wsStore.send({ type: 'start_fleet', prompt });
        }}
      />
    </div>

    <Sidebar
      open={sidebarOpen}
      currentAgent={chatStore.currentAgent}
      quotaSnapshots={chatStore.quotaSnapshots}
      sessionTotals={chatStore.sessionTotals}
      onClose={() => sidebarOpen = false}
      onNewChat={handleNewChat}
      onOpenSessions={handleOpenSessions}
      onOpenSettings={handleOpenSettings}
      onLogout={handleLogout}
    />

    <ModelSheet
      open={modelSheetOpen}
      models={chatStore.models}
      currentModel={chatStore.currentModel}
      reasoningEffort={chatStore.reasoningEffort ?? settings.reasoningEffort}
      onSetModel={handleSetModel}
      onSetReasoning={handleSetReasoning}
      onClose={() => modelSheetOpen = false}
    />

    <SettingsModal
      open={settingsOpen}
      tools={chatStore.tools}
      agents={chatStore.agents}
      currentAgent={chatStore.currentAgent}
      quotaSnapshots={chatStore.quotaSnapshots}
      customInstructions={settings.customInstructions}
      excludedTools={settings.excludedTools}
      customTools={settings.customTools}
      customAgents={settings.customAgents}
      mcpServers={settings.mcpServers}
      availableSkills={settings.availableSkills}
      disabledSkills={settings.disabledSkills}
      onClose={() => settingsOpen = false}
      onSaveInstructions={(v) => { settings.customInstructions = v; }}
      onToggleTool={(name, enabled) => {
        if (enabled) {
          settings.excludedTools = settings.excludedTools.filter(t => t !== name);
        } else {
          settings.excludedTools = [...settings.excludedTools, name];
        }
      }}
      onSaveCustomTools={(tools) => { settings.customTools = tools; }}
      onSaveCustomAgents={(agents) => { settings.customAgents = agents; }}
      onSaveMcpServers={(servers) => { settings.mcpServers = servers; }}
      onToggleSkill={handleToggleSkill}
      onSelectAgent={(name) => wsStore.selectAgent(name)}
      onDeselectAgent={() => wsStore.deselectAgent()}
      onCompact={() => wsStore.compact()}
      onFetchTools={() => wsStore.listTools(chatStore.currentModel)}
      onFetchAgents={() => wsStore.listAgents()}
      onFetchQuota={() => wsStore.getQuota()}
      onFetchSkills={() => settings.fetchSkills()}
    />

    <SessionsSheet
      open={sessionsOpen}
      sessions={chatStore.sessions}
      sessionDetail={chatStore.sessionDetail}
      loading={sessionsLoading}
      onClose={() => sessionsOpen = false}
      onResume={handleResumeSession}
      onDelete={(id) => wsStore.deleteSession(id)}
      onRequestDetail={(id) => wsStore.getSessionDetail(id)}
    />
  </div>
{:else}
  <DeviceFlowLogin />
{/if}

<style>
  .screen {
    height: 100dvh;
    height: var(--vh, 100dvh);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .terminal {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: var(--sp-3) var(--sp-4);
    min-height: 0;
    overflow: hidden;
  }

  @media (min-width: 600px) {
    .terminal {
      padding: var(--sp-4) var(--sp-5);
    }
  }

  @media (min-width: 768px) {
    .terminal {
      max-width: 800px;
      margin: 0 auto;
      padding: var(--sp-4) var(--sp-6);
      width: 100%;
    }
  }

  @media (min-width: 1024px) {
    .terminal {
      max-width: 880px;
    }
  }

  @media (orientation: landscape) and (max-height: 500px) {
    .terminal { padding: var(--sp-1) var(--sp-3); }
  }
</style>

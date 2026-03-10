<script lang="ts">
  import DeviceFlowLogin from '$lib/components/DeviceFlowLogin.svelte';
  import MessageList from '$lib/components/MessageList.svelte';
  import ChatInput from '$lib/components/ChatInput.svelte';
  import Banner from '$lib/components/Banner.svelte';
  import EnvInfo from '$lib/components/EnvInfo.svelte';
  import PlanPanel from '$lib/components/PlanPanel.svelte';
  import UserInputPrompt from '$lib/components/UserInputPrompt.svelte';
  import PermissionPrompt from '$lib/components/PermissionPrompt.svelte';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import SettingsModal from '$lib/components/SettingsModal.svelte';
  import SessionsSheet from '$lib/components/SessionsSheet.svelte';
  import TopBar from '$lib/components/TopBar.svelte';
  import ModelSheet from '$lib/components/ModelSheet.svelte';
  import { createWsStore } from '$lib/stores/ws.svelte.js';
  import { createChatStore } from '$lib/stores/chat.svelte.js';
  import { createSettingsStore } from '$lib/stores/settings.svelte.js';
  import type { SessionMode, ReasoningEffort } from '$lib/types/index.js';

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

  const modelCount = $derived(chatStore.models.size);
  const toolCount = $derived(chatStore.tools.length);
  const mcpServerCount = $derived(
    new Set(chatStore.tools.filter(t => t.mcpServerName).map(t => t.mcpServerName)).size
  );

  // ── Debug: trace data.authenticated changes ──────────────────────────
  $effect(() => {
    console.log(`[PAGE] data.authenticated=${data.authenticated} user=${JSON.stringify(data.user)}`);
  });

  // ── Lifecycle ──────────────────────────────────────────────────────────
  $effect(() => {
    if (data.authenticated) {
      console.log(`[PAGE] authenticated=true, loading settings & connecting WS`);
      settings.load();
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
      });

      return () => {
        console.log('[PAGE] effect cleanup: unsubscribing and disconnecting WS');
        unsub();
        wsStore.disconnect();
        console.log(`[PAGE] effect cleanup: disconnecting WS`);
        unsub();
        wsStore.disconnect();
      };
    } else {
      console.log(`[PAGE] authenticated=false, showing login screen`);
    }
  });

  // ── Helpers ────────────────────────────────────────────────────────────
  function requestNewSession(): void {
    const model = settings.selectedModel || 'gpt-4.1';
    const modelInfo = chatStore.models.get(model);
    const isReasoning = modelInfo?.capabilities?.supports?.reasoningEffort;

    wsStore.newSession({
      model,
      ...(isReasoning && { reasoningEffort: settings.reasoningEffort }),
      ...(settings.customInstructions.trim() && { customInstructions: settings.customInstructions.trim() }),
      ...(settings.excludedTools.length > 0 && { excludedTools: settings.excludedTools }),
      ...(settings.customTools.length > 0 && { customTools: settings.customTools }),
    });
  }

  function handleSend(content: string, attachments?: Array<{ path: string; name: string; type: string }>): void {
    chatStore.addUserMessage(content);
    wsStore.sendMessage(content, attachments);
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
    wsStore.listSessions();
  }

  function handleResumeSession(sessionId: string): void {
    chatStore.clearMessages();
    wsStore.resumeSession(sessionId);
    sessionsOpen = false;
  }

  function handleOpenSettings(): void {
    sidebarOpen = false;
    settingsOpen = true;
  }

  function handleUserInputResponse(answer: string, wasFreeform: boolean): void {
    wsStore.respondToUserInput(answer, wasFreeform);
  }

  function handlePermissionResponse(requestId: string, decision: 'allow' | 'deny' | 'always_allow'): void {
    const toolName = chatStore.pendingPermission?.toolName ?? '';
    wsStore.respondToPermission(requestId, toolName, decision);
    chatStore.clearPendingPermission();
  }
</script>

{#if data.authenticated}
  <div class="screen">
    <TopBar
      mode={chatStore.mode}
      currentModel={chatStore.currentModel}
      connectionState={wsStore.connectionState}
      quotaSnapshots={chatStore.quotaSnapshots}
      onToggleSidebar={() => sidebarOpen = true}
      onSetMode={handleSetMode}
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

      <MessageList {chatStore}>
        <Banner />
        <EnvInfo
          modelCount={modelCount}
          toolCount={toolCount}
          mcpServerCount={mcpServerCount}
          currentAgent={chatStore.currentAgent}
          sessionTitle={chatStore.sessionTitle}
          contextInfo={chatStore.contextInfo}
        />
      </MessageList>

      {#if chatStore.pendingUserInput}
        <UserInputPrompt
          question={chatStore.pendingUserInput.question}
          choices={chatStore.pendingUserInput.choices}
          allowFreeform={chatStore.pendingUserInput.allowFreeform}
          onRespond={handleUserInputResponse}
        />
      {/if}

      {#if chatStore.pendingPermission}
        <PermissionPrompt
          requestId={chatStore.pendingPermission.requestId}
          toolName={chatStore.pendingPermission.toolName}
          toolArgs={chatStore.pendingPermission.toolArgs}
          onRespond={handlePermissionResponse}
        />
      {/if}

      <ChatInput
        connectionState={wsStore.connectionState}
        sessionReady={wsStore.sessionReady}
        isStreaming={chatStore.isStreaming}
        onSend={handleSend}
        onAbort={() => wsStore.abort()}
      />
    </div>

    <Sidebar
      open={sidebarOpen}
      currentAgent={chatStore.currentAgent}
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
      reasoningEffort={chatStore.reasoningEffort}
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
      onSelectAgent={(name) => wsStore.selectAgent(name)}
      onDeselectAgent={() => wsStore.deselectAgent()}
      onCompact={() => wsStore.compact()}
      onFetchTools={() => wsStore.listTools(chatStore.currentModel)}
      onFetchAgents={() => wsStore.listAgents()}
      onFetchQuota={() => wsStore.getQuota()}
    />

    <SessionsSheet
      open={sessionsOpen}
      sessions={chatStore.sessions}
      onClose={() => sessionsOpen = false}
      onResume={handleResumeSession}
      onDelete={(id) => wsStore.deleteSession(id)}
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

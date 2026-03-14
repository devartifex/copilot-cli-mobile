import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSettingsStore } from '$lib/stores/settings.svelte.js';
import type { CustomToolDefinition, McpServerDefinition, PersistedSettings } from '$lib/types/index.js';

const STORAGE_KEY = 'copilot-cli-settings';

function jsonResponse(data: unknown, ok = true): Response {
  return {
    ok,
    json: vi.fn().mockResolvedValue(data),
  } as unknown as Response;
}

function makeCustomTool(name: string): CustomToolDefinition {
  return {
    name,
    description: `${name} description`,
    webhookUrl: `https://example.com/${name}`,
    method: 'POST',
    headers: { Authorization: 'Bearer token' },
    parameters: {
      prompt: { type: 'string', description: 'Prompt text' },
    },
  };
}

function makeMcpServer(name: string): McpServerDefinition {
  return {
    name,
    url: `https://mcp.example.com/${name}`,
    type: 'http',
    headers: { Authorization: 'Bearer token' },
    tools: [`${name}.tool`],
    enabled: true,
  };
}

describe('createSettingsStore', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    localStorage.clear();
  });

  it('starts with the expected defaults', () => {
    const store = createSettingsStore();

    expect(store.selectedModel).toBe('');
    expect(store.selectedMode).toBe('interactive');
    expect(store.reasoningEffort).toBe('medium');
    expect(store.customInstructions).toBe('');
    expect(store.excludedTools).toEqual([]);
    expect(store.customTools).toEqual([]);
    expect(store.mcpServers).toEqual([]);
  });

  it('persists setter updates to localStorage and syncs them to the server', () => {
    const store = createSettingsStore();
    const tools = Array.from({ length: 12 }, (_, index) => makeCustomTool(`tool-${index}`));
    const servers = Array.from({ length: 12 }, (_, index) => makeMcpServer(`server-${index}`));

    store.selectedModel = 'gpt-5';
    store.selectedMode = 'autopilot';
    store.reasoningEffort = 'high';
    store.customInstructions = 'Be concise';
    store.excludedTools = ['bash', 'grep'];
    store.customTools = tools;
    store.mcpServers = servers;

    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as PersistedSettings;

    expect(store.customTools).toHaveLength(10);
    expect(store.mcpServers).toHaveLength(10);
    expect(persisted).toMatchObject({
      model: 'gpt-5',
      mode: 'autopilot',
      reasoningEffort: 'high',
      customInstructions: 'Be concise',
      excludedTools: ['bash', 'grep'],
    });
    expect(persisted.customTools).toHaveLength(10);
    expect(persisted.mcpServers).toHaveLength(10);
    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: persisted }),
    });
  });

  it('loads valid persisted settings, filters invalid entries, and keeps mode interactive', () => {
    const validTool = makeCustomTool('valid-tool');
    const validServer = makeMcpServer('valid-server');

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        model: 'claude-sonnet',
        mode: 'autopilot',
        reasoningEffort: 'xhigh',
        customInstructions: 'Use the docs',
        excludedTools: ['bash', 42, null],
        customTools: [
          validTool,
          { ...validTool, name: 123 },
          ...Array.from({ length: 10 }, (_, index) => makeCustomTool(`extra-tool-${index}`)),
        ],
        mcpServers: [
          validServer,
          { ...validServer, enabled: 'yes' },
          ...Array.from({ length: 10 }, (_, index) => makeMcpServer(`extra-server-${index}`)),
        ],
      }),
    );

    const store = createSettingsStore();
    store.load();

    expect(store.selectedModel).toBe('claude-sonnet');
    expect(store.selectedMode).toBe('interactive');
    expect(store.reasoningEffort).toBe('xhigh');
    expect(store.customInstructions).toBe('Use the docs');
    expect(store.excludedTools).toEqual(['bash']);
    expect(store.customTools).toHaveLength(10);
    expect(store.customTools[0]).toEqual(validTool);
    expect(store.mcpServers).toHaveLength(10);
    expect(store.mcpServers[0]).toEqual(validServer);
  });

  it('ignores corrupt localStorage payloads', () => {
    localStorage.setItem(STORAGE_KEY, '{this is not valid json');

    const store = createSettingsStore();
    store.load();

    expect(store.selectedModel).toBe('');
    expect(store.selectedMode).toBe('interactive');
    expect(store.reasoningEffort).toBe('medium');
  });

  it('pulls settings from the server and rewrites localStorage with the sanitized result', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        settings: {
          model: 'gpt-4.1',
          mode: 'plan',
          reasoningEffort: 'low',
          customInstructions: 'Server wins',
          excludedTools: ['bash'],
          customTools: [makeCustomTool('server-tool')],
          mcpServers: [makeMcpServer('server-mcp')],
        },
      }),
    );

    const store = createSettingsStore();
    await store.syncFromServer();

    expect(fetchMock).toHaveBeenCalledWith('/api/settings');
    expect(store.selectedModel).toBe('gpt-4.1');
    expect(store.selectedMode).toBe('interactive');
    expect(store.reasoningEffort).toBe('low');
    expect(store.customInstructions).toBe('Server wins');
    expect(store.excludedTools).toEqual(['bash']);
    expect(store.customTools).toEqual([makeCustomTool('server-tool')]);
    expect(store.mcpServers).toEqual([makeMcpServer('server-mcp')]);

    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as PersistedSettings;
    expect(persisted.mode).toBe('interactive');
    expect(persisted.model).toBe('gpt-4.1');
  });

  it('pushes local settings to the server when no server snapshot exists', async () => {
    const store = createSettingsStore();
    store.selectedModel = 'gpt-4o-mini';
    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(jsonResponse({ settings: null }));

    await store.syncFromServer();

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/settings');
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: {
          model: 'gpt-4o-mini',
          mode: 'interactive',
          reasoningEffort: 'medium',
          customInstructions: '',
          excludedTools: [],
          customTools: [],
          mcpServers: [],
          disabledSkills: [],
        },
      }),
    });
  });
});

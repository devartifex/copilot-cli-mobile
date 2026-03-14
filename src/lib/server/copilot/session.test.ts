import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { defineToolMock } = vi.hoisted(() => ({
  defineToolMock: vi.fn((name: string, options: Record<string, unknown>) => ({ name, ...options })),
}));

vi.mock('@github/copilot-sdk', () => ({
  CopilotClient: vi.fn(),
  defineTool: defineToolMock,
}));

vi.mock('../config.js', () => ({
  config: {
    copilotConfigDir: '/copilot-config',
  },
}));

import { createCopilotSession, getAvailableModels, buildSessionHooks } from './session.js';

interface ClientMock {
  createSession: ReturnType<typeof vi.fn>;
  listModels: ReturnType<typeof vi.fn>;
}

interface DefinedTool {
  name: string;
  description: string;
  parameters: {
    parse: (input: unknown) => unknown;
  };
  handler: (args: unknown) => Promise<unknown>;
}

function createClientMock(): ClientMock {
  return {
    createSession: vi.fn(async (sessionConfig: unknown) => ({ sessionConfig })),
    listModels: vi.fn(),
  };
}

function getSessionConfig(client: ClientMock): Record<string, unknown> {
  const [sessionConfig] = client.createSession.mock.calls[0] as [Record<string, unknown>];
  return sessionConfig;
}

function getCreatedTool(client: ClientMock): DefinedTool {
  const sessionConfig = getSessionConfig(client);
  const tools = sessionConfig.tools as DefinedTool[];
  return tools[0];
}

const fetchMock = vi.fn();

beforeEach(() => {
  defineToolMock.mockClear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ ok: true }),
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createCopilotSession', () => {
  it('creates a default session config with GitHub MCP access and approve-all permissions', async () => {
    const client = createClientMock();

    await createCopilotSession(client as unknown as Parameters<typeof createCopilotSession>[0], 'gh-token');

    expect(client.createSession).toHaveBeenCalledTimes(1);

    const sessionConfig = getSessionConfig(client);
    expect(sessionConfig).toMatchObject({
      clientName: 'copilot-unleashed',
      model: 'gpt-4.1',
      streaming: true,
      configDir: '/copilot-config',
    });

    const mcpServers = sessionConfig.mcpServers as Record<string, Record<string, unknown>>;
    expect(mcpServers.github).toEqual({
      type: 'http',
      url: 'https://api.githubcopilot.com/mcp/x/all',
      headers: {
        Authorization: 'Bearer gh-token',
      },
      tools: ['*'],
    });

    const onPermissionRequest = sessionConfig.onPermissionRequest as (
      request: unknown,
      context: unknown,
    ) => { kind: string };
    expect(onPermissionRequest({ toolName: 'bash' }, { sessionId: 's1' })).toEqual({ kind: 'approved' });
  });

  it('uses the provided prompt permission handler when prompt mode is enabled', async () => {
    const client = createClientMock();
    const onPermissionRequest = vi.fn((_request: unknown, _context: unknown) => ({ kind: 'approved' as const }));

    await createCopilotSession(client as unknown as Parameters<typeof createCopilotSession>[0], 'gh-token', {
      permissionMode: 'prompt',
      onPermissionRequest,
    });

    const sessionConfig = getSessionConfig(client);
    const configuredHandler = sessionConfig.onPermissionRequest as typeof onPermissionRequest;

    configuredHandler({ toolName: 'write' }, { sessionId: 's2' });
    expect(onPermissionRequest).toHaveBeenCalledWith({ toolName: 'write' }, { sessionId: 's2' });
  });

  it('applies optional session settings to the SDK config', async () => {
    const client = createClientMock();
    const onUserInputRequest = vi.fn();

    await createCopilotSession(client as unknown as Parameters<typeof createCopilotSession>[0], 'gh-token', {
      model: 'claude-sonnet-4.5',
      reasoningEffort: 'high',
      customInstructions: 'Stay concise.',
      excludedTools: ['bash'],
      availableTools: ['read'],
      onUserInputRequest,
      infiniteSessions: {
        enabled: true,
        backgroundCompactionThreshold: 0.7,
        bufferExhaustionThreshold: 0.4,
      },
      configDir: '/custom-config',
      mcpServers: [{
        name: 'public-api',
        url: 'https://api.example.com:8443/stream/%E2%9C%93',
        type: 'http',
        headers: { 'X-Test': 'true' },
        tools: [],
      }],
    });

    expect(getSessionConfig(client)).toMatchObject({
      model: 'claude-sonnet-4.5',
      reasoningEffort: 'high',
      excludedTools: ['bash'],
      availableTools: ['read'],
      onUserInputRequest,
      configDir: '/custom-config',
      systemMessage: {
        mode: 'append',
        content: 'Stay concise.',
      },
      infiniteSessions: {
        enabled: true,
        backgroundCompactionThreshold: 0.7,
        bufferExhaustionThreshold: 0.4,
      },
    });

    const mcpServers = getSessionConfig(client).mcpServers as Record<string, Record<string, unknown>>;
    expect(mcpServers['public-api']).toEqual({
      type: 'http',
      url: 'https://api.example.com:8443/stream/%E2%9C%93',
      headers: { 'X-Test': 'true' },
      tools: ['*'],
    });
  });

  it('builds POST custom tools with zod parameter parsing and JSON fetch bodies', async () => {
    const client = createClientMock();

    await createCopilotSession(client as unknown as Parameters<typeof createCopilotSession>[0], 'gh-token', {
      customTools: [{
        name: 'webhook-tool',
        description: 'Calls a webhook',
        webhookUrl: 'https://tools.example.com/hooks/%E2%9C%93',
        method: 'POST',
        headers: { Authorization: 'Bearer abc' },
        parameters: {
          query: { type: 'string', description: 'Search query' },
          count: { type: 'number', description: 'Result count' },
          enabled: { type: 'boolean', description: 'Feature toggle' },
        },
      }],
    });

    expect(defineToolMock).toHaveBeenCalledTimes(1);
    const tool = getCreatedTool(client);

    expect(tool.parameters.parse({ query: 'copilot', count: 2, enabled: true })).toEqual({
      query: 'copilot',
      count: 2,
      enabled: true,
    });

    const result = await tool.handler({ query: 'copilot', count: 2, enabled: true });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://tools.example.com/hooks/%E2%9C%93',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer abc',
        },
        body: JSON.stringify({ query: 'copilot', count: 2, enabled: true }),
      }),
    );
  });

  it('omits the request body for GET custom tools', async () => {
    const client = createClientMock();

    await createCopilotSession(client as unknown as Parameters<typeof createCopilotSession>[0], 'gh-token', {
      customTools: [{
        name: 'get-tool',
        description: 'Fetches without a body',
        webhookUrl: 'https://tools.example.com/read',
        method: 'GET',
        headers: {},
        parameters: {},
      }],
    });

    const tool = getCreatedTool(client);
    await tool.handler({ ignored: true });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://tools.example.com/read',
      expect.objectContaining({
        method: 'GET',
        body: undefined,
      }),
    );
  });

  it.each([
    'https://127.0.0.1/hook',
    'https://10.0.0.8/hook',
    'https://172.16.5.10/hook',
    'https://172.31.255.1/hook',
    'https://192.168.1.5/hook',
    'https://169.254.2.3/hook',
    'https://0.0.0.0/hook',
    'https://localhost/hook',
    'https://sub.localhost/hook',
    'https://[::1]/hook',
    'https://[fc00::1]/hook',
    'https://[fe80::1]/hook',
  ])('rejects blocked tool URLs: %s', async (webhookUrl) => {
    const client = createClientMock();

    await expect(
      createCopilotSession(client as unknown as Parameters<typeof createCopilotSession>[0], 'gh-token', {
        customTools: [{
          name: 'private-tool',
          description: 'Should fail',
          webhookUrl,
          method: 'POST',
          headers: {},
          parameters: {},
        }],
      }),
    ).rejects.toThrow('internal network URLs are not allowed');
  });

  it('rejects HTTP, invalid, and credential-bearing tool URLs', async () => {
    const client = createClientMock();

    await expect(
      createCopilotSession(client as unknown as Parameters<typeof createCopilotSession>[0], 'gh-token', {
        customTools: [{
          name: 'http-tool',
          description: 'Should fail',
          webhookUrl: 'http://example.com/hook',
          method: 'GET',
          headers: {},
          parameters: {},
        }],
      }),
    ).rejects.toThrow('HTTPS required');

    await expect(
      createCopilotSession(client as unknown as Parameters<typeof createCopilotSession>[0], 'gh-token', {
        customTools: [{
          name: 'bad-tool',
          description: 'Should fail',
          webhookUrl: 'not-a-url',
          method: 'GET',
          headers: {},
          parameters: {},
        }],
      }),
    ).rejects.toThrow('invalid URL');

    await expect(
      createCopilotSession(client as unknown as Parameters<typeof createCopilotSession>[0], 'gh-token', {
        customTools: [{
          name: 'auth-tool',
          description: 'Should fail',
          webhookUrl: 'https://user:pass@example.com/hook',
          method: 'GET',
          headers: {},
          parameters: {},
        }],
      }),
    ).rejects.toThrow('auth credentials in URLs are not allowed');
  });

  it.each([
    'https://127.0.0.1/stream',
    'https://localhost/stream',
    'https://[::1]/stream',
  ])('rejects blocked MCP server URLs: %s', async (url) => {
    const client = createClientMock();

    await expect(
      createCopilotSession(client as unknown as Parameters<typeof createCopilotSession>[0], 'gh-token', {
        mcpServers: [{
          name: 'private-mcp',
          url,
          type: 'sse',
          headers: {},
          tools: ['search'],
        }],
      }),
    ).rejects.toThrow('internal network URLs are not allowed');
  });

  it('rejects non-HTTPS and invalid MCP server URLs', async () => {
    const client = createClientMock();

    await expect(
      createCopilotSession(client as unknown as Parameters<typeof createCopilotSession>[0], 'gh-token', {
        mcpServers: [{
          name: 'http-mcp',
          url: 'http://public.example.com/stream',
          type: 'http',
          headers: {},
          tools: ['search'],
        }],
      }),
    ).rejects.toThrow('HTTPS required');

    await expect(
      createCopilotSession(client as unknown as Parameters<typeof createCopilotSession>[0], 'gh-token', {
        mcpServers: [{
          name: 'bad-mcp',
          url: '%%%bad-url',
          type: 'http',
          headers: {},
          tools: ['search'],
        }],
      }),
    ).rejects.toThrow('invalid URL');
  });

  it('passes skillDirectories and disabledSkills to the SDK session config', async () => {
    const client = createClientMock();

    await createCopilotSession(client as unknown as Parameters<typeof createCopilotSession>[0], 'gh-token', {
      skillDirectories: ['/skills/git-commit', '/skills/code-review'],
      disabledSkills: ['code-review'],
    });

    const config = getSessionConfig(client);
    expect(config.skillDirectories).toEqual(['/skills/git-commit', '/skills/code-review']);
    expect(config.disabledSkills).toEqual(['code-review']);
  });

  it('omits skillDirectories and disabledSkills when empty', async () => {
    const client = createClientMock();

    await createCopilotSession(client as unknown as Parameters<typeof createCopilotSession>[0], 'gh-token', {
      skillDirectories: [],
      disabledSkills: [],
    });

    const config = getSessionConfig(client);
    expect(config.skillDirectories).toBeUndefined();
    expect(config.disabledSkills).toBeUndefined();
  });

  it('passes custom agents to SDK session config', async () => {
    const client = createClientMock();
    const customAgents = [
      { name: 'editor', prompt: 'Edit code', tools: ['bash', 'edit'] },
      { name: 'reviewer', prompt: 'Review code', displayName: 'Code Reviewer' },
    ];

    await createCopilotSession(client as unknown as Parameters<typeof createCopilotSession>[0], 'gh-token', {
      customAgents,
    });

    const config = getSessionConfig(client);
    expect(config.customAgents).toEqual(customAgents);
  });

  it('supports SSE-type MCP servers alongside HTTP servers', async () => {
    const client = createClientMock();

    await createCopilotSession(client as unknown as Parameters<typeof createCopilotSession>[0], 'gh-token', {
      mcpServers: [
        {
          name: 'http-server',
          url: 'https://api.example.com/mcp',
          type: 'http',
          headers: { 'X-Api-Key': 'key1' },
          tools: ['search'],
        },
        {
          name: 'sse-server',
          url: 'https://stream.example.com/events',
          type: 'sse',
          headers: { Authorization: 'Bearer tok' },
          tools: [],
        },
      ],
    });

    const mcpServers = getSessionConfig(client).mcpServers as Record<string, Record<string, unknown>>;

    // GitHub server always present
    expect(mcpServers.github).toBeDefined();

    // HTTP server preserved as-is
    expect(mcpServers['http-server']).toEqual({
      type: 'http',
      url: 'https://api.example.com/mcp',
      headers: { 'X-Api-Key': 'key1' },
      tools: ['search'],
    });

    // SSE server with empty tools defaults to wildcard
    expect(mcpServers['sse-server']).toEqual({
      type: 'sse',
      url: 'https://stream.example.com/events',
      headers: { Authorization: 'Bearer tok' },
      tools: ['*'],
    });
  });

  it('always includes GitHub MCP server with the provided token', async () => {
    const client = createClientMock();

    await createCopilotSession(client as unknown as Parameters<typeof createCopilotSession>[0], 'my-gh-token-123');

    const mcpServers = getSessionConfig(client).mcpServers as Record<string, Record<string, unknown>>;
    expect(mcpServers.github).toEqual({
      type: 'http',
      url: 'https://api.githubcopilot.com/mcp/x/all',
      headers: { Authorization: 'Bearer my-gh-token-123' },
      tools: ['*'],
    });
  });

  it('omits user MCP servers when none are provided', async () => {
    const client = createClientMock();

    await createCopilotSession(client as unknown as Parameters<typeof createCopilotSession>[0], 'gh-token', {
      mcpServers: [],
    });

    const mcpServers = getSessionConfig(client).mcpServers as Record<string, Record<string, unknown>>;
    expect(Object.keys(mcpServers)).toEqual(['github']);
  });

  it('wires session hooks when onHookEvent callback is provided', async () => {
    const client = createClientMock();
    const onHookEvent = vi.fn();

    await createCopilotSession(client as unknown as Parameters<typeof createCopilotSession>[0], 'gh-token', {
      onHookEvent,
    });

    const config = getSessionConfig(client);
    expect(config.hooks).toBeDefined();
    expect(config.hooks).toHaveProperty('onPreToolUse');
    expect(config.hooks).toHaveProperty('onPostToolUse');
    expect(config.hooks).toHaveProperty('onSessionStart');
    expect(config.hooks).toHaveProperty('onSessionEnd');
    expect(config.hooks).toHaveProperty('onErrorOccurred');
  });

  it('omits hooks when onHookEvent is not provided', async () => {
    const client = createClientMock();

    await createCopilotSession(client as unknown as Parameters<typeof createCopilotSession>[0], 'gh-token');

    const config = getSessionConfig(client);
    expect(config.hooks).toBeUndefined();
  });
});

describe('buildSessionHooks', () => {
  it('sends hook_pre_tool message with tool name and args', () => {
    const callback = vi.fn();
    const hooks = buildSessionHooks(callback);

    hooks!.onPreToolUse!(
      { toolName: 'bash', toolArgs: { command: 'ls' }, timestamp: 1, cwd: '/tmp' },
      { sessionId: 's1' },
    );

    expect(callback).toHaveBeenCalledWith({
      type: 'hook_pre_tool',
      toolName: 'bash',
      toolArgs: { command: 'ls' },
    });
  });

  it('sends hook_post_tool message with tool name and args', () => {
    const callback = vi.fn();
    const hooks = buildSessionHooks(callback);

    hooks!.onPostToolUse!(
      { toolName: 'read', toolArgs: { path: '/file' }, toolResult: { content: 'ok' } as any, timestamp: 1, cwd: '/tmp' },
      { sessionId: 's1' },
    );

    expect(callback).toHaveBeenCalledWith({
      type: 'hook_post_tool',
      toolName: 'read',
      toolArgs: { path: '/file' },
    });
  });

  it('sends hook_session_start message with source', () => {
    const callback = vi.fn();
    const hooks = buildSessionHooks(callback);

    hooks!.onSessionStart!(
      { source: 'new', timestamp: 1, cwd: '/tmp' },
      { sessionId: 's1' },
    );

    expect(callback).toHaveBeenCalledWith({
      type: 'hook_session_start',
      source: 'new',
    });
  });

  it('sends hook_session_end message with reason', () => {
    const callback = vi.fn();
    const hooks = buildSessionHooks(callback);

    hooks!.onSessionEnd!(
      { reason: 'complete', timestamp: 1, cwd: '/tmp' },
      { sessionId: 's1' },
    );

    expect(callback).toHaveBeenCalledWith({
      type: 'hook_session_end',
      reason: 'complete',
    });
  });

  it('sends hook_error message with error details', () => {
    const callback = vi.fn();
    const hooks = buildSessionHooks(callback);

    hooks!.onErrorOccurred!(
      { error: 'timeout', errorContext: 'tool_execution', recoverable: true, timestamp: 1, cwd: '/tmp' },
      { sessionId: 's1' },
    );

    expect(callback).toHaveBeenCalledWith({
      type: 'hook_error',
      error: 'timeout',
      errorContext: 'tool_execution',
      recoverable: true,
    });
  });
});

describe('getAvailableModels', () => {
  it('returns arrays directly from the client', async () => {
    const client = createClientMock();
    client.listModels.mockResolvedValue([{ id: 'gpt-4.1' }]);

    await expect(getAvailableModels(client as unknown as Parameters<typeof getAvailableModels>[0])).resolves.toEqual([{ id: 'gpt-4.1' }]);
  });

  it('reads model arrays from object responses', async () => {
    const client = createClientMock();
    client.listModels.mockResolvedValueOnce({ models: [{ id: 'claude-sonnet-4.5' }] });
    await expect(getAvailableModels(client as unknown as Parameters<typeof getAvailableModels>[0])).resolves.toEqual([{ id: 'claude-sonnet-4.5' }]);

    client.listModels.mockResolvedValueOnce({ data: [{ id: 'gemini-3-pro-preview' }] });
    await expect(getAvailableModels(client as unknown as Parameters<typeof getAvailableModels>[0])).resolves.toEqual([{ id: 'gemini-3-pro-preview' }]);
  });

  it('returns an empty array for unknown shapes or client errors', async () => {
    const client = createClientMock();
    client.listModels.mockResolvedValueOnce({});
    await expect(getAvailableModels(client as unknown as Parameters<typeof getAvailableModels>[0])).resolves.toEqual([]);

    client.listModels.mockRejectedValueOnce(new Error('boom'));
    await expect(getAvailableModels(client as unknown as Parameters<typeof getAvailableModels>[0])).resolves.toEqual([]);
  });
});

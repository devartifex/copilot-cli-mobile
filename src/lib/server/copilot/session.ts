import { CopilotClient, defineTool } from '@github/copilot-sdk';
import type { SessionConfig } from '@github/copilot-sdk';
import { isIP } from 'node:net';
import { config } from '../config.js';
import { z } from 'zod';

export interface CustomToolDefinition {
  name: string;
  description: string;
  webhookUrl: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  parameters: Record<string, { type: string; description: string }>;
}

type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

export interface InfiniteSessionsConfig {
  enabled: boolean;
  backgroundCompactionThreshold?: number;
  bufferExhaustionThreshold?: number;
}

export interface McpServerInput {
  name: string;
  url: string;
  type: 'http' | 'sse';
  headers: Record<string, string>;
  tools: string[];
}

export interface CreateSessionOptions {
  model?: string;
  reasoningEffort?: ReasoningEffort;
  customInstructions?: string;
  excludedTools?: string[];
  availableTools?: string[];
  customTools?: CustomToolDefinition[];
  infiniteSessions?: InfiniteSessionsConfig;
  onUserInputRequest?: SessionConfig['onUserInputRequest'];
  permissionMode?: 'approve_all' | 'prompt';
  onPermissionRequest?: SessionConfig['onPermissionRequest'];
  mcpServers?: McpServerInput[];
  configDir?: string;
  skillDirectories?: string[];
  disabledSkills?: string[];
}

function buildZodSchema(params: Record<string, { type: string; description: string }>): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [name, param] of Object.entries(params)) {
    let field: z.ZodTypeAny;
    switch (param.type) {
      case 'number': field = z.number(); break;
      case 'boolean': field = z.boolean(); break;
      default: field = z.string(); break;
    }
    shape[name] = field.describe(param.description);
  }
  return z.object(shape);
}

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split('.').map((segment) => Number.parseInt(segment, 10));
  if (octets.length !== 4 || octets.some((segment) => Number.isNaN(segment) || segment < 0 || segment > 255)) {
    return false;
  }

  const [first, second] = octets;
  return first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168);
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (normalized === '::' || normalized === '::1') {
    return true;
  }

  const firstSegment = normalized.split(':').find((segment) => segment.length > 0);
  if (!firstSegment) {
    return false;
  }

  const firstHextet = Number.parseInt(firstSegment, 16);
  if (Number.isNaN(firstHextet)) {
    return false;
  }

  return (firstHextet & 0xfe00) === 0xfc00 || (firstHextet & 0xffc0) === 0xfe80;
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  if (!normalized) {
    return true;
  }

  if (normalized === 'localhost' || normalized.endsWith('.localhost') || normalized === '0.0.0.0') {
    return true;
  }

  switch (isIP(normalized)) {
    case 4:
      return isPrivateIpv4(normalized);
    case 6:
      return isPrivateIpv6(normalized);
    default:
      return false;
  }
}

function validateOutboundUrl(kind: 'Tool' | 'MCP server', name: string, rawUrl: string): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`${kind} "${name}": invalid URL`);
  }

  if (url.protocol !== 'https:') {
    throw new Error(`${kind} "${name}": HTTPS required`);
  }

  if (url.username || url.password) {
    throw new Error(`${kind} "${name}": auth credentials in URLs are not allowed`);
  }

  if (isBlockedHostname(url.hostname)) {
    throw new Error(`${kind} "${name}": internal network URLs are not allowed`);
  }
}

function validateToolUrl(toolName: string, webhookUrl: string): void {
  validateOutboundUrl('Tool', toolName, webhookUrl);
}

function validateMcpServerUrl(name: string, serverUrl: string): void {
  validateOutboundUrl('MCP server', name, serverUrl);
}

function buildUserMcpServers(servers?: McpServerInput[]): Record<string, unknown> {
  if (!servers || servers.length === 0) return {};
  const result: Record<string, unknown> = {};
  for (const server of servers) {
    validateMcpServerUrl(server.name, server.url);
    result[server.name] = {
      type: server.type,
      url: server.url,
      headers: server.headers,
      tools: server.tools.length > 0 ? server.tools : ['*'],
    };
  }
  return result;
}

function buildCustomTools(customTools: CustomToolDefinition[]) {
  return customTools.map((tool) => {
    validateToolUrl(tool.name, tool.webhookUrl);

    return defineTool(tool.name, {
      description: tool.description,
      parameters: buildZodSchema(tool.parameters),
      handler: async (args: unknown) => {
        const response = await fetch(tool.webhookUrl, {
          method: tool.method,
          headers: { 'Content-Type': 'application/json', ...tool.headers },
          body: tool.method === 'POST' ? JSON.stringify(args) : undefined,
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) throw new Error(`Tool failed: ${response.status}`);
        return await response.json();
      },
    });
  });
}

export async function createCopilotSession(
  client: CopilotClient,
  githubToken: string,
  options: CreateSessionOptions = {}
) {
  // Wrap the permission handler to log calls for diagnostics
  const wrappedApproveAll: SessionConfig['onPermissionRequest'] = (request: any, context) => {
    console.log('[PERMISSION] approveAll called:', JSON.stringify({
      toolName: request?.toolName ?? request?.tool?.name,
      sessionId: context?.sessionId,
    }));
    return { kind: 'approved' as const };
  };

  const permissionHandler = options.permissionMode === 'prompt' && options.onPermissionRequest
    ? options.onPermissionRequest
    : wrappedApproveAll;

  console.log('[SESSION] Creating session with permissionMode:', options.permissionMode || 'approve_all (default)');

  const sessionConfig: SessionConfig = {
    clientName: 'copilot-unleashed',
    model: options.model || 'gpt-4.1',
    streaming: true,
    onPermissionRequest: permissionHandler,
    ...(config.copilotConfigDir && { configDir: config.copilotConfigDir }),
    mcpServers: {
      github: {
        type: 'http',
        url: 'https://api.githubcopilot.com/mcp/x/all',
        headers: {
          Authorization: `Bearer ${githubToken}`,
        },
        tools: ['*'],
      },
      ...buildUserMcpServers(options.mcpServers),
    },
  };

  if (options.reasoningEffort) {
    sessionConfig.reasoningEffort = options.reasoningEffort;
  }

  if (options.excludedTools && options.excludedTools.length > 0) {
    sessionConfig.excludedTools = options.excludedTools;
  }

  if (options.availableTools && options.availableTools.length > 0) {
    sessionConfig.availableTools = options.availableTools;
  }

  if (options.customInstructions) {
    sessionConfig.systemMessage = {
      mode: 'append',
      content: options.customInstructions,
    };
  }

  if (options.onUserInputRequest) {
    sessionConfig.onUserInputRequest = options.onUserInputRequest;
  }

  if (options.infiniteSessions) {
    sessionConfig.infiniteSessions = {
      enabled: options.infiniteSessions.enabled,
      ...(options.infiniteSessions.backgroundCompactionThreshold != null && {
        backgroundCompactionThreshold: options.infiniteSessions.backgroundCompactionThreshold,
      }),
      ...(options.infiniteSessions.bufferExhaustionThreshold != null && {
        bufferExhaustionThreshold: options.infiniteSessions.bufferExhaustionThreshold,
      }),
    };
  }

  if (options.customTools && options.customTools.length > 0) {
    sessionConfig.tools = buildCustomTools(options.customTools);
  }

  if (options.configDir) {
    sessionConfig.configDir = options.configDir;
  }

  if (options.skillDirectories && options.skillDirectories.length > 0) {
    sessionConfig.skillDirectories = options.skillDirectories;
  }

  if (options.disabledSkills && options.disabledSkills.length > 0) {
    sessionConfig.disabledSkills = options.disabledSkills;
  }

  return client.createSession(sessionConfig);
}

export async function getAvailableModels(client: CopilotClient) {
  try {
    const result = await client.listModels();
    if (Array.isArray(result)) return result;
    if (result && typeof result === 'object') {
      const obj = result as Record<string, unknown>;
      if (Array.isArray(obj.models)) return obj.models;
      if (Array.isArray(obj.data)) return obj.data;
    }
    return [];
  } catch {
    return [];
  }
}

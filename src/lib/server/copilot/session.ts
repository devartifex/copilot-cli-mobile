import { CopilotClient, approveAll, defineTool } from '@github/copilot-sdk';
import type { SessionConfig } from '@github/copilot-sdk';
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
}

const BLOCKED_RANGES = ['10.', '172.16.', '172.17.', '172.18.', '172.19.',
  '172.20.', '172.21.', '172.22.', '172.23.', '172.24.', '172.25.',
  '172.26.', '172.27.', '172.28.', '172.29.', '172.30.', '172.31.',
  '192.168.', '169.254.'];

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

function validateToolUrl(toolName: string, webhookUrl: string): void {
  const url = new URL(webhookUrl);
  const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (!isLocalhost && url.protocol !== 'https:') {
    throw new Error(`Tool "${toolName}": HTTPS required for non-localhost URLs`);
  }
  if (BLOCKED_RANGES.some((r) => url.hostname.startsWith(r))) {
    throw new Error(`Tool "${toolName}": internal network URLs are not allowed`);
  }
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
  const sessionConfig: SessionConfig = {
    clientName: 'copilot-cli-mobile',
    model: options.model || 'gpt-4.1',
    streaming: true,
    onPermissionRequest: options.permissionMode === 'prompt' && options.onPermissionRequest
      ? options.onPermissionRequest
      : approveAll,
    mcpServers: {
      github: {
        type: 'http',
        url: 'https://api.githubcopilot.com/mcp/x/all/readonly',
        headers: {
          Authorization: `Bearer ${githubToken}`,
        },
        tools: ['*'],
      },
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

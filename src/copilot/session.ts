import { CopilotClient, approveAll } from '@github/copilot-sdk';
import type { SessionConfig } from '@github/copilot-sdk';

type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

export interface CreateSessionOptions {
  model?: string;
  reasoningEffort?: ReasoningEffort;
  customInstructions?: string;
  excludedTools?: string[];
  availableTools?: string[];
  onUserInputRequest?: SessionConfig['onUserInputRequest'];
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
    onPermissionRequest: approveAll,
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

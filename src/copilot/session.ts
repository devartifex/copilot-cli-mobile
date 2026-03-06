import { CopilotClient } from '@github/copilot-sdk';
import type { PermissionRequest, PermissionRequestResult, PermissionHandler } from '@github/copilot-sdk';
import { config } from '../config.js';

const APP_SYSTEM_MESSAGE = [
  'You are Copilot CLI Web, an assistant running inside this web app.',
  'Execute user requests directly when possible instead of explaining your identity.',
  'Use available tools when needed and return concise, task-focused results.',
  'Do not refuse GitHub-related requests unless a real permission or tool error occurs.',
].join(' ');

// Only approve read-only requests; deny shell, write, and unknown custom tools.
const approveReadOnly: PermissionHandler = (request: PermissionRequest): PermissionRequestResult => {
  if (request.kind === 'read' || request.kind === 'url') {
    return { kind: 'approved' };
  }
  if (request.kind === 'mcp') {
    const tool = (typeof request.toolName === 'string' ? request.toolName : '').toLowerCase();
    const readOnlyPatterns = [
      'list', 'get', 'search', 'read', 'fetch', 'describe', 'show', 'count', 'find',
    ];
    if (readOnlyPatterns.some((p) => tool.includes(p))) {
      return { kind: 'approved' };
    }
  }
  return { kind: 'denied-by-rules' };
};

// Optional: if a GitHub MCP server package is installed locally, use it to give Copilot
// GitHub API tools (list repos, read files, create PRs, etc.).
// The official GitHub MCP server (https://github.com/github/github-mcp-server) is a Go
// binary and not yet available as an npm package. As a drop-in alternative you can install:
//   npm install @modelcontextprotocol/server-github
// Note: that package is deprecated — use it at your own risk until GitHub ships an npm release.
let hasWarnedMissingGitHubMcp = false;

function resolveGitHubMcpServer(): { command: string; args: string[] } | null {
  try {
    const main = import.meta.resolve('@modelcontextprotocol/server-github');
    if (!main) return null;
    const resolved = main.startsWith('file://') ? new URL(main).pathname : main;
    return { command: 'node', args: [resolved] };
  } catch (err: any) {
    if (!hasWarnedMissingGitHubMcp) {
      console.warn('GitHub MCP server not available:', err.message);
      hasWarnedMissingGitHubMcp = true;
    }
    return null; // Package not installed — Copilot runs without GitHub API tools
  }
}

export async function createCopilotSession(
  client: CopilotClient,
  githubToken?: string,
  model?: string
) {
  try {
    const shouldEnableGitHubMcp = config.enableGitHubMcp && !!githubToken;
    const mcpServer = shouldEnableGitHubMcp ? resolveGitHubMcpServer() : null;

    const sessionConfig: Parameters<typeof client.createSession>[0] = {
      model: model || 'gpt-4.1',
      streaming: true,
      systemMessage: {
        mode: 'append',
        content: APP_SYSTEM_MESSAGE,
      },
      onPermissionRequest: approveReadOnly,
    };

    if (mcpServer && githubToken) {
      (sessionConfig as any).mcpServers = {
        github: {
          command: mcpServer.command,
          args: mcpServer.args,
          env: { GITHUB_PERSONAL_ACCESS_TOKEN: githubToken },
        },
      };
    }

    const session = await client.createSession(sessionConfig);
    return session;
  } catch (err: any) {
    console.error('Failed to create Copilot session:', err.message);
    console.error('Session error stack:', err.stack);
    throw err;
  }
}

export async function getAvailableModels(client: CopilotClient) {
  try {
    const result = await client.listModels();
    // Ensure we always return an array, even if the API returns undefined or an object
    if (Array.isArray(result)) {
      return result;
    }
    if (result && typeof result === 'object' && Array.isArray((result as any).models)) {
      return (result as any).models;
    }
    if (result && typeof result === 'object' && Array.isArray((result as any).data)) {
      return (result as any).data;
    }
    return [];
  } catch {
    return [];
  }
}

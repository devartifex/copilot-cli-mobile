import { CopilotClient, approveAll } from '@github/copilot-sdk';

function resolveGitHubMcpServer(): { command: string; args: string[] } | null {
  try {
    const main = require.resolve('@modelcontextprotocol/server-github');
    return { command: 'node', args: [main] };
  } catch {
    return null;
  }
}

export async function createCopilotSession(
  client: CopilotClient,
  githubToken?: string,
  model?: string
) {
  const mcpServer = githubToken ? resolveGitHubMcpServer() : null;

  const sessionConfig: Parameters<typeof client.createSession>[0] = {
    model: model || 'gpt-4.1',
    streaming: true,
    onPermissionRequest: approveAll,
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

  return client.createSession(sessionConfig);
}

export async function getAvailableModels(client: CopilotClient) {
  try {
    return await client.listModels();
  } catch {
    return [];
  }
}

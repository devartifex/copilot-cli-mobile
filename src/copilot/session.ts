import { CopilotClient } from '@github/copilot-sdk';
import type { PermissionRequest, PermissionRequestResult, PermissionHandler } from '@github/copilot-sdk';

const APP_SYSTEM_MESSAGE = [
  'You are Copilot CLI Web, an assistant running inside this web app.',
  'Execute user requests directly when possible instead of explaining your identity.',
  'Use available tools when needed and return concise, task-focused results.',
  'Do not refuse GitHub-related requests unless a real permission or tool error occurs.',
].join(' ');

// Approve all tool requests — match the desktop Copilot CLI behaviour.
const approveAll: PermissionHandler = (_request: PermissionRequest): PermissionRequestResult => {
  return { kind: 'approved' };
};

export async function createCopilotSession(
  client: CopilotClient,
  model?: string
) {
  try {
    if (process.env.DEBUG_COPILOT) console.log(`[Session] Creating Copilot session with model: ${model || 'gpt-4.1'}`);

    const session = await client.createSession({
      model: model || 'gpt-4.1',
      streaming: true,
      systemMessage: {
        mode: 'append',
        content: APP_SYSTEM_MESSAGE,
      },
      onPermissionRequest: approveAll,
    });
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

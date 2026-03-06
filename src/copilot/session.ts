import { CopilotClient, approveAll } from '@github/copilot-sdk';

export async function createCopilotSession(
  client: CopilotClient,
  model?: string
) {
  return client.createSession({
    model: model || 'gpt-4.1',
    streaming: true,
    onPermissionRequest: approveAll,
  });
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

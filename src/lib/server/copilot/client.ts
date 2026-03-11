import { CopilotClient } from '@github/copilot-sdk';

export function createCopilotClient(githubToken: string): CopilotClient {
  return new CopilotClient({
    githubToken,
    env: { ...process.env, GH_TOKEN: githubToken },
  });
}

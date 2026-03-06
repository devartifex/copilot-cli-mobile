import { Router } from 'express';
import { requireGitHub } from '../auth/middleware.js';
import { createCopilotClient } from '../copilot/client.js';
import { getAvailableModels } from '../copilot/session.js';

const router = Router();

router.use(requireGitHub);

router.get('/models', async (req, res) => {
  try {
    const client = createCopilotClient(req.session.githubToken!);
    const models = await getAvailableModels(client);
    const modelArray = Array.isArray(models) ? models : [];
    res.json({ models: modelArray });
    await client.stop();
  } catch (err: any) {
    console.error('Models error:', err.message);
    res.status(500).json({ error: 'Failed to list models', models: [] });
  }
});

export { router as apiRoutes };

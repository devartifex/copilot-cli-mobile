import { Router } from 'express';
import { requireAuth, requireGitHubToken } from '../auth/middleware.js';
import { getCopilotClient } from '../copilot/client.js';
import { getAvailableModels } from '../copilot/session.js';

const router = Router();

router.use(requireAuth);
router.use(requireGitHubToken);

router.get('/models', async (req, res) => {
  try {
    const client = await getCopilotClient(
      req.sessionID,
      req.session.githubToken!
    );
    const models = await getAvailableModels(client);
    // Ensure models is always an array
    const modelArray = Array.isArray(models) ? models : [];
    res.json({ models: modelArray });
  } catch (err: any) {
    console.error('Models error:', err);
    console.error('Models error stack:', err.stack);
    res.status(500).json({ error: `Failed to list models: ${err.message}`, models: [] });
  }
});

export { router as apiRoutes };

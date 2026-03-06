import { Router } from 'express';
import { requireAuth, requireGitHubToken } from '../auth/middleware';
import { getCopilotClient } from '../copilot/client';
import { getAvailableModels } from '../copilot/session';

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
    res.json({ models });
  } catch (err: any) {
    console.error('Models error:', err);
    res.status(500).json({ error: err.message });
  }
});

export { router as apiRoutes };

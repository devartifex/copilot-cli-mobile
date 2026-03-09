import { Router } from 'express';
import { createRequire } from 'module';
import { requireGitHub } from '../auth/middleware.js';
import { createCopilotClient } from '../copilot/client.js';
import { getAvailableModels } from '../copilot/session.js';
import { logSecurity } from '../security-log.js';

const router = Router();

// Read installed SDK version once at startup
let sdkVersion = 'unknown';
try {
  const require = createRequire(import.meta.url);
  const sdkPkg = require('@github/copilot-sdk/package.json') as { version: string };
  sdkVersion = sdkPkg.version;
} catch {
  // keep 'unknown' if resolution fails
}

// Public — no auth required
router.get('/version', (_req, res) => {
  res.json({ sdkVersion });
});

// Receive browser-side errors for server-side logging
router.post('/client-error', (req, res) => {
  const { message, source, lineno, colno, stack, type } = req.body ?? {};
  logSecurity('warn', 'browser_error', {
    type: String(type || 'error').slice(0, 50),
    message: String(message || '').slice(0, 500),
    source: String(source || '').slice(0, 200),
    lineno: Number(lineno) || 0,
    colno: Number(colno) || 0,
    stack: String(stack || '').slice(0, 2000),
  });
  res.status(204).end();
});

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

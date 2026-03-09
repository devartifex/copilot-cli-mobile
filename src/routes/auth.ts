import { Router } from 'express';
import {
  requestDeviceCode,
  pollForToken,
  validateGitHubToken,
} from '../auth/github.js';

const router = Router();

// Start GitHub Device Flow
router.post('/github/device/start', async (req, res) => {
  try {
    const deviceData = await requestDeviceCode();
    req.session.githubDeviceCode = deviceData.device_code;
    req.session.githubDeviceExpiry = Date.now() + deviceData.expires_in * 1000;

    res.json({
      user_code: deviceData.user_code,
      verification_uri: deviceData.verification_uri,
      expires_in: deviceData.expires_in,
      interval: deviceData.interval,
    });
  } catch (err) {
    console.error('GitHub device flow start error:', err);
    res.status(500).json({ error: 'Failed to start device flow' });
  }
});

// Poll GitHub Device Flow
router.post('/github/device/poll', async (req, res) => {
  const deviceCode = req.session.githubDeviceCode;
  const expiry = req.session.githubDeviceExpiry;

  if (!deviceCode) {
    return res.status(400).json({ error: 'No active device flow. Call /start first.' });
  }

  if (expiry && Date.now() > expiry) {
    delete req.session.githubDeviceCode;
    delete req.session.githubDeviceExpiry;
    return res.json({ status: 'expired' });
  }

  try {
    const result = await pollForToken(deviceCode);

    if (result.status === 'pending' || result.status === 'slow_down') {
      return res.json({ status: result.status });
    }

    if (result.status === 'access_denied') {
      delete req.session.githubDeviceCode;
      delete req.session.githubDeviceExpiry;
      return res.json({ status: 'access_denied' });
    }

    if (result.status === 'expired') {
      delete req.session.githubDeviceCode;
      delete req.session.githubDeviceExpiry;
      return res.json({ status: 'expired' });
    }

    if (!result.token) throw new Error('Token missing in authorized response');

    const user = await validateGitHubToken(result.token);
    if (!user) throw new Error('Could not validate GitHub token');

    // Regenerate session to prevent session fixation, then save before responding
    const token = result.token;
    await new Promise<void>((resolve, reject) =>
      req.session.regenerate((err) => (err ? reject(err) : resolve()))
    );
    req.session.githubToken = token;
    req.session.githubUser = user;
    await new Promise<void>((resolve, reject) =>
      req.session.save((err) => (err ? reject(err) : resolve()))
    );

    res.json({ status: 'authorized', githubUser: user.login });
  } catch (err) {
    console.error('GitHub device flow poll error:', err);
    res.status(500).json({ error: 'Device flow polling failed' });
  }
});

// Logout
router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

// Auth status
router.get('/status', (req, res) => {
  res.json({
    authenticated: !!req.session?.githubToken,
    githubUser: req.session?.githubUser?.login || null,
  });
});

export { router as authRoutes };


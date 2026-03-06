import { Router } from 'express';
import crypto from 'crypto';
import { getAuthUrl, handleCallback } from '../auth/azure';
import {
  requestDeviceCode,
  pollForToken,
  validateGitHubToken,
} from '../auth/github';

const router = Router();

// Azure AD login
router.get('/login', async (req, res) => {
  try {
    const state = crypto.randomBytes(32).toString('hex');
    req.session.authState = state;
    const loginHint = req.session.azureAccount?.username;
    const { url, verifier } = await getAuthUrl(state, loginHint);
    req.session.pkceVerifier = verifier;
    res.redirect(url);
  } catch (err) {
    console.error('Azure login error:', err);
    res.status(500).send('Login failed');
  }
});

// Azure AD callback
router.get('/callback', async (req, res) => {
  const { code, state } = req.query;

  if (!code || state !== req.session.authState) {
    return res.status(403).send('Invalid state parameter');
  }

  try {
    const result = await handleCallback(code as string, req.session.pkceVerifier!);
    req.session.azureAccount = {
      homeAccountId: result.account!.homeAccountId,
      username: result.account!.username,
      name: result.account!.name ?? undefined,
    };
    delete req.session.authState;
    delete req.session.pkceVerifier;

    // If GitHub token already in session, proceed to app; otherwise the UI will trigger device flow
    if (req.session.githubToken) {
      const returnTo = req.session.returnTo || '/';
      delete req.session.returnTo;
      return res.redirect(returnTo);
    }

    res.redirect('/');
  } catch (err) {
    console.error('Azure callback error:', err);
    res.status(500).send('Authentication failed');
  }
});

// Start GitHub Device Flow — returns user_code + verification_uri to the browser
router.post('/github/device/start', async (req, res) => {
  if (!req.session.azureAccount) {
    return res.status(401).json({ error: 'Azure AD authentication required' });
  }

  try {
    const deviceData = await requestDeviceCode();
    // Store device_code server-side; never sent to the browser
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

// Poll GitHub Device Flow — called by the browser every `interval` seconds
router.post('/github/device/poll', async (req, res) => {
  if (!req.session.azureAccount) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

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

    // Authorized — exchange device code for a real token
    if (!result.token) throw new Error('Token missing in authorized response');

    const user = await validateGitHubToken(result.token);
    if (!user) throw new Error('Could not validate GitHub token');

    req.session.githubToken = result.token;
    req.session.githubUser = user;
    delete req.session.githubDeviceCode;
    delete req.session.githubDeviceExpiry;

    res.json({ status: 'authorized', githubUser: user.login });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('GitHub device flow poll error:', err);
    res.status(500).json({ error: message });
  }
});

// Logout
router.get('/logout', (req, res) => {
  const postLogoutUrl = `${req.protocol}://${req.get('host')}`;
  req.session.destroy(() => {
    res.redirect(postLogoutUrl);
  });
});

// Auth status (for SPA) — returns granular state so the UI can drive multi-step auth
router.get('/status', (req, res) => {
  res.json({
    authenticated: !!req.session?.azureAccount && !!req.session?.githubToken,
    azureAuthenticated: !!req.session?.azureAccount,
    azureUser: req.session?.azureAccount?.name || null,
    githubUser: req.session?.githubUser?.login || null,
  });
});

export { router as authRoutes };


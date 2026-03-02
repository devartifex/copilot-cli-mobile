const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const path = require('path');
const os = require('os');
require('dotenv').config();

let pty;
try {
  pty = require('node-pty');
} catch (e) {
  console.error('node-pty not available, falling back to child_process');
  pty = null;
}

// --- Configuration ---
const PASSWORD = process.env.COPILOT_CLI_PASSWORD;
if (!PASSWORD) {
  console.error('ERROR: Set COPILOT_CLI_PASSWORD in .env');
  process.exit(1);
}
const PORT = parseInt(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const SESSION_TTL = parseInt(process.env.SESSION_TTL) || 86400000;

// --- State ---
const sessions = new Map();
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW = 60000;

// --- Express App ---
const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +
    "connect-src 'self' ws: wss:; " +
    "img-src 'self' data:;"
  );
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// --- Rate Limiting ---
function checkRateLimit(ip) {
  const now = Date.now();
  const attempts = (loginAttempts.get(ip) || []).filter(t => now - t < ATTEMPT_WINDOW);
  loginAttempts.set(ip, attempts);
  return attempts.length < MAX_ATTEMPTS;
}

// --- Auth ---
app.post('/api/login', (req, res) => {
  const ip = req.ip;
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many attempts. Try again in a minute.' });
  }

  const attempts = loginAttempts.get(ip) || [];
  attempts.push(Date.now());
  loginAttempts.set(ip, attempts);

  const { password } = req.body;
  if (!password) return res.status(401).json({ error: 'Password required' });

  const inputHash = crypto.createHash('sha256').update(String(password)).digest();
  const expectedHash = crypto.createHash('sha256').update(PASSWORD).digest();

  if (crypto.timingSafeEqual(inputHash, expectedHash)) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { created: Date.now(), ip });
    res.json({ token });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

app.get('/api/check', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token && sessions.has(token)) {
    const s = sessions.get(token);
    if (Date.now() - s.created < SESSION_TTL) {
      return res.json({ valid: true });
    }
    sessions.delete(token);
  }
  res.status(401).json({ valid: false });
});

// --- Session Cleanup ---
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (now - session.created > SESSION_TTL) sessions.delete(token);
  }
  for (const [ip, attempts] of loginAttempts) {
    const recent = attempts.filter(t => now - t < ATTEMPT_WINDOW);
    if (recent.length === 0) loginAttempts.delete(ip);
    else loginAttempts.set(ip, recent);
  }
}, 60000);

// --- WebSocket Terminal ---
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');

  if (!token || !sessions.has(token)) {
    ws.close(4001, 'Unauthorized');
    return;
  }

  const session = sessions.get(token);
  if (Date.now() - session.created > SESSION_TTL) {
    sessions.delete(token);
    ws.close(4001, 'Session expired');
    return;
  }

  const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/bash');
  const home = process.env.HOME || process.env.USERPROFILE || '.';

  if (pty) {
    // Full PTY mode
    let term;
    try {
      term = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: home,
        env: { ...process.env, TERM: 'xterm-256color' },
      });
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', data: 'Terminal start failed: ' + err.message }));
      ws.close(4002, 'Terminal error');
      return;
    }

    term.onData(data => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'output', data }));
    });

    term.onExit(({ exitCode }) => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
        ws.close();
      }
    });

    ws.on('message', msg => {
      try {
        const parsed = JSON.parse(msg);
        if (parsed.type === 'input') term.write(parsed.data);
        if (parsed.type === 'resize' && parsed.cols > 0 && parsed.rows > 0) {
          term.resize(Math.min(parsed.cols, 500), Math.min(parsed.rows, 200));
        }
      } catch (e) { /* ignore */ }
    });

    ws.on('close', () => { try { term.kill(); } catch (e) {} });
    ws.on('error', () => { try { term.kill(); } catch (e) {} });
  } else {
    // Fallback: child_process (no PTY)
    const { spawn } = require('child_process');
    const proc = spawn(shell, [], {
      cwd: home,
      env: { ...process.env, TERM: 'xterm-256color' },
    });

    proc.stdout.on('data', data => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'output', data: data.toString() }));
    });
    proc.stderr.on('data', data => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'output', data: data.toString() }));
    });
    proc.on('exit', code => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'exit', code }));
        ws.close();
      }
    });

    ws.on('message', msg => {
      try {
        const parsed = JSON.parse(msg);
        if (parsed.type === 'input') proc.stdin.write(parsed.data);
      } catch (e) { /* ignore */ }
    });

    ws.on('close', () => { try { proc.kill(); } catch (e) {} });
    ws.on('error', () => { try { proc.kill(); } catch (e) {} });
  }
});

// --- Get Local IP ---
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

// --- Start ---
server.listen(PORT, HOST, () => {
  const ip = getLocalIP();
  console.log('');
  console.log('  🤖 Copilot CLI Mobile');
  console.log('  ─────────────────────');
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${ip}:${PORT}`);
  console.log('');
  console.log('  Open this URL on your phone (same WiFi network)');
  console.log('');
});

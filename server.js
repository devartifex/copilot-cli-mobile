import { createServer } from 'http';
import session from 'express-session';
import FileStoreFactory from 'session-file-store';
import { setupWebSocket } from './dist/ws/handler.js';
import { registerSession, deleteSessionById } from './dist/session-store.js';

const FileStore = FileStoreFactory(session);
const isDev = process.env.NODE_ENV !== 'production';
const port = parseInt(process.env.PORT || '3000');

// Set ORIGIN for SvelteKit adapter-node CSRF check before importing handler.
// Without this, adapter-node defaults protocol to 'https', causing origin mismatch on plain HTTP.
if (!process.env.ORIGIN) {
  process.env.ORIGIN = process.env.BASE_URL || `http://localhost:${port}`;
}
const { handler } = await import('./build/handler.js');

const sessionStorePath = process.env.SESSION_STORE_PATH || (isDev ? '.sessions' : '/data/sessions');
const sessionMiddleware = session({
  store: new FileStore({ path: sessionStorePath, ttl: 86400, retries: 0, logFn: () => {} }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  proxy: !isDev,
  cookie: {
    httpOnly: true,
    secure: !isDev,
    sameSite: 'lax',
    maxAge: parseInt(process.env.TOKEN_MAX_AGE_MS || String(7 * 24 * 60 * 60 * 1000)),
  },
});

const server = createServer((req, res) => {
  sessionMiddleware(req, res, () => {
    const sessionId = registerSession(req.session);
    req.headers['x-session-id'] = sessionId;

    const origEnd = res.end.bind(res);
    res.end = function (...args) {
      deleteSessionById(sessionId);
      return origEnd(...args);
    };

    handler(req, res);
  });
});

setupWebSocket(server, sessionMiddleware);

server.listen(port, () => {
  console.log('');
  console.log('  Copilot Unleashed');
  console.log('  ──────────────────');
  console.log(`  Mode:  ${isDev ? 'Development' : 'Production'}`);
  console.log(`  URL:   http://localhost:${port}`);
  console.log('');
});

function shutdown() {
  console.log('\nShutting down...');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

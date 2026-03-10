import { createServer } from 'http';
import { handler } from './build/handler.js';
import session from 'express-session';
import FileStoreFactory from 'session-file-store';
import { setupWebSocket } from './dist/ws/handler.js';
import { registerSession, deleteSessionById } from './dist/session-store.js';

const FileStore = FileStoreFactory(session);
const isDev = process.env.NODE_ENV !== 'production';
const port = parseInt(process.env.PORT || '3000');

const sessionMiddleware = session({
  store: isDev
    ? new FileStore({ path: process.env.SESSION_STORE_PATH || '.sessions', ttl: 86400, retries: 0, logFn: () => {} })
    : undefined,
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: !isDev,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
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
  console.log('  Copilot CLI Mobile');
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

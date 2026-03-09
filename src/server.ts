import express from 'express';
import session from 'express-session';
import FileStoreFactory from 'session-file-store';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { config } from './config.js';
import { authRoutes } from './routes/auth.js';
import { apiRoutes } from './routes/api.js';

const app = express();
const FileStore = FileStoreFactory(session);

// Security headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
        connectSrc: ["'self'", 'ws:', 'wss:', 'https://cdn.jsdelivr.net'],
        imgSrc: ["'self'", 'data:', 'https://avatars.githubusercontent.com'],
        fontSrc: ["'self'", 'https://cdn.jsdelivr.net'],
        frameAncestors: ["'none'"],
      },
    },
  })
);

// Rate limiting
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// Session
const sessionMiddleware = session({
  store: config.isDev
    ? new FileStore({ path: config.sessionStorePath, ttl: 86400, retries: 0, logFn: () => {} })
    : undefined,
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: !config.isDev,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  },
});

app.use(sessionMiddleware);
app.use(express.json());

if (!config.isDev) {
  app.set('trust proxy', 1);
}

// Routes
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});
app.use('/auth', authRoutes);
app.use('/api', apiRoutes);

// Static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

export { app, sessionMiddleware };

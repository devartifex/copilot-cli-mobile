import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { config } from './config';
import { authRoutes } from './routes/auth';
import { apiRoutes } from './routes/api';

const app = express();

// Security headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        imgSrc: ["'self'", 'data:', 'https://avatars.githubusercontent.com'],
        fontSrc: ["'self'", 'https://cdn.jsdelivr.net'],
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
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: !config.isDev,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  },
});

app.use(sessionMiddleware);
app.use(express.json());

// Trust proxy in production (Azure Container Apps)
if (!config.isDev) {
  app.set('trust proxy', 1);
}

// Routes
app.use('/auth', authRoutes);
app.use('/api', apiRoutes);

// Static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// SPA fallback — serve index.html for non-API routes
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

export { app, sessionMiddleware };

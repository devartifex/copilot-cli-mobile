import type { Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { getSessionById, deleteSessionById } from '$lib/server/session-store';

// Extract express-session from the bridge and attach to event.locals
const sessionHandle: Handle = async ({ event, resolve }) => {
	const sessionId = event.request.headers.get('x-session-id');
	if (sessionId) {
		event.locals.session = getSessionById(sessionId) ?? null;
	} else {
		event.locals.session = null;
	}
	return resolve(event);
};

const securityHeaders: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);

  const isDev = process.env.NODE_ENV !== 'production';

  // Skip strict CSP in dev mode — Vite HMR uses blob: workers and eval
  if (!isDev) {
    response.headers.set('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self' ws: wss:",
      "worker-src 'self' blob:",
      "img-src 'self' data: https://avatars.githubusercontent.com",
      "font-src 'self'",
      "frame-ancestors 'none'",
    ].join('; '));

    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  // Security headers (always)
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('X-XSS-Protection', '1; mode=block');

  return response;
};

// Rate limiting with Map-based IP tracking
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX = 200;

const rateLimit: Handle = async ({ event, resolve }) => {
  const ip = event.getClientAddress();
  const now = Date.now();

  let entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetTime) {
    entry = { count: 0, resetTime: now + RATE_LIMIT_WINDOW };
    rateLimitMap.set(ip, entry);
  }

  entry.count++;

  if (entry.count > RATE_LIMIT_MAX) {
    return new Response('Too Many Requests', { status: 429 });
  }

  return resolve(event);
};

export const handle: Handle = sequence(sessionHandle, securityHeaders, rateLimit);

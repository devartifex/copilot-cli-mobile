import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type ViteDevServer } from 'vite';

function webSocketDevPlugin() {
	return {
		name: 'copilot-ws-dev',
		async configureServer(server: ViteDevServer) {
			if (!server.httpServer) return;

			// Dynamic import to avoid bundling server-only code
			const { setupWebSocket } = await import('./dist/ws/handler.js');
			const session = (await import('express-session')).default;
			const FileStoreFactory = (await import('session-file-store')).default;

			const FileStore = FileStoreFactory(session);
			const sessionMiddleware = session({
				store: new FileStore({
					path: process.env.SESSION_STORE_PATH || '.sessions',
					ttl: 86400,
					retries: 0,
					logFn: () => {},
				}),
				secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
				resave: false,
				saveUninitialized: false,
				rolling: true,
				cookie: { httpOnly: true, secure: false, sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000 },
			});

			// Bridge sessions to SvelteKit locals via globalThis
			const { registerSession, deleteSessionById } = await import('./dist/session-store.js');

			// Intercept HTTP requests to inject session
			server.middlewares.use((req, res, next) => {
				sessionMiddleware(req as any, res as any, () => {
					const sessionId = registerSession((req as any).session);
					req.headers['x-session-id'] = sessionId;
					const origEnd = res.end.bind(res);
					(res as any).end = function (...args: any[]) {
						deleteSessionById(sessionId);
						return origEnd(...args);
					};
					next();
				});
			});

			setupWebSocket(server.httpServer, sessionMiddleware);
			console.log('  ✓ WebSocket server attached to Vite dev server');
		},
	};
}

export default defineConfig({
	plugins: [sveltekit(), webSocketDevPlugin()],
	server: {
		port: 5173,
	},
	build: {
		rollupOptions: {
			output: {
				manualChunks(id) {
					// Keep Svelte runtime in one chunk to avoid circular deps
					if (id.includes('node_modules/svelte')) {
						return 'svelte';
					}
					// Group markdown rendering libs together
					if (id.includes('node_modules/highlight.js') ||
						id.includes('node_modules/marked') ||
						id.includes('node_modules/dompurify')) {
						return 'markdown-vendor';
					}
				},
			},
		},
	},
});

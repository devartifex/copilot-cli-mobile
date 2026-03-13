import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	plugins: [sveltekit()],
	resolve: {
		alias: {
			$lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
		},
	},
	test: {
		environment: 'jsdom',
		environmentMatchGlobs: [['src/lib/server/**', 'node']],
		include: ['src/**/*.test.ts'],
		exclude: ['node_modules', 'tests/**'],
		setupFiles: ['./src/test-setup.ts'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'lcov'],
			thresholds: {
				lines: 50,
				functions: 50,
				branches: 50,
				statements: 50,
			},
			include: ['src/lib/**/*.ts'],
			exclude: [
				'**/*.test.ts',
				'**/*.d.ts',
				'**/types/**',
				'src/lib/server/**',
				'src/lib/stores/**',
				'src/lib/utils/markdown.ts',
			],
		},
	},
});

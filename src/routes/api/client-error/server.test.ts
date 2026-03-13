// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/security-log', () => ({
	logSecurity: vi.fn(),
}));

import { POST } from './+server';
import { logSecurity } from '$lib/server/security-log';

function createEvent(request: Request) {
	return { request } as any;
}

describe('POST /api/client-error', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('accepts valid client error reports', async () => {
		const request = new Request('http://localhost/api/client-error', {
			method: 'POST',
			body: JSON.stringify({ message: 'Boom', source: '/app.js', lineno: 12, colno: 7, stack: 'stack', type: 'error' }),
			headers: { 'content-type': 'application/json' },
		});

		const response = await POST(createEvent(request));

		expect(response.status).toBe(204);
		expect(logSecurity).toHaveBeenCalledWith('warn', 'browser_error', expect.objectContaining({
			type: 'error',
			message: 'Boom',
			source: '/app.js',
			lineno: 12,
			colno: 7,
			stack: 'stack',
		}));
	});

	it('truncates oversized string fields', async () => {
		const message = 'm'.repeat(600);
		const source = 's'.repeat(300);
		const stack = 'k'.repeat(2500);
		const type = 't'.repeat(80);
		const request = new Request('http://localhost/api/client-error', {
			method: 'POST',
			body: JSON.stringify({ message, source, lineno: 1, colno: 2, stack, type }),
			headers: { 'content-type': 'application/json' },
		});

		await POST(createEvent(request));

		expect(logSecurity).toHaveBeenCalledWith('warn', 'browser_error', {
			type: type.slice(0, 50),
			message: message.slice(0, 500),
			source: source.slice(0, 200),
			lineno: 1,
			colno: 2,
			stack: stack.slice(0, 2000),
		});
	});

	it('defaults missing fields to safe values', async () => {
		const request = new Request('http://localhost/api/client-error', {
			method: 'POST',
			body: JSON.stringify({}),
			headers: { 'content-type': 'application/json' },
		});

		await POST(createEvent(request));

		expect(logSecurity).toHaveBeenCalledWith('warn', 'browser_error', {
			type: 'error',
			message: '',
			source: '',
			lineno: 0,
			colno: 0,
			stack: '',
		});
	});

	it('coerces malformed scalar fields without failing', async () => {
		const request = new Request('http://localhost/api/client-error', {
			method: 'POST',
			body: JSON.stringify({ message: 42, source: true, lineno: '7', colno: 'abc', stack: null, type: false }),
			headers: { 'content-type': 'application/json' },
		});

		const response = await POST(createEvent(request));

		expect(response.status).toBe(204);
		expect(logSecurity).toHaveBeenCalledWith('warn', 'browser_error', {
			type: 'error',
			message: '42',
			source: 'true',
			lineno: 7,
			colno: 0,
			stack: '',
		});
	});

	it('ignores malformed JSON bodies', async () => {
		const request = new Request('http://localhost/api/client-error', {
			method: 'POST',
			body: '{bad json',
			headers: { 'content-type': 'application/json' },
		});

		const response = await POST(createEvent(request));

		expect(response.status).toBe(204);
		expect(logSecurity).not.toHaveBeenCalled();
	});
});

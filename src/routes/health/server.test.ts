// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { GET } from './+server';

function createEvent() {
	return {} as any;
}

describe('GET /health', () => {
	it('returns 200', async () => {
		const response = await GET(createEvent());

		expect(response.status).toBe(200);
	});

	it('returns the expected payload', async () => {
		const response = await GET(createEvent());

		expect(await response.json()).toEqual({ status: 'ok' });
	});

	it('includes a status field', async () => {
		const response = await GET(createEvent());
		const body = await response.json();

		expect(body).toHaveProperty('status');
	});

	it('returns a string status value', async () => {
		const response = await GET(createEvent());
		const body = await response.json();

		expect(body.status).toBe('ok');
		expect(typeof body.status).toBe('string');
	});

	it('responds with JSON content type', async () => {
		const response = await GET(createEvent());

		expect(response.headers.get('content-type')).toContain('application/json');
	});
});

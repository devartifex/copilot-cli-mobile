// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { GET } from './+server';

function createEvent() {
	return {} as any;
}

describe('GET /api/version', () => {
	it('returns 200', async () => {
		const response = await GET(createEvent());

		expect(response.status).toBe(200);
	});

	it('returns version info', async () => {
		const response = await GET(createEvent());
		const body = await response.json();

		expect(body).toHaveProperty('sdkVersion');
	});

	it('returns sdkVersion as a string', async () => {
		const response = await GET(createEvent());
		const body = await response.json();

		expect(typeof body.sdkVersion).toBe('string');
	});

	it('returns a stable payload across requests', async () => {
		const first = await (await GET(createEvent())).json();
		const second = await (await GET(createEvent())).json();

		expect(second).toEqual(first);
	});

	it('responds with JSON content type', async () => {
		const response = await GET(createEvent());

		expect(response.headers.get('content-type')).toContain('application/json');
	});
});

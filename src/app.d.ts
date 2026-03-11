import type { SessionData } from '$lib/server/auth/guard';

declare global {
	namespace App {
		interface Locals {
			session: SessionData | null;
		}
	}
}

export {};

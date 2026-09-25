import type { GrantScope } from '$lib/server/advisor';
import type { User } from '$lib/types';

declare global {
	namespace App {
		type Error = { message: string };
		type PageData = {};
		type PageState = {};
		type Platform = Request;
		interface Locals {
			user: User | null;
			/** Set for a magic-link advisor session. Mutations must 403. */
			viewer: { grantId: number; scope: GrantScope } | null;
		}
	}
}

export {};

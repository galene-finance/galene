import { fail } from '@sveltejs/kit';
import type { PublishResult } from './themeGallery';

/**
 * Appearance `publish-theme` action result. A refusal is a real HTTP failure:
 * 403 on the public demo, 429 when the gallery's hourly limit says no.
 * The gallery is the authoritative limit; the app does not keep its own.
 */
export async function publishThemeAction(run: () => Promise<PublishResult>) {
	const result = await run();
	if (!result.ok) {
		return fail(result.status, {
			error: result.error,
			publishError: result.error,
			rateLimited: result.status === 429,
			retryAfterSec: result.retryAfterSec ?? null
		});
	}
	return { ok: true, message: result.message };
}

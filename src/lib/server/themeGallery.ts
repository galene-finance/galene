/**
 * Publish the selected theme to the public gallery.
 * The instance holds an Ed25519 key (created once, stored in this database).
 * The gallery accepts only a request signed with that key. No user accounts.
 *
 * Message: UTF-8 "galene-theme-publish\n" + unix seconds + "\n" + hex SHA-256 of the raw body.
 * Galene-Key is the raw public key (base64url). Galene-Signature is the Ed25519 signature (base64url).
 * Keep this in sync with the gallery verifier.
 *
 * Captcha is intentionally omitted: this is a server-to-server call and the
 * Appearance page cannot show a captcha widget cleanly for a self-hosted app.
 */
import { createHash, createPrivateKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { db } from './db';
import { serializeThemePack } from '../theme-pack';

export const THEME_GALLERY_ORIGIN = 'https://themes.galene.finance';
export const PUBLISH_LABEL = 'galene-theme-publish';

const DEFAULT_PUBLISH_URL = `${THEME_GALLERY_ORIGIN}/api/themes`;

export function themeGalleryPublishUrl(): string {
	const override = process.env.GALENE_THEME_GALLERY_URL?.trim();
	return override || DEFAULT_PUBLISH_URL;
}

export function publishMessage(timestamp: string, body: Buffer | string): Buffer {
	const digest = createHash('sha256').update(body).digest('hex');
	return Buffer.from(`${PUBLISH_LABEL}\n${timestamp}\n${digest}`, 'utf8');
}

export function ensureInstanceKey(): { publicKey: string; privateKey: KeyObject } {
	const database = db();
	const existing = database
		.query('SELECT public_key, private_key FROM gallery_instance WHERE id = 1')
		.get() as { public_key: string; private_key: string } | null;
	if (existing) {
		return {
			publicKey: existing.public_key,
			privateKey: createPrivateKey(existing.private_key)
		};
	}
	const { publicKey, privateKey } = generateKeyPairSync('ed25519');
	const publicB64 = publicKey.export({ format: 'jwk' }).x;
	if (!publicB64) throw new Error('Could not create a gallery signing key.');
	const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
	database.query('INSERT INTO gallery_instance (id, public_key, private_key) VALUES (1, ?, ?)').run(publicB64, pem);
	return { publicKey: publicB64, privateKey };
}

function allowedGalleryUrl(raw: string): boolean {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return false;
	}
	if (url.protocol === 'https:') return true;
	const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
	return url.protocol === 'http:' && local;
}

/**
 * `status` is the HTTP status the Appearance action should fail with:
 * 403 demo, 409 duplicate colors, 429 the gallery's hourly limit, 400 the
 * gallery refused the theme or the address, 502 the gallery could not be
 * reached or failed.
 */
export type PublishResult =
	| { ok: true; message: string }
	| { ok: false; status: 400 | 403 | 409 | 429 | 502; error: string; retryAfterSec?: number };

export const RATE_LIMIT_MESSAGE = 'You can publish one theme per hour. Try again later.';

/** Whole seconds from the gallery's JSON `retryAfterSec`, else the Retry-After header. */
function retryAfterSeconds(data: { retryAfterSec?: unknown } | null, header: string | null): number | undefined {
	const fromBody = data?.retryAfterSec;
	if (typeof fromBody === 'number' && Number.isFinite(fromBody) && fromBody > 0) return Math.ceil(fromBody);
	if (header && /^\d{1,7}$/.test(header.trim())) {
		const n = Number(header.trim());
		if (n > 0) return n;
	}
	return undefined;
}

/** "You can publish one theme per hour. Try again in about 12 minutes." */
export function rateLimitMessage(retryAfterSec?: number): string {
	if (!retryAfterSec) return RATE_LIMIT_MESSAGE;
	const minutes = Math.max(1, Math.ceil(retryAfterSec / 60));
	const when = minutes === 1 ? 'about a minute' : `about ${minutes} minutes`;
	return `You can publish one theme per hour. Try again in ${when}.`;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; redirect: 'error'; signal: AbortSignal }) => Promise<Response>;

export async function publishThemePack(
	body: string,
	deps?: { fetchImpl?: FetchLike; url?: string; now?: () => number }
): Promise<PublishResult> {
	const url = deps?.url ?? themeGalleryPublishUrl();
	if (!allowedGalleryUrl(url)) return { ok: false, status: 400, error: 'Theme gallery address is not allowed.' };
	const keys = ensureInstanceKey();
	const timestamp = String(Math.floor((deps?.now ?? Date.now)() / 1000));
	const signature = sign(null, publishMessage(timestamp, Buffer.from(body, 'utf8')), keys.privateKey).toString('base64url');
	const fetchImpl = deps?.fetchImpl ?? fetch;
	let response: Response;
	try {
		response = await fetchImpl(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Galene-Key': keys.publicKey,
				'Galene-Timestamp': timestamp,
				'Galene-Signature': signature
			},
			body,
			redirect: 'error',
			signal: AbortSignal.timeout(10_000)
		});
	} catch {
		return { ok: false, status: 502, error: 'Could not reach the theme gallery.' };
	}
	if (response.status === 201) return { ok: true, message: 'Published to the theme gallery.' };
	let data: { error?: unknown; retryAfterSec?: unknown; code?: unknown } | null = null;
	try {
		data = (await response.json()) as { error?: unknown; retryAfterSec?: unknown; code?: unknown };
	} catch {
		data = null;
	}
	if (response.status === 429) {
		const retryAfterSec = retryAfterSeconds(data, response.headers.get('retry-after'));
		return { ok: false, status: 429, error: rateLimitMessage(retryAfterSec), retryAfterSec };
	}
	if (response.status === 409) {
		const code = data && typeof data.code === 'string' ? data.code : '';
		const detail =
			data && typeof data.error === 'string' && /^[A-Za-z0-9 .,'():\u201c\u201d-]{1,200}$/.test(data.error)
				? data.error
				: '';
		if (code === 'duplicate_colors' && detail) {
			return { ok: false, status: 409, error: detail };
		}
		return {
			ok: false,
			status: 409,
			error: detail || "These colors are already published. You can't publish the same colors again."
		};
	}
	let detail = '';
	if (data && typeof data.error === 'string' && /^[A-Za-z0-9 .,'():\u201c\u201d-]{1,200}$/.test(data.error)) detail = data.error;
	const status = response.status >= 400 && response.status < 500 ? 400 : 502;
	return { ok: false, status, error: detail || 'The theme gallery did not accept this theme.' };
}

function demoPublishBlocked(): string | null {
	const raw = process.env.GALENE_DEMO?.trim().toLowerCase() ?? '';
	if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') {
		return 'Publishing a theme is disabled on the public demo. Run your own Galene instance to use it.';
	}
	return null;
}

/** Publish the theme currently selected for this user. Demo mode never publishes. */
export async function publishCurrentTheme(userId: number, deps?: { fetchImpl?: FetchLike; url?: string; now?: () => number }): Promise<PublishResult> {
	const blocked = demoPublishBlocked();
	if (blocked) return { ok: false, status: 403, error: blocked };
	// Loaded only when publishing so unit tests can run without the Kit alias.
	const { resolveTheme } = await import('./themes');
	const theme = resolveTheme(userId);
	return publishThemePack(serializeThemePack(theme.name, theme.colors), deps);
}

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

export type PublishResult = { ok: true; message: string } | { ok: false; error: string };

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; redirect: 'error'; signal: AbortSignal }) => Promise<Response>;

export async function publishThemePack(
	body: string,
	deps?: { fetchImpl?: FetchLike; url?: string; now?: () => number }
): Promise<PublishResult> {
	const url = deps?.url ?? themeGalleryPublishUrl();
	if (!allowedGalleryUrl(url)) return { ok: false, error: 'Theme gallery address is not allowed.' };
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
		return { ok: false, error: 'Could not reach the theme gallery.' };
	}
	if (response.status === 201) return { ok: true, message: 'Published to the theme gallery.' };
	let detail = '';
	try {
		const data = (await response.json()) as { error?: unknown };
		if (typeof data.error === 'string' && /^[A-Za-z0-9 .,'():-]{1,160}$/.test(data.error)) detail = data.error;
	} catch {
		detail = '';
	}
	return { ok: false, error: detail || 'The theme gallery did not accept this theme.' };
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
	if (blocked) return { ok: false, error: blocked };
	// Loaded only when publishing so unit tests can run without the Kit alias.
	const { resolveTheme } = await import('./themes');
	const theme = resolveTheme(userId);
	return publishThemePack(serializeThemePack(theme.name, theme.colors), deps);
}

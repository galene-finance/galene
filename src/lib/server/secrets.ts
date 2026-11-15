/**
 * Authenticated encryption for reversible secrets stored in SQLite.
 *
 * Envelope: `enc:v1:<keyId>:<nonce>:<ciphertext>`
 *   keyId       — 16 hex chars, first 8 bytes of SHA-256(key)
 *   nonce       — 12 bytes, base64url
 *   ciphertext  — AES-256-GCM ciphertext || 16-byte tag, base64url
 * The version and key id are bound as additional authenticated data.
 *
 * GALENE_SECRET_KEY is the current key (32 bytes, standard or URL-safe base64).
 * GALENE_SECRET_KEY_PREVIOUS decrypts rows still on the old key during rotation.
 * Rows that are not an enc:v1 envelope are treated as legacy plaintext.
 * Encryption is skipped when the current key is unset so a fresh install and
 * demo mode can start; startup fails if an envelope is present and the key
 * is missing or cannot decrypt it.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Database } from 'bun:sqlite';

export const SECRET_ENVELOPE_PREFIX = 'enc:v1:';

/** Settings keys whose values are secrets (provider client secret, and similar). */
export const SECRET_SETTING_KEYS = ['plaid_client_secret'] as const;

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export class SecretKeyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SecretKeyError';
	}
}

export type KeyMaterial = { id: string; bytes: Buffer };

type LoadedKeys = {
	current: KeyMaterial | null;
	previous: KeyMaterial | null;
};

type SecretCell = {
	where: string;
	value: string;
	/** Seal even when the stored string is empty JSON (`{}`). */
	always: boolean;
	save: (next: string) => void;
};

let warnedMissingKey = false;
let warnedPreviousKey = false;

/** Test hook: allow another startup warning after env changes. */
export function resetSecretWarningForTests(): void {
	warnedMissingKey = false;
	warnedPreviousKey = false;
}

export function isSecretSetting(key: string): boolean {
	return (SECRET_SETTING_KEYS as readonly string[]).includes(key);
}

function invalidKeyMessage(name: string): string {
	return `Galene will not start: ${name} must be 32 bytes, base64-encoded. Generate one with: openssl rand -base64 32`;
}

function decodeKey(raw: string): Buffer | null {
	const compact = raw.trim().replace(/\s+/g, '');
	if (!compact) return null;
	const body = compact.replace(/=+$/, '');
	if (!/^[A-Za-z0-9+/_-]+$/.test(body)) return null;
	const standard = body.includes('+') || body.includes('/');
	const url = body.includes('-') || body.includes('_');
	if (standard && url) return null;
	const encoding = standard ? 'base64' : 'base64url';
	const buf = Buffer.from(compact, encoding);
	if (buf.length !== KEY_BYTES) return null;
	const recoded = buf.toString(encoding).replace(/=+$/, '');
	if (recoded !== body) return null;
	return buf;
}

export function keyIdFor(bytes: Buffer): string {
	return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}

function readKey(name: string): KeyMaterial | null {
	const raw = process.env[name];
	if (raw == null || raw.trim() === '') return null;
	const bytes = decodeKey(raw);
	if (!bytes) throw new SecretKeyError(invalidKeyMessage(name));
	return { bytes, id: keyIdFor(bytes) };
}

export function loadSecretKeys(): LoadedKeys {
	return {
		current: readKey('GALENE_SECRET_KEY'),
		previous: readKey('GALENE_SECRET_KEY_PREVIOUS')
	};
}

type ParsedEnvelope = { keyId: string; nonce: Buffer; ct: Buffer };

export function parseSecretEnvelope(stored: string): ParsedEnvelope | null {
	if (!stored.startsWith(SECRET_ENVELOPE_PREFIX)) return null;
	const rest = stored.slice(SECRET_ENVELOPE_PREFIX.length);
	const parts = rest.split(':');
	if (parts.length !== 3) return null;
	const [keyId, nonceB64, ctB64] = parts;
	if (!keyId || !/^[0-9a-f]{16}$/.test(keyId)) return null;
	if (!nonceB64 || !ctB64 || !/^[A-Za-z0-9_-]+$/.test(nonceB64) || !/^[A-Za-z0-9_-]+$/.test(ctB64)) {
		return null;
	}
	const nonce = Buffer.from(nonceB64, 'base64url');
	const ct = Buffer.from(ctB64, 'base64url');
	if (nonce.length !== NONCE_BYTES || ct.length < TAG_BYTES) return null;
	if (nonce.toString('base64url') !== nonceB64 || ct.toString('base64url') !== ctB64) return null;
	return { keyId, nonce, ct };
}

export function isSecretEnvelope(stored: string): boolean {
	return parseSecretEnvelope(stored) !== null;
}

function encryptValue(plaintext: string, key: KeyMaterial): string {
	const nonce = randomBytes(NONCE_BYTES);
	const cipher = createCipheriv('aes-256-gcm', key.bytes, nonce);
	cipher.setAAD(Buffer.from(`${SECRET_ENVELOPE_PREFIX}${key.id}`));
	const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const ct = Buffer.concat([body, cipher.getAuthTag()]);
	return `${SECRET_ENVELOPE_PREFIX}${key.id}:${nonce.toString('base64url')}:${ct.toString('base64url')}`;
}

function decryptValue(stored: string, keys: LoadedKeys): string {
	const parsed = parseSecretEnvelope(stored);
	if (!parsed) {
		throw new SecretKeyError(
			'Stored credentials could not be decrypted. Check GALENE_SECRET_KEY.'
		);
	}
	const key = [keys.current, keys.previous].find((item) => item?.id === parsed.keyId) ?? null;
	if (!key) {
		throw new SecretKeyError(
			'Stored credentials could not be decrypted. Check GALENE_SECRET_KEY.'
		);
	}
	try {
		const decipher = createDecipheriv('aes-256-gcm', key.bytes, parsed.nonce);
		decipher.setAAD(Buffer.from(`${SECRET_ENVELOPE_PREFIX}${parsed.keyId}`));
		decipher.setAuthTag(parsed.ct.subarray(parsed.ct.length - TAG_BYTES));
		const plain = Buffer.concat([
			decipher.update(parsed.ct.subarray(0, parsed.ct.length - TAG_BYTES)),
			decipher.final()
		]);
		return plain.toString('utf8');
	} catch {
		throw new SecretKeyError(
			'Stored credentials could not be decrypted. Check GALENE_SECRET_KEY.'
		);
	}
}

/**
 * Encrypt a secret for storage. Empty strings stay empty. An existing
 * enc:v1 envelope is returned unchanged so a row is never double-encrypted.
 * With no current key the plaintext is returned (legacy / fresh install).
 */
export function sealSecret(plaintext: string): string {
	if (!plaintext) return plaintext;
	if (plaintext.startsWith(SECRET_ENVELOPE_PREFIX)) return plaintext;
	const keys = loadSecretKeys();
	if (!keys.current) return plaintext;
	return encryptValue(plaintext, keys.current);
}

/** Decrypt an envelope. Legacy plaintext is returned unchanged. */
export function openSecret(stored: string): string {
	if (!stored || !stored.startsWith(SECRET_ENVELOPE_PREFIX)) return stored;
	return decryptValue(stored, loadSecretKeys());
}

export function sealConnectionCredentials(record: Record<string, string>): string {
	return sealSecret(JSON.stringify(record));
}

/** Read a connection credential blob. Decrypt failures propagate; bad JSON becomes {}. */
export function openConnectionCredentials(stored: string): Record<string, string> {
	const plain = openSecret(stored);
	try {
		const parsed = JSON.parse(plain) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
		const out: Record<string, string> = {};
		for (const [key, value] of Object.entries(parsed)) {
			out[key] = value == null ? '' : String(value);
		}
		return out;
	} catch (error) {
		if (error instanceof SecretKeyError) throw error;
		return {};
	}
}

function tableExists(database: Database, name: string): boolean {
	return !!database
		.query(`SELECT 1 AS o FROM sqlite_master WHERE type = 'table' AND name = ?`)
		.get(name);
}

function collectSecretCells(database: Database): SecretCell[] {
	const cells: SecretCell[] = [];
	if (tableExists(database, 'connections')) {
		const rows = database.query('SELECT id, credentials AS value FROM connections').all() as {
			id: number;
			value: string;
		}[];
		for (const row of rows) {
			cells.push({
				where: `connections row ${row.id}`,
				value: row.value,
				always: true,
				save: (next) => {
					database.query('UPDATE connections SET credentials = ? WHERE id = ?').run(next, row.id);
				}
			});
		}
	}
	if (tableExists(database, 'settings')) {
		const rows = database
			.query(`SELECT user_id, key, value FROM settings WHERE key = 'plaid_client_secret'`)
			.all() as { user_id: number; key: string; value: string }[];
		for (const row of rows) {
			cells.push({
				where: `settings ${row.key} for user ${row.user_id}`,
				value: row.value,
				always: false,
				save: (next) => {
					database
						.query('UPDATE settings SET value = ? WHERE user_id = ? AND key = ?')
						.run(next, row.user_id, row.key);
				}
			});
		}
	}
	if (tableExists(database, 'oidc_config')) {
		const row = database.query('SELECT client_secret AS value FROM oidc_config WHERE id = 1').get() as
			| { value: string }
			| null;
		if (row) {
			cells.push({
				where: 'oidc client secret',
				value: row.value,
				always: false,
				save: (next) => {
					database.query('UPDATE oidc_config SET client_secret = ? WHERE id = 1').run(next);
				}
			});
		}
	}
	if (tableExists(database, 'webhooks')) {
		const rows = database.query('SELECT id, secret AS value FROM webhooks').all() as {
			id: number;
			value: string;
		}[];
		for (const row of rows) {
			cells.push({
				where: `webhook ${row.id}`,
				value: row.value,
				always: true,
				save: (next) => {
					database.query('UPDATE webhooks SET secret = ? WHERE id = ?').run(next, row.id);
				}
			});
		}
	}
	if (tableExists(database, 'user_mfa_methods')) {
		const rows = database.query('SELECT id, secret AS value FROM user_mfa_methods').all() as {
			id: number;
			value: string;
		}[];
		for (const row of rows) {
			cells.push({
				where: `authenticator method ${row.id}`,
				value: row.value,
				always: true,
				save: (next) => {
					database.query('UPDATE user_mfa_methods SET secret = ? WHERE id = ?').run(next, row.id);
				}
			});
		}
	}
	if (tableExists(database, 'gallery_instance')) {
		const row = database.query('SELECT private_key AS value FROM gallery_instance WHERE id = 1').get() as
			| { value: string }
			| null;
		if (row) {
			cells.push({
				where: 'gallery signing key',
				value: row.value,
				always: true,
				save: (next) => {
					database.query('UPDATE gallery_instance SET private_key = ? WHERE id = 1').run(next);
				}
			});
		}
	}
	return cells;
}

function isPlaintextSecret(cell: SecretCell): boolean {
	if (cell.value.startsWith(SECRET_ENVELOPE_PREFIX)) return false;
	if (!cell.always && cell.value === '') return false;
	return true;
}

/**
 * Locations of secret cells that are still plaintext. Descriptions name the
 * row, never the stored value. Used by tests and not logged at startup.
 */
export function plaintextSecretLocations(database: Database): string[] {
	return collectSecretCells(database)
		.filter(isPlaintextSecret)
		.map((cell) => cell.where);
}

/**
 * Encrypt plaintext secret cells with the current key. No-op when the key is
 * unset. Envelopes are skipped, so running this again does not double-encrypt.
 * Does not open its own transaction (the schema migration already has one).
 */
export function encryptPlaintextSecrets(database: Database): number {
	const keys = loadSecretKeys();
	if (!keys.current) return 0;
	let updated = 0;
	for (const cell of collectSecretCells(database)) {
		if (!isPlaintextSecret(cell)) continue;
		cell.save(encryptValue(cell.value, keys.current));
		updated++;
	}
	return updated;
}

/**
 * Re-encrypt every secret cell with the current key. Rows already on that
 * key are left byte-for-byte. Plaintext rows are encrypted. Requires
 * GALENE_SECRET_KEY; GALENE_SECRET_KEY_PREVIOUS is used to read older envelopes.
 */
export function rotateStoredSecrets(database: Database): { updated: number; unchanged: number } {
	const keys = loadSecretKeys();
	if (!keys.current) {
		throw new SecretKeyError(
			'Set GALENE_SECRET_KEY to the new key before re-encrypting stored credentials. Set GALENE_SECRET_KEY_PREVIOUS to the old key so existing rows can be read.'
		);
	}
	let updated = 0;
	let unchanged = 0;
	database.run('BEGIN');
	try {
		for (const cell of collectSecretCells(database)) {
			if (!cell.always && cell.value === '') {
				unchanged++;
				continue;
			}
			const parsed = parseSecretEnvelope(cell.value);
			if (parsed?.keyId === keys.current.id) {
				unchanged++;
				continue;
			}
			if (cell.value.startsWith(SECRET_ENVELOPE_PREFIX) && !parsed) {
				throw new SecretKeyError(
					`Stored credentials could not be decrypted (${cell.where}). Check GALENE_SECRET_KEY.`
				);
			}
			const plain = parsed ? decryptValue(cell.value, keys) : cell.value;
			const next = encryptValue(plain, keys.current);
			cell.save(next);
			updated++;
		}
		database.run('COMMIT');
	} catch (error) {
		database.run('ROLLBACK');
		throw error;
	}
	return { updated, unchanged };
}

/**
 * Startup check. Invalid key material always fails. Encrypted rows with a
 * missing or wrong key fail. No key and no envelopes warns once and continues
 * so a fresh install and demo mode still boot.
 */
export function prepareStoredSecrets(database: Database): void {
	const keys = loadSecretKeys();
	const cells = collectSecretCells(database);
	const encrypted = cells.filter((cell) => cell.value.startsWith(SECRET_ENVELOPE_PREFIX));
	if (encrypted.length > 0 && !keys.current) {
		throw new SecretKeyError(
			'Galene will not start: stored connection credentials are encrypted but GALENE_SECRET_KEY is not set. Set it to the key used when they were saved. During rotation, GALENE_SECRET_KEY is the new key and GALENE_SECRET_KEY_PREVIOUS is the old key. Restoring a backup needs the same key.'
		);
	}
	for (const cell of encrypted) {
		try {
			if (!parseSecretEnvelope(cell.value)) {
				throw new SecretKeyError('undecryptable');
			}
			decryptValue(cell.value, keys);
		} catch {
			throw new SecretKeyError(
				`Galene will not start: GALENE_SECRET_KEY cannot decrypt stored credentials (${cell.where}). Set the key that was used for this database, or set GALENE_SECRET_KEY_PREVIOUS to the previous key while rotating.`
			);
		}
	}
	if (keys.current) {
		const stale = encrypted.some((cell) => {
			const parsed = parseSecretEnvelope(cell.value);
			return parsed != null && parsed.keyId !== keys.current!.id;
		});
		database.run('BEGIN');
		try {
			encryptPlaintextSecrets(database);
			database.run('COMMIT');
		} catch (error) {
			database.run('ROLLBACK');
			throw error;
		}
		if (stale && !warnedPreviousKey) {
			warnedPreviousKey = true;
			console.warn(
				'Galene: some stored credentials still use the previous key. Run `bun run secrets:rotate` (or `bun rotate-secrets.js` from the app image) to re-encrypt them with GALENE_SECRET_KEY.'
			);
		}
		return;
	}
	if (!warnedMissingKey) {
		warnedMissingKey = true;
		console.warn(
			'Galene: GALENE_SECRET_KEY is not set, so connection credentials and other stored secrets are not encrypted at rest. The app will keep running. Generate a key with `openssl rand -base64 32` and set GALENE_SECRET_KEY before saving provider credentials. A fresh install and demo mode do not require a key until credentials are stored.'
		);
	}
}

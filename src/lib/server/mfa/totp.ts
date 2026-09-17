import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * TOTP (RFC 6238) with HMAC-SHA1, 30s period, 6 digits — implemented on
 * node:crypto to keep the dependency footprint at zero. The shared secret is
 * 20 random bytes, base32-encoded (RFC 4648) for display and for the
 * otpauth:// URI that authenticator apps scan.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_PERIOD = 30;
export const TOTP_DIGITS = 6;
export const TOTP_ISSUER = 'Galene';

export function base32Encode(bytes: Uint8Array): string {
	let bits = 0;
	let value = 0;
	let out = '';
	for (const byte of bytes) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			out += ALPHABET[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}
	if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
	return out;
}

export function base32Decode(input: string): Uint8Array {
	const clean = input.toUpperCase().replace(/=+$/g, '').replace(/\s/g, '');
	if (!clean) throw new Error('Empty base32 input');
	let bits = 0;
	let value = 0;
	const out: number[] = [];
	for (const c of clean) {
		const index = ALPHABET.indexOf(c);
		if (index === -1) throw new Error('Invalid base32 character');
		value = (value << 5) | index;
		bits += 5;
		if (bits >= 8) {
			out.push((value >>> (bits - 8)) & 255);
			bits -= 8;
		}
	}
	return new Uint8Array(out);
}

/** 20 random bytes, base32-encoded (32 chars) — the standard TOTP secret size. */
export function generateTotpSecret(): string {
	return base32Encode(randomBytes(20));
}

function counterAt(timeSeconds: number): number {
	return Math.floor(timeSeconds / TOTP_PERIOD);
}

/** The TOTP code for a counter (RFC 4226 dynamic truncation). */
function codeFor(secretBytes: Uint8Array, counter: number): string {
	const buffer = Buffer.alloc(8);
	buffer.writeBigUInt64BE(BigInt(counter));
	const hmac = createHmac('sha1', secretBytes).update(buffer).digest();
	const offset = hmac[hmac.length - 1] & 0x0f;
	const value =
		((hmac[offset] & 0x7f) << 24) |
		(hmac[offset + 1] << 16) |
		(hmac[offset + 2] << 8) |
		hmac[offset + 3];
	return String(value % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

/** The code the user's authenticator shows right now. */
export function totpNow(secret: string): string {
	return codeFor(base32Decode(secret), counterAt(Date.now() / 1000));
}

/**
 * Verify a presented 6-digit code against the secret, allowing ±1 period of
 * clock skew between the server and the user's device.
 */
export function verifyTotp(secret: string, code: string): boolean {
	const normalized = code.trim();
	if (!/^\d{6}$/.test(normalized)) return false;
	let secretBytes: Uint8Array;
	try {
		secretBytes = base32Decode(secret);
	} catch {
		return false;
	}
	const counter = counterAt(Date.now() / 1000);
	for (let offset = -1; offset <= 1; offset++) {
		const candidate = codeFor(secretBytes, counter + offset);
		if (timingSafeEqual(Buffer.from(candidate), Buffer.from(normalized))) return true;
	}
	return false;
}

/** otpauth:// URI for seeding an authenticator app (QR or manual entry). */
export function otpauthUri(secret: string, accountName: string): string {
	const params = new URLSearchParams({
		secret,
		issuer: TOTP_ISSUER,
		algorithm: 'SHA1',
		digits: String(TOTP_DIGITS),
		period: String(TOTP_PERIOD)
	});
	return `otpauth://totp/${encodeURIComponent(TOTP_ISSUER)}:${encodeURIComponent(accountName)}?${params.toString()}`;
}

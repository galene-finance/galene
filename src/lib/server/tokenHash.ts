import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * One-way hint used to locate an API token's row. The raw token is 192 bits
 * of random data, so a SHA-256 hint cannot be inverted to recover it.
 */
export function tokenHint(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

/** Per-row salted scrypt hash of a token (same KDF as user passwords). */
export function hashToken(token: string): { hint: string; salt: string; hash: string } {
	const salt = randomBytes(16).toString('hex');
	const hash = scryptSync(token, salt, 32).toString('hex');
	return { hint: tokenHint(token), salt, hash };
}

/** Constant-time check of a presented token against a stored salt + hash. */
export function verifyToken(token: string, salt: string, storedHash: string): boolean {
	const candidate = scryptSync(token, salt, 32);
	const expected = Buffer.from(storedHash, 'hex');
	return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

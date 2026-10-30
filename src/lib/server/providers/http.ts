/**
 * Small helper for calling external bank-provider REST APIs from the server:
 * JSON or plain-text in/out, a timeout, and user-friendly errors (no raw
 * stack traces).
 */

const TIMEOUT_MS = 20000;

export class ProviderHttpError extends Error {
	/** Provider error code when the body included one (e.g. Plaid ITEM_LOGIN_REQUIRED). */
	code?: string;
	/** Plaid error_type, when the error body included one. Never a token. */
	errorType?: string;
	/** Plaid error_message or display_message, trimmed and redacted. */
	errorMessage?: string;
}

/**
 * Redact a URL for logging: only the host and path are kept. SimpleFIN
 * access URLs embed Basic-auth userinfo, and query strings can carry
 * secrets, so neither is ever logged. Unparseable or non-http(s) input
 * becomes a fixed placeholder instead of being echoed raw.
 */
export function safeUrlForLog(url: string): string {
	let u: URL;
	try {
		u = new URL(url);
	} catch {
		return '[invalid-url]';
	}
	if (u.protocol !== 'http:' && u.protocol !== 'https:') return '[redacted-url]';
	return `${u.hostname}${u.port ? `:${u.port}` : ''}${u.pathname}`;
}

/** Strip `user:pass@` from any URL-like substring in free text (defensive:
 * some fetch failure messages echo the request URL). */
function redactUrlUserinfo(text: string): string {
	return text.replace(/(\w+:\/\/)[^/\s@]+@/g, '$1');
}

/** One-line, redacted form of a fetch failure: name + message (+ cause),
 * with any URL userinfo stripped and the length capped. */
function safeErrorForLog(error: unknown): string {
	let text: string;
	if (error instanceof Error) {
		const cause = error.cause;
		const causeText = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '';
		text = causeText ? `${error.name}: ${error.message} (${causeText})` : `${error.name}: ${error.message}`;
	} else {
		text = String(error);
	}
	return redactUrlUserinfo(text).slice(0, 200);
}

interface Options {
	method?: 'GET' | 'POST';
	headers?: Record<string, string>;
	body?: string;
	timeoutMs?: number;
	/** Message for 401/403 responses (default: "Invalid credentials for {provider}."). */
	authErrorMessage?: string;
}

async function request(
	url: string,
	provider: string,
	opts: Options
): Promise<{ status: number; text: string }> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? TIMEOUT_MS);
	try {
		const res = await fetch(url, {
			method: opts.method ?? 'GET',
			headers: opts.headers,
			body: opts.body,
			signal: controller.signal
		});
		const text = await res.text();
		return { status: res.status, text };
	} catch (error) {
		// Log the underlying failure (DNS, TLS, connection reset, …) — the
		// user-facing message below is deliberately generic. The URL and the
		// error text are redacted: SimpleFIN access URLs embed Basic-auth
		// userinfo, which must not reach the logs.
		console.error(`[${provider}] request to ${safeUrlForLog(url)} failed: ${safeErrorForLog(error)}`);
		if (error instanceof Error && error.name === 'AbortError') {
			throw new ProviderHttpError(`${provider} did not respond in time.`);
		}
		throw new ProviderHttpError(`Could not reach ${provider}. Check your connection and try again.`);
	} finally {
		clearTimeout(timer);
	}
}

function authFail(provider: string, opts: Options): never {
	throw new ProviderHttpError(opts.authErrorMessage ?? `Invalid credentials for ${provider}.`);
}

/** GET/POST a JSON API and return the parsed body. */
export async function fetchJson<T>(url: string, provider: string, opts: Options = {}): Promise<T> {
	const { status, text } = await request(url, provider, opts);
	if (status === 401 || status === 403) authFail(provider, opts);

	let data: unknown = null;
	try {
		data = text ? JSON.parse(text) : null;
	} catch {
		data = text;
	}

	if (status < 200 || status >= 300) {
		const detail = redactSecretText(extractDetail(data), 200);
		const err = new ProviderHttpError(
			detail ? `${provider} error: ${detail}` : `${provider} error (HTTP ${status}).`
		);
		applyProviderErrorFields(err, data);
		throw err;
	}

	return data as T;
}

/** GET/POST an endpoint that answers with plain text (e.g. a token claim). */
export async function fetchText(url: string, provider: string, opts: Options = {}): Promise<string> {
	const { status, text } = await request(url, provider, opts);
	if (status === 401 || status === 403) authFail(provider, opts);
	if (status < 200 || status >= 300) {
		const detail = text.trim() ? text.trim().slice(0, 200) : null;
		throw new ProviderHttpError(
			detail ? `${provider} error: ${detail}` : `${provider} error (HTTP ${status}).`
		);
	}
	return text;
}

function errorCode(data: unknown): string | null {
	return stringField(data, 'error_code');
}

function stringField(data: unknown, key: string): string | null {
	if (!data || typeof data !== 'object') return null;
	const value = (data as Record<string, unknown>)[key];
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Copy Plaid error_code / error_type / error_message (or display_message)
 * onto the thrown error. Request bodies, access tokens, and secrets are not
 * copied. The message is trimmed and length-capped.
 */
function applyProviderErrorFields(err: ProviderHttpError, data: unknown): void {
	const code = redactSecretText(errorCode(data), 64);
	if (code) err.code = code;
	const errorType = redactSecretText(stringField(data, 'error_type'), 64);
	if (errorType) err.errorType = errorType;
	const errorMessage = redactSecretText(
		stringField(data, 'error_message') ?? stringField(data, 'display_message'),
		200
	);
	if (errorMessage) err.errorMessage = errorMessage;
}

/** Trim, cap, and strip token-like substrings from provider error text. */
export function redactSecretText(value: string | null | undefined, maxLen = 200): string | null {
	if (value == null) return null;
	let text = value.replace(/(\w+:\/\/)[^/\s@]+@/g, '$1');
	text = text.replace(/access-(?:sandbox|production|development)-[A-Za-z0-9_-]+/gi, '[redacted]');
	text = text.replace(/public-(?:sandbox|production|development)-[A-Za-z0-9_-]+/gi, '[redacted]');
	text = text.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
	text = text.replace(/\b[a-f0-9]{64}\b/gi, '[redacted]');
	text = text.replace(/\s+/g, ' ').trim();
	if (!text) return null;
	return text.slice(0, maxLen);
}

/** Pull a human-readable message out of a JSON error body, if present. */
function extractDetail(data: unknown): string | null {
	if (typeof data === 'string' && data.trim()) return data.trim().slice(0, 200);
	if (data && typeof data === 'object') {
		const o = data as Record<string, unknown>;
		for (const key of ['error', 'message', 'error_message', 'detail', 'reason', 'title']) {
			const v = o[key];
			if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 200);
		}
	}
	return null;
}

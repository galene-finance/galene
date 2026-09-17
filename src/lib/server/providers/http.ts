/**
 * Small helper for calling external bank-provider REST APIs from the server:
 * JSON or plain-text in/out, a timeout, and user-friendly errors (no raw
 * stack traces).
 */

const TIMEOUT_MS = 20000;

export class ProviderHttpError extends Error {}

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
		const detail = extractDetail(data);
		throw new ProviderHttpError(
			detail ? `${provider} error: ${detail}` : `${provider} error (HTTP ${status}).`
		);
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

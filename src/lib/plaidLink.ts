/**
 * Lazy loader for the current Plaid Link web SDK (link-initialize.js). The
 * script is only fetched when the user actually starts a Plaid connection, so
 * the sync settings page stays light otherwise.
 *
 * The SDK is token-based: the server creates a short-lived, one-time-use
 * link_token (via /link/token/create) and the browser only ever sees that
 * token — the client secret never leaves the server.
 */
const SCRIPT_SRC = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';

export interface PlaidLinkHandler {
	open(): void;
	exit(): void;
	destroy(): void;
}

/** The SDK's error object; field names vary by version, so probe both. */
interface PlaidLinkError {
	error_code?: string;
	error_message?: string;
	message?: string;
	[key: string]: unknown;
}

interface PlaidLinkMetadata {
	link_session_id?: string;
	status?: string;
	request_id?: string;
}

export interface PlaidLinkOptions {
	/** One-time-use link token from /link/token/create. */
	token: string;
	/** Called with the one-time public token once the user completes Link. */
	onSuccess: (publicToken: string) => void;
	/**
	 * Called when Link closes. `message` is null when the user simply closed a
	 * working session; otherwise it explains why the connection failed.
	 */
	onExit: (message: string | null) => void;
}

interface PlaidGlobal {
	create(options: {
		token: string;
		onSuccess?: (publicToken: string | null, metadata?: PlaidLinkMetadata) => void;
		onExit?: (error: PlaidLinkError | null, metadata?: PlaidLinkMetadata) => void;
	}): PlaidLinkHandler;
}

declare global {
	interface Window {
		Plaid?: PlaidGlobal;
	}
}

let loading: Promise<void> | null = null;

function loadScript(): Promise<void> {
	if (window.Plaid) return Promise.resolve();
	if (loading) return loading;
	loading = new Promise<void>((resolve, reject) => {
		const script = document.createElement('script');
		script.src = SCRIPT_SRC;
		script.async = true;
		script.onload = () => {
			if (window.Plaid?.create) resolve();
			else {
				loading = null;
				reject(new Error('The Plaid Link script loaded but is unusable. Refresh and try again.'));
			}
		};
		script.onerror = () => {
			loading = null;
			reject(new Error('Could not load the Plaid Link script. Check your connection and try again.'));
		};
		document.head.appendChild(script);
	});
	return loading;
}

/** Start fetching the Link script now so the first "Connect with Plaid" click is fast. */
export function preloadPlaidLink(): void {
	void loadScript().catch(() => {
		// A failed preload just means the click handler reports the error.
	});
}

function errorMessage(error: PlaidLinkError | null | undefined): string | null {
	if (!error) return null;
	const message =
		typeof error.message === 'string' && error.message.trim()
			? error.message
			: typeof error.error_message === 'string' && error.error_message.trim()
				? error.error_message
				: null;
	if (message) return message;
	if (typeof error.error_code === 'string' && error.error_code) return `Plaid error: ${error.error_code}`;
	return null;
}

/**
 * Load the SDK (once) and open the Link widget for the given token. Returns
 * the handler so the caller can destroy the iframe on unmount.
 */
export async function openPlaidLink(options: PlaidLinkOptions): Promise<PlaidLinkHandler> {
	await loadScript();
	const handler = window.Plaid!.create({
		token: options.token,
		onSuccess: (publicToken) => {
			if (publicToken) options.onSuccess(publicToken);
		},
		onExit: (error, metadata) => {
			const message = errorMessage(error);
			if (message) {
				options.onExit(message);
				return;
			}
			// The SDK reports init failures (bad token, network, auth) with a
			// null error; the only tell is that the session never started.
			const started = !!(metadata && (metadata.link_session_id || metadata.status));
			options.onExit(
				started
					? null
					: 'Plaid could not start the connection. Try again in a moment; if it keeps failing, check the Plaid settings on the server.'
			);
		}
	});
	handler.open();
	return handler;
}

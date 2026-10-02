import type { SubmitFunction } from '@sveltejs/kit';

/**
 * Wrap a SvelteKit `use:enhance` submit so `setPending(true)` while the
 * request is in flight. Callers use the flag to lock fields, show a spinner,
 * and block dialog dismiss until the response lands (success or error).
 */
export function withPending(
	setPending: (pending: boolean) => void,
	inner: SubmitFunction
): SubmitFunction {
	return (input) => {
		const after = inner(input);
		if (typeof after !== 'function') return after;
		setPending(true);
		return async (opts) => {
			try {
				await after(opts);
			} finally {
				setPending(false);
			}
		};
	};
}

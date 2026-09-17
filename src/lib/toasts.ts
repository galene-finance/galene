import { writable, type Writable } from 'svelte/store';

export interface Toast {
	id: number;
	kind: 'success' | 'error';
	message: string;
}

let nextId = 1;

/**
 * Global toast queue, rendered by <ToastHost /> (bottom-right, persistent until
 * dismissed with its X). Toasts replace the old top-of-page status blocks, so
 * feedback reaches the user wherever they are on the page.
 */
export const toasts: Writable<Toast[]> = writable([]);

/** Add a toast. */
export function toast(message: string, kind: 'success' | 'error' = 'success') {
	const t: Toast = { id: nextId++, kind, message };
	toasts.update((list) => [...list, t]);
}

/** Remove a toast by id. */
export function dismissToast(id: number) {
	toasts.update((list) => list.filter((t) => t.id !== id));
}

/**
 * Toast the result of a form action: a success `message`, or the `error` when
 * there is no message. Call from an identity-guarded `$effect` (see the page
 * that calls it) so each new action result is toasted exactly once.
 */
export function toastFormResult(form: { message?: string | null; error?: string | null } | undefined) {
	const message = form?.message ?? '';
	const error = form?.error ?? '';
	if (message) toast(message, 'success');
	else if (error) toast(error, 'error');
}

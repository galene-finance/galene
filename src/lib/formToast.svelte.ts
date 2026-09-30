import { untrack } from 'svelte';
import { toastFormResult } from '$lib/toasts';

/**
 * Toast each new form-action result once. Pages that also close a dialog or
 * navigate on success keep their own effect.
 */
export function watchFormToast(getForm: () => { message?: string | null; error?: string | null } | undefined) {
	let lastForm = untrack(getForm);
	$effect(() => {
		const form = getForm();
		if (form === lastForm) return;
		lastForm = form;
		toastFormResult(form);
	});
}

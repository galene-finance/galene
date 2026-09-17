import { fail, redirect } from '@sveltejs/kit';
import {
	buildImportPreview,
	commitImportPreview,
	getImportPreview
} from '$lib/server/csvImport';
import { getAccounts } from '$lib/server/finance';

export function load({ locals, url }) {
	if (!locals.user) redirect(303, '/login');
	const previewId = url.searchParams.get('preview');
	const preview = previewId ? getImportPreview(locals.user.id, previewId) : null;
	return {
		accounts: getAccounts(locals.user.id).map((a) => ({ id: a.id, name: a.name })),
		preview
	};
}

function boolFlag(form: FormData, key: string): boolean {
	const v = form.get(key);
	return v === 'on' || v === 'true' || v === '1';
}

export const actions = {
	preview: async ({ request, locals }) => {
		const user = locals.user!;
		const form = await request.formData();
		const file = form.get('file');
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { error: 'Choose a CSV file to upload.' });
		}
		if (file.size > 2_000_000) {
			return fail(400, { error: 'File is too large (max 2 MB for MVP).' });
		}
		const options = {
			createAccounts: boolFlag(form, 'create_accounts'),
			createCategories: boolFlag(form, 'create_categories'),
			createTags: boolFlag(form, 'create_tags')
		};
		const text = await file.text();
		const built = buildImportPreview(user.id, text, options);
		if ('error' in built) return fail(400, { error: built.error });
		redirect(303, `/transactions/import?preview=${built.id}`);
	},

	commit: async ({ request, locals }) => {
		const user = locals.user!;
		const form = await request.formData();
		const previewId = String(form.get('preview_id') ?? '');
		const result = commitImportPreview(user.id, previewId);
		if ('error' in result) return fail(400, { error: result.error });
		return {
			ok: true,
			message: `Imported ${result.created} transaction(s); skipped ${result.skipped}; failed ${result.failed}.`,
			result
		};
	}
};

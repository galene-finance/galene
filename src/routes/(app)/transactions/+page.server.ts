import {
	backfillCategorizationRules,
	bulkAddTags,
	bulkDeleteTransactions,
	bulkSetCategory,
	clearTransactionSplits,
	countUncategorizedMatchingMerchant,
	deleteTransaction,
	getAccounts,
	getCategories,
	getOrCreateCategory,
	getOrCreateTag,
	getSetting,
	getTags,
	getTransactions,
	getTransactionForRemember,
	rememberPayeeRule,
	saveScheduled,
	saveTransaction,
	saveTransactionSplits,
	setSetting,
	scheduledInputFromForm,
	transactionInputFromForm,
	type TransactionFilters
} from '$lib/server/finance';
import { parseAmountToCents } from '$lib/utils';

const PAGE_SIZES = [25, 50, 75, 100];

function parseFilters(url: URL, defaultPageSize: number): TransactionFilters {
	const num = (v: string | null) => {
		if (!v) return null;
		const n = parseInt(v, 10);
		return Number.isFinite(n) ? n : null;
	};
	const op = url.searchParams.get('amount_op') ?? '';
	const pageSizeParam = num(url.searchParams.get('page_size'));
	return {
		accountIds: url.searchParams.getAll('account').map(num).filter((n): n is number => n !== null),
		categoryIds: url.searchParams.getAll('category').map(num).filter((n): n is number => n !== null),
		tagIds: url.searchParams.getAll('tag').map(num).filter((n): n is number => n !== null),
		amountOp: (['eq', 'between', 'gt', 'lt'].includes(op) ? op : '') as TransactionFilters['amountOp'],
		amountFrom: parseAmountToCents(url.searchParams.get('amount_from') ?? ''),
		amountTo: parseAmountToCents(url.searchParams.get('amount_to') ?? ''),
		dateFrom: url.searchParams.get('date_from') || null,
		dateTo: url.searchParams.get('date_to') || null,
		q: url.searchParams.get('q') ?? '',
		page: Math.max(1, num(url.searchParams.get('page')) ?? 1),
		pageSize: PAGE_SIZES.includes(pageSizeParam ?? -1) ? pageSizeParam! : defaultPageSize
	};
}

export function load({ locals, url }) {
	const userId = locals.user!.id;
	const filters = parseFilters(url, parseInt(getSetting(userId, 'tx_page_size') ?? '25', 10));
	return {
		data: getTransactions(userId, filters),
		filters,
		accounts: getAccounts(userId),
		categories: getCategories(userId),
		tags: getTags(userId)
	};
}



export const actions = {
	save: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const { input, error } = transactionInputFromForm(userId, form);
		if (error || !input) return { error };
		saveTransaction(userId, input);
		return { ok: true };
	},

	delete: async ({ request, locals }) => {
		const form = await request.formData();
		const id = parseInt(String(form.get('id') ?? ''), 10);
		if (Number.isFinite(id)) deleteTransaction(locals.user!.id, id);
		return { ok: true };
	},

	'bulk-delete': async ({ request, locals }) => {
		const form = await request.formData();
		const ids = form
			.getAll('ids')
			.map((v) => parseInt(String(v), 10))
			.filter((n) => Number.isFinite(n) && n > 0);
		bulkDeleteTransactions(locals.user!.id, ids);
		return { ok: true };
	},

	'bulk-category': async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const ids = form
			.getAll('ids')
			.map((v) => parseInt(String(v), 10))
			.filter((n) => Number.isFinite(n) && n > 0);
		const type = form.get('type') === 'income' ? 'income' : 'expense';
		const categoryNew = String(form.get('category_new') ?? '').trim();
		const categoryExisting = String(form.get('category_id') ?? '').trim();
		let categoryId: number | null = null;
		if (categoryNew) {
			categoryId = getOrCreateCategory(userId, categoryNew, type);
		} else if (categoryExisting) {
			const category = getCategories(userId).find((c) => c.id === parseInt(categoryExisting, 10));
			if (category) categoryId = category.id;
		}
		bulkSetCategory(userId, ids, categoryId);
		return { ok: true };
	},

	'bulk-tags': async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const ids = form
			.getAll('ids')
			.map((v) => parseInt(String(v), 10))
			.filter((n) => Number.isFinite(n) && n > 0);
		const tagIds = form
			.getAll('tags')
			.map((v) => parseInt(String(v), 10))
			.filter((n) => Number.isFinite(n) && n > 0);
		const tagNew = String(form.get('tag_new') ?? '').trim();
		if (tagNew) tagIds.push(getOrCreateTag(userId, tagNew));
		bulkAddTags(userId, ids, tagIds);
		return { ok: true };
	},

	split: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const id = parseInt(String(form.get('id') ?? ''), 10);
		if (!Number.isFinite(id)) return { error: 'Invalid transaction.' };
		if (form.get('unsplit') === '1') {
			clearTransactionSplits(userId, id);
			return { ok: true };
		}
		const type = form.get('type') === 'income' ? 'income' : 'expense';
		const catIds = form.getAll('cat_id').map((v) => parseInt(String(v), 10));
		const catNews = form.getAll('cat_new').map((v) => String(v).trim());
		const amounts = form.getAll('amount').map((v) => parseAmountToCents(String(v)));
		const splits: { categoryId: number; amountCents: number }[] = [];
		for (let i = 0; i < catIds.length; i++) {
			let categoryId: number | null = null;
			if (catNews[i]) {
				categoryId = getOrCreateCategory(userId, catNews[i], type);
			} else if (Number.isFinite(catIds[i])) {
				const category = getCategories(userId).find((c) => c.id === catIds[i]);
				if (category) categoryId = category.id;
			}
			const amountCents = amounts[i];
			if (categoryId === null || amountCents === null || amountCents <= 0) {
				return { error: 'Each split part needs a category and a positive amount.' };
			}
			splits.push({ categoryId, amountCents });
		}
		if (splits.length < 2) return { error: 'A split needs at least two parts.' };
		try {
			saveTransactionSplits(userId, id, splits);
		} catch (e) {
			return { error: e instanceof Error ? e.message : 'Could not save splits.' };
		}
		return { ok: true };
	},

	'save-scheduled': async ({ request, locals }) => {
		const { input, error } = scheduledInputFromForm(locals.user!.id, await request.formData());
		if (error || !input) return { error };
		saveScheduled(locals.user!.id, input);
		return { ok: true };
	},

	'set-category': async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const id = parseInt(String(form.get('id') ?? ''), 10);
		if (!Number.isFinite(id)) return {};
		const type = form.get('type') === 'income' ? 'income' : 'expense';
		const categoryNew = String(form.get('category_new') ?? '').trim();
		const categoryExisting = String(form.get('category_id') ?? '').trim();
		let categoryId: number | null = null;
		if (categoryNew) {
			categoryId = getOrCreateCategory(userId, categoryNew, type);
		} else if (categoryExisting) {
			const category = getCategories(userId).find((c) => c.id === parseInt(categoryExisting, 10));
			if (category) categoryId = category.id;
		}
		bulkSetCategory(userId, [id], categoryId);
		return { ok: true };
	},

	'set-page-size': async ({ request, locals }) => {
		const form = await request.formData();
		const size = parseInt(String(form.get('page_size') ?? '25'), 10);
		if (PAGE_SIZES.includes(size)) setSetting(locals.user!.id, 'tx_page_size', String(size));
		return { ok: true };
	},

	'payee-match-count': async ({ request, locals }) => {
		const form = await request.formData();
		const merchant = String(form.get('merchant') ?? '').trim();
		if (!merchant) return { count: 0 };
		return { count: countUncategorizedMatchingMerchant(locals.user!.id, merchant) };
	},

	'remember-payee': async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const id = parseInt(String(form.get('id') ?? ''), 10);
		if (!Number.isFinite(id)) return { error: 'Missing transaction.' };
		const row = getTransactionForRemember(userId, id);
		if (!row) return { error: 'Transaction not found.' };
		const merchantOverride = String(form.get('merchant') ?? '').trim();
		const categoryOverride = parseInt(String(form.get('category_id') ?? ''), 10);
		const merchant = merchantOverride || row.merchant?.trim() || '';
		const categoryId = Number.isFinite(categoryOverride) && categoryOverride > 0 ? categoryOverride : row.category_id;
		if (!merchant) return { error: 'Add a merchant before remembering this payee.' };
		if (categoryId == null) return { error: 'Set a category before remembering this payee.' };
		try {
			const { ruleId, created } = rememberPayeeRule(userId, merchant, categoryId);
			let applied = 0;
			if (form.get('apply_existing') === '1') {
				applied = backfillCategorizationRules(userId, ruleId);
			}
			const verb = created ? 'Remembered' : 'Updated rule for';
			const applyNote = applied > 0 ? ` Applied to ${applied} uncategorized.` : '';
			return {
				message: `${verb} ${merchant}.${applyNote}`,
				ok: true
			};
		} catch (e) {
			return { error: e instanceof Error ? e.message : 'Could not remember payee.' };
		}
	}
};

<script lang="ts">
	import { flushSync } from 'svelte';
	import { deserialize, enhance } from '$app/forms';
	import AddScheduledDialog from '$lib/components/AddScheduledDialog.svelte';
	import AddTransactionDialog from '$lib/components/AddTransactionDialog.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import CategoryCell from '$lib/components/CategoryCell.svelte';
	import Checkbox from '$lib/components/ui/Checkbox.svelte';
	import Combobox from '$lib/components/ui/Combobox.svelte';
	import Title from '$lib/components/Title.svelte';
	import DatePicker from '$lib/components/ui/DatePicker.svelte';
	import MultiCombobox from '$lib/components/ui/MultiCombobox.svelte';
	import DropdownMenu from '$lib/components/ui/DropdownMenu.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import MenuItem from '$lib/components/ui/MenuItem.svelte';
	import RememberPayeeDialog from '$lib/components/RememberPayeeDialog.svelte';
	import RuleDialog from '$lib/components/RuleDialog.svelte';
	import SplitDialog from '$lib/components/SplitDialog.svelte';
	import { formatMoney, formatDate, todayISO, dayGroupLabel } from '$lib/utils';
	import { toastFormResult } from '$lib/toasts';
	import type { Account, Category, RuleCondition, Tag, Transaction } from '$lib/types';

	let { form, data }: {
		form: { error?: string | null; message?: string | null } | undefined;
		data: {
			data: { items: Transaction[]; total: number; pages: number };
			filters: {
				accountIds: number[];
				categoryIds: number[];
				tagIds: number[];
				amountOp: string;
				amountFrom: number | null;
				amountTo: number | null;
				dateFrom: string | null;
				dateTo: string | null;
				q: string;
				page: number;
				pageSize: number;
			};
			accounts: Account[];
			categories: Category[];
			tags: Tag[];
		};
	} = $props();

	const accountItems = $derived(data.accounts.map((a) => ({ value: String(a.id), label: a.name })));
	const categoryItems = $derived(data.categories.map((c) => ({ value: String(c.id), label: c.name })));
	const tagItems = $derived(data.tags.map((t) => ({ value: String(t.id), label: t.name })));
	const tagsOf = (t: Transaction) => t.tags ?? [];

	let lastForm = form;
	$effect(() => {
		if (form === lastForm) return;
		lastForm = form;
		toastFormResult(form);
	});

	// Filter state (synced from the URL after each navigation)
	let q = $state(data.filters.q);
	let filterAccounts = $state<string[]>(data.filters.accountIds.map(String));
	let filterCategories = $state<string[]>(data.filters.categoryIds.map(String));
	let filterTags = $state<string[]>(data.filters.tagIds.map(String));
	let amountOp = $state(data.filters.amountOp);
	let amountFrom = $state(data.filters.amountFrom !== null ? String(data.filters.amountFrom / 100) : '');
	let amountTo = $state(data.filters.amountTo !== null ? String(data.filters.amountTo / 100) : '');
	let dateFrom = $state(data.filters.dateFrom ?? '');
	let dateTo = $state(data.filters.dateTo ?? '');
	// Svelte 5 ignores a one-way `value` on <select>; bind instead.
	let pageSizeSel = $state(String(data.filters.pageSize));

	// Quick filter: fill the search field with a merchant and submit the
	// filter form (plain GET submit, like the Filter button).
	let filterFormEl: HTMLFormElement | undefined = undefined;
	function quickFilterByMerchant(merchant: string | null) {
		if (!merchant) return;
		q = merchant;
		// Svelte batches DOM updates; flush so the input reflects the new
		// value before the form serializes it on submit.
		flushSync();
		filterFormEl?.requestSubmit();
	}

	// Re-sync filter state from the URL, but only when the URL's filters
	// actually change (navigation). Without this guard the effect would
	// clobber an in-progress, not-yet-submitted selection, because it also
	// re-runs when the local filter state changes.
	let lastFiltersKey = JSON.stringify(data.filters);
	$effect(() => {
		const f = data.filters;
		const key = JSON.stringify(f);
		if (key === lastFiltersKey) return;
		lastFiltersKey = key;
		if (q !== f.q) q = f.q;
		if (filterAccounts.join(',') !== f.accountIds.map(String).join(',')) {
			filterAccounts = f.accountIds.map(String);
		}
		if (filterCategories.join(',') !== f.categoryIds.map(String).join(',')) {
			filterCategories = f.categoryIds.map(String);
		}
		if (filterTags.join(',') !== f.tagIds.map(String).join(',')) {
			filterTags = f.tagIds.map(String);
		}
		if (amountOp !== f.amountOp) amountOp = f.amountOp;
		const from = f.amountFrom !== null ? String(f.amountFrom / 100) : '';
		if (amountFrom !== from) amountFrom = from;
		const to = f.amountTo !== null ? String(f.amountTo / 100) : '';
		if (amountTo !== to) amountTo = to;
		if (dateFrom !== (f.dateFrom ?? '')) dateFrom = f.dateFrom ?? '';
		if (dateTo !== (f.dateTo ?? '')) dateTo = f.dateTo ?? '';
		if (pageSizeSel !== String(f.pageSize)) pageSizeSel = String(f.pageSize);
	});

	// Selection for bulk actions
	let selected = $state<Record<number, boolean>>({});
	const selectedItems = $derived(data.data.items.filter((t) => selected[t.id]));
	const allSelected = $derived(
		data.data.items.length > 0 && data.data.items.every((t) => selected[t.id])
	);
	const bulkType = $derived(
		selectedItems.length > 0 && selectedItems.every((t) => t.amount_cents > 0) ? 'income' : 'expense'
	);

	// Bulk category picker
	let bulkCatValue = $state('');
	let bulkCatSearch = $state('');
	let bulkCatCreate = $state(false);
	// Captured at select-time from the combobox's own search state (passed as
	// `typed`); the combobox clears its search when the dropdown closes, which
	// happens before the submit button is clicked.
	let bulkCatNewName = $state('');

	// Bulk tags picker (additive: applies to each selected transaction)
	let bulkTagValues = $state<string[]>([]);
	let bulkTagSearch = $state('');
	let bulkTagNewName = $state('');
	const bulkTagCreate = $derived(bulkTagValues.includes('__create__'));

	// Sticky bulk bar: once the user has scrolled past the page header, pin the
	// bar just below the top nav (57px tall: h-14 + 1px border) so the actions
	// stay reachable. `barStuck` drives a shadow so the pinned state is visible.
	let bulkBarEl = $state<HTMLElement | undefined>(undefined);
	let barStuck = $state(false);
	$effect(() => {
		if (selectedItems.length === 0) {
			barStuck = false;
			return;
		}
		const check = () => {
			barStuck = bulkBarEl ? bulkBarEl.getBoundingClientRect().top <= 58 : false;
		};
		check();
		window.addEventListener('scroll', check, { passive: true });
		window.addEventListener('resize', check);
		return () => {
			window.removeEventListener('scroll', check);
			window.removeEventListener('resize', check);
		};
	});

	// Add / edit dialog
	let dialogOpen = $state(false);
	let editingTx = $state<Transaction | null>(null);

	function openAdd() {
		editingTx = null;
		dialogOpen = true;
	}

	function openEdit(tx: Transaction) {
		editingTx = tx;
		dialogOpen = true;
	}

	function closeDialog() {
		editingTx = null;
	}

	// Split / rule / scheduled dialogs
	let splitOpen = $state(false);
	let splittingTx = $state<Transaction | null>(null);
	let ruleOpen = $state(false);
	let rulePrefill = $state<{
		name: string;
		conditions: RuleCondition[];
		categoryId: number | null;
	} | null>(null);
	let rememberOpen = $state(false);
	let rememberTx = $state<Transaction | null>(null);
	let rememberMatchCount = $state(0);
	let scheduledOpen = $state(false);

	function openSplit(tx: Transaction) {
		splittingTx = tx;
		splitOpen = true;
	}

	function openRule(tx: Transaction) {
		rulePrefill = {
			name: tx.merchant ? `Auto: ${tx.merchant}` : 'Auto-categorize',
			conditions: [
				...(tx.merchant ? [{ field: 'merchant' as const, op: 'contains' as const, value: tx.merchant }] : []),
				{ field: 'account' as const, op: 'equals' as const, value: String(tx.account_id) }
			],
			categoryId: tx.category_id
		};
		ruleOpen = true;
	}

	function closeRule() {
		rulePrefill = null;
	}

	async function openRemember(tx: Transaction) {
		if (!tx.merchant?.trim() || tx.category_id == null) return;
		rememberTx = tx;
		rememberMatchCount = 0;
		rememberOpen = true;
		const fd = new FormData();
		fd.set('merchant', tx.merchant);
		try {
			const response = await fetch('?/payee-match-count', { method: 'POST', body: fd });
			const result = deserialize(await response.text());
			if (result.type === 'success' && result.data && typeof (result.data as { count?: number }).count === 'number') {
				rememberMatchCount = (result.data as { count: number }).count;
			}
		} catch {
			rememberMatchCount = 0;
		}
	}

	function closeRemember() {
		rememberTx = null;
		rememberMatchCount = 0;
	}

	function deleteTx(tx: Transaction) {
		setTimeout(() => {
			selected[tx.id] = false;
		}, 0);
		(document.getElementById(`delete-form-${tx.id}`) as HTMLFormElement | null)?.requestSubmit();
	}

	// After a bulk action completes, refresh the page data in place (no full
	// reload, so scroll position and the URL are preserved) and clear all
	// selection + picker state.
	function resetBulkState() {
		selected = {};
		bulkCatValue = '';
		bulkCatSearch = '';
		bulkCatCreate = false;
		bulkCatNewName = '';
		bulkTagValues = [];
		bulkTagSearch = '';
		bulkTagNewName = '';
	}

	function onBulkEnhance() {
		return async ({
			update
		}: {
			update: (options?: { reset?: boolean; invalidateAll?: boolean }) => Promise<void>;
		}) => {
			await update({ reset: false });
			resetBulkState();
		};
	}

	function pageUrl(page: number): string {
		const f = data.filters;
		const params = new URLSearchParams();
		if (f.q) params.set('q', f.q);
		for (const id of f.accountIds) params.append('account', String(id));
		for (const id of f.categoryIds) params.append('category', String(id));
		for (const id of f.tagIds) params.append('tag', String(id));
		if (f.amountOp) params.set('amount_op', f.amountOp);
		if (f.amountFrom !== null) params.set('amount_from', String(f.amountFrom / 100));
		if (f.amountTo !== null) params.set('amount_to', String(f.amountTo / 100));
		if (f.dateFrom) params.set('date_from', f.dateFrom);
		if (f.dateTo) params.set('date_to', f.dateTo);
		if (page > 1) params.set('page', String(page));
		const qs = params.toString();
		return `/transactions${qs ? `?${qs}` : ''}`;
	}

	const hasAnyFilters = $derived(
		data.filters.q !== '' ||
			data.filters.accountIds.length > 0 ||
			data.filters.categoryIds.length > 0 ||
			data.filters.tagIds.length > 0 ||
			data.filters.amountOp !== '' ||
			amountFrom !== '' ||
			amountTo !== '' ||
			data.filters.dateFrom !== null ||
			data.filters.dateTo !== null
	);

	// Mobile (<768px) vs desktop: only the matching list is mounted.
	// window.matchMedia in an effect: SSR-safe (no matchMedia rune in this Svelte version).
	let isDesktop = $state(false);
	$effect(() => {
		const mql = window.matchMedia('(min-width: 768px)');
		const update = () => (isDesktop = mql.matches);
		update();
		mql.addEventListener('change', update);
		return () => mql.removeEventListener('change', update);
	});

	// Collapsible mobile filter panel
	let filtersOpen = $state(false);
	const activeFilterCount = $derived(
		(q.trim() !== '' ? 1 : 0) +
			(filterAccounts.length > 0 ? 1 : 0) +
			(filterCategories.length > 0 ? 1 : 0) +
			(filterTags.length > 0 ? 1 : 0) +
			(amountOp !== '' || amountFrom !== '' || amountTo !== '' ? 1 : 0) +
			(dateFrom !== '' ? 1 : 0) +
			(dateTo !== '' ? 1 : 0)
	);

	// Mobile list is grouped by day; items arrive date-descending
	const groups = $derived.by(() => {
		const out: { label: string; items: Transaction[] }[] = [];
		for (const t of data.data.items) {
			const last = out[out.length - 1];
			if (last && last.items[0].date === t.date) last.items.push(t);
			else out.push({ label: dayGroupLabel(t.date), items: [t] });
		}
		return out;
	});
</script>

<Title title="Transactions" />

<div class="mx-auto flex max-w-6xl flex-col gap-4 2xl:max-w-7xl">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<h1 class="text-2xl font-semibold tracking-tight">Transactions</h1>
		<div class="flex flex-wrap gap-2">
			<a
				href="/transactions/import"
				class="inline-flex h-9 items-center justify-center rounded-md border border-border bg-surface px-4 text-sm font-medium hover:bg-muted"
			>Import CSV</a>
			<Button variant="secondary" type="button" onclick={() => (scheduledOpen = true)}>+ New scheduled</Button>
			<Button type="button" onclick={openAdd}>+ Add transaction</Button>
		</div>
	</div>

	<!-- Filters: collapsible panel on mobile, current row at md+ -->
	<!-- GET filter form: plain submit (use:enhance requires POST) -->
	<form method="GET" bind:this={filterFormEl} class="rounded-lg border border-border bg-surface">
		<div class="flex items-center gap-3 p-3 md:hidden">
			<Button
				variant="secondary"
				type="button"
				aria-expanded={filtersOpen}
				onclick={() => (filtersOpen = !filtersOpen)}
			>
				Filters
				{#if activeFilterCount > 0}
					<span
						class="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground"
					>
						{activeFilterCount}
					</span>
				{/if}
				<svg
					class="size-3.5 text-muted-foreground transition-transform {filtersOpen ? 'rotate-180' : ''}"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
				>
					<path d="m6 9 6 6 6-6" />
				</svg>
			</Button>
			<span class="flex-1"></span>
			{#if activeFilterCount > 0}
				<a
					href="/transactions"
					class="inline-flex h-9 items-center rounded-md px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
				>
					Clear
				</a>
			{/if}
		</div>
		<div class="{filtersOpen ? 'grid' : 'hidden'} grid-cols-2 gap-3 p-3 md:flex md:flex-wrap md:items-end">
			<div class="col-span-2 flex flex-col gap-1.5 md:min-w-40 md:flex-1">
				<span class="text-xs font-medium text-muted-foreground">Search</span>
				<Input type="text" name="q" value={q} placeholder="Merchant or notes" />
			</div>
			<div class="flex flex-col gap-1.5 md:w-44">
				<span class="text-xs font-medium text-muted-foreground">Accounts</span>
				<MultiCombobox
					bind:value={filterAccounts}
					items={accountItems}
					placeholder="All accounts"
				/>
				{#each filterAccounts as v (v)}
					<input type="hidden" name="account" value={v} />
				{/each}
			</div>
			<div class="flex flex-col gap-1.5 md:w-44">
				<span class="text-xs font-medium text-muted-foreground">Categories</span>
				<MultiCombobox
					bind:value={filterCategories}
					items={categoryItems}
					placeholder="All categories"
				/>
				{#each filterCategories as v (v)}
					<input type="hidden" name="category" value={v} />
				{/each}
			</div>
			<div class="flex flex-col gap-1.5 md:w-40">
				<span class="text-xs font-medium text-muted-foreground">Tags</span>
				<MultiCombobox bind:value={filterTags} items={tagItems} placeholder="All tags" />
				{#each filterTags as v (v)}
					<input type="hidden" name="tag" value={v} />
				{/each}
			</div>
			<div class="flex flex-col gap-1.5">
				<span class="text-xs font-medium text-muted-foreground">From</span>
				<DatePicker name="date_from" value={dateFrom} placeholder="Any date" />
			</div>
			<div class="flex flex-col gap-1.5">
				<span class="text-xs font-medium text-muted-foreground">To</span>
				<DatePicker name="date_to" value={dateTo} placeholder="Any date" />
			</div>
			<div class="col-span-2 flex flex-col gap-1.5">
				<span class="text-xs font-medium text-muted-foreground">Amount</span>
				<!-- One nowrap group: the op and value(s) must not split across
					rows in the md:flex-wrap filter strip. -->
				<div class="flex flex-nowrap items-center gap-1.5">
					<select
						name="amount_op"
						bind:value={amountOp}
						class="h-9 rounded-md border border-input bg-surface px-2 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
					>
						<option value="">Any</option>
						<option value="eq">Equals</option>
						<option value="between">Between</option>
						<option value="gt">More than</option>
						<option value="lt">Less than</option>
					</select>
					{#if amountOp !== ''}
						<div class="min-w-0 flex-1 md:flex-none md:w-24">
							<Input
								type="text"
								inputmode="decimal"
								name="amount_from"
								bind:value={amountFrom}
								placeholder={amountOp === 'between' ? 'Min' : 'Value'}
							/>
						</div>
						{#if amountOp === 'between'}
							<span class="text-sm text-muted-foreground">to</span>
							<div class="min-w-0 flex-1 md:flex-none md:w-24">
								<Input type="text" inputmode="decimal" name="amount_to" bind:value={amountTo} placeholder="Max" />
							</div>
						{/if}
					{/if}
				</div>
			</div>
			<div class="col-span-2 flex gap-2">
				<Button type="submit" variant="secondary">Filter</Button>
				{#if hasAnyFilters}
					<a href="/transactions" class="inline-flex h-9 items-center rounded-md px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
						Clear
					</a>
				{/if}
			</div>
		</div>
	</form>

	<!-- Bulk actions -->
	{#if selectedItems.length > 0}
		<div
			bind:this={bulkBarEl}
			class="sticky top-[57px] z-20 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-4 py-2.5 transition-shadow {barStuck ? 'shadow-lg' : ''}"
		>
			<span class="text-sm font-medium">{selectedItems.length} selected</span>
			<form method="POST" action="?/bulk-category" use:enhance={onBulkEnhance} class="flex items-center gap-2">
				{#each selectedItems as t (t.id)}
					<input type="hidden" name="ids" value={t.id} />
				{/each}
				<input type="hidden" name="type" value={bulkType} />
				<input type="hidden" name="category_id" value={bulkCatCreate ? '' : bulkCatValue} />
				<input type="hidden" name="category_new" value={bulkCatCreate ? bulkCatNewName : ''} />
				<Combobox
					bind:value={bulkCatValue}
					bind:search={bulkCatSearch}
					items={categoryItems}
					allowCreate
					createLabel="Create"
					placeholder="Apply category"
					class="w-48"
					onselect={(_, label, typed) => {
						bulkCatCreate = label === null;
						if (label === null) bulkCatNewName = typed;
					}}
				/>
				<Button type="submit" size="sm" variant="secondary">Apply</Button>
			</form>
			<form method="POST" action="?/bulk-tags" use:enhance={onBulkEnhance} class="flex items-center gap-2">
				{#each selectedItems as t (t.id)}
					<input type="hidden" name="ids" value={t.id} />
				{/each}
				{#each bulkTagValues as v (v)}
					{#if v !== '__create__'}
						<input type="hidden" name="tags" value={v} />
					{/if}
				{/each}
				<input type="hidden" name="tag_new" value={bulkTagCreate ? bulkTagNewName : ''} />
				<MultiCombobox
					bind:value={bulkTagValues}
					bind:search={bulkTagSearch}
					items={tagItems}
					allowCreate
					createLabel="Create"
					placeholder="Apply tags"
					class="w-48"
					onselect={(_, label, typed) => {
						if (label === null) bulkTagNewName = typed;
					}}
				/>
				<Button type="submit" size="sm" variant="secondary">Apply</Button>
			</form>
			<form method="POST" action="?/bulk-delete" use:enhance={onBulkEnhance}>
				{#each selectedItems as t (t.id)}
					<input type="hidden" name="ids" value={t.id} />
				{/each}
				<Button type="submit" size="sm" variant="destructive">Delete</Button>
			</form>
		</div>
	{/if}

	{#if isDesktop}
	<!-- Table -->
	<div class="min-w-0 max-w-full overflow-x-auto rounded-lg border border-border bg-surface">
		<table class="w-full min-w-[860px] text-sm">
			<thead>
				<tr class="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
					<th class="w-10 px-3 py-2.5">
						<input
							type="checkbox"
							checked={allSelected}
							onchange={(e) => {
								const v = e.currentTarget.checked;
								for (const t of data.data.items) selected[t.id] = v;
							}}
							class="size-4 accent-primary"
							aria-label="Select all"
						/>
					</th>
					<th class="px-3 py-2.5 font-medium">Date</th>
					<th class="px-3 py-2.5 font-medium">Merchant</th>
					<th class="px-3 py-2.5 font-medium">Category</th>
					<th class="px-3 py-2.5 font-medium">Account</th>
					<th class="px-3 py-2.5 font-medium">Tags</th>
					<th class="px-3 py-2.5 text-right font-medium">Amount</th>
					<th class="w-10 px-3 py-2.5"></th>
				</tr>
			</thead>
			<tbody>
				{#each data.data.items as tx (tx.id)}
					<tr class="border-b border-border last:border-0 hover:bg-muted/40">
						<td class="px-3 py-2">
							<Checkbox
								checked={selected[tx.id] ?? false}
								onCheckedChange={(v: boolean) => (selected[tx.id] = v)}
								aria-label="Select transaction"
							/>
						</td>
						<td class="whitespace-nowrap px-3 py-2">{formatDate(tx.date)}</td>
						<td class="max-w-52 px-3 py-2">
							<div class="flex items-center gap-1">
								<div class="min-w-0 flex-1 truncate" title={tx.merchant ?? undefined}>
									{#if tx.merchant}
										{tx.merchant}
									{:else}
										<span class="text-muted-foreground">—</span>
									{/if}
								</div>
								{#if tx.merchant}
									<button
										type="button"
										class="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
										title="Filter by this merchant"
										aria-label="Filter by merchant {tx.merchant}"
										onclick={() => quickFilterByMerchant(tx.merchant)}
									>
										<svg
											class="size-3.5"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2"
											stroke-linecap="round"
											stroke-linejoin="round"
										>
											<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
										</svg>
									</button>
								{/if}
							</div>
							{#if tx.notes}
								<div class="truncate text-xs text-muted-foreground" title={tx.notes}>{tx.notes}</div>
							{/if}
						</td>
						<td class="px-3 py-2">
							<CategoryCell transaction={tx} categories={data.categories} />
						</td>
						<td class="whitespace-nowrap px-3 py-2">{tx.account_name}</td>
						<td class="px-3 py-2">
							<div class="flex flex-wrap gap-1">
								{#each tagsOf(tx) as tag (tag)}
									<span class="rounded-full bg-muted px-2 py-0.5 text-xs">{tag}</span>
								{/each}
							</div>
						</td>
						<td class="whitespace-nowrap px-3 py-2 text-right font-medium {tx.amount_cents > 0 ? 'text-success' : ''}">
							{formatMoney(tx.amount_cents)}
						</td>
						<td class="px-3 py-2">
							<form id="delete-form-{tx.id}" method="POST" action="?/delete" class="hidden">
								<input type="hidden" name="id" value={tx.id} />
							</form>
							<DropdownMenu
								class="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
								ariaLabel="Transaction actions"
							>
								{#snippet trigger()}
									<svg class="size-4" viewBox="0 0 24 24" fill="currentColor">
										<circle cx="12" cy="5" r="1.5" />
										<circle cx="12" cy="12" r="1.5" />
										<circle cx="12" cy="19" r="1.5" />
									</svg>
								{/snippet}
								<MenuItem onclick={() => openEdit(tx)}>Edit</MenuItem>
								<MenuItem onclick={() => openSplit(tx)}>Split transaction</MenuItem>
								{#if tx.merchant && tx.category_id != null}
									<MenuItem onclick={() => openRemember(tx)}>Remember this payee</MenuItem>
								{/if}
									<MenuItem onclick={() => openRule(tx)}>Customize categorization rule…</MenuItem>
								<MenuItem variant="destructive" onclick={() => deleteTx(tx)}>Delete</MenuItem>
							</DropdownMenu>
						</td>
					</tr>
				{:else}
					<tr>
						<td class="px-3 py-12 text-center text-muted-foreground" colspan="8">
							{data.accounts.length === 0
								? 'No accounts yet. Create one in Settings, then add transactions here.'
								: 'No transactions match your filters.'}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	{:else}
	<!-- Mobile: stacked cards grouped by day -->
	<div class="overflow-hidden rounded-lg border border-border bg-surface">
		{#each groups as g (g.label)}
			<div class="px-4 pb-1.5 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
				{g.label}
			</div>
			{#each g.items as tx (tx.id)}
				<div class="flex gap-3 border-t border-border px-4 py-3 hover:bg-muted/40">
					<div class="pt-0.5">
						<Checkbox
							checked={selected[tx.id] ?? false}
							onCheckedChange={(v: boolean) => (selected[tx.id] = v)}
							aria-label="Select transaction"
						/>
					</div>
					<div class="flex min-w-0 flex-1 flex-col gap-0.5">
						<div class="flex items-baseline gap-2">
							<span class="min-w-0 flex-1 truncate text-[15px] font-semibold">
								{#if tx.merchant}
									{tx.merchant}
								{:else}
									<span class="text-muted-foreground">—</span>
								{/if}
							</span>
							{#if tx.merchant}
								<button
									type="button"
									class="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
									title="Filter by this merchant"
									aria-label="Filter by merchant {tx.merchant}"
									onclick={() => quickFilterByMerchant(tx.merchant)}
								>
									<svg
										class="size-3.5"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
									>
										<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
									</svg>
								</button>
							{/if}
							<span
								class="shrink-0 text-[15px] font-medium tabular-nums {tx.amount_cents > 0 ? 'text-success' : ''}"
							>
								{formatMoney(tx.amount_cents)}
							</span>
						</div>
						{#if tx.notes}
							<div class="truncate text-xs text-muted-foreground" title={tx.notes}>{tx.notes}</div>
						{/if}
						<div class="truncate text-[13px] text-muted-foreground">
							{tx.account_name} · {formatDate(tx.date)}
						</div>
						<div class="flex items-center gap-2">
							<span class="cat-pill inline-flex max-w-44 items-center rounded-full border border-border bg-muted">
								<CategoryCell transaction={tx} categories={data.categories} />
							</span>
							<div class="flex min-w-0 flex-1 gap-1 overflow-hidden">
								{#each tagsOf(tx) as tag (tag)}
									<span class="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
										{tag}
									</span>
								{/each}
							</div>
							<form id="delete-form-{tx.id}" method="POST" action="?/delete" class="hidden">
								<input type="hidden" name="id" value={tx.id} />
							</form>
							<DropdownMenu
								class="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
								ariaLabel="Transaction actions"
							>
								{#snippet trigger()}
									<svg class="size-4" viewBox="0 0 24 24" fill="currentColor">
										<circle cx="12" cy="5" r="1.5" />
										<circle cx="12" cy="12" r="1.5" />
										<circle cx="12" cy="19" r="1.5" />
									</svg>
								{/snippet}
								<MenuItem onclick={() => openEdit(tx)}>Edit</MenuItem>
								<MenuItem onclick={() => openSplit(tx)}>Split transaction</MenuItem>
								{#if tx.merchant && tx.category_id != null}
									<MenuItem onclick={() => openRemember(tx)}>Remember this payee</MenuItem>
								{/if}
									<MenuItem onclick={() => openRule(tx)}>Customize categorization rule…</MenuItem>
								<MenuItem variant="destructive" onclick={() => deleteTx(tx)}>Delete</MenuItem>
							</DropdownMenu>
						</div>
					</div>
				</div>
			{/each}
		{:else}
			<div class="px-4 py-12 text-center text-sm text-muted-foreground">
				{data.accounts.length === 0
					? 'No accounts yet. Create one in Settings, then add transactions here.'
					: 'No transactions match your filters.'}
			</div>
		{/each}
	</div>
	{/if}

	<!-- Pagination -->
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div class="flex items-center gap-3 text-sm text-muted-foreground">
			<span>{data.data.total} transaction{data.data.total === 1 ? '' : 's'}</span>
			<form method="POST" action="?/set-page-size" class="flex items-center gap-1.5">
				<span>Per page</span>
				<select
					name="page_size"
					bind:value={pageSizeSel}
					onchange={(e) => e.currentTarget.closest('form')?.requestSubmit()}
					class="h-8 rounded-md border border-input bg-surface px-2 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
				>
					{#each [25, 50, 75, 100] as size (size)}
						<!-- String values: the bound value is a string and Svelte
						 matches options with strict equality (100 !== "100"). -->
						<option value={String(size)}>{size}</option>
					{/each}
				</select>
			</form>
		</div>
		<div class="flex items-center gap-2 text-sm">
			{#if data.filters.page > 1}
				<a
					href={pageUrl(data.filters.page - 1)}
					class="rounded-md border border-border px-3 py-1.5 hover:bg-muted"
				>
					← Prev
				</a>
			{/if}
			<span class="text-muted-foreground">Page {data.filters.page} of {data.data.pages}</span>
			{#if data.filters.page < data.data.pages}
				<a
					href={pageUrl(data.filters.page + 1)}
					class="rounded-md border border-border px-3 py-1.5 hover:bg-muted"
				>
					Next →
				</a>
			{/if}
		</div>
	</div>
</div>

<AddTransactionDialog
	bind:open={dialogOpen}
	editing={editingTx}
	accounts={data.accounts}
	categories={data.categories}
	tags={data.tags}
	{form}
	onclose={closeDialog}
	onRememberPayee={(tx) => {
		open = false;
		void openRemember(tx);
	}}
/>

<SplitDialog
	bind:open={splitOpen}
	transaction={splittingTx}
	categories={data.categories}
	{form}
	onclose={() => (splittingTx = null)}
/>

<RememberPayeeDialog
	bind:open={rememberOpen}
	transaction={rememberTx}
	uncategorizedMatchCount={rememberMatchCount}
	{form}
	onclose={closeRemember}
/>

<RuleDialog
	bind:open={ruleOpen}
	editing={null}
	prefill={rulePrefill}
	accounts={data.accounts}
	categories={data.categories}
	{form}
	onclose={closeRule}
/>

<AddScheduledDialog
	bind:open={scheduledOpen}
	editing={null}
	prefillDate={todayISO()}
	accounts={data.accounts}
	categories={data.categories}
	tags={data.tags}
	{form}
/>

<style>
	/* Mobile: strip the CategoryCell combobox's own chrome so it reads as a pill */
	.cat-pill :global(input) {
		height: 1.5rem;
		padding: 0 0.5rem;
		border-color: transparent;
		border-radius: 9999px;
		background: transparent;
		font-size: 0.75rem;
	}
</style>

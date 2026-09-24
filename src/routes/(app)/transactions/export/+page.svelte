<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import DatePicker from '$lib/components/ui/DatePicker.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import MultiCombobox from '$lib/components/ui/MultiCombobox.svelte';
	import Title from '$lib/components/Title.svelte';
	import { CSV_EXPORT_COLUMNS, type CsvExportColumn } from '$lib/csvExportColumns';
	import { exportCsvHref, exportPageHref, type ExportQueryState } from '$lib/exportQuery';
	import type { Account, Category, Tag } from '$lib/types';

	let {
		data
	}: {
		data: {
			filters: {
				accountIds: number[];
				categoryIds: number[];
				tagIds: number[];
				emptyFields: string[];
				amountOp: string;
				amountFrom: number | null;
				amountTo: number | null;
				dateFrom: string | null;
				dateTo: string | null;
				q: string;
			};
			total: number;
			accounts: Account[];
			categories: Category[];
			tags: Tag[];
			columns: CsvExportColumn[];
		};
	} = $props();

	const accountItems = $derived(data.accounts.map((a) => ({ value: String(a.id), label: a.name })));
	const tagItems = $derived(data.tags.map((t) => ({ value: String(t.id), label: t.name })));
	const emptyFilterItems = [
		{ value: 'account', label: 'Account' },
		{ value: 'category', label: 'Category' },
		{ value: 'merchant', label: 'Merchant' },
		{ value: 'tag', label: 'Tag' }
	];
	const filterCategoryItems = $derived(
		data.categories.map((c) => ({
			value: String(c.id),
			label: c.type === 'transfer' ? `${c.name} (transfer)` : c.name
		}))
	);

	// untrack is the first paint only. The effect below applies the next URL.
	let q = $state(untrack(() => data.filters.q));
	let filterAccounts = $state<string[]>(untrack(() => data.filters.accountIds.map(String)));
	let filterCategories = $state<string[]>(untrack(() => data.filters.categoryIds.map(String)));
	let filterTags = $state<string[]>(untrack(() => data.filters.tagIds.map(String)));
	let filterEmpty = $state<string[]>(untrack(() => [...data.filters.emptyFields]));
	let amountOp = $state(untrack(() => data.filters.amountOp));
	let amountFrom = $state(untrack(() => data.filters.amountFrom !== null ? String(data.filters.amountFrom / 100) : ''));
	let amountTo = $state(untrack(() => data.filters.amountTo !== null ? String(data.filters.amountTo / 100) : ''));
	let dateFrom = $state(untrack(() => data.filters.dateFrom ?? ''));
	let dateTo = $state(untrack(() => data.filters.dateTo ?? ''));
	let selectedColumns = $state<CsvExportColumn[]>(untrack(() => data.columns.length > 0 ? [...data.columns] : [...CSV_EXPORT_COLUMNS]));

	let lastKey = untrack(() => JSON.stringify({ f: data.filters, c: data.columns }));
	$effect(() => {
		const key = JSON.stringify({ f: data.filters, c: data.columns });
		if (key === lastKey) return;
		lastKey = key;
		const f = data.filters;
		q = f.q;
		filterAccounts = f.accountIds.map(String);
		filterCategories = f.categoryIds.map(String);
		filterTags = f.tagIds.map(String);
		filterEmpty = [...f.emptyFields];
		amountOp = f.amountOp;
		amountFrom = f.amountFrom !== null ? String(f.amountFrom / 100) : '';
		amountTo = f.amountTo !== null ? String(f.amountTo / 100) : '';
		dateFrom = f.dateFrom ?? '';
		dateTo = f.dateTo ?? '';
		selectedColumns = data.columns.length > 0 ? [...data.columns] : [...CSV_EXPORT_COLUMNS];
	});

	function localState(): ExportQueryState {
		return {
			q,
			accountIds: filterAccounts,
			categoryIds: filterCategories,
			tagIds: filterTags,
			emptyFields: filterEmpty,
			amountOp,
			amountFrom,
			amountTo,
			dateFrom,
			dateTo,
			columns: selectedColumns
		};
	}

	function serverState(): ExportQueryState {
		const f = data.filters;
		return {
			q: f.q,
			accountIds: f.accountIds.map(String),
			categoryIds: f.categoryIds.map(String),
			tagIds: f.tagIds.map(String),
			emptyFields: [...f.emptyFields],
			amountOp: f.amountOp,
			amountFrom: f.amountFrom !== null ? String(f.amountFrom / 100) : '',
			amountTo: f.amountTo !== null ? String(f.amountTo / 100) : '',
			dateFrom: f.dateFrom ?? '',
			dateTo: f.dateTo ?? '',
			columns: selectedColumns
		};
	}

	function applyFilters() {
		const href = exportPageHref(localState());
		if (href === exportPageHref(serverState())) return;
		void goto(href, { keepFocus: true, noScroll: true, replaceState: true });
	}

	$effect(() => {
		filterAccounts;
		filterCategories;
		filterTags;
		filterEmpty;
		amountOp;
		dateFrom;
		dateTo;
		applyFilters();
	});

	$effect(() => {
		q;
		amountFrom;
		amountTo;
		const handle = setTimeout(applyFilters, 300);
		return () => clearTimeout(handle);
	});

	const hasAnyFilters = $derived(
		data.filters.q !== '' ||
			data.filters.accountIds.length > 0 ||
			data.filters.categoryIds.length > 0 ||
			data.filters.tagIds.length > 0 ||
			data.filters.amountOp !== '' ||
			data.filters.dateFrom !== null ||
			data.filters.dateTo !== null
	);

	function toggleColumn(column: CsvExportColumn, on: boolean) {
		if (on) {
			if (!selectedColumns.includes(column)) selectedColumns = [...selectedColumns, column];
			return;
		}
		selectedColumns = selectedColumns.filter((c) => c !== column);
	}

	const canExport = $derived(selectedColumns.length > 0);
	const csvHref = $derived(exportCsvHref(localState()));
</script>

<Title title="Export transactions" />

<div class="mx-auto flex max-w-5xl flex-col gap-6">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Export transactions</h1>
			<p class="text-sm text-muted-foreground">
				Filters apply as you change them. Pick columns, then download CSV. Amount signs match import
				(negative expense, positive income).
			</p>
		</div>
		<a href="/transactions" class="text-sm text-primary underline-offset-2 hover:underline">← Transactions</a>
	</div>

	<section class="rounded-lg border border-border bg-surface p-5">
		<div class="flex flex-wrap items-start justify-between gap-3">
			<div>
				<h2 class="text-base font-semibold">Filters</h2>
				<p class="mt-1 text-sm text-muted-foreground">Same filters as the Transactions list. Changes apply immediately.</p>
			</div>
			{#if hasAnyFilters}
				<a
					href="/transactions/export"
					class="inline-flex h-9 items-center rounded-md px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
				>
					Clear
				</a>
			{/if}
		</div>
		<div class="mt-4 grid grid-cols-2 gap-3 md:flex md:flex-wrap md:items-end">
			<div class="col-span-2 flex flex-col gap-1.5 md:min-w-40 md:flex-1">
				<span class="text-xs font-medium text-muted-foreground">Search</span>
				<Input
					type="text"
					bind:value={q}
					placeholder="Merchant or notes"
					onkeydown={(e: KeyboardEvent) => {
						if (e.key === 'Enter') applyFilters();
					}}
				/>
			</div>
			<div class="flex flex-col gap-1.5 md:w-44">
				<span class="text-xs font-medium text-muted-foreground">Accounts</span>
				<MultiCombobox bind:value={filterAccounts} items={accountItems} placeholder="All accounts" />
			</div>
			<div class="flex flex-col gap-1.5 md:w-44">
				<span class="text-xs font-medium text-muted-foreground">Categories</span>
				<MultiCombobox
					bind:value={filterCategories}
					items={filterCategoryItems}
					placeholder="All categories"
				/>
			</div>
			<div class="flex flex-col gap-1.5 md:w-40">
				<span class="text-xs font-medium text-muted-foreground">Tags</span>
				<MultiCombobox bind:value={filterTags} items={tagItems} placeholder="All tags" />
			</div>
			<div class="flex flex-col gap-1.5 md:w-44">
				<span class="text-xs font-medium text-muted-foreground">Empty</span>
				<MultiCombobox
					bind:value={filterEmpty}
					items={emptyFilterItems}
					placeholder="Any field"
				/>
			</div>
			<div class="flex flex-col gap-1.5">
				<span class="text-xs font-medium text-muted-foreground">From</span>
				<DatePicker bind:value={dateFrom} placeholder="Any date" />
			</div>
			<div class="flex flex-col gap-1.5">
				<span class="text-xs font-medium text-muted-foreground">To</span>
				<DatePicker bind:value={dateTo} placeholder="Any date" />
			</div>
			<div class="col-span-2 flex flex-col gap-1.5">
				<span class="text-xs font-medium text-muted-foreground">Amount</span>
				<div class="flex flex-nowrap items-center gap-1.5">
					<select
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
								bind:value={amountFrom}
								placeholder={amountOp === 'between' ? 'Min' : 'Value'}
							/>
						</div>
						{#if amountOp === 'between'}
							<span class="text-sm text-muted-foreground">to</span>
							<div class="min-w-0 flex-1 md:flex-none md:w-24">
								<Input type="text" inputmode="decimal" bind:value={amountTo} placeholder="Max" />
							</div>
						{/if}
					{/if}
				</div>
			</div>
		</div>
	</section>

	<section class="rounded-lg border border-border bg-surface p-5">
		<h2 class="text-base font-semibold">Fields</h2>
		<p class="mt-1 text-sm text-muted-foreground">
			At least one column. No extra columns (no id, splits, or provider).
		</p>
		<ul class="mt-4 grid gap-2 sm:grid-cols-2">
			{#each CSV_EXPORT_COLUMNS as column (column)}
				<li>
					<label class="flex cursor-pointer items-center gap-2 text-sm">
						<input
							type="checkbox"
							value={column}
							class="size-4 rounded border border-input"
							checked={selectedColumns.includes(column)}
							onchange={(e) => toggleColumn(column, e.currentTarget.checked)}
						/>
						<span class="font-mono text-xs">{column}</span>
					</label>
				</li>
			{/each}
		</ul>
		<p class="mt-4 text-sm text-muted-foreground">
			{data.total} matching {data.total === 1 ? 'transaction' : 'transactions'}
		</p>
		{#if !canExport}
			<p class="mt-2 text-sm text-destructive">Select at least one field to export.</p>
		{/if}
		<div class="mt-4">
			{#if canExport}
				<a
					href={csvHref}
					data-sveltekit-reload
					class="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
				>
					Export CSV
				</a>
			{:else}
				<span
					class="inline-flex h-9 cursor-not-allowed items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground opacity-50"
				>
					Export CSV
				</span>
			{/if}
		</div>
	</section>
</div>

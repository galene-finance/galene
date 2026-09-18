<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from './ui/Button.svelte';
	import Combobox from './ui/Combobox.svelte';
	import Dialog from './ui/Dialog.svelte';
	import Field from './ui/Field.svelte';
	import Input from './ui/Input.svelte';
	import { formatMoney, parseAmountToCents } from '$lib/utils';
	import { categoryPickerItems, findOppositeTypeCategory } from '$lib/categoryPicker';
	import CategoryCreateConflictDialog from './CategoryCreateConflictDialog.svelte';
	import type { Category, Transaction } from '$lib/types';
	import type { SubmitFunction } from '@sveltejs/kit';

	type SplitRow = {
		categoryId: string;
		categorySearch: string;
		categoryCreate: boolean;
		categoryNewName: string;
		createMode: 'default' | 'use_existing' | 'create_anyway';
		amount: string;
	};

	let {
		open = $bindable(false),
		transaction = null,
		categories,
		form,
		onclose
	}: {
		open?: boolean;
		transaction?: Transaction | null;
		categories: Category[];
		form?: { error?: string | null };
		onclose?: () => void;
	} = $props();

	let rows = $state<SplitRow[]>([]);
	let showError = $state(false);

	const amountType = $derived<'expense' | 'income'>(
		transaction ? (transaction.amount_cents < 0 ? 'expense' : 'income') : 'expense'
	);
	const categoryItems = $derived(categoryPickerItems(categories, amountType));

	let conflictOpen = $state(false);
	let conflictExisting = $state<Category | null>(null);
	let conflictRowIndex = $state(0);
	let pendingCreateName = $state('');
	let categoryCreateMode = $state<'default' | 'use_existing' | 'create_anyway'>('default');

	function requestRowCreate(index: number, typed: string) {
		const name = typed.trim();
		const other = findOppositeTypeCategory(categories, name, amountType);
		if (other) {
			conflictRowIndex = index;
			pendingCreateName = name;
			conflictExisting = other;
			conflictOpen = true;
			return;
		}
		rows[index].categoryCreate = true;
		rows[index].categoryNewName = name;
		rows[index].createMode = 'default';
	}
	const total = $derived(transaction ? Math.abs(transaction.amount_cents) : 0);
	const sum = $derived(rows.reduce((s, r) => s + (parseAmountToCents(r.amount) ?? 0), 0));
	const remaining = $derived(total - sum);

	$effect(() => {
		if (!open || !transaction) return;
		showError = false;
		if (transaction.splits && transaction.splits.length > 0) {
			rows = transaction.splits.map((s) => ({
				categoryId: String(s.category_id),
				categorySearch: '',
				categoryCreate: false,
				categoryNewName: '',
				createMode: 'default',
				amount: (s.amount_cents / 100).toFixed(2)
			}));
		} else {
			rows = [
				{
					categoryId: transaction.category_id ? String(transaction.category_id) : '',
					categorySearch: '',
					categoryCreate: false,
					categoryNewName: '',
					createMode: 'default',
					amount: (total / 100).toFixed(2)
				},
				{ categoryId: '', categorySearch: '', categoryCreate: false, categoryNewName: '', createMode: 'default', amount: '' }
			];
		}
	});

	function addRow() {
		const leftover = Math.max(0, remaining);
		rows.push({
			categoryId: '',
			categorySearch: '',
			categoryCreate: false,
			createMode: 'default',
			categoryNewName: '',
			amount: leftover > 0 ? (leftover / 100).toFixed(2) : ''
		});
	}

	function removeRow(i: number) {
		rows.splice(i, 1);
	}

	// The dialog auto-focuses its first tabbable element, which is row 1's
	// category combobox — that would open its dropdown over row 2. Redirect
	// the initial focus to row 1's amount input instead.
	function handleOpenAutoFocus(e: Event) {
		e.preventDefault();
		(document.getElementById('split-amount-0') as HTMLInputElement | null)?.focus();
	}

	const handleSubmit: SubmitFunction = ({ formData }) => {
		if (!transaction) return;
		formData.set('id', String(transaction.id));
		formData.set('type', amountType);
		formData.set('unsplit', '0');
		for (const key of ['cat_id', 'cat_new', 'amount']) {
			for (const _ of formData.getAll(key)) formData.delete(key);
		}
		const mode = rows.some((r) => r.categoryCreate && r.createMode === 'create_anyway')
			? 'create_anyway'
			: 'default';
		formData.set('category_create_mode', mode);
		for (const r of rows) {
			formData.append('cat_id', r.categoryCreate ? '' : r.categoryId);
			formData.append('cat_new', r.categoryCreate ? r.categoryNewName : '');
			formData.append('amount', r.amount);
		}
		return async ({ result, update }) => {
			await update();
			// 'success' also covers actions that return an error object — only close when there is none.
			if (
				result.type === 'redirect' ||
				(result.type === 'success' && !result.data?.error && !result.data?.categoryConflict)
			) {
				open = false;
				onclose?.();
			} else if (result.type === 'success' && result.data?.error) {
				showError = true;
			}
		};
	};

	function unsplit() {
		(document.getElementById('split-unsplit-form') as HTMLFormElement | null)?.requestSubmit();
	}
</script>

<Dialog
	bind:open
	size="lg"
	title="Split transaction"
	description={
		transaction
			? `${transaction.merchant ?? 'Transaction'} · ${transaction.account_name} · ${formatMoney(transaction.amount_cents)}`
			: undefined
	}
	onOpenAutoFocus={handleOpenAutoFocus}
>
	{#if transaction}
		<form id="split-unsplit-form" method="POST" action="?/split" class="hidden">
			<input type="hidden" name="id" value={transaction.id} />
			<input type="hidden" name="unsplit" value="1" />
		</form>
	{/if}
	<form method="POST" action="?/split" use:enhance={handleSubmit} class="flex flex-col gap-4">
		{#if transaction}
			<div class="flex flex-col gap-2">
				{#each rows as row, i (i)}
					<div class="flex flex-wrap items-center gap-2">
						<Combobox
							bind:value={row.categoryId}
							bind:search={row.categorySearch}
							items={categoryItems}
							allowCreate
							createLabel="Create"
							placeholder="Category"
							class="min-w-44 flex-1"
							onselect={(_, label, typed) => {
								if (label === null) {
									requestRowCreate(i, typed);
								} else {
									row.categoryCreate = false;
									row.createMode = 'default';
								}
							}}
						/>
						<Input
							bind:value={row.amount}
							type="text"
							inputmode="decimal"
							placeholder="0.00"
							id={i === 0 ? 'split-amount-0' : undefined}
							class="w-28"
						/>
						<Button
							variant="ghost"
							size="sm"
							type="button"
							disabled={rows.length <= 2}
							onclick={() => removeRow(i)}
						>
							Remove
						</Button>
					</div>
				{/each}
			</div>
			<div class="flex flex-wrap items-center justify-between gap-2">
				<Button variant="secondary" size="sm" type="button" onclick={addRow}>+ Add part</Button>
				<p class="text-sm {remaining === 0 ? 'text-success' : 'text-destructive'}">
					Remaining: {formatMoney(remaining)}
				</p>
			</div>
		{/if}

		{#if showError && form?.error}
			<p class="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{form.error}</p>
		{/if}

		<div class="flex items-center gap-2">
			{#if transaction?.splits && transaction.splits.length > 0}
				<Button variant="destructive" type="button" class="mr-auto" onclick={unsplit}>
					Unsplit
				</Button>
			{/if}
			<Button variant="secondary" type="button" onclick={() => (open = false)}>Cancel</Button>
			<Button type="submit">Save split</Button>
		</div>
	</form>
</Dialog>

<CategoryCreateConflictDialog
	bind:open={conflictOpen}
	existing={conflictExisting}
	requestedType={amountType}
	onUseExisting={(cat: Category) => {
		const row = rows[conflictRowIndex];
		if (!row) return;
		row.categoryId = String(cat.id);
		row.categoryCreate = false;
		row.createMode = 'default';
		row.categoryNewName = '';
	}}
	onCreateAnyway={() => {
		const row = rows[conflictRowIndex];
		if (!row) return;
		row.categoryCreate = true;
		row.categoryNewName = pendingCreateName;
		row.createMode = 'create_anyway';
	}}
/>

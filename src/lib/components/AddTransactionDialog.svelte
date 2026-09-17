<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import Button from './ui/Button.svelte';
	import ColorPicker from './ui/ColorPicker.svelte';
	import Combobox from './ui/Combobox.svelte';
	import DatePicker from './ui/DatePicker.svelte';
	import MultiCombobox from './ui/MultiCombobox.svelte';
	import Dialog from './ui/Dialog.svelte';
	import Field from './ui/Field.svelte';
	import Input from './ui/Input.svelte';
	import { todayISO } from '$lib/utils';
	import type { Account, Category, Tag, Transaction } from '$lib/types';
	import type { SubmitFunction } from '@sveltejs/kit';

	const CREATE_VALUE = '__create__';

	let {
		open = $bindable(false),
		editing = null,
		accounts,
		categories,
		tags,
		form,
		action = '?/save',
		onclose
	}: {
		open?: boolean;
		editing?: Transaction | null;
		accounts: Account[];
		categories: Category[];
		tags: Tag[];
		form?: { error?: string | null };
		action?: string;
		onclose?: () => void;
	} = $props();

	let type = $state<'expense' | 'income'>('expense');
	let amount = $state('');
	let date = $state(todayISO());
	let accountId = $state('');
	let accountSearch = $state('');
	let accountCreate = $state(false);
	let accountNewName = $state('');
	let categoryId = $state('');
	let categorySearch = $state('');
	let categoryCreate = $state(false);
	let categoryNewName = $state('');
	let merchant = $state('');
	let notes = $state('');
	let color = $state('');
	let tagValues = $state<string[]>([]);
	let tagSearch = $state('');
	let tagNewName = $state('');
	const tagCreate = $derived(tagValues.includes(CREATE_VALUE));

	const accountItems = $derived(accounts.map((a) => ({ value: String(a.id), label: a.name })));
	const categoryItems = $derived(
		categories
			.filter((c) => c.type === type || c.type === 'transfer')
			.map((c) => ({
				value: String(c.id),
				label: c.type === 'transfer' ? `${c.name} (transfer)` : c.name
			}))
	);
	const tagItems = $derived(tags.map((t) => ({ value: String(t.id), label: t.name })));

	function reset() {
		type = 'expense';
		amount = '';
		date = todayISO();
		accountId = '';
		accountSearch = '';
		accountCreate = false;
		accountNewName = '';
		categoryId = '';
		categorySearch = '';
		categoryCreate = false;
		categoryNewName = '';
		merchant = '';
		notes = '';
		color = '';
		tagValues = [];
		tagSearch = '';
		tagNewName = '';
	}

	// Re-fetch the account/category/tag lists each time the dialog opens so
	// entities created in this or another dialog appear without a manual refresh.
	$effect(() => {
		if (open) invalidateAll();
	});

	$effect(() => {
		if (!open) return;
		if (editing) {
			type = editing.amount_cents < 0 ? 'expense' : 'income';
			amount = (Math.abs(editing.amount_cents) / 100).toFixed(2);
			date = editing.date;
			accountId = String(editing.account_id);
			accountCreate = false;
			categoryId = editing.category_id ? String(editing.category_id) : '';
			categoryCreate = false;
			merchant = editing.merchant ?? '';
			notes = editing.notes ?? '';
			color = editing.color ?? '';
			tagValues = (editing.tag_ids ?? []).map(String);
			tagSearch = '';
		} else {
			reset();
		}
	});

	function onTypeChange(newType: 'expense' | 'income') {
		if (newType === type) return;
		type = newType;
		// A category of the other type is not valid for this transaction
		const cat = categories.find((c) => String(c.id) === categoryId);
		// Keep transfer categories when switching income/expense; clear only a mismatched income/expense.
		if (cat && cat.type !== 'transfer' && cat.type !== newType) {
			categoryId = '';
			categoryCreate = false;
		}
	}

	const handleSubmit: SubmitFunction = ({ formData }) => {
		formData.set('id', editing ? String(editing.id) : '');
		formData.set('type', type);
		formData.set('amount', amount);
		formData.set('date', date);
		formData.set('merchant', merchant);
		formData.set('notes', notes);
		formData.set('color', color);
		if (accountCreate) {
			formData.set('account_id', '');
			formData.set('account_new', accountNewName);
		} else {
			formData.set('account_id', accountId);
			formData.set('account_new', '');
		}
		if (categoryCreate) {
			formData.set('category_id', '');
			formData.set('category_new', categoryNewName);
		} else {
			formData.set('category_id', categoryId);
			formData.set('category_new', '');
		}
		for (const value of formData.getAll('tags')) formData.delete('tags');
		for (const value of tagValues) {
			if (value !== CREATE_VALUE) formData.append('tags', value);
		}
		// The dropdown may still be open (search holds the final text) or already
		// closed (search cleared) — prefer the live text, fall back to the captured one.
		formData.set('tag_new', tagCreate ? tagSearch.trim() || tagNewName : '');
		return async ({ result, update }) => {
			await update();
			// 'success' also covers actions that return an error object — only close when there is none.
			if (result.type === 'redirect' || (result.type === 'success' && !result.data?.error)) {
				open = false;
				onclose?.();
			}
		};
	};
</script>

<Dialog
	bind:open
	size="lg"
	title={editing ? 'Edit transaction' : 'Add transaction'}
	description={editing ? undefined : 'Record a one-time income or expense.'}
>
	<form method="POST" action={action} use:enhance={handleSubmit} class="flex flex-col gap-4">
		<div class="flex gap-2" role="radiogroup" aria-label="Transaction type">
			<button
				type="button"
				onclick={() => onTypeChange('expense')}
				class="flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors {type === 'expense'
					? 'border-primary bg-primary/10 text-primary'
					: 'border-border text-muted-foreground hover:bg-muted'}"
			>
				Expense
			</button>
			<button
				type="button"
				onclick={() => onTypeChange('income')}
				class="flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors {type === 'income'
					? 'border-primary bg-primary/10 text-primary'
					: 'border-border text-muted-foreground hover:bg-muted'}"
			>
				Income
			</button>
		</div>

		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
			<Field label="Amount">
				<Input type="text" inputmode="decimal" bind:value={amount} placeholder="0.00" required autocomplete="off" />
			</Field>
			<Field label="Date">
				<DatePicker bind:value={date} placeholder="Select date" />
			</Field>
		</div>

		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
			<Field label="Account">
				<Combobox
					bind:value={accountId}
					bind:search={accountSearch}
					items={accountItems}
					allowCreate
					createLabel="Create account"
					placeholder="Search or create account"
					onselect={(_, label, typed) => {
						accountCreate = label === null;
						if (label === null) accountNewName = typed;
					}}
				/>
			</Field>
			<Field label="Category">
				<Combobox
					bind:value={categoryId}
					bind:search={categorySearch}
					items={categoryItems}
					allowCreate
					createLabel="Create category"
					placeholder="Search or create category"
					onselect={(_, label, typed) => {
						categoryCreate = label === null;
						if (label === null) categoryNewName = typed;
					}}
				/>
			</Field>
		</div>

		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
			<Field label="Merchant">
				<Input type="text" bind:value={merchant} placeholder="e.g. Whole Foods" />
			</Field>
			<Field label="Notes">
				<Input type="text" bind:value={notes} placeholder="Optional notes" />
			</Field>
		</div>

		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
			<Field label="Color">
				<ColorPicker bind:value={color} />
			</Field>
			<Field label="Tags">
				<MultiCombobox
					bind:value={tagValues}
					bind:search={tagSearch}
					items={tagItems}
					allowCreate
					createLabel="Create tag"
					placeholder="Search or create tags"
					onselect={(_, label, typed) => {
						if (label === null) tagNewName = typed;
					}}
				/>
			</Field>
		</div>

		{#if form?.error}
			<p class="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{form.error}</p>
		{/if}

		<div class="flex justify-end gap-2">
			<Button variant="secondary" type="button" onclick={() => (open = false)}>Cancel</Button>
			<Button type="submit">{editing ? 'Save changes' : 'Add transaction'}</Button>
		</div>
	</form>
</Dialog>

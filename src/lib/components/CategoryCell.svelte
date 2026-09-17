<script lang="ts">
	import { enhance } from '$app/forms';
	import Combobox from './ui/Combobox.svelte';
	import type { Category, Transaction } from '$lib/types';

	let {
		transaction,
		categories,
		action = '?/set-category'
	}: {
		transaction: Transaction;
		categories: Category[];
		action?: string;
	} = $props();

	let value = $state('');
	let search = $state('');
	let create = $state(false);
	// Captured at select-time from the combobox's own search state (passed as
	// `typed`); the combobox clears its search when the dropdown closes, which
	// happens before the delayed submit below reads this.
	let newCategoryName = $state('');

	$effect(() => {
		value = transaction.category_id ? String(transaction.category_id) : '';
	});

	const selected = $derived(
		transaction.category_id != null
			? categories.find((c) => c.id === transaction.category_id)
			: undefined
	);
	const isTransfer = $derived(
		transaction.category_type === 'transfer' || selected?.type === 'transfer'
	);

	// Income/expense categories matching the signed amount, plus all transfer categories.
	const amountType = $derived(transaction.amount_cents < 0 ? 'expense' : 'income');
	const items = $derived([
		{ value: '', label: 'No category' },
		...categories
			.filter((c) => c.type === amountType || c.type === 'transfer')
			.map((c) => ({
				value: String(c.id),
				label: c.type === 'transfer' ? `${c.name} (transfer)` : c.name
			}))
	]);

	function onselect(selected: string, label: string | null, typed: string) {
		create = label === null;
		newCategoryName = typed;
		// Let Svelte flush the hidden inputs before submitting
		setTimeout(() => {
			(document.getElementById(`cat-form-${transaction.id}`) as HTMLFormElement | null)?.requestSubmit();
		}, 0);
	}
</script>

<!-- Enhanced (fetch) submit: no full-page reload, and no native POST in the
	history, so a later F5 can't trigger a "resubmit this form?" 405.
	reset:false skips the default form.reset(), which would wipe the
	combobox's display value (its default is empty) right after a selection. -->
<div class="inline-flex items-center gap-1">
	{#if isTransfer}
		<span
			class="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground"
			title="Transfer — excluded from cashflow income/expense"
			aria-label="Transfer category"
		>
			<svg
				class="size-3.5"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<path d="M7 16V4m0 0L3 8m4-4l4 4" />
				<path d="M17 8v12m0 0l4-4m-4 4l-4-4" />
			</svg>
		</span>
	{/if}
	<form
		id="cat-form-{transaction.id}"
		method="POST"
		action={action}
		use:enhance={() =>
			async ({ update }) => {
				await update({ reset: false });
			}}
		class="relative inline-block w-44"
	>
		<input type="hidden" name="id" value={transaction.id} />
		<input type="hidden" name="type" value={transaction.amount_cents < 0 ? 'expense' : 'income'} />
		<input type="hidden" name="category_id" value={create ? '' : value} />
		<input type="hidden" name="category_new" value={create ? newCategoryName : ''} />
		<Combobox
			bind:value
			bind:search
			{items}
			placeholder={transaction.category_name ?? 'No category'}
			allowCreate
			createLabel="Create"
			{onselect}
			class="h-8 w-full cursor-pointer"
		/>
	</form>
	{#if transaction.splits && transaction.splits.length > 1}
		<span
			class="ml-0.5 inline-block rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
			title="Split across {transaction.splits.length} categories"
		>
			{transaction.splits.length} parts
		</span>
	{/if}
</div>

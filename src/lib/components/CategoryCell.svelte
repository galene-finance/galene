<script lang="ts">
 import CategoryPill from './CategoryPill.svelte';
 import {categoryIdentity} from '$lib/categoryIdentity';
	import { enhance } from '$app/forms';
	import { categoryPickerItems } from '$lib/categoryPicker';
	import Combobox from './ui/Combobox.svelte';
	import type { Category, Transaction } from '$lib/types';

	let {
		transaction,
		categories,
		action = '?/set-category',
		readonly = false
	}: {
		transaction: Transaction;
		categories: Category[];
		action?: string;
		readonly?: boolean;
	} = $props();

	let value = $state('');
	let search = $state('');
	let create = $state(false);
	let newCategoryName = $state('');

	$effect(() => {
		value = transaction.category_id ? String(transaction.category_id) : '';
	});

	const selected = $derived(
		transaction.category_id != null
			? categories.find((c) => c.id === transaction.category_id)
			: undefined
	);
	const identity=$derived(categoryIdentity(selected?.id,selected?.color));
	const isTransfer = $derived(
		transaction.category_type === 'transfer' || selected?.type === 'transfer'
	);

	const amountType = $derived(transaction.amount_cents < 0 ? 'expense' : 'income');
	const items = $derived(categoryPickerItems(categories, { includeNone: true }));

	function onselect(_selected: string, label: string | null, typed: string) {
		create = label === null;
		newCategoryName = typed;
		setTimeout(() => {
			(document.getElementById(`cat-form-${transaction.id}`) as HTMLFormElement | null)?.requestSubmit();
		}, 0);
	}
</script>

<div class="category-control inline-flex items-center gap-1" style:--category-fill={identity.fill} style:--category-ink={identity.ink}>
	{#if readonly}
		<CategoryPill id={selected?.id} name={selected?.name??transaction.category_name??'No category'} color={selected?.color}/>
	{:else}
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
		<input type="hidden" name="type" value={amountType} />
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
	{/if}
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
	{#if transaction.splits && transaction.splits.length > 1}
		<span
			class="ml-0.5 inline-block rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
			title="Split across {transaction.splits.length} categories"
		>
			{transaction.splits.length} parts
		</span>
	{/if}
</div>
<style>.category-control :global(input[role="combobox"]){background:var(--category-fill);color:var(--category-ink);border-radius:999px;min-height:44px;border-color:transparent;font-weight:650}.category-control :global(input::placeholder){color:var(--category-ink);opacity:1}.category-control :global([data-combobox-trigger] svg){color:var(--category-ink)}</style>

<script lang="ts">
	import { enhance } from '$app/forms';
	import Title from '$lib/components/Title.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Combobox from '$lib/components/ui/Combobox.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import { watchFormToast } from '$lib/formToast.svelte';
	import { inclusiveEnd } from '$lib/trendsChart';
	import { formatMoney, periodLabel } from '$lib/utils';
	import type { Budget, Category } from '$lib/types';
	import type { SubmitFunction } from '@sveltejs/kit';

	type BudgetRow = Budget & {
		category_name: string;
		category_color: string | null;
		spentCents: number;
		from: string;
		to: string;
	};

	let { form, data }: {
		form: { error?: string | null } | undefined;
		data: { budgets: BudgetRow[]; categories: Category[]; selectedDate: string };
	} = $props();

	// --- Add / edit dialog ---
	let dialogOpen = $state(false);
	let editing = $state<BudgetRow | null>(null);
	let type = $state<'expense' | 'income'>('expense');
	let amount = $state('');
	let categoryId = $state('');
	let categorySearch = $state('');
	let categoryCreate = $state(false);
	let categoryNewName = $state('');
	let period = $state<'week' | 'month' | 'year'>('month');

	const categoryItems = $derived(
		data.categories
			.filter((c) => c.type === type && c.system_kind !== 'balance_adjustment') // transfers and balance adjustments are excluded from budgets
			.map((c) => ({ value: String(c.id), label: c.name }))
	);

	function openAdd() {
		editing = null;
		type = 'expense';
		amount = '';
		categoryId = '';
		categorySearch = '';
		categoryCreate = false;
		categoryNewName = '';
		period = 'month';
		dialogOpen = true;
	}

	function openEdit(b: BudgetRow) {
		editing = b;
		const cat = data.categories.find((c) => c.id === b.category_id);
		type = cat?.type === 'income' ? 'income' : 'expense';
		amount = (b.limit_cents / 100).toFixed(2);
		categoryId = String(b.category_id);
		categorySearch = '';
		categoryCreate = false;
		categoryNewName = '';
		period = b.period;
		dialogOpen = true;
	}

	function onTypeChange(newType: 'expense' | 'income') {
		if (newType === type) return;
		type = newType;
		const cat = data.categories.find((c) => String(c.id) === categoryId);
		if (cat && cat.type !== newType) {
			categoryId = '';
			categoryCreate = false;
		}
	}

	const handleSubmit: SubmitFunction = ({ formData }) => {
		formData.set('id', editing ? String(editing.id) : '');
		formData.set('type', type);
		formData.set('amount', amount);
		formData.set('period', period);
		if (categoryCreate) {
			formData.set('category_id', '');
			formData.set('category_new', categoryNewName);
		} else {
			formData.set('category_id', categoryId);
			formData.set('category_new', '');
		}
		return async ({ result, update }) => {
			await update();
			// 'success' also covers actions that return an error object — only close when there is none.
			if (result.type === 'redirect' || (result.type === 'success' && !result.data?.error)) {
				dialogOpen = false;
			}
		};
	};

	// Toast the latest action result (replaces the old top-of-page status block).
	watchFormToast(() => form);
</script>

<Title title="Budget" />

<div class="product-page">
 <header class="product-heading"><div><h1>Budget</h1><p>A spending plan, with room to make changes.</p></div><button class="product-button primary" onclick={openAdd}>Add a limit</button></header>
 <form method="GET" class="product-toolbar"><label class="product-field">As of <input type="date" name="date" value={data.selectedDate} required/></label><button class="product-button">View budget</button><span class="product-muted">Limits compared with posted, categorized activity.</span></form>
 <div class="product-attention"><span>These are spending limits, not money set aside. Uncategorized activity may still need review.</span><a class="product-link" href="/transactions?empty=category">Review activity</a></div>
 {#if !data.budgets.length}<section class="product-panel product-empty"><strong>Give your money a simple plan</strong><p>Add a limit for a category you want to keep an eye on.</p><button class="product-button" onclick={openAdd}>Add your first limit</button></section>{/if}
 {#each ['month','week','year'] as frequency}
  {@const items=data.budgets.filter(b=>b.period===frequency)}
  {#if items.length}
  <section class="product-panel"><header class="product-panel-header"><h2>{frequency==='month'?'Monthly':frequency==='week'?'Weekly':'Yearly'} limits</h2><span class="product-muted">{items.length} categories</span></header>
   {#each items as b}
    {@const over=b.spentCents>b.limit_cents}
    {@const income=data.categories.find(c=>c.id===b.category_id)?.type==='income'}
    <div class="budget-line">
     <a class="budget-category" href={`/categories/${b.category_id}?date_from=${b.from}&date_to=${inclusiveEnd(b.to)}`}><strong>{b.category_name}</strong><span class="product-row-caption">{periodLabel(b.period,b.from,b.to)}</span></a>
     <div class="budget-progress"><div class="product-bar-caption"><span>{income?'Received':'Spent'} {formatMoney(b.spentCents)}</span><strong>{formatMoney(b.limit_cents)} {income?'target':'limit'}</strong></div><div class="product-bar-track" aria-hidden="true"><div class="product-bar-fill" style:width={`${Math.max(0,Math.min(100,b.spentCents/Math.max(1,b.limit_cents)*100))}%`} style:background={over&&!income?'var(--destructive)':'var(--primary)'}></div></div></div>
     <span class="budget-difference">{formatMoney(Math.abs(b.limit_cents-b.spentCents))}<small>{income?(over?'above target':'to target'):(over?'over limit':'under limit')}</small></span>
     <button class="product-button" aria-label={`Edit ${b.category_name} limit`} onclick={()=>openEdit(b)}>Edit</button>
    </div>
   {/each}
  </section>
  {/if}
 {/each}
 <details class="product-panel product-details"><summary>About your plan</summary><p>Refunds reduce spending in the original category. Transfers and card payments are not new spending. Week, month and year limits keep their own periods. Changing a limit changes the plan; it does not move money or change an account balance.</p></details>
</div>

<Dialog
	bind:open={dialogOpen}
	size="md"
	title={editing ? 'Edit budget' : 'Add budget'}
	description={editing ? undefined : 'Set a spending limit for a category.'}
>
	<form id="budget-dialog-form" method="POST" action="?/save" use:enhance={handleSubmit} class="flex flex-col gap-4">
		<div class="flex gap-2" role="radiogroup" aria-label="Budget type">
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
			<Field label="Limit amount">
				<Input type="text" inputmode="decimal" bind:value={amount} placeholder="0.00" required autocomplete="off" />
			</Field>
			<Field label="Period">
				<Select
					bind:value={period}
					items={[
						{ value: 'week', label: 'Week' },
						{ value: 'month', label: 'Month' },
						{ value: 'year', label: 'Year' }
					]}
				/>
			</Field>
		</div>

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

		{#if form?.error}
			<p class="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{form.error}</p>
		{/if}

	</form>
	{#snippet footer()}
		<div class="flex items-center gap-2">
			{#if editing}
				<form
					method="POST"
					action="?/delete"
					class="mr-auto"
					onsubmit={(event) => {
						if (!confirm('Remove this budget limit? Your transactions and account balances will not change.')) {
							event.preventDefault();
						}
					}}
				>
					<input type="hidden" name="id" value={editing.id} />
					<Button variant="destructive" type="submit">Remove limit</Button>
				</form>
			{/if}
			<Button variant="secondary" type="button" onclick={() => (dialogOpen = false)}>Cancel</Button>
			<Button type="submit" form="budget-dialog-form">{editing ? 'Save changes' : 'Add budget'}</Button>
		</div>
	{/snippet}
</Dialog>
<style>
 .budget-line{display:grid;grid-template-columns:minmax(160px,1.1fr) minmax(200px,1.4fr) 100px auto;gap:24px;align-items:center;padding:20px 22px;border-bottom:1px solid var(--border)}
 .budget-line:last-child{border-bottom:0}.budget-category{font-size:14px}.budget-category strong{font-weight:550}.budget-difference{text-align:right;font-variant-numeric:tabular-nums;font-size:14px}.budget-difference small{display:block;color:var(--muted-foreground);font-size:11px}
 @media(max-width:1050px){.budget-line{grid-template-columns:1fr auto;gap:14px;padding:18px 16px}.budget-progress{grid-column:1/-1;grid-row:2}.budget-difference{grid-column:1;text-align:left}.budget-line>button{grid-column:2;grid-row:1}.budget-difference small{display:inline;margin-left:6px}}
</style>

<script lang="ts">
	import { enhance } from '$app/forms';
	import Title from '$lib/components/Title.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Combobox from '$lib/components/ui/Combobox.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import { toastFormResult } from '$lib/toasts';
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
		data: { budgets: BudgetRow[]; categories: Category[] };
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
			.filter((c) => c.type === type) // transfer categories are excluded from budgets by default
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

	function deleteBudget(b: BudgetRow) {
		(document.getElementById(`budget-delete-${b.id}`) as HTMLFormElement | null)?.requestSubmit();
	}

	// Toast the latest action result (replaces the old top-of-page status block).
	let lastForm = form;
	$effect(() => {
		if (form === lastForm) return;
		lastForm = form;
		toastFormResult(form);
	});
</script>

<Title title="Budget" />

<div class="mx-auto flex max-w-5xl flex-col gap-4 2xl:max-w-7xl">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Budgets</h1>
			<p class="text-sm text-muted-foreground">Limits per category, checked against what you actually spend.</p>
		</div>
		<Button type="button" onclick={openAdd}>+ Add budget</Button>
	</div>

	{#if data.budgets.length === 0}
		<div class="rounded-lg border border-dashed border-border bg-surface p-10 text-center">
			<p class="text-sm text-muted-foreground">
				No budgets yet. Add one to set a weekly, monthly, or yearly limit for a category.
			</p>
		</div>
	{:else}
		<div class="overflow-x-auto rounded-lg border border-border bg-surface">
			<table class="w-full min-w-[760px] text-sm">
				<thead>
					<tr class="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
						<th class="px-4 py-2.5 font-medium">Category</th>
						<th class="px-3 py-2.5 font-medium">Period</th>
						<th class="px-3 py-2.5 text-right font-medium">Limit</th>
						<th class="px-3 py-2.5 text-right font-medium">Spent</th>
						<th class="px-3 py-2.5 text-right font-medium">Remaining</th>
						<th class="w-44 px-3 py-2.5 font-medium">Progress</th>
						<th class="w-24 px-3 py-2.5"></th>
					</tr>
				</thead>
				<tbody>
					{#each data.budgets as b (b.id)}
						{@const over = b.spentCents > b.limit_cents}
						{@const pct = Math.min(100, Math.round((b.spentCents / Math.max(1, b.limit_cents)) * 100))}
						<tr class="border-b border-border last:border-0 hover:bg-muted/40">
							<td class="px-4 py-2.5">
								<span class="flex items-center gap-2">
									<span
										class="size-2.5 shrink-0 rounded-full"
										style="background: {b.category_color ?? 'transparent'}"
									></span>
									<span class="font-medium">{b.category_name}</span>
								</span>
							</td>
							<td class="whitespace-nowrap px-3 py-2.5 capitalize text-muted-foreground">{b.period}</td>
							<td class="whitespace-nowrap px-3 py-2.5 text-right">{formatMoney(b.limit_cents)}</td>
							<td class="whitespace-nowrap px-3 py-2.5 text-right">
								<span class="font-medium {over ? 'text-destructive' : ''}">{formatMoney(b.spentCents)}</span>
								<span class="block text-xs text-muted-foreground">
									{periodLabel(b.period, b.from, b.to)}
								</span>
							</td>
							<td class="whitespace-nowrap px-3 py-2.5 text-right {over ? 'font-medium text-destructive' : 'text-muted-foreground'}">
								{formatMoney(b.limit_cents - b.spentCents)}
							</td>
							<td class="px-3 py-2.5">
								<div class="h-2 w-full overflow-hidden rounded-full bg-muted">
									<div class="h-full rounded-full {over ? 'bg-destructive' : 'bg-primary'}" style="width: {pct}%"></div>
								</div>
							</td>
							<td class="whitespace-nowrap px-3 py-2.5 text-right">
								<button type="button" class="text-sm text-primary hover:underline" onclick={() => openEdit(b)}>
									Edit
								</button>
								<form id="budget-delete-{b.id}" method="POST" action="?/delete" class="inline">
									<input type="hidden" name="id" value={b.id} />
									<button type="submit" class="ml-2 text-sm text-destructive hover:underline">Delete</button>
								</form>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<Dialog
	bind:open={dialogOpen}
	size="md"
	title={editing ? 'Edit budget' : 'Add budget'}
	description={editing ? undefined : 'Set a spending limit for a category.'}
>
	<form method="POST" action="?/save" use:enhance={handleSubmit} class="flex flex-col gap-4">
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

		<div class="flex justify-end gap-2">
			<Button variant="secondary" type="button" onclick={() => (dialogOpen = false)}>Cancel</Button>
			<Button type="submit">{editing ? 'Save changes' : 'Add budget'}</Button>
		</div>
	</form>
</Dialog>

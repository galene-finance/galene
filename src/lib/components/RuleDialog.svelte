<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from './ui/Button.svelte';
	import Combobox from './ui/Combobox.svelte';
	import Dialog from './ui/Dialog.svelte';
	import Field from './ui/Field.svelte';
	import Input from './ui/Input.svelte';
	import Select from './ui/Select.svelte';
	import { categoryPickerItems } from '$lib/categoryPicker';
	import type { Account, CategorizationRule, Category, RuleCondition, RuleField, RuleOp } from '$lib/types';
	import { centsToDollars } from '$lib/utils';
	import type { SubmitFunction } from '@sveltejs/kit';

	const CREATE_VALUE = '__create__';

	// Dialog values are plain strings (dollars for amounts); the server parses them to cents.
	type DialogCondition = { field: RuleField; op: RuleOp; value: string; value2?: string };

	function toDialogConditions(conds: RuleCondition[]): DialogCondition[] {
		return conds.map((c) => ({
			field: c.field,
			op: c.op,
			value: c.field === 'amount' ? centsToDollars(Number(c.value)) : String(c.value ?? ''),
			value2: c.value2 != null ? (c.field === 'amount' ? centsToDollars(Number(c.value2)) : String(c.value2)) : undefined
		}));
	}

	const FIELD_ITEMS = [
		{ value: 'merchant', label: 'Merchant' },
		{ value: 'amount', label: 'Amount' },
		{ value: 'account', label: 'Account' }
	];

	const OPS: Record<RuleField, { value: RuleOp; label: string }[]> = {
		merchant: [
			{ value: 'contains', label: 'Contains' },
			{ value: 'equals', label: 'Equals' }
		],
		amount: [
			{ value: 'equals', label: 'Equals' },
			{ value: 'gt', label: 'More than' },
			{ value: 'lt', label: 'Less than' },
			{ value: 'between', label: 'Between' }
		],
		account: [{ value: 'equals', label: 'Is' }]
	};

	let {
		open = $bindable(false),
		editing = null,
		prefill = null,
		accounts,
		categories,
		form,
		action = '/settings/rules?/save-rule',
		onclose
	}: {
		open?: boolean;
		editing?: CategorizationRule | null;
		prefill?: { name: string; conditions: RuleCondition[]; categoryId: number | null } | null;
		accounts: Account[];
		categories: Category[];
		form?: { error?: string | null };
		action?: string;
		onclose?: () => void;
	} = $props();

	let type = $state<'expense' | 'income'>('expense');
	let name = $state('');
	let categoryId = $state('');
	let categorySearch = $state('');
	let categoryCreate = $state(false);
	let categoryNewName = $state('');
	let conditions = $state<DialogCondition[]>([{ field: 'merchant', op: 'contains', value: '' }]);
	let applyExisting = $state(false);

	const categoryItems = $derived(categoryPickerItems(categories));
	const accountItems = $derived(accounts.map((a) => ({ value: String(a.id), label: a.name })));

	// Keep ops valid for their field (e.g. switching Amount → Merchant drops 'gt').
	$effect(() => {
		for (const cond of conditions) {
			const valid = OPS[cond.field]?.map((o) => o.value) ?? [];
			if (!valid.includes(cond.op)) {
				cond.op = valid[0] ?? 'contains';
				cond.value = '';
				cond.value2 = undefined;
			}
		}
	});

	function onTypeChange(newType: 'expense' | 'income') {
		if (newType === type) return;
		type = newType;
	}

	$effect(() => {
		if (!open) return;
		applyExisting = false;
		if (editing) {
			const cat = categories.find((c) => c.id === editing.category_id);
			type = cat?.type === 'income' ? 'income' : 'expense'; // transfer stays selectable in either list
			name = editing.name;
			categoryId = String(editing.category_id);
			categoryCreate = false;
			categoryNewName = '';
			conditions = toDialogConditions(editing.conditions);
		} else if (prefill) {
			const cat = categories.find((c) => c.id === prefill.categoryId);
			type = cat?.type === 'income' ? 'income' : 'expense';
			name = prefill.name;
			categoryId = prefill.categoryId ? String(prefill.categoryId) : '';
			categoryCreate = false;
			categoryNewName = '';
			conditions = toDialogConditions(prefill.conditions);
		} else {
			type = 'expense';
			name = '';
			categoryId = '';
			categoryCreate = false;
			categoryNewName = '';
			conditions = [{ field: 'merchant', op: 'contains', value: '' }];
		}
	});

	function addCondition() {
		conditions.push({ field: 'merchant', op: 'contains', value: '' });
	}

	function removeCondition(i: number) {
		conditions.splice(i, 1);
	}

	const handleSubmit: SubmitFunction = ({ formData }) => {
		formData.set('id', editing ? String(editing.id) : '');
		formData.set('type', type);
		formData.set('name', name);
		if (categoryCreate) {
			formData.set('category_id', '');
			formData.set('category_new', categoryNewName);
		} else {
			formData.set('category_id', categoryId);
			formData.set('category_new', '');
		}
		for (let i = 0; i < conditions.length; i++) {
			const c = conditions[i];
			formData.set(`cond_field_${i}`, c.field);
			formData.set(`cond_op_${i}`, c.op);
			formData.set(`cond_value_${i}`, String(c.value ?? ''));
			formData.set(`cond_value2_${i}`, String(c.value2 ?? ''));
		}
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
	title={editing ? 'Edit categorization rule' : 'New categorization rule'}
	description="Matching transactions are auto-assigned this category when they come in without one."
>
	<form method="POST" action={action} use:enhance={handleSubmit} class="flex flex-col gap-4">
		<Field label="Rule name">
			<Input type="text" bind:value={name} placeholder='e.g. "Whole Foods → Groceries"' required />
		</Field>

		<div class="flex gap-2" role="radiogroup" aria-label="Category type">
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

		<Field label="Assign to category">
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

		<div class="rounded-md border border-border p-3">
			<p class="text-sm font-medium">
				Conditions
				<span class="ml-1 text-xs font-normal text-muted-foreground">All must match</span>
			</p>
			<div class="mt-2 flex flex-col gap-2">
				{#each conditions as cond, i (i)}
					<div class="flex flex-wrap items-center gap-2">
						<Select bind:value={cond.field} items={FIELD_ITEMS} class="w-32" />
						<Select bind:value={cond.op} items={OPS[cond.field]} class="w-36" />
						{#if cond.field === 'account'}
							<Select
								bind:value={cond.value}
								items={accountItems}
								placeholder="Select account"
								class="min-w-40 flex-1"
							/>
						{:else if cond.field === 'amount' && cond.op === 'between'}
							<Input
								bind:value={cond.value}
								inputmode="decimal"
								placeholder="Min"
								class="min-w-24 flex-1"
							/>
							<Input
								bind:value={cond.value2}
								inputmode="decimal"
								placeholder="Max"
								class="min-w-24 flex-1"
							/>
						{:else}
							<Input
								bind:value={cond.value}
								type="text"
								inputmode={cond.field === 'amount' ? 'decimal' : undefined}
								placeholder={cond.field === 'merchant' ? 'e.g. whole foods' : '0.00'}
								class="min-w-40 flex-1"
							/>
						{/if}
						<Button variant="ghost" size="sm" type="button" onclick={() => removeCondition(i)}>
							Remove
						</Button>
					</div>
				{/each}
			</div>
			<Button variant="secondary" size="sm" type="button" class="mt-2" onclick={addCondition}>
				+ Add condition
			</Button>
		</div>

		<label class="flex cursor-pointer items-start gap-2 rounded-md border border-border p-3 text-sm">
			<input type="checkbox" name="apply_existing" value="1" bind:checked={applyExisting} class="mt-0.5 size-4 accent-primary" />
			<span>
				<span class="font-medium">Also apply to existing uncategorized transactions</span>
				<span class="block text-xs text-muted-foreground">
					Runs this rule over transactions that already have no category. Existing categories are never changed.
				</span>
			</span>
		</label>

		{#if form?.error}
			<p class="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{form.error}</p>
		{/if}

		<div class="flex justify-end gap-2">
			<Button variant="secondary" type="button" onclick={() => (open = false)}>Cancel</Button>
			<Button type="submit">{editing ? 'Save changes' : 'Create rule'}</Button>
		</div>
	</form>
</Dialog>

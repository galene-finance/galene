<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from './ui/Button.svelte';
	import Combobox from './ui/Combobox.svelte';
	import ConditionCards, { type DialogCondition } from './ConditionCards.svelte';
	import Dialog from './ui/Dialog.svelte';
	import Field from './ui/Field.svelte';
	import Input from './ui/Input.svelte';
	import { categoryPickerItems } from '$lib/categoryPicker';
	import type { Account, CategorizationRule, Category, RuleCondition } from '$lib/types';
	import { centsToDollars } from '$lib/utils';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { withPending } from '$lib/formPending';

	function toDialogConditions(conds: RuleCondition[]): DialogCondition[] {
		return conds.map((c) => ({
			field: c.field,
			op: c.op,
			value: c.field === 'amount' ? centsToDollars(Number(c.value)) : String(c.value ?? ''),
			value2: c.value2 != null ? (c.field === 'amount' ? centsToDollars(Number(c.value2)) : String(c.value2)) : undefined
		}));
	}

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
	let saving = $state(false);

	const categoryItems = $derived(categoryPickerItems(categories));

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

	const handleSubmit: SubmitFunction = withPending(
		(v) => (saving = v),
		({ formData }) => {
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
		}
	);
</script>

<Dialog
	bind:open
	size="lg"
	busy={saving}
	title={editing ? 'Edit categorization rule' : 'New categorization rule'}
	description="Matching transactions are auto-assigned this category when they come in without one."
>
	<form method="POST" action={action} use:enhance={handleSubmit} class="flex flex-col gap-4" aria-busy={saving ? 'true' : undefined}>
		<fieldset disabled={saving} class="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
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

		<ConditionCards bind:conditions {accounts} {categories} />

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
			<Button variant="secondary" type="button" disabled={saving} onclick={() => (open = false)}>Cancel</Button>
			<Button type="submit" pending={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create rule'}</Button>
		</div>
		</fieldset>
	</form>
</Dialog>

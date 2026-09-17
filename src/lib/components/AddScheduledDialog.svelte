<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import Button from './ui/Button.svelte';
	import Checkbox from './ui/Checkbox.svelte';
	import ColorPicker from './ui/ColorPicker.svelte';
	import Combobox from './ui/Combobox.svelte';
	import DatePicker from './ui/DatePicker.svelte';
	import Dialog from './ui/Dialog.svelte';
	import Field from './ui/Field.svelte';
	import Input from './ui/Input.svelte';
	import MultiCombobox from './ui/MultiCombobox.svelte';
	import Select from './ui/Select.svelte';
	import { todayISO } from '$lib/utils';
	import type { Account, Category, RepeatUnit, Scheduled, Tag } from '$lib/types';
	import type { SubmitFunction } from '@sveltejs/kit';

	const CREATE_VALUE = '__create__';

	let {
		open = $bindable(false),
		editing = null,
		prefillDate = null,
		prefill = null,
		accounts,
		categories,
		tags,
		form,
		action = '?/save-scheduled',
		deleteAction = null,
		extraHidden = {} as Record<string, string>,
		onclose
	}: {
		open?: boolean;
		editing?: Scheduled | null;
		prefillDate?: string | null;
		/** Draft values when accepting a recurring suggestion (no id). */
		prefill?: {
			name?: string;
			amount_cents?: number;
			start_date?: string;
			account_id?: number | null;
			category_id?: number | null;
			repeat_interval?: number | null;
			repeat_unit?: RepeatUnit | null;
			forecast_behavior?: 'bill' | 'spread';
			notes?: string | null;
		} | null;
		accounts: Account[];
		categories: Category[];
		tags: Tag[];
		form?: { error?: string | null };
		action?: string;
		deleteAction?: string | null;
		extraHidden?: Record<string, string>;
		onclose?: () => void;
	} = $props();

	let type = $state<'expense' | 'income'>('expense');
	let name = $state('');
	let amount = $state('');
	let startDate = $state(todayISO());
	let accountId = $state('');
	let accountSearch = $state('');
	let accountCreate = $state(false);
	let accountNewName = $state('');
	let categoryId = $state('');
	let categorySearch = $state('');
	let categoryCreate = $state(false);
	let categoryNewName = $state('');
	let notes = $state('');
	let repeats = $state(false);
	let repeatInterval = $state('1');
	let repeatUnit = $state<RepeatUnit>('month');
	let untilDate = $state('');
	let forecastBehavior = $state<'bill' | 'spread'>('bill');
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
		name = '';
		amount = '';
		startDate = prefillDate ?? todayISO();
		accountId = '';
		accountSearch = '';
		accountCreate = false;
		accountNewName = '';
		categoryId = '';
		categorySearch = '';
		categoryCreate = false;
		categoryNewName = '';
		notes = '';
		repeats = false;
		repeatInterval = '1';
		repeatUnit = 'month';
		untilDate = '';
		forecastBehavior = 'bill';
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
			const cat = categories.find((c) => c.id === editing.category_id);
			type = cat?.type === 'income' ? 'income' : 'expense';
			name = editing.name;
			amount = (Math.abs(editing.amount_cents) / 100).toFixed(2);
			startDate = editing.start_date;
			accountId = editing.account_id ? String(editing.account_id) : '';
			accountCreate = false;
			categoryId = editing.category_id ? String(editing.category_id) : '';
			categoryCreate = false;
			notes = editing.notes ?? '';
			repeats = editing.repeat_interval !== null && editing.repeat_unit !== null;
			repeatInterval = String(editing.repeat_interval ?? 1);
			repeatUnit = editing.repeat_unit ?? 'month';
			untilDate = editing.until_date ?? '';
			forecastBehavior = editing.forecast_behavior;
			color = editing.color ?? '';
			tagValues = (editing.tag_ids ?? []).map(String);
			tagSearch = '';
		} else if (prefill) {
			const cat = prefill.category_id != null ? categories.find((c) => c.id === prefill.category_id) : undefined;
			type = cat?.type === 'income' ? 'income' : 'expense';
			name = prefill.name ?? '';
			amount = prefill.amount_cents != null ? (Math.abs(prefill.amount_cents) / 100).toFixed(2) : '';
			startDate = prefill.start_date ?? prefillDate ?? todayISO();
			accountId = prefill.account_id ? String(prefill.account_id) : '';
			accountCreate = false;
			categoryId = prefill.category_id ? String(prefill.category_id) : '';
			categoryCreate = false;
			notes = prefill.notes ?? '';
			repeats = prefill.repeat_interval != null && prefill.repeat_unit != null;
			repeatInterval = String(prefill.repeat_interval ?? 1);
			repeatUnit = prefill.repeat_unit ?? 'month';
			untilDate = '';
			forecastBehavior = prefill.forecast_behavior ?? 'bill';
			color = '';
			tagValues = [];
			tagSearch = '';
		} else {
			reset();
		}
	});

	function onTypeChange(newType: 'expense' | 'income') {
		if (newType === type) return;
		type = newType;
		const cat = categories.find((c) => String(c.id) === categoryId);
		if (cat && cat.type !== 'transfer' && cat.type !== newType) {
			categoryId = '';
			categoryCreate = false;
		}
	}

	const handleSubmit: SubmitFunction = ({ formData }) => {
		formData.set('id', editing ? String(editing.id) : '');
		formData.set('type', type);
		formData.set('name', name);
		formData.set('amount', amount);
		formData.set('start_date', startDate);
		formData.set('notes', notes);
		formData.set('color', color);
		formData.set('repeats', repeats ? '1' : '0');
		formData.set('repeat_interval', repeatInterval);
		formData.set('repeat_unit', repeatUnit);
		formData.set('until_date', repeats ? untilDate : '');
		formData.set('forecast_behavior', forecastBehavior);
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
	title={editing ? 'Edit scheduled expectation' : 'New scheduled expectation'}
	description={
		editing
			? undefined
			: 'A recurring or one-time expectation that shows on the calendar and feeds your cashflow forecast.'
	}
>
	{#if editing && deleteAction}
		<form id="sched-delete-form" method="POST" action={deleteAction} class="hidden">
			<input type="hidden" name="id" value={editing.id} />
		</form>
	{/if}
	<form method="POST" action={action} use:enhance={handleSubmit} class="flex flex-col gap-4">
		{#each Object.entries(extraHidden) as [k, v] (k)}
			<input type="hidden" name={k} value={v} />
		{/each}
		<div class="flex gap-2" role="radiogroup" aria-label="Expectation type">
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
			<Field label="Name or merchant">
				<Input type="text" bind:value={name} placeholder="e.g. Rent, Netflix" required />
			</Field>
			<Field label="Amount">
				<Input type="text" inputmode="decimal" bind:value={amount} placeholder="0.00" required autocomplete="off" />
			</Field>
		</div>

		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
			<Field label={editing ? 'Start date' : 'Date'}>
				<DatePicker bind:value={startDate} placeholder="Select date" />
			</Field>
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
		</div>

		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
			<Field label="Notes">
				<Input type="text" bind:value={notes} placeholder="Optional notes" />
			</Field>
		</div>

		<div class="rounded-md border border-border p-3">
			<label class="flex items-center gap-2 text-sm font-medium">
				<Checkbox bind:checked={repeats} label="Repeats" />
			</label>
			{#if repeats}
				<div class="mt-3 flex flex-wrap items-end gap-3">
					<Field label="Every" class="w-20">
						<Input type="text" inputmode="numeric" bind:value={repeatInterval} placeholder="1" />
					</Field>
					<Field label="Unit" class="w-32">
						<Select
							bind:value={repeatUnit}
							items={[
								{ value: 'day', label: 'day(s)' },
								{ value: 'week', label: 'week(s)' },
								{ value: 'month', label: 'month(s)' },
								{ value: 'year', label: 'year(s)' }
							]}
						/>
					</Field>
					<Field label="Until (optional)" class="flex-1">
						<DatePicker bind:value={untilDate} placeholder="No end date" />
					</Field>
				</div>
			{/if}
		</div>

		<Field label="Forecast behavior">
			<div class="flex gap-2" role="radiogroup" aria-label="Forecast behavior">
				<button
					type="button"
					onclick={() => (forecastBehavior = 'bill')}
					class="flex-1 rounded-md border px-3 py-2 text-left text-sm transition-colors {forecastBehavior === 'bill'
						? 'border-primary bg-primary/10'
						: 'border-border hover:bg-muted'}"
				>
					<span class="font-medium">Bill</span>
					<span class="block text-xs text-muted-foreground">Full amount on the due date</span>
				</button>
				<button
					type="button"
					onclick={() => (forecastBehavior = 'spread')}
					class="flex-1 rounded-md border px-3 py-2 text-left text-sm transition-colors {forecastBehavior === 'spread'
						? 'border-primary bg-primary/10'
						: 'border-border hover:bg-muted'}"
				>
					<span class="font-medium">Spread</span>
					<span class="block text-xs text-muted-foreground">Evenly across the repeat period</span>
				</button>
			</div>
		</Field>

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

		<div class="flex items-center gap-2">
			{#if editing && deleteAction}
				<Button
					variant="destructive"
					type="button"
					class="mr-auto"
					onclick={() => (document.getElementById('sched-delete-form') as HTMLFormElement | null)?.requestSubmit()}
				>
					Delete
				</Button>
			{/if}
			<Button variant="secondary" type="button" onclick={() => (open = false)}>Cancel</Button>
			<Button type="submit">{editing ? 'Save changes' : 'Add expectation'}</Button>
		</div>
	</form>
</Dialog>

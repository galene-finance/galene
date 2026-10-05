<script lang="ts">
	import Button from './ui/Button.svelte';
	import Input from './ui/Input.svelte';
	import Select from './ui/Select.svelte';
	import type { Account, Category, RuleField, RuleOp } from '$lib/types';

	export type DialogCondition = { field: RuleField; op: RuleOp; value: string; value2?: string };

	let {
		conditions = $bindable(),
		accounts,
		categories,
		allowEmpty = false,
		includeCategory = false,
		heading = 'Conditions',
		sub = 'All must match'
	}: {
		conditions: DialogCondition[];
		accounts: Account[];
		categories: Category[];
		/** Webhooks may fire on events alone. Rules still require one condition. */
		allowEmpty?: boolean;
		/** Category Is is a webhook field. Rules still ignore it. */
		includeCategory?: boolean;
		heading?: string;
		sub?: string;
	} = $props();

	const FIELD_ITEMS = $derived(
		[
			{ value: 'merchant', label: 'Merchant' },
			{ value: 'amount', label: 'Amount' },
			{ value: 'account', label: 'Account' },
			...(includeCategory ? [{ value: 'category', label: 'Category' }] : [])
		]
	);

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
		account: [{ value: 'equals', label: 'Is' }],
		category: [{ value: 'equals', label: 'Is' }]
	};

	const accountItems = $derived(accounts.map((a) => ({ value: String(a.id), label: a.name })));
	const categoryItems = $derived(
		[...categories].sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ value: String(c.id), label: c.name }))
	);

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

	function addCondition() {
		conditions.push({ field: 'merchant', op: 'contains', value: '' });
	}

	function removeCondition(i: number) {
		if (!allowEmpty && conditions.length <= 1) return;
		conditions.splice(i, 1);
	}
</script>

<div class="rounded-md border border-border bg-surface p-3">
	<p class="text-sm font-medium">
		{heading}
		<span class="ml-1 rounded-full bg-primary/10 px-2 py-0.5 text-[0.68rem] font-semibold uppercase tracking-wide text-primary">
			{sub}
		</span>
	</p>
	<div class="mt-2 flex flex-col gap-2.5">
		{#each conditions as cond, i (i)}
			<div class="rounded-[10px] border border-border bg-muted p-3">
				<div class="mb-2 flex items-center justify-between gap-2">
					<span
						class="rounded-full bg-primary/10 px-2 py-0.5 text-[0.68rem] font-semibold uppercase tracking-wide text-primary"
					>
						Condition {i + 1}
					</span>
					{#if allowEmpty || conditions.length > 1}
						<Button variant="ghost" size="sm" type="button" onclick={() => removeCondition(i)}>Remove</Button>
					{/if}
				</div>
				<div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
					<Select bind:value={cond.field} items={FIELD_ITEMS} class="w-full sm:w-32" />
					<Select bind:value={cond.op} items={OPS[cond.field]} class="w-full sm:w-36" />
					{#if cond.field === 'account'}
						<Select bind:value={cond.value} items={accountItems} placeholder="Select account" class="w-full min-w-40 sm:flex-1" />
					{:else if cond.field === 'category'}
						<Select
							bind:value={cond.value}
							items={categoryItems}
							placeholder="Select category"
							class="w-full min-w-40 sm:flex-1"
						/>
					{:else if cond.field === 'amount' && cond.op === 'between'}
						<Input bind:value={cond.value} inputmode="decimal" placeholder="Min" class="w-full min-w-24 sm:flex-1" />
						<Input bind:value={cond.value2} inputmode="decimal" placeholder="Max" class="w-full min-w-24 sm:flex-1" />
					{:else}
						<Input
							bind:value={cond.value}
							type="text"
							inputmode={cond.field === 'amount' ? 'decimal' : undefined}
							placeholder={cond.field === 'merchant' ? 'e.g. Kroger' : '0.00'}
							class="w-full min-w-40 sm:flex-1"
						/>
					{/if}
				</div>
			</div>
		{/each}
	</div>
	<Button variant="secondary" size="sm" type="button" class="mt-2 w-full border border-dashed" onclick={addCondition}>
		+ Add condition
	</Button>
</div>

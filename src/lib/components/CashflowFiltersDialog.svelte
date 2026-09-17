<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import MultiCombobox from '$lib/components/ui/MultiCombobox.svelte';
	import type { Account, Category } from '$lib/types';
	import type { CashflowViewFilters } from '$lib/types';

	let {
		open = $bindable(false),
		accounts,
		categories,
		filters,
		onSave
	}: {
		open?: boolean;
		accounts: Account[];
		categories: Category[];
		filters: CashflowViewFilters;
		onSave: (filters: CashflowViewFilters) => void;
	} = $props();

	// Local form state as string[] so bits-ui MultiCombobox can bind directly.
	let accountIds = $state<string[]>([]);
	let categoryIds = $state<string[]>([]);

	function init() {
		accountIds = filters.accountIds.map(String);
		categoryIds = filters.categoryIds.map(String);
	}
	init();

	$effect(() => {
		if (open) init();
	});

	const accountItems = $derived(accounts.map((a) => ({ value: String(a.id), label: a.name })));
	const categoryItems = $derived(
		categories.map((c) => ({
			value: String(c.id),
			label: c.type === 'transfer' ? `${c.name} (transfer)` : c.name
		}))
	);

	function buildFilters(): CashflowViewFilters {
		const toIds = (list: string[]) => {
			const ids = new Set<number>();
			for (const s of list) {
				const n = parseInt(s, 10);
				if (Number.isFinite(n) && n > 0) ids.add(n);
			}
			return [...ids].sort((a, b) => a - b);
		};
		return { accountIds: toIds(accountIds), categoryIds: toIds(categoryIds) };
	}

	function reset() {
		accountIds = [];
		categoryIds = [];
	}
</script>

<Dialog
	bind:open
	title="Cashflow filters"
	description="Choose which accounts and categories feed this page. Leave blank for all. Transfer categories stay out unless you pick them."
>
	<div class="flex flex-col gap-4">
		<Field label="Accounts">
			<MultiCombobox bind:value={accountIds} items={accountItems} placeholder="All accounts" />
		</Field>
		<Field label="Categories">
			<MultiCombobox bind:value={categoryIds} items={categoryItems} placeholder="All non-transfer categories" />
		</Field>
		<p class="text-xs text-muted-foreground">
			Empty means all accounts and all non-transfer categories. Transfer categories are excluded by
			default — select them here only if you want them in cashflow.
		</p>
	</div>

	<div class="mt-5 flex items-center gap-2">
		<Button variant="ghost" onclick={reset}>Reset</Button>
		<span class="flex-1"></span>
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
		<Button
			onclick={() => {
				onSave(buildFilters());
				open = false;
			}}>Save</Button
		>
	</div>
</Dialog>

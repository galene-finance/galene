<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import Checkbox from '$lib/components/ui/Checkbox.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import MultiCombobox from '$lib/components/ui/MultiCombobox.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import { WIDGET_CATALOG, clampInt } from '$lib/dashboard';
	import type {
		Account,
		AccountType,
		Category,
		DashboardFilters,
		DashboardWidget,
		NotificationKind,
		Tag
	} from '$lib/types';

	let {
		open = $bindable(false),
		widget,
		accounts,
		categories,
		tags,
		onSave
	}: {
		open?: boolean;
		widget: DashboardWidget;
		accounts: Account[];
		categories: Category[];
		tags: Tag[];
		onSave: (filters: DashboardFilters) => void;
	} = $props();

	const entry = WIDGET_CATALOG[widget.type];
	const f = entry.filters;
	const isTrends = widget.type === 'trends';

	const KINDS: { value: NotificationKind; label: string }[] = [
		{ value: 'sync_failed', label: 'Sync failed' },
		{ value: 'sync_recovered', label: 'Sync recovered' },
		{ value: 'budget_overrun', label: 'Budget overrun' },
		{ value: 'bill_upcoming', label: 'Bill upcoming' }
	];

	// Local form state, kept as strings (Select) / string[] (MultiCombobox) so
	// the bits-ui controls can bind to them directly.
	let accountIds = $state<string[]>([]);
	let categoryIds = $state<string[]>([]);
	let tagIds = $state<string[]>([]);
	let accountType = $state<'' | AccountType>('');
	let period = $state<'' | 'week' | 'month' | 'year'>('');
	let kindsChecked = $state<Record<string, boolean>>({});
	let unreadOnly = $state(false);
	let days = $state('14');
	let months = $state('6');
	let limit = $state('10');
	let trendCategory = $state('');

	function init() {
		accountIds = (widget.filters.accountIds ?? []).map(String);
		categoryIds = (widget.filters.categoryIds ?? []).map(String);
		tagIds = (widget.filters.tagIds ?? []).map(String);
		accountType = widget.filters.accountType ?? '';
		period = widget.filters.period ?? '';
		kindsChecked = Object.fromEntries(
			KINDS.map((k) => [k.value, widget.filters.kinds?.includes(k.value) ?? false])
		);
		unreadOnly = widget.filters.unreadOnly ?? false;
		days = String(widget.filters.days ?? 14);
		months = String(widget.filters.months ?? 6);
		limit = String(widget.filters.limit ?? 10);
		trendCategory = widget.filters.categoryIds?.[0] ? String(widget.filters.categoryIds[0]) : '';
	}
	init();

	const accountItems = $derived(accounts.map((a) => ({ value: String(a.id), label: a.name })));
	const categoryItems = $derived(categories.map((c) => ({ value: String(c.id), label: c.name })));
	const tagItems = $derived(tags.map((t) => ({ value: String(t.id), label: t.name })));
	const trendCategoryItems = $derived([
		{ value: '', label: 'All categories' },
		...categories.filter((c) => c.type === 'expense').map((c) => ({ value: String(c.id), label: c.name }))
	]);
	const accountTypeItems = $derived([
		{ value: '', label: 'All types' },
		...(['bank', 'credit', 'cash', 'investment', 'other'] as AccountType[]).map((t) => ({
			value: t,
			label: t.charAt(0).toUpperCase() + t.slice(1)
		}))
	]);
	const periodItems = $derived([
		{ value: '', label: 'All periods' },
		{ value: 'week', label: 'Week' },
		{ value: 'month', label: 'Month' },
		{ value: 'year', label: 'Year' }
	]);

	// A hand-edited layout could carry a value outside the preset list; keep it
	// selectable rather than silently showing the placeholder.
	function withCurrent(items: { value: string; label: string }[], current: string) {
		return items.some((i) => i.value === current) ? items : [...items, { value: current, label: current }];
	}
	const daysItems = $derived(
		withCurrent(
			[
				{ value: '7', label: '7 days' },
				{ value: '14', label: '14 days' },
				{ value: '30', label: '30 days' }
			],
			days
		)
	);
	const monthsItems = $derived(
		withCurrent(
			[
				{ value: '3', label: '3 months' },
				{ value: '6', label: '6 months' },
				{ value: '12', label: '12 months' }
			],
			months
		)
	);
	const limitItems = $derived(
		withCurrent(
			[
				{ value: '5', label: '5' },
				{ value: '10', label: '10' },
				{ value: '20', label: '20' }
			],
			limit
		)
	);

	function buildFilters(): DashboardFilters {
		const toIds = (list: string[]) => {
			const ids = new Set<number>();
			for (const s of list) {
				const n = parseInt(s, 10);
				if (Number.isFinite(n) && n > 0) ids.add(n);
			}
			return ids.size ? [...ids].sort((a, b) => a - b) : undefined;
		};
		const out: DashboardFilters = {};
		if (f.accountIds) out.accountIds = toIds(accountIds);
		if (f.categoryIds) out.categoryIds = toIds(isTrends ? (trendCategory ? [trendCategory] : []) : categoryIds);
		if (f.tagIds) out.tagIds = toIds(tagIds);
		if (f.accountType && accountType) out.accountType = accountType;
		if (f.period && period) out.period = period;
		if (f.kinds) {
			const k = KINDS.filter((x) => kindsChecked[x.value]).map((x) => x.value);
			if (k.length) out.kinds = k;
		}
		if (f.unreadOnly) out.unreadOnly = unreadOnly;
		if (f.days) out.days = clampInt(parseInt(days, 10), 1, 365, 14);
		if (f.months) out.months = clampInt(parseInt(months, 10), 1, 24, 6);
		if (f.limit) out.limit = clampInt(parseInt(limit, 10), 1, 100, 10);
		return out;
	}
</script>

<Dialog bind:open title={entry.label} description={entry.description}>
	<div class="flex flex-col gap-4">
		{#if f.accountType}
			<Field label="Account type">
				<Select bind:value={accountType} items={accountTypeItems} placeholder="All types" />
			</Field>
		{/if}
		{#if f.accountIds}
			<Field label="Accounts">
				<MultiCombobox bind:value={accountIds} items={accountItems} placeholder="All accounts" />
			</Field>
		{/if}
		{#if f.categoryIds}
			{#if isTrends}
				<Field label="Category">
					<Select bind:value={trendCategory} items={trendCategoryItems} placeholder="All categories" />
				</Field>
			{:else}
				<Field label="Categories">
					<MultiCombobox bind:value={categoryIds} items={categoryItems} placeholder="All categories" />
				</Field>
			{/if}
		{/if}
		{#if f.tagIds}
			<Field label="Tags">
				<MultiCombobox bind:value={tagIds} items={tagItems} placeholder="All tags" />
			</Field>
		{/if}
		{#if f.period}
			<Field label="Period">
				<Select bind:value={period} items={periodItems} placeholder="All periods" />
			</Field>
		{/if}
		{#if f.kinds}
			<Field label="Kinds">
				<div class="flex flex-col gap-2">
					{#each KINDS as k (k.value)}
						<label class="flex cursor-pointer items-center gap-2">
							<Checkbox bind:checked={kindsChecked[k.value]} />
							<span class="text-sm">{k.label}</span>
						</label>
					{/each}
				</div>
			</Field>
		{/if}
		{#if f.unreadOnly}
			<label class="flex cursor-pointer items-center gap-2">
				<Checkbox bind:checked={unreadOnly} />
				<span class="text-sm">Unread only</span>
			</label>
		{/if}
		{#if f.days}
			<Field label="Look-ahead">
				<Select bind:value={days} items={daysItems} placeholder="Days" />
			</Field>
		{/if}
		{#if f.months}
			<Field label="Months shown">
				<Select bind:value={months} items={monthsItems} placeholder="Months" />
			</Field>
		{/if}
		{#if f.limit}
			<Field label="How many">
				<Select bind:value={limit} items={limitItems} placeholder="Count" />
			</Field>
		{/if}
	</div>

	<div class="mt-5 flex items-center gap-2">
		<Button variant="ghost" onclick={init}>Reset</Button>
		<span class="flex-1"></span>
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
		<Button onclick={() => onSave(buildFilters())}>Save</Button>
	</div>
</Dialog>

<script lang="ts">
	import { untrack } from 'svelte';
	import AddScheduledDialog from '$lib/components/AddScheduledDialog.svelte';
	import AddTransactionDialog from '$lib/components/AddTransactionDialog.svelte';
	import Title from '$lib/components/Title.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Checkbox from '$lib/components/ui/Checkbox.svelte';
	import {
		scheduledPillRows,
		transactionPillRows,
		popupPosition,
		estimatedPopupHeight,
		type PillPopupRow
	} from '$lib/calendarPillPopup';
	import { toastFormResult } from '$lib/toasts';
	import { formatMoney, monthLabel, todayISO } from '$lib/utils';
	import type { Account, Category, Scheduled, Tag, Transaction } from '$lib/types';

	let { form, data }: {
		form: { error?: string | null } | undefined;
		data: {
			month: string;
			transactions: Transaction[];
			occurrences: { scheduled: Scheduled; date: string }[];
			hideActuals: boolean;
			weekStartsOn: 'sunday' | 'monday';
			accounts: Account[];
			categories: Category[];
			tags: Tag[];
		};
	} = $props();

	let hideForm = $state<HTMLFormElement | null>(null);

	function monthShift(month: string, delta: number): string {
		const [y, m] = month.split('-').map(Number);
		const t = m - 1 + delta;
		const ny = y + Math.floor(t / 12);
		const nm = ((t % 12) + 12) % 12 + 1;
		return `${ny}-${String(nm).padStart(2, '0')}`;
	}

	const [year, monthNum] = $derived(data.month.split('-').map(Number));
	const firstDow = $derived(new Date(Date.UTC(year, monthNum - 1, 1)).getUTCDay());
	// Days to step back from the 1st to reach the configured week start.
	const startOffset = $derived(data.weekStartsOn === 'monday' ? (firstDow + 6) % 7 : firstDow);
	const dayLabels = $derived(
		data.weekStartsOn === 'monday'
			? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
			: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
	);
	const daysInMonth = $derived(new Date(Date.UTC(year, monthNum, 0)).getUTCDate());
	const prevMonth = $derived(monthShift(data.month, -1));
	const nextMonth = $derived(monthShift(data.month, 1));
	const thisMonth = $derived(todayISO().slice(0, 7));
	const today = $derived(todayISO());

	function buildCells() {
		const txMap = new Map<string, Transaction[]>();
		for (const t of data.transactions) {
			const list = txMap.get(t.date) ?? [];
			list.push(t);
			txMap.set(t.date, list);
		}
		const occMap = new Map<string, { scheduled: Scheduled }[]>();
		for (const o of data.occurrences) {
			const list = occMap.get(o.date) ?? [];
			list.push({ scheduled: o.scheduled });
			occMap.set(o.date, list);
		}
		const total = Math.ceil((startOffset + daysInMonth) / 7) * 7;
		const out: {
			iso: string;
			day: number;
			inMonth: boolean;
			transactions: Transaction[];
			occurrences: { scheduled: Scheduled }[];
		}[] = [];
		for (let i = 0; i < total; i++) {
			const d = new Date(Date.UTC(year, monthNum - 1, 1 - startOffset + i));
			const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
				d.getUTCDate()
			).padStart(2, '0')}`;
			out.push({
				iso,
				day: d.getUTCDate(),
				inMonth: d.getUTCMonth() === monthNum - 1,
				transactions: txMap.get(iso) ?? [],
				occurrences: occMap.get(iso) ?? []
			});
		}
		return out;
	}

	const cells = $derived(buildCells());

	// --- Dialogs ---
	let scheduledOpen = $state(false);
	let scheduledEditing = $state<Scheduled | null>(null);
	let scheduledPrefill = $state<string | null>(null);
	let txOpen = $state(false);

	function openScheduledFor(date: string) {
		hidePillPopup();
		scheduledEditing = null;
		scheduledPrefill = date;
		scheduledOpen = true;
	}

	function openNewScheduled() {
		hidePillPopup();
		scheduledEditing = null;
		scheduledPrefill = todayISO();
		scheduledOpen = true;
	}

	function openScheduledEdit(s: Scheduled) {
		hidePillPopup();
		scheduledEditing = s;
		scheduledPrefill = null;
		scheduledOpen = true;
	}

	function closeScheduled() {
		scheduledEditing = null;
		scheduledPrefill = null;
	}

	const PILL_POPUP_ID = 'calendar-pill-popup';
	let popup = $state<{ rows: PillPopupRow[]; top: number; left: number } | null>(null);
	let popupSource: HTMLElement | null = null;

	function showPillPopup(el: EventTarget | null, rows: PillPopupRow[]) {
		if (!(el instanceof HTMLElement) || rows.length === 0) {
			hidePillPopup();
			return;
		}
		if (popupSource && popupSource !== el) popupSource.removeAttribute('aria-describedby');
		el.setAttribute('aria-describedby', PILL_POPUP_ID);
		popupSource = el;
		const pos = popupPosition(
			el.getBoundingClientRect(),
			{
				width: window.innerWidth,
				height: window.innerHeight
			},
			estimatedPopupHeight(rows.length)
		);
		popup = { rows, ...pos };
	}

	function hidePillPopup() {
		if (popupSource) popupSource.removeAttribute('aria-describedby');
		popupSource = null;
		popup = null;
	}

	function hidePillPopupOnLeave(el: EventTarget | null) {
		if (el instanceof HTMLElement && document.activeElement === el) return;
		hidePillPopup();
	}

	$effect(() => {
		const hide = () => hidePillPopup();
		window.addEventListener('scroll', hide, true);
		window.addEventListener('resize', hide);
		return () => {
			window.removeEventListener('scroll', hide, true);
			window.removeEventListener('resize', hide);
		};
	});

	// Toast the latest action result (replaces the old top-of-page status block).
	let lastForm = untrack(() => form);
	$effect(() => {
		if (form === lastForm) return;
		lastForm = form;
		toastFormResult(form);
	});
</script>

<Title title="Calendar" />

<div class="mx-auto flex max-w-6xl flex-col gap-4 2xl:max-w-7xl">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div class="flex items-center gap-2">
			<h1 class="text-2xl font-semibold tracking-tight">{monthLabel(`${data.month}-01`)}</h1>
			<div class="ml-1 flex items-center gap-1">
				<a
					href="/calendar?month={prevMonth}"
					class="rounded-md border border-border px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
					aria-label="Previous month"
				>
					←
				</a>
				{#if data.month !== thisMonth}
					<a
						href="/calendar?month={thisMonth}"
						class="rounded-md border border-border px-2.5 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
					>
						Today
					</a>
				{/if}
				<a
					href="/calendar?month={nextMonth}"
					class="rounded-md border border-border px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
					aria-label="Next month"
				>
					→
				</a>
			</div>
		</div>
		<div class="flex flex-wrap items-center gap-3">
			<form method="POST" action="?/set-hide-actuals" class="flex items-center gap-2" bind:this={hideForm}>
				<!-- Bits Checkbox is a type="button" element, so submit the form explicitly on change.
				 The hidden input's checked state is set directly because Svelte may not have
				 flushed it to the DOM by the time the deferred submit runs. -->
				<Checkbox
					bind:checked={data.hideActuals}
					label="Hide actuals"
					name="hide_actuals"
					onCheckedChange={(v: unknown) => {
						const input = hideForm?.querySelector('input[name="hide_actuals"]') as HTMLInputElement | null;
						if (input) input.checked = Boolean(v);
						setTimeout(() => hideForm?.requestSubmit(), 0);
					}}
				/>
			</form>
			<a
				href="/recurring"
				class="inline-flex h-9 items-center justify-center rounded-md border border-border bg-surface px-4 text-sm font-medium hover:bg-muted"
			>Find recurring bills</a>
			<Button variant="secondary" type="button" onclick={openNewScheduled}>+ New scheduled</Button>
			<Button type="button" onclick={() => (txOpen = true)}>+ Add transaction</Button>
		</div>
	</div>

	<div class="galene-scroll-x min-w-0 max-w-full overflow-x-auto rounded-lg border border-border">
		<div class="grid min-w-[840px] grid-cols-7 gap-px bg-border">
			{#each dayLabels as d}
				<div class="bg-surface px-2 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
					{d}
				</div>
			{/each}
			{#each cells as cell (cell.iso)}
				{@const shownTx = data.hideActuals ? [] : cell.transactions}
				{@const shown = [...shownTx.slice(0, 3).map((t) => ({ kind: 'tx' as const, t })),
					...cell.occurrences.slice(0, 3).map((o) => ({ kind: 'occ' as const, o }))]}
				{@const hidden = (data.hideActuals ? 0 : cell.transactions.length) +
					cell.occurrences.length -
					shown.length}
				<div class="relative flex min-h-28 flex-col bg-surface p-1.5 text-left align-top transition-colors hover:bg-muted/50">
					<button
						type="button"
						class="absolute inset-0 z-0"
						onclick={() => openScheduledFor(cell.iso)}
						title="Click to add a scheduled expectation on this day"
						aria-label="Add a scheduled expectation on {cell.iso}"
					></button>
					<span
						class="pointer-events-none relative z-10 inline-flex min-w-6 items-center justify-center self-start rounded-full px-1.5 text-xs {cell.iso ===
						today
							? 'bg-primary font-semibold text-primary-foreground'
							: cell.inMonth
								? 'font-medium'
								: 'text-muted-foreground/60'}"
					>
						{cell.day}
					</span>
					<div class="pointer-events-none relative z-10 mt-1 flex flex-col gap-1">
						{#each shown as item (item.kind + (item.kind === 'tx' ? item.t.id : item.o.scheduled.id))}
							{#if item.kind === 'tx'}
								<button
									type="button"
									class="pointer-events-auto flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-left text-xs"
									style="border-left: 3px solid {item.t.color ?? item.t.category_color ?? 'transparent'}"
									onpointerenter={(e) => showPillPopup(e.currentTarget, transactionPillRows(item.t))}
									onpointerleave={(e) => hidePillPopupOnLeave(e.currentTarget)}
									onfocus={(e) => showPillPopup(e.currentTarget, transactionPillRows(item.t))}
									onblur={hidePillPopup}
								>
									<span class="truncate">{item.t.merchant ?? item.t.category_name ?? 'Transaction'}</span>
									<span class="ml-auto shrink-0 font-medium {item.t.amount_cents > 0 ? 'text-success' : ''}">
										{formatMoney(item.t.amount_cents)}
									</span>
								</button>
							{:else}
								<button
									type="button"
									class="pointer-events-auto flex cursor-pointer items-center gap-1 rounded border border-dashed px-1.5 py-0.5 text-left text-xs {item
										.o.scheduled.color
										? ''
										: 'border-primary/60 bg-primary/10'}"
									style={item.o.scheduled.color
										? `border-color: ${item.o.scheduled.color}; background: ${item.o.scheduled.color}1a`
										: undefined}
									onclick={() => openScheduledEdit(item.o.scheduled)}
									onpointerenter={(e) => showPillPopup(e.currentTarget, scheduledPillRows(item.o.scheduled))}
									onpointerleave={(e) => hidePillPopupOnLeave(e.currentTarget)}
									onfocus={(e) => showPillPopup(e.currentTarget, scheduledPillRows(item.o.scheduled))}
									onblur={hidePillPopup}
								>
									{#if item.o.scheduled.repeat_interval}
										<svg
											class="size-3 shrink-0"
											style="color: {item.o.scheduled.color ?? 'var(--color-primary)'}"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2"
											stroke-linecap="round"
										>
											<path d="M21 12a9 9 0 1 1-2.64-6.36" />
											<path d="M21 3v6h-6" />
										</svg>
									{/if}
									<span class="truncate">{item.o.scheduled.name}</span>
									<span
										class="ml-auto shrink-0 font-medium"
										style="color: {item.o.scheduled.color ?? 'var(--color-primary)'}"
									>
										{formatMoney(item.o.scheduled.amount_cents)}
									</span>
								</button>
							{/if}
						{/each}
						{#if hidden > 0}
							<span class="pointer-events-none px-1.5 text-xs text-muted-foreground">+{hidden} more</span>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	</div>

	<p class="text-xs text-muted-foreground">
		Dashed pills are scheduled expectations — click a day to add one.
	</p>
</div>

{#if popup}
	<div
		id={PILL_POPUP_ID}
		role="tooltip"
		class="pointer-events-none fixed z-50 w-56 rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-lg"
		style="top: {popup.top}px; left: {popup.left}px"
	>
		<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
			{#each popup.rows as row (row.label)}
				<dt class="text-muted-foreground">{row.label}</dt>
				<dd class="min-w-0 break-words font-medium">{row.value}</dd>
			{/each}
		</dl>
	</div>
{/if}

<AddTransactionDialog
	bind:open={txOpen}
	editing={null}
	accounts={data.accounts}
	categories={data.categories}
	tags={data.tags}
	{form}
/>

<AddScheduledDialog
	bind:open={scheduledOpen}
	editing={scheduledEditing}
	prefillDate={scheduledPrefill}
	accounts={data.accounts}
	categories={data.categories}
	tags={data.tags}
	{form}
	deleteAction="?/delete-scheduled"
	onclose={closeScheduled}
/>

<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
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
		pillPopupUsesTapToggle,
		nextPillTapAction,
		type PillPopupRow
	} from '$lib/calendarPillPopup';
	import {
		MOBILE_VIEW_STORAGE_KEY,
		dayBookedCents,
		dayCardDateLabel,
		dayHasBooked,
		dayHasScheduled,
		dayTotalLabel,
		defaultSelectedIso,
		dowShort,
		firstScheduleColor,
		otherWeekDaysWithActivity,
		parseMobileView,
		softFill,
		weekContaining,
		type MobileCalendarView
	} from '$lib/calendarMobile';
	import {
		splitDayGridItems,
		estimatedOverflowHeight,
		overflowPanelPosition
	} from '$lib/calendarDayOverflow';
	import { watchFormToast } from '$lib/formToast.svelte';
	import { formatDate, formatMoney, monthLabel, todayISO } from '$lib/utils';
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

	type Cell = {
		iso: string;
		day: number;
		inMonth: boolean;
		transactions: Transaction[];
		occurrences: { scheduled: Scheduled; date: string }[];
	};

	function buildCells(): Cell[] {
		const txMap = new Map<string, Transaction[]>();
		for (const t of data.transactions) {
			const list = txMap.get(t.date) ?? [];
			list.push(t);
			txMap.set(t.date, list);
		}
		const occMap = new Map<string, { scheduled: Scheduled; date: string }[]>();
		for (const o of data.occurrences) {
			const list = occMap.get(o.date) ?? [];
			list.push({ scheduled: o.scheduled, date: o.date });
			occMap.set(o.date, list);
		}
		const total = Math.ceil((startOffset + daysInMonth) / 7) * 7;
		const out: Cell[] = [];
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
	const cellByIso = $derived(new Map(cells.map((c) => [c.iso, c])));

	function cellFor(iso: string): Cell {
		const hit = cellByIso.get(iso);
		if (hit) return hit;
		const [y, m, d] = iso.split('-').map(Number);
		return {
			iso,
			day: d,
			inMonth: `${y}-${String(m).padStart(2, '0')}` === data.month,
			transactions: [],
			occurrences: []
		};
	}

	// --- Narrow D2 stack (#149) ---
	let mobileView = $state<MobileCalendarView>('stack');
	let miniMonthOpen = $state(true);
	let selectedIso = $state('');

	$effect(() => {
		if (!browser) return;
		try {
			const saved = parseMobileView(localStorage.getItem(MOBILE_VIEW_STORAGE_KEY));
			if (saved) mobileView = saved;
		} catch {
			/* ignore */
		}
	});

	function setMobileView(next: MobileCalendarView) {
		mobileView = next;
		if (!browser) return;
		try {
			localStorage.setItem(MOBILE_VIEW_STORAGE_KEY, next);
		} catch {
			/* ignore */
		}
	}

	const SELECT_PENDING_KEY = 'galene_calendar_select';

	// Keep selection in the loaded month; prefer today when it fits.
	// Out-of-month picks stash the ISO so it survives the month navigation.
	$effect(() => {
		const month = data.month;
		const t = todayISO();
		if (browser) {
			try {
				const pending = sessionStorage.getItem(SELECT_PENDING_KEY);
				if (pending?.startsWith(month)) {
					sessionStorage.removeItem(SELECT_PENDING_KEY);
					selectedIso = pending;
					return;
				}
			} catch {
				/* ignore */
			}
		}
		const cur = untrack(() => selectedIso);
		if (!cur.startsWith(month)) {
			selectedIso = defaultSelectedIso(month, t);
		}
	});

	const weekIsos = $derived(weekContaining(selectedIso || `${data.month}-01`, data.weekStartsOn));
	const weekCells = $derived(weekIsos.map((iso) => cellFor(iso)));
	const selectedCell = $derived(cellFor(selectedIso || `${data.month}-01`));
	const otherWeekCells = $derived(
		otherWeekDaysWithActivity(weekCells, selectedCell.iso, data.hideActuals)
	);

	function selectDay(iso: string) {
		const monthOf = iso.slice(0, 7);
		if (monthOf !== data.month) {
			if (browser) {
				try {
					sessionStorage.setItem(SELECT_PENDING_KEY, iso);
				} catch {
					/* ignore */
				}
			}
			void goto(`/calendar?month=${monthOf}`);
			return;
		}
		selectedIso = iso;
	}

	const DAY_OVERFLOW_ID = 'calendar-day-overflow';
	type DayOverflowItem =
		| { kind: 'tx'; t: Transaction }
		| { kind: 'occ'; o: { scheduled: Scheduled; date: string } };
	let dayOverflow = $state<{
		iso: string;
		items: DayOverflowItem[];
		top: number;
		left: number;
	} | null>(null);
	let dayOverflowSource: HTMLElement | null = null;

	function hideDayOverflow() {
		if (dayOverflowSource) {
			dayOverflowSource.removeAttribute('aria-expanded');
			dayOverflowSource.removeAttribute('aria-controls');
		}
		dayOverflowSource = null;
		dayOverflow = null;
	}

	function toggleDayOverflow(e: MouseEvent, iso: string, truncated: DayOverflowItem[]) {
		e.preventDefault();
		e.stopPropagation();
		hidePillPopup();
		const el = e.currentTarget;
		if (!(el instanceof HTMLElement) || truncated.length === 0) {
			hideDayOverflow();
			return;
		}
		if (dayOverflowSource === el && dayOverflow?.iso === iso) {
			hideDayOverflow();
			return;
		}
		if (dayOverflowSource && dayOverflowSource !== el) {
			dayOverflowSource.removeAttribute('aria-expanded');
			dayOverflowSource.removeAttribute('aria-controls');
		}
		el.setAttribute('aria-expanded', 'true');
		el.setAttribute('aria-controls', DAY_OVERFLOW_ID);
		dayOverflowSource = el;
		const pos = overflowPanelPosition(
			el.getBoundingClientRect(),
			{ width: window.innerWidth, height: window.innerHeight },
			estimatedOverflowHeight(truncated.length)
		);
		dayOverflow = { iso, items: truncated, ...pos };
	}

	// --- Dialogs ---
	let scheduledOpen = $state(false);
	let scheduledEditing = $state<Scheduled | null>(null);
	let scheduledOccurrence = $state<string | null>(null);
	let scheduledPrefill = $state<string | null>(null);
	let txOpen = $state(false);

	function openScheduledFor(date: string) {
		hidePillPopup();
		hideDayOverflow();
		scheduledEditing = null;
		scheduledOccurrence = null;
		scheduledPrefill = date;
		scheduledOpen = true;
	}

	function openNewScheduled() {
		hidePillPopup();
		hideDayOverflow();
		scheduledEditing = null;
		scheduledOccurrence = null;
		scheduledPrefill = todayISO();
		scheduledOpen = true;
	}

	function openScheduledEdit(s: Scheduled, date: string) {
		hidePillPopup();
		hideDayOverflow();
		scheduledEditing = s;
		scheduledOccurrence = date;
		scheduledPrefill = null;
		scheduledOpen = true;
	}

	function closeScheduled() {
		scheduledEditing = null;
		scheduledOccurrence = null;
		scheduledPrefill = null;
	}

	const PILL_POPUP_ID = 'calendar-pill-popup';
	let popup = $state<{ rows: PillPopupRow[]; top: number; left: number } | null>(null);
	let popupSource: HTMLElement | null = null;
	/** Touch-first: sticky tap open/close instead of hover/long-press. */
	let tapToggle = $state(false);

	$effect(() => {
		if (!browser) return;
		const mql = window.matchMedia('(hover: none)');
		const sync = () => {
			tapToggle = pillPopupUsesTapToggle(mql.matches);
		};
		sync();
		mql.addEventListener('change', sync);
		return () => mql.removeEventListener('change', sync);
	});

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
		if (tapToggle) return;
		if (el instanceof HTMLElement && document.activeElement === el) return;
		hidePillPopup();
	}

	function onPillPointerEnter(el: EventTarget | null, rows: PillPopupRow[]) {
		if (tapToggle) return;
		showPillPopup(el, rows);
	}

	function onPillFocus(el: EventTarget | null, rows: PillPopupRow[]) {
		// Touch tap focuses then blurs — that flash is why sticky tap-toggle exists.
		if (tapToggle) return;
		showPillPopup(el, rows);
	}

	function onPillBlur() {
		if (tapToggle) return;
		hidePillPopup();
	}

	/** Mobile: tap toggles sticky popup. Desktop: optional click (scheduled edit). */
	function onPillClick(
		e: MouseEvent,
		rows: PillPopupRow[],
		onDesktopClick?: () => void
	) {
		if (!tapToggle) {
			onDesktopClick?.();
			return;
		}
		e.preventDefault();
		e.stopPropagation();
		const el = e.currentTarget;
		if (!(el instanceof HTMLElement)) return;
		const action = nextPillTapAction(popupSource, el, popup != null);
		if (action === 'hide') hidePillPopup();
		else showPillPopup(el, rows);
	}

	$effect(() => {
		const hide = () => {
			hidePillPopup();
			hideDayOverflow();
		};
		window.addEventListener('scroll', hide, true);
		window.addEventListener('resize', hide);
		return () => {
			window.removeEventListener('scroll', hide, true);
			window.removeEventListener('resize', hide);
		};
	});

	// Tap-elsewhere closes sticky popup (opening click must not immediately dismiss).
	$effect(() => {
		if (!browser || !tapToggle || !popup) return;
		const onPointerDown = (e: PointerEvent) => {
			const t = e.target;
			if (!(t instanceof Node)) return;
			if (popupSource?.contains(t)) return;
			const tip = document.getElementById(PILL_POPUP_ID);
			if (tip?.contains(t)) return;
			hidePillPopup();
		};
		const id = window.setTimeout(() => {
			window.addEventListener('pointerdown', onPointerDown, true);
		}, 0);
		return () => {
			window.clearTimeout(id);
			window.removeEventListener('pointerdown', onPointerDown, true);
		};
	});


	// Outside click / Escape closes day overflow.
	$effect(() => {
		if (!browser || !dayOverflow) return;
		const onPointerDown = (e: PointerEvent) => {
			const t = e.target;
			if (!(t instanceof Node)) return;
			if (dayOverflowSource?.contains(t)) return;
			const panel = document.getElementById(DAY_OVERFLOW_ID);
			if (panel?.contains(t)) return;
			hideDayOverflow();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') hideDayOverflow();
		};
		const id = window.setTimeout(() => {
			window.addEventListener('pointerdown', onPointerDown, true);
			window.addEventListener('keydown', onKey, true);
		}, 0);
		return () => {
			window.clearTimeout(id);
			window.removeEventListener('pointerdown', onPointerDown, true);
			window.removeEventListener('keydown', onKey, true);
		};
	});

	function shownItems(cell: Cell) {
		const shownTx = data.hideActuals ? [] : cell.transactions;
		return [
			...shownTx.map((t) => ({ kind: 'tx' as const, t })),
			...cell.occurrences.map((o) => ({ kind: 'occ' as const, o }))
		];
	}

	function gridShown(cell: Cell) {
		return splitDayGridItems(cell.transactions, cell.occurrences, data.hideActuals);
	}


	// Toast the latest action result (replaces the old top-of-page status block).
	watchFormToast(() => form);
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
			<a href="/scheduled" class="text-sm font-medium text-primary underline-offset-2 hover:underline">Scheduled</a>
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

	<!-- Narrow only: Agenda stack (D2) vs Month grid. Preference in localStorage. -->
	<div
		class="flex md:hidden"
		role="group"
		aria-label="Calendar layout"
	>
		<button
			type="button"
			class="flex-1 rounded-l-md border px-3 py-2 text-sm font-medium transition-colors {mobileView ===
			'stack'
				? 'border-primary/40 bg-primary/15 text-primary'
				: 'border-border bg-surface text-muted-foreground hover:bg-muted hover:text-foreground'}"
			aria-pressed={mobileView === 'stack'}
			onclick={() => setMobileView('stack')}
		>
			Agenda stack
		</button>
		<button
			type="button"
			class="flex-1 rounded-r-md border border-l-0 px-3 py-2 text-sm font-medium transition-colors {mobileView ===
			'month'
				? 'border-primary/40 bg-primary/15 text-primary'
				: 'border-border bg-surface text-muted-foreground hover:bg-muted hover:text-foreground'}"
			aria-pressed={mobileView === 'month'}
			onclick={() => setMobileView('month')}
		>
			Month
		</button>
	</div>

	{#if mobileView === 'stack'}
		<!-- D2: mini-month → week strip → selected day card → other week day cards -->
		<div class="flex flex-col gap-3 md:hidden">
			<!-- 1) Mini-month -->
			<div class="rounded-xl border border-border bg-surface px-3 py-2.5">
				<button
					type="button"
					class="flex w-full items-center justify-between text-xs font-semibold text-muted-foreground"
					aria-expanded={miniMonthOpen}
					onclick={() => (miniMonthOpen = !miniMonthOpen)}
				>
					<span>Jump · {monthLabel(`${data.month}-01`)}</span>
					<span class="font-medium text-primary">{miniMonthOpen ? 'Hide ▴' : 'Show ▾'}</span>
				</button>
				{#if miniMonthOpen}
					<div class="mt-2 grid grid-cols-7 gap-0.5 text-center" aria-label="Jump to date">
						{#each dayLabels as d}
							<span class="py-0.5 text-[0.55rem] font-semibold uppercase tracking-wide text-muted-foreground/70"
								>{d.slice(0, 1)}</span
							>
						{/each}
						{#each cells as cell (cell.iso)}
							{@const hasTx = dayHasBooked(cell.transactions, data.hideActuals)}
							{@const hasSched = dayHasScheduled(cell.occurrences)}
							{@const schedColor = firstScheduleColor(cell.occurrences)}
							{@const selected = cell.iso === selectedCell.iso}
							<button
								type="button"
								class="relative rounded-md py-1 text-[0.7rem] font-medium {selected
									? 'bg-primary/20 font-semibold text-primary'
									: cell.inMonth
										? 'text-muted-foreground hover:bg-muted'
										: 'text-muted-foreground/40 hover:bg-muted/50'}"
								aria-label="Select {cell.iso}"
								aria-current={selected ? 'date' : undefined}
								onclick={() => selectDay(cell.iso)}
							>
								{cell.day}
								{#if hasTx || hasSched}
									<span
										class="mx-auto mt-0.5 block size-1 rounded-full"
										style="background: {hasSched
											? (schedColor ?? 'var(--color-primary)')
											: 'var(--color-primary)'}"
										aria-hidden="true"
									></span>
								{/if}
							</button>
						{/each}
					</div>
				{/if}
			</div>

			<!-- 2) Week strip -->
			<div class="flex gap-1.5" role="tablist" aria-label="Week days">
				{#each weekCells as cell (cell.iso)}
					{@const hasTx = dayHasBooked(cell.transactions, data.hideActuals)}
					{@const hasSched = dayHasScheduled(cell.occurrences)}
					{@const schedColor = firstScheduleColor(cell.occurrences)}
					{@const selected = cell.iso === selectedCell.iso}
					<button
						type="button"
						role="tab"
						aria-selected={selected}
						aria-label="{dowShort(cell.iso)} {cell.day}"
						class="flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-lg border px-1 py-2 {selected
							? 'border-primary/50 bg-primary/15 text-primary'
							: 'border-border bg-surface text-muted-foreground hover:bg-muted/50'}"
						onclick={() => selectDay(cell.iso)}
					>
						<span class="text-[0.58rem] font-semibold uppercase tracking-wide">{dowShort(cell.iso)}</span>
						<span class="text-[0.95rem] font-semibold leading-tight {selected ? 'text-primary' : 'text-foreground'}"
							>{cell.day}</span
						>
						<span
							class="mt-0.5 size-1 rounded-full {hasTx || hasSched ? '' : 'bg-transparent'}"
							style={hasTx || hasSched
								? `background: ${hasSched ? (schedColor ?? 'var(--color-primary)') : 'var(--color-primary)'}`
								: undefined}
							aria-hidden="true"
						></span>
					</button>
				{/each}
			</div>

			<!-- 3) Selected day card -->
			{#if selectedCell}
			{@const selItems = shownItems(selectedCell)}
			{@const selBooked = dayBookedCents(selectedCell.transactions, data.hideActuals)}
			<article
				class="relative rounded-xl border border-primary/40 bg-surface p-3.5 shadow-[0_0_0_1px_rgba(13,148,136,0.12)]"
				aria-label="Selected day"
			>
				<button
					type="button"
					class="absolute inset-0 z-0 rounded-xl"
					onclick={() => openScheduledFor(selectedCell.iso)}
					aria-label="Add a scheduled expectation on {selectedCell.iso}"
				></button>
				<div class="relative z-10 mb-1 flex items-baseline justify-between gap-2">
					<div class="text-sm font-semibold tracking-tight">
						{dayCardDateLabel(selectedCell.iso)}
						{#if selectedCell.iso === today}
							<span
								class="ml-1 inline-flex align-middle rounded-full border border-primary/30 bg-primary/15 px-1.5 py-0.5 text-[0.58rem] font-bold uppercase tracking-wide text-primary"
								>Today</span
							>
						{/if}
					</div>
					<div class="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
						{dayTotalLabel(selBooked, selectedCell.occurrences.length, data.hideActuals)}
					</div>
				</div>
				{#if selItems.length === 0}
					<p class="relative z-10 py-4 text-center text-sm text-muted-foreground/80">
						Nothing on this day — tap to add a scheduled item.
					</p>
				{:else}
					<div class="relative z-10 flex flex-col">
						{#each selItems as item (item.kind + (item.kind === 'tx' ? item.t.id : item.o.scheduled.id))}
							{#if item.kind === 'tx'}
								<button
									type="button"
									class="pointer-events-auto flex select-none items-center justify-between gap-2 border-b border-border py-2.5 text-left last:border-b-0 [-webkit-touch-callout:none]"
									onpointerenter={(e) => onPillPointerEnter(e.currentTarget, transactionPillRows(item.t))}
									onpointerleave={(e) => hidePillPopupOnLeave(e.currentTarget)}
									onfocus={(e) => onPillFocus(e.currentTarget, transactionPillRows(item.t))}
									onblur={onPillBlur}
									onclick={(e) => onPillClick(e, transactionPillRows(item.t))}
								>
									<div class="min-w-0 flex-1">
										<div class="truncate text-sm font-medium">
											{item.t.merchant ?? item.t.category_name ?? 'Transaction'}
										</div>
										{#if item.t.category_name}
											<div class="mt-1">
												<span
													class="inline-flex rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[0.62rem] font-semibold uppercase tracking-wide text-muted-foreground"
													>{item.t.category_name}</span
												>
											</div>
										{/if}
									</div>
									<div
										class="shrink-0 text-sm font-semibold tabular-nums {item.t.amount_cents > 0
											? 'text-success'
											: ''}"
									>
										{formatMoney(item.t.amount_cents)}
									</div>
								</button>
							{:else}
								{@const sc = item.o.scheduled.color}
								<button
									type="button"
									class="pointer-events-auto relative my-1.5 flex select-none items-center justify-between gap-2 rounded-lg border border-dashed px-3 py-2.5 pl-3.5 text-left [-webkit-touch-callout:none]"
									style="border-color: {sc ?? 'color-mix(in oklab, var(--color-primary) 60%, transparent)'}; background: {softFill(
										sc
									) ??
										'color-mix(in oklab, var(--color-primary) 10%, transparent)'}"
									onclick={(e) => onPillClick(e, scheduledPillRows(item.o.scheduled), () => openScheduledEdit(item.o.scheduled, item.o.date))}
									onpointerenter={(e) => onPillPointerEnter(e.currentTarget, scheduledPillRows(item.o.scheduled))}
									onpointerleave={(e) => hidePillPopupOnLeave(e.currentTarget)}
									onfocus={(e) => onPillFocus(e.currentTarget, scheduledPillRows(item.o.scheduled))}
									onblur={onPillBlur}
								>
									<span
										class="absolute bottom-1.5 left-0 top-1.5 w-0.5 rounded-r"
										style="background: {sc ?? 'var(--color-primary)'}"
										aria-hidden="true"
									></span>
									<div class="min-w-0 flex-1">
										<div class="truncate text-sm font-medium">{item.o.scheduled.name}</div>
										<div class="mt-1 flex flex-wrap gap-1">
											{#if item.o.scheduled.category_name}
												<span
													class="inline-flex rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[0.62rem] font-semibold uppercase tracking-wide text-muted-foreground"
													>{item.o.scheduled.category_name}</span
												>
											{/if}
											<span
												class="inline-flex rounded-full border border-dashed px-2 py-0.5 text-[0.62rem] font-semibold"
												style="border-color: {sc ??
													'color-mix(in oklab, var(--color-primary) 42%, transparent)'}; color: {sc ??
													'var(--color-primary)'}; background: {softFill(sc) ??
													'color-mix(in oklab, var(--color-primary) 12%, transparent)'}"
												>Scheduled</span
											>
										</div>
									</div>
									<div
										class="shrink-0 text-sm font-medium tabular-nums"
										style="color: {sc ?? 'var(--color-primary)'}"
									>
										{formatMoney(item.o.scheduled.amount_cents)}
									</div>
								</button>
							{/if}
						{/each}
					</div>
				{/if}
			</article>
			{/if}

			<!-- 4) Other days this week -->
			{#if otherWeekCells.length > 0}
				<p class="mb-0 text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground/70">
					Other days · this week
				</p>
				<div class="flex flex-col gap-3 opacity-90">
					{#each otherWeekCells as cell (cell.iso)}
						{@const items = shownItems(cell)}
						{@const booked = dayBookedCents(cell.transactions, data.hideActuals)}
						<article class="relative rounded-xl border border-border bg-surface p-3.5">
							<button
								type="button"
								class="absolute inset-0 z-0 rounded-xl"
								onclick={() => selectDay(cell.iso)}
								aria-label="Select {cell.iso}"
							></button>
							<div class="relative z-10 mb-1 flex items-baseline justify-between gap-2">
								<div class="text-sm font-semibold tracking-tight">{dayCardDateLabel(cell.iso)}</div>
								<div class="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
									{dayTotalLabel(booked, cell.occurrences.length, data.hideActuals)}
								</div>
							</div>
							<div class="relative z-10 flex flex-col">
								{#each items as item (item.kind + (item.kind === 'tx' ? item.t.id : item.o.scheduled.id))}
									{#if item.kind === 'tx'}
										<button
											type="button"
											class="pointer-events-auto flex select-none items-center justify-between gap-2 border-b border-border py-2.5 text-left last:border-b-0 [-webkit-touch-callout:none]"
											onpointerenter={(e) => onPillPointerEnter(e.currentTarget, transactionPillRows(item.t))}
											onpointerleave={(e) => hidePillPopupOnLeave(e.currentTarget)}
											onfocus={(e) => onPillFocus(e.currentTarget, transactionPillRows(item.t))}
											onblur={onPillBlur}
											onclick={(e) => onPillClick(e, transactionPillRows(item.t))}
										>
											<div class="min-w-0 flex-1">
												<div class="truncate text-sm font-medium">
													{item.t.merchant ?? item.t.category_name ?? 'Transaction'}
												</div>
												{#if item.t.category_name}
													<div class="mt-1">
														<span
															class="inline-flex rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[0.62rem] font-semibold uppercase tracking-wide text-muted-foreground"
															>{item.t.category_name}</span
														>
													</div>
												{/if}
											</div>
											<div
												class="shrink-0 text-sm font-semibold tabular-nums {item.t.amount_cents > 0
													? 'text-success'
													: ''}"
											>
												{formatMoney(item.t.amount_cents)}
											</div>
										</button>
									{:else}
										{@const sc = item.o.scheduled.color}
										<button
											type="button"
											class="pointer-events-auto relative my-1.5 flex select-none items-center justify-between gap-2 rounded-lg border border-dashed px-3 py-2.5 pl-3.5 text-left [-webkit-touch-callout:none]"
											style="border-color: {sc ?? 'color-mix(in oklab, var(--color-primary) 60%, transparent)'}; background: {softFill(
												sc
											) ??
												'color-mix(in oklab, var(--color-primary) 10%, transparent)'}"
											onclick={(e) => onPillClick(e, scheduledPillRows(item.o.scheduled), () => openScheduledEdit(item.o.scheduled, item.o.date))}
											onpointerenter={(e) => onPillPointerEnter(e.currentTarget, scheduledPillRows(item.o.scheduled))}
											onpointerleave={(e) => hidePillPopupOnLeave(e.currentTarget)}
											onfocus={(e) => onPillFocus(e.currentTarget, scheduledPillRows(item.o.scheduled))}
											onblur={onPillBlur}
										>
											<span
												class="absolute bottom-1.5 left-0 top-1.5 w-0.5 rounded-r"
												style="background: {sc ?? 'var(--color-primary)'}"
												aria-hidden="true"
											></span>
											<div class="min-w-0 flex-1">
												<div class="truncate text-sm font-medium">{item.o.scheduled.name}</div>
												<div class="mt-1 flex flex-wrap gap-1">
													{#if item.o.scheduled.category_name}
														<span
															class="inline-flex rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[0.62rem] font-semibold uppercase tracking-wide text-muted-foreground"
															>{item.o.scheduled.category_name}</span
														>
													{/if}
													<span
														class="inline-flex rounded-full border border-dashed px-2 py-0.5 text-[0.62rem] font-semibold"
														style="border-color: {sc ??
															'color-mix(in oklab, var(--color-primary) 42%, transparent)'}; color: {sc ??
															'var(--color-primary)'}; background: {softFill(sc) ??
															'color-mix(in oklab, var(--color-primary) 12%, transparent)'}"
														>Scheduled</span
													>
												</div>
											</div>
											<div
												class="shrink-0 text-sm font-medium tabular-nums"
												style="color: {sc ?? 'var(--color-primary)'}"
											>
												{formatMoney(item.o.scheduled.amount_cents)}
											</div>
										</button>
									{/if}
								{/each}
							</div>
						</article>
					{/each}
				</div>
			{/if}

			<p class="text-xs text-muted-foreground">
				Dashed rows are scheduled expectations — tap a day card to add one. Scheduled chrome uses each
				item’s color.
			</p>
		</div>
	{/if}

	<!-- Desktop always; narrow when Month toggle is on -->
	<div class={mobileView === 'stack' ? 'hidden md:block' : 'block'}>
		<div class="galene-scroll-x min-w-0 max-w-full overflow-x-auto rounded-lg border border-border">
			<div class="grid min-w-[840px] grid-cols-7 gap-px bg-border">
				{#each dayLabels as d}
					<div class="bg-surface px-2 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
						{d}
					</div>
				{/each}
				{#each cells as cell (cell.iso)}
					{@const { shown, truncated, hidden } = gridShown(cell)}
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
										class="pointer-events-auto flex select-none items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-left text-xs [-webkit-touch-callout:none]"
										style="border-left: 3px solid {item.t.color ?? item.t.category_color ?? 'transparent'}"
										onpointerenter={(e) => onPillPointerEnter(e.currentTarget, transactionPillRows(item.t))}
										onpointerleave={(e) => hidePillPopupOnLeave(e.currentTarget)}
										onfocus={(e) => onPillFocus(e.currentTarget, transactionPillRows(item.t))}
										onblur={onPillBlur}
										onclick={(e) => onPillClick(e, transactionPillRows(item.t))}
									>
										<span class="truncate">{item.t.merchant ?? item.t.category_name ?? 'Transaction'}</span>
										<span class="ml-auto shrink-0 font-medium {item.t.amount_cents > 0 ? 'text-success' : ''}">
											{formatMoney(item.t.amount_cents)}
										</span>
									</button>
								{:else}
									<button
										type="button"
										class="pointer-events-auto flex cursor-pointer select-none items-center gap-1 rounded border border-dashed px-1.5 py-0.5 text-left text-xs [-webkit-touch-callout:none] {item
											.o.scheduled.color
											? ''
											: 'border-primary/60 bg-primary/10'}"
										style={item.o.scheduled.color
											? `border-color: ${item.o.scheduled.color}; background: ${item.o.scheduled.color}1a`
											: undefined}
										onclick={(e) => onPillClick(e, scheduledPillRows(item.o.scheduled), () => openScheduledEdit(item.o.scheduled, item.o.date))}
										onpointerenter={(e) => onPillPointerEnter(e.currentTarget, scheduledPillRows(item.o.scheduled))}
										onpointerleave={(e) => hidePillPopupOnLeave(e.currentTarget)}
										onfocus={(e) => onPillFocus(e.currentTarget, scheduledPillRows(item.o.scheduled))}
										onblur={onPillBlur}
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
								<button
									type="button"
									class="pointer-events-auto relative z-10 rounded px-1.5 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
									onclick={(e) => toggleDayOverflow(e, cell.iso, truncated)}
									aria-haspopup="dialog"
									aria-expanded={dayOverflow?.iso === cell.iso}
								>
									+{hidden} more
								</button>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</div>

		<p class="mt-4 text-xs text-muted-foreground">
			Dashed pills are scheduled expectations — click a day to add one.
		</p>
	</div>
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

{#if dayOverflow}
	<div
		id={DAY_OVERFLOW_ID}
		role="dialog"
		aria-label="More on {formatDate(dayOverflow.iso)}"
		class="fixed z-[60] flex w-64 max-h-72 flex-col overflow-hidden rounded-md border border-border bg-surface shadow-lg"
		style="top: {dayOverflow.top}px; left: {dayOverflow.left}px"
	>
		<div class="shrink-0 border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
			{formatDate(dayOverflow.iso)}
		</div>
		<div class="min-h-0 flex-1 overflow-y-auto p-1.5">
			<div class="flex flex-col gap-1">
				{#each dayOverflow.items as item (item.kind + (item.kind === 'tx' ? item.t.id : item.o.scheduled.id))}
					{#if item.kind === 'tx'}
						<button
							type="button"
							class="flex select-none items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-left text-xs [-webkit-touch-callout:none]"
							style="border-left: 3px solid {item.t.color ?? item.t.category_color ?? 'transparent'}"
							onpointerenter={(e) => onPillPointerEnter(e.currentTarget, transactionPillRows(item.t))}
							onpointerleave={(e) => hidePillPopupOnLeave(e.currentTarget)}
							onfocus={(e) => onPillFocus(e.currentTarget, transactionPillRows(item.t))}
							onblur={onPillBlur}
							onclick={(e) => onPillClick(e, transactionPillRows(item.t))}
						>
							<span class="truncate">{item.t.merchant ?? item.t.category_name ?? 'Transaction'}</span>
							<span class="ml-auto shrink-0 font-medium {item.t.amount_cents > 0 ? 'text-success' : ''}">
								{formatMoney(item.t.amount_cents)}
							</span>
						</button>
					{:else}
						<button
							type="button"
							class="flex cursor-pointer select-none items-center gap-1 rounded border border-dashed px-1.5 py-0.5 text-left text-xs [-webkit-touch-callout:none] {item
								.o.scheduled.color
									? ''
									: 'border-primary/60 bg-primary/10'}"
							style={item.o.scheduled.color
								? `border-color: ${item.o.scheduled.color}; background: ${item.o.scheduled.color}1a`
								: undefined}
							onclick={(e) =>
								onPillClick(e, scheduledPillRows(item.o.scheduled), () =>
									openScheduledEdit(item.o.scheduled, item.o.date)
								)}
							onpointerenter={(e) => onPillPointerEnter(e.currentTarget, scheduledPillRows(item.o.scheduled))}
							onpointerleave={(e) => hidePillPopupOnLeave(e.currentTarget)}
							onfocus={(e) => onPillFocus(e.currentTarget, scheduledPillRows(item.o.scheduled))}
							onblur={onPillBlur}
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
			</div>
		</div>
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
	occurrenceDate={scheduledOccurrence}
	prefillDate={scheduledPrefill}
	accounts={data.accounts}
	categories={data.categories}
	tags={data.tags}
	{form}
	deleteAction="?/delete-scheduled"
	onclose={closeScheduled}
/>

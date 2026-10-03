<script lang="ts">
	import AddScheduledDialog from '$lib/components/AddScheduledDialog.svelte';
	import Title from '$lib/components/Title.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { formatRepeat } from '$lib/calendarPillPopup';
	import { softFill } from '$lib/calendarMobile';
	import { watchFormToast } from '$lib/formToast.svelte';
	import { formatDate, formatMoney, todayISO } from '$lib/utils';
	import type { Account, Category, Scheduled, Tag } from '$lib/types';

	let { form, data }: {
		form: { error?: string | null } | undefined;
		data: {
			rows: { scheduled: Scheduled; nextDate: string | null }[];
			accounts: Account[];
			categories: Category[];
			tags: Tag[];
		};
	} = $props();

	let scheduledOpen = $state(false);
	let scheduledEditing = $state<Scheduled | null>(null);
	let scheduledOccurrence = $state<string | null>(null);
	let scheduledPrefill = $state<string | null>(null);

	function openNewScheduled() {
		scheduledEditing = null;
		scheduledOccurrence = null;
		scheduledPrefill = todayISO();
		scheduledOpen = true;
	}

	function openScheduledEdit(row: { scheduled: Scheduled; nextDate: string | null }) {
		scheduledEditing = row.scheduled;
		scheduledOccurrence = row.nextDate ?? row.scheduled.start_date;
		scheduledPrefill = null;
		scheduledOpen = true;
	}

	function closeScheduled() {
		scheduledEditing = null;
		scheduledOccurrence = null;
		scheduledPrefill = null;
	}

	function cadence(s: Scheduled): string {
		return formatRepeat(s.repeat_interval, s.repeat_unit) ?? 'One time';
	}

	/** Same tint Calendar uses on a colored schedule item. No color keeps the card surface. */
	function cardStyle(color: string | null | undefined): string | undefined {
		if (!color) return undefined;
		const fill = softFill(color);
		return fill ? `border-color: ${color}; background: ${fill}` : `border-color: ${color}`;
	}

	watchFormToast(() => form);
</script>

<Title title="Scheduled" />

<div class="mx-auto flex max-w-3xl flex-col gap-4 2xl:max-w-5xl">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Scheduled</h1>
			<p class="text-sm text-muted-foreground">Each series, not every future date.</p>
		</div>
		<Button type="button" onclick={openNewScheduled}>+ New scheduled</Button>
	</div>

	{#if data.rows.length === 0}
		<div class="rounded-lg border border-dashed border-border bg-surface p-10 text-center">
			<p class="text-sm text-muted-foreground">
				No schedules yet. Add one to see it here and on the calendar.
			</p>
		</div>
	{:else}
		<ul class="flex flex-col gap-3">
			{#each data.rows as row (row.scheduled.id)}
				<li>
					<button
						type="button"
						class="w-full rounded-xl border p-4 text-left transition-colors {row.scheduled.color
							? ''
							: 'border-border bg-surface hover:bg-muted/40'}"
						style={cardStyle(row.scheduled.color)}
						onclick={() => openScheduledEdit(row)}
					>
						<div class="flex items-start justify-between gap-3">
							<span class="min-w-0 truncate text-[0.95rem] font-semibold tracking-tight">
								{row.scheduled.name}
							</span>
							<span class="shrink-0 text-sm font-medium">{formatMoney(row.scheduled.amount_cents)}</span>
						</div>
						<dl class="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
							<div class="min-w-0">
								<dt class="text-xs text-muted-foreground">Frequency</dt>
								<dd class="truncate">{cadence(row.scheduled)}</dd>
							</div>
							<div class="min-w-0">
								<dt class="text-xs text-muted-foreground">Next occurrence</dt>
								<dd class="truncate">{row.nextDate ? formatDate(row.nextDate) : 'No upcoming date'}</dd>
							</div>
							<div class="min-w-0">
								<dt class="text-xs text-muted-foreground">Start date</dt>
								<dd class="truncate">{formatDate(row.scheduled.start_date)}</dd>
							</div>
							<div class="min-w-0">
								<dt class="text-xs text-muted-foreground">End date</dt>
								<dd class="truncate">
									{row.scheduled.until_date ? formatDate(row.scheduled.until_date) : 'Open-ended'}
								</dd>
							</div>
							<div class="min-w-0">
								<dt class="text-xs text-muted-foreground">Category</dt>
								<dd class="truncate">{row.scheduled.category_name ?? 'No category'}</dd>
							</div>
							<div class="min-w-0">
								<dt class="text-xs text-muted-foreground">Account</dt>
								<dd class="truncate">{row.scheduled.account_name ?? 'No account'}</dd>
							</div>
						</dl>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>

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

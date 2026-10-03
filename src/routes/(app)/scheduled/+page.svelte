<script lang="ts">
	import AddScheduledDialog from '$lib/components/AddScheduledDialog.svelte';
	import Title from '$lib/components/Title.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { formatRepeat } from '$lib/calendarPillPopup';
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

	<section class="rounded-lg border border-border bg-surface">
		<div class="border-b border-border px-4 py-3">
			<h2 class="font-medium">Scheduled</h2>
			<p class="text-sm text-muted-foreground">
				Bills and income you expect. Open a row to edit that series.
			</p>
		</div>
		<div class="p-4">
			{#if data.rows.length === 0}
				<p class="py-4 text-center text-sm text-muted-foreground">
					No schedules yet. Add one to see it here and on the calendar.
				</p>
			{:else}
				<ul class="divide-y divide-border">
					{#each data.rows as row (row.scheduled.id)}
						<li>
							<button
								type="button"
								class="flex w-full flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-left transition-colors hover:bg-muted/60"
								onclick={() => openScheduledEdit(row)}
							>
								<span class="min-w-0 flex-1 basis-40">
									<span class="block truncate text-sm font-medium">{row.scheduled.name}</span>
									<span class="block truncate text-xs text-muted-foreground">
										{cadence(row.scheduled)}
										·
										{row.nextDate ? formatDate(row.nextDate) : 'No upcoming date'}
									</span>
								</span>
								<span class="min-w-0 flex-1 basis-32 truncate text-xs text-muted-foreground">
									{row.scheduled.account_name ?? 'No account'}
									·
									{row.scheduled.category_name ?? 'No category'}
								</span>
								<span class="shrink-0 text-sm font-medium">{formatMoney(row.scheduled.amount_cents)}</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</section>
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

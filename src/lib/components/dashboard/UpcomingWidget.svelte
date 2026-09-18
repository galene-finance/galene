<script lang="ts">
	import { formatMoney } from '$lib/utils';
	import type { DashboardWidgetData } from '$lib/types';

	type Data = Extract<DashboardWidgetData, { kind: 'upcoming' }>;
	let { data }: { data: Data } = $props();
</script>

{#if data.recurringSuggestionCount > 0}
	<p class="mb-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
		<a href="/recurring" class="font-medium text-primary underline-offset-2 hover:underline">
			We found {data.recurringSuggestionCount} likely bill{data.recurringSuggestionCount === 1 ? '' : 's'} — review
		</a>
	</p>
{/if}

{#if data.days.length === 0}
	<p class="text-sm text-muted-foreground">
		Nothing scheduled. Add an expectation on the
		<a href="/calendar" class="text-primary underline underline-offset-2">Calendar</a> page
		{#if data.recurringSuggestionCount > 0}
			or
			<a href="/recurring" class="text-primary underline underline-offset-2">find recurring bills</a>
		{/if}.
	</p>
{:else}
	<ul class="flex flex-col gap-3">
		{#each data.days as day (day.date)}
			<li>
				<p class="mb-1.5 text-xs font-medium text-muted-foreground">{day.label}</p>
				<ul class="flex flex-col gap-1.5">
					{#each day.items as it (it.id + day.date)}
						<li class="flex items-center gap-2.5">
							<span class="size-2.5 shrink-0 rounded-full" style="background: {it.color ?? 'transparent'}"></span>
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-medium">{it.name}</p>
								{#if it.categoryName || it.accountName}
									<p class="truncate text-xs text-muted-foreground">
										{[it.categoryName, it.accountName].filter(Boolean).join(' · ')}
									</p>
								{/if}
							</div>
							<p class="shrink-0 text-sm font-medium">{formatMoney(it.amountCents)}</p>
						</li>
					{/each}
				</ul>
			</li>
		{/each}
	</ul>
{/if}

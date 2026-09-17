<script lang="ts">
	import { formatMoney } from '$lib/utils';
	import type { DashboardWidgetData } from '$lib/types';

	type Data = Extract<DashboardWidgetData, { kind: 'upcoming' }>;
	let { data }: { data: Data } = $props();
</script>

{#if data.days.length === 0}
	<p class="text-sm text-muted-foreground">
		Nothing scheduled. Add an expectation on the
		<a href="/calendar" class="text-primary underline underline-offset-2">Calendar</a> page.
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

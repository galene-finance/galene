<script lang="ts">
	import { formatDate, formatMoney } from '$lib/utils';
	import type { DashboardWidgetData } from '$lib/types';

	type Data = Extract<DashboardWidgetData, { kind: 'recent' }>;
	let { data }: { data: Data } = $props();
</script>

{#if data.items.length === 0}
	<p class="text-sm text-muted-foreground">
		No transactions match. Add your first one on the
		<a href="/transactions" class="text-primary underline underline-offset-2">Transactions</a> page.
	</p>
{:else}
	<ul class="divide-y divide-border">
		{#each data.items as tx (tx.id)}
			<li class="flex min-w-0 items-center gap-3 py-2 first:pt-0 last:pb-0">
				<span
					class="size-2.5 shrink-0 rounded-full"
					style="background: {tx.color ?? tx.category_color ?? 'transparent'}"
				></span>
				<div class="min-w-0 flex-1">
					<p class="truncate text-sm font-medium">{tx.merchant ?? tx.account_name}</p>
					<p class="truncate text-xs text-muted-foreground">
						{tx.category_name ?? 'No category'} · {tx.account_name}
					</p>
				</div>
				<div class="min-w-0 shrink-0 text-right">
					<p class="truncate text-sm font-medium {tx.amount_cents > 0 ? 'text-success' : ''}">
						{formatMoney(tx.amount_cents)}
					</p>
					<p class="text-xs text-muted-foreground">{formatDate(tx.date)}</p>
				</div>
			</li>
		{/each}
	</ul>
{/if}

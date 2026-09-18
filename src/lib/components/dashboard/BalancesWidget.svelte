<script lang="ts">
	import { formatMoney } from '$lib/utils';
	import type { DashboardWidgetData } from '$lib/types';

	type Data = Extract<DashboardWidgetData, { kind: 'balances' }>;
	let { data }: { data: Data } = $props();

	/** Format UTC DB datetime for a short local display. */
	function formatBankAsOf(s: string | null): string {
		if (!s) return '';
		const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
		if (Number.isNaN(d.getTime())) return s;
		return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	}
</script>

{#if data.items.length === 0}
	<p class="text-sm text-muted-foreground">
		No accounts match. Add one on the
		<a href="/settings/accounts" class="text-primary underline underline-offset-2">Accounts</a> page.
	</p>
{:else}
	<ul class="flex min-w-0 flex-col gap-2.5">
		{#each data.items as a (a.id)}
			<li class="flex min-w-0 items-start gap-2.5">
				<span class="mt-1.5 size-2.5 shrink-0 rounded-full" style="background: {a.color ?? 'transparent'}"></span>
				<div class="min-w-0 flex-1">
					<p class="truncate text-sm font-medium">{a.name}</p>
					<p class="truncate text-xs capitalize text-muted-foreground">{a.type}</p>
				</div>
				<div class="min-w-0 max-w-[55%] shrink text-right">
					<p
						class="truncate text-sm font-medium {a.balanceCents < 0 ? 'text-destructive' : ''}"
						title="Ledger {formatMoney(a.balanceCents)}"
					>
						<span class="mr-1 text-xs font-normal text-muted-foreground">Ledger</span>
						{formatMoney(a.balanceCents)}
					</p>
					{#if a.bankCents != null}
						<p
							class="truncate text-xs {a.bankCents < 0 ? 'text-destructive' : 'text-muted-foreground'}"
							title={a.bankAsOf
								? `Bank ${formatMoney(a.bankCents)} as of ${formatBankAsOf(a.bankAsOf)}`
								: `Bank ${formatMoney(a.bankCents)} from last sync`}
						>
							<span class="mr-1 font-normal text-muted-foreground">Bank</span>
							{formatMoney(a.bankCents)}
						</p>
					{/if}
				</div>
			</li>
		{/each}
	</ul>
	<div class="mt-3 flex min-w-0 items-center justify-between gap-2 border-t border-border pt-2.5 text-sm">
		<span class="min-w-0 truncate text-muted-foreground">Total (ledger)</span>
		<span class="min-w-0 truncate font-semibold {data.totalCents < 0 ? 'text-destructive' : ''}"
			>{formatMoney(data.totalCents)}</span
		>
	</div>
{/if}

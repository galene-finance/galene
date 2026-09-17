<script lang="ts">
	import type { DashboardWidgetData, NotificationKind } from '$lib/types';

	type Data = Extract<DashboardWidgetData, { kind: 'notifications' }>;
	let { data }: { data: Data } = $props();

	// Same icons as the TopNav bell (kept local to avoid a TopNav dependency).
	const KIND_ICONS: Record<NotificationKind, string[]> = {
		sync_failed: [
			'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
			'M12 9v4',
			'M12 17h.01'
		],
		sync_recovered: ['M22 11.08V12a10 10 0 1 1-5.93-9.14', 'm22 4-10 10.01-3-3'],
		budget_overrun: ['M21.21 15.89A10 10 0 1 1 8 2.83', 'M22 12A10 10 0 0 0 12 2v10z'],
		bill_upcoming: [
			'M8 2v4',
			'M16 2v4',
			'M3 10h18',
			'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'
		]
	};

	function kindPaths(kind: NotificationKind): string {
		return KIND_ICONS[kind].map((d) => `<path d="${d}"/>`).join('');
	}
</script>

{#if data.items.length === 0}
	<p class="text-sm text-muted-foreground">
		{#if data.unread > 0}
			No notifications match this filter.
		{:else}
			No notifications.
		{/if}
	</p>
{:else}
	<ul class="divide-y divide-border">
		{#each data.items as n (n.id)}
			<li class="flex items-start gap-2.5 py-2 first:pt-0 last:pb-0">
				<span class="mt-0.5 shrink-0 {n.read_at ? 'text-muted-foreground' : 'text-primary'}">
					<svg
						class="size-4"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						{@html kindPaths(n.kind)}
					</svg>
				</span>
				<a href={n.link ?? '/'} class="min-w-0 flex-1">
					<p class="truncate text-sm {n.read_at ? 'text-muted-foreground' : 'font-medium'}">{n.title}</p>
					<p class="line-clamp-2 text-xs text-muted-foreground">{n.body}</p>
				</a>
				{#if !n.read_at}
					<span class="mt-1.5 size-2 shrink-0 rounded-full bg-primary"></span>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

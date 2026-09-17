<script lang="ts">
	import { toasts, dismissToast, type Toast } from '$lib/toasts';

	let list = $state<Toast[]>([]);
	$effect(() => {
		const unsubscribe = toasts.subscribe((value) => (list = value));
		return unsubscribe;
	});
</script>

{#if list.length}
	<div class="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
		{#each list as t (t.id)}
			<div
				role="status"
				class="flex w-80 max-w-[calc(100vw-2rem)] items-start gap-3 rounded-lg border border-border bg-surface p-4 shadow-xl"
			>
				{#if t.kind === 'success'}
					<svg
						class="mt-0.5 size-5 shrink-0 text-success"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path d="M20 6 9 17l-5-5" />
					</svg>
				{:else}
					<svg
						class="mt-0.5 size-5 shrink-0 text-destructive"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<circle cx="12" cy="12" r="10" />
						<path d="M12 8v4" />
						<path d="M12 16h.01" />
					</svg>
				{/if}
				<p class="flex-1 text-sm">{t.message}</p>
				<button
					type="button"
					class="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					aria-label="Dismiss"
					onclick={() => dismissToast(t.id)}
				>
					<svg
						class="size-4"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path d="M18 6 6 18M6 6l12 12" />
					</svg>
				</button>
			</div>
		{/each}
	</div>
{/if}

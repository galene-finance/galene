<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import Button from '$lib/components/ui/Button.svelte';
	import Title from '$lib/components/Title.svelte';
	import { formatMoney, formatDate } from '$lib/utils';
	import { toastFormResult } from '$lib/toasts';
	import type { SyncReviewItem } from '$lib/types';

	let {
		form,
		data
	}: {
		form: { error?: string | null; ok?: boolean; message?: string } | undefined;
		data: { items: SyncReviewItem[]; viewer: boolean };
	} = $props();

	let lastForm = untrack(() => form);
	$effect(() => {
		if (form === lastForm) return;
		lastForm = form;
		toastFormResult(form);
		if (form?.ok) invalidateAll();
	});
</script>

<Title title="Sync review" />

<div class="mx-auto flex max-w-3xl flex-col gap-6 2xl:max-w-5xl">
	<div>
		<a href="/transactions" class="text-sm text-primary underline-offset-2 hover:underline">← Transactions</a>
		<h1 class="mt-2 text-2xl font-semibold tracking-tight">Sync review</h1>
		<p class="mt-1 text-sm text-muted-foreground">
			Possible duplicates or replaced pending charges that sync could not fold automatically. Keep both,
			fold the older row into a live match, or dismiss.
		</p>
	</div>

	{#if form?.error}
		<p class="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{form.error}</p>
	{/if}

	{#if data.items.length === 0}
		<div class="rounded-lg border border-border bg-surface p-6 text-sm text-muted-foreground">
			Nothing to review. Ambiguous bank-sync orphans will show up here.
		</div>
	{:else}
		<ul class="flex flex-col gap-4">
			{#each data.items as item (item.id)}
				<li class="rounded-lg border border-border bg-surface p-4">
					<div class="flex flex-wrap items-start justify-between gap-2">
						<div>
							<p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
								Possible duplicate / replaced pending · {item.provider}
							</p>
							<p class="mt-1 text-sm font-semibold">
								{item.orphan.merchant ?? '—'}
								<span class="ml-2 font-medium text-muted-foreground">{formatDate(item.orphan.date)}</span>
								<span class="ml-2 font-medium">{formatMoney(item.orphan.amount_cents)}</span>
							</p>
							{#if item.orphan.external_id}
								<p class="mt-0.5 truncate text-xs text-muted-foreground" title={item.orphan.external_id}>
									Id {item.orphan.external_id}
								</p>
							{/if}
						</div>
					</div>

					{#if item.candidates.length > 0}
						<div class="mt-3">
							<p class="text-xs font-medium text-muted-foreground">Live candidates</p>
							<ul class="mt-1 divide-y divide-border rounded-md border border-border">
								{#each item.candidates as c (c.id)}
									<li class="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
										<span class="min-w-0 flex-1 truncate font-medium">{c.merchant ?? '—'}</span>
										<span class="text-muted-foreground">{formatDate(c.date)}</span>
										<span class="font-medium">{formatMoney(c.amount_cents)}</span>
										{#if !data.viewer}
											<form method="POST" action="?/fold" use:enhance class="shrink-0">
												<input type="hidden" name="id" value={item.id} />
												<input type="hidden" name="fold_into" value={c.id} />
												<Button type="submit" variant="secondary" class="h-8 px-2 text-xs">
													Fold into this
												</Button>
											</form>
										{/if}
									</li>
								{/each}
							</ul>
						</div>
					{:else}
						<p class="mt-3 text-sm text-muted-foreground">
							No live same-account match in the window — the charge may have dropped out of the feed.
						</p>
					{/if}

					{#if !data.viewer}
						<div class="mt-3 flex flex-wrap gap-2">
							<form method="POST" action="?/keep" use:enhance>
								<input type="hidden" name="id" value={item.id} />
								<Button type="submit" variant="secondary">Keep both</Button>
							</form>
							<form method="POST" action="?/dismiss" use:enhance>
								<input type="hidden" name="id" value={item.id} />
								<Button type="submit" variant="secondary">Dismiss</Button>
							</form>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

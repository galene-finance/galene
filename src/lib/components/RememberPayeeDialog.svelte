<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from './ui/Button.svelte';
	import Dialog from './ui/Dialog.svelte';
	import type { Transaction } from '$lib/types';
	import type { SubmitFunction } from '@sveltejs/kit';

	let {
		open = $bindable(false),
		transaction = null,
		uncategorizedMatchCount = 0,
		form,
		action = '?/remember-payee',
		onclose
	}: {
		open?: boolean;
		transaction?: Transaction | null;
		uncategorizedMatchCount?: number;
		form?: { error?: string | null; message?: string | null };
		action?: string;
		onclose?: () => void;
	} = $props();

	let applyExisting = $state(false);

	$effect(() => {
		if (open) applyExisting = false;
	});

	const handleSubmit: SubmitFunction = () => {
		return async ({ result, update }) => {
			await update();
			if (result.type === 'success' && !(result.data as { error?: string } | undefined)?.error) {
				open = false;
				onclose?.();
			}
		};
	};
</script>

<Dialog
	bind:open
	size="md"
	title="Remember this payee?"
	description="Future imports and uncategorized transactions whose merchant matches will get this category. Already-categorized rows stay unchanged unless you opt in below."
>
	{#if transaction}
		<form method="POST" {action} use:enhance={handleSubmit} class="flex flex-col gap-4">
			<input type="hidden" name="id" value={transaction.id} />
			<input type="hidden" name="merchant" value={transaction.merchant ?? ''} />
			<input type="hidden" name="category_id" value={transaction.category_id ?? ''} />
			<div class="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
				<p>
					<span class="text-muted-foreground">Payee</span>
					<span class="ml-2 font-medium">{transaction.merchant}</span>
				</p>
				<p class="mt-1">
					<span class="text-muted-foreground">Category</span>
					<span class="ml-2 font-medium">{transaction.category_name ?? '—'}</span>
				</p>
			</div>
			{#if uncategorizedMatchCount > 0}
				<label class="flex items-start gap-2 text-sm">
					<input
						type="checkbox"
						name="apply_existing"
						value="1"
						bind:checked={applyExisting}
						class="mt-0.5 size-4 accent-primary"
					/>
					<span>
						Also apply to <strong>{uncategorizedMatchCount}</strong> matching uncategorized
						transaction{uncategorizedMatchCount === 1 ? '' : 's'}
					</span>
				</label>
			{:else}
				<p class="text-xs text-muted-foreground">No matching uncategorized transactions right now.</p>
			{/if}
			{#if form?.error}
				<p class="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{form.error}</p>
			{/if}
			<div class="flex justify-end gap-2">
				<Button type="button" variant="secondary" onclick={() => (open = false)}>Cancel</Button>
				<Button type="submit">Remember payee</Button>
			</div>
		</form>
	{/if}
</Dialog>

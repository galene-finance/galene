<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import type { LinkedAccount } from '$lib/types';

	let {
		provider,
		account,
		allAccounts
	}: {
		provider: string;
		account: LinkedAccount;
		allAccounts: { id: number; name: string; type: string; provider: string | null; external_id: string | null }[];
	} = $props();

	// The target the source account maps to: the current account's id, another
	// account's id, or 'new' (rename in place to the typed name).
	let target = $state(String(account.id));
	let newName = $state(account.source_name ?? account.name);

	// When the account reloads (after a save or a sync), reset the editor to
	// reflect it. Depends only on the account, not on target/newName, so the
	// user's in-progress edits don't retrigger it.
	$effect(() => {
		target = String(account.id);
		newName = account.source_name ?? account.name;
	});

	// The current account, then any account not already representing a
	// different source, then "Custom name…".
	const options = $derived.by(() => {
		const opts: { value: string; label: string }[] = [{ value: String(account.id), label: account.name }];
		for (const acc of allAccounts) {
			if (acc.id === account.id) continue;
			if (acc.provider != null && !(acc.provider === provider && acc.external_id === account.external_id)) continue;
			opts.push({ value: String(acc.id), label: acc.name });
		}
		opts.push({ value: 'new', label: 'Custom name…' });
		return opts;
	});
</script>

<div class="flex flex-col gap-1.5">
	<div class="flex items-center gap-2 text-sm">
		<span class="flex-1 truncate font-medium" title={account.source_name ?? account.name}>
			{account.source_name ?? account.name}
		</span>
		<span class="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{account.type}</span>
		<span class="shrink-0 text-xs text-muted-foreground">{account.tx_count} transactions</span>
	</div>

	<!-- Skips use:enhance's default form.reset(): it would revert the select's
		hidden input; the $effect above re-syncs state after the reload instead. -->
	<form method="POST" action="?/map" use:enhance={() => ({ update }) => update({ reset: false })} class="flex flex-wrap items-center gap-2">
		<input type="hidden" name="provider" value={provider} />
		<input type="hidden" name="external_id" value={account.external_id} />
		<span class="text-xs text-muted-foreground">Maps to</span>
		<Select name="target" bind:value={target} items={options} class="w-48" />
		{#if target === 'new'}
			<Input type="text" name="new_name" bind:value={newName} required placeholder="Account name" class="w-44" />
		{/if}
		<Button type="submit" variant="secondary" size="sm">Save</Button>
	</form>
</div>

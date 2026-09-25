<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '$lib/components/ui/Button.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Title from '$lib/components/Title.svelte';

	let { data, form } = $props();
</script>

<Title title="Advisor invite" />

<div class="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center gap-4 p-6">
	<h1 class="text-2xl font-semibold">Advisor access</h1>
	{#if data.expired}
		<p class="text-sm text-muted-foreground">This invite is no longer valid.</p>
	{:else}
		<p class="text-sm text-muted-foreground">
			This signs you in as a read-only viewer. You can look at transactions, accounts, categories, and trends for the shared range.
		</p>
		<form method="POST" use:enhance class="flex flex-col gap-3">
			{#if form && 'error' in form && form.error}
				<p class="text-sm text-destructive">{form.error}</p>
			{/if}
			{#if data.needsPassword}
				<Field label="Password">
					<Input name="password" type="password" required />
				</Field>
			{/if}
			<Button type="submit">Continue</Button>
		</form>
	{/if}
</div>

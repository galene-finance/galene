<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import CsvIoIcons from '$lib/components/CsvIoIcons.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Title from '$lib/components/Title.svelte';
	import { toastFormResult } from '$lib/toasts';
	import { DATA_TYPES, type DataTypeInfo, type DeletableDataType } from '$lib/types';

	let {
		form,
		data
	}: {
		form: { ok?: boolean; error?: string | null; message?: string } | undefined;
		data: {
			user: { name: string; email: string };
			counts: Record<DeletableDataType, number>;
		};
	} = $props();

	// The dialog that's open: one of the data types, or 'all' for delete-all.
	// Explicit $state generic: annotating the let instead would make TS start
	// control-flow analysis from the null initializer, not the union.
	let pending = $state<DataTypeInfo | 'all' | null>(null);
	let dialogOpen = $state(false);
	let confirm = $state('');
	let dialogError = $state('');

	const matches = $derived(confirm.trim() === data.user.name);

	function openDelete(t: DataTypeInfo | 'all') {
		pending = t;
		confirm = '';
		dialogError = '';
		dialogOpen = true;
	}

	function close() {
		dialogOpen = false;
		pending = null;
		confirm = '';
		dialogError = '';
	}

	// A failed submission keeps the dialog open and shows the server's message
	// (a stale error from an earlier submission is dropped when the dialog reopens).
	let lastError = $state<string | null>(null);
	$effect(() => {
		const e = form?.error ?? null;
		if (e !== lastError) {
			lastError = e;
			dialogError = e ?? '';
		}
	});

	// A successful submission closes the dialog and refreshes page data
	// (the counts here, and the layout's notification/theme state).
	$effect(() => {
		if (form?.ok) {
			close();
			invalidateAll();
		}
	});

	const pendingDescription = $derived(
		pending === 'all'
			? 'This permanently deletes everything on this page: accounts, transactions, categories, tags, budgets, scheduled expectations, rules, bank connections, notifications, API tokens, themes, and preferences. Your account itself stays, so you can sign in again.'
			: pending
				? pending.description
				: ''
	);

	// Toast the latest action result (replaces the old top-of-page status block).
	let lastForm = untrack(() => form);
	$effect(() => {
		if (form === lastForm) return;
		lastForm = form;
		toastFormResult(form);
	});
</script>

<Title title="Data" />

<div class="mx-auto flex max-w-3xl flex-col gap-4 2xl:max-w-5xl">
	<a href="/settings" class="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
		>← Back to Settings</a
	>
	<h1 class="text-2xl font-semibold tracking-tight">Data</h1>

	<section class="rounded-lg border border-border bg-surface">
		<div class="border-b border-border px-4 py-3">
			<h2 class="font-medium">Your data</h2>
			<p class="text-sm text-muted-foreground">
				Delete a specific kind of data. You'll be asked to type your username to confirm.
			</p>
		</div>
		<div class="p-4">
			<ul class="divide-y divide-border">
				{#each DATA_TYPES as t (t.key)}
					<li class="flex items-center gap-3 py-3">
						<div class="min-w-0 flex-1">
							<p class="text-sm font-medium">
								{t.label}
								<span class="font-normal text-muted-foreground">({data.counts[t.key]})</span>
							</p>
							<p class="text-sm text-muted-foreground">{t.description}</p>
						</div>
						<div class="flex shrink-0 items-center gap-2">
							{#if t.key === 'transactions'}
								<CsvIoIcons size="sm" />
							{/if}
							<button
								type="button"
								class="text-sm text-destructive hover:underline"
								onclick={() => openDelete(t)}
							>
								Delete
							</button>
						</div>
					</li>
				{/each}
			</ul>
		</div>
	</section>

	<section class="rounded-lg border border-destructive/40 bg-surface">
		<div class="border-b border-destructive/40 px-4 py-3">
			<h2 class="font-medium text-destructive">Delete everything</h2>
			<p class="text-sm text-muted-foreground">
				Remove all of your data at once: accounts, transactions, categories, tags, budgets,
				scheduled expectations, rules, bank connections, notifications, API tokens, themes, and
				preferences. Your account itself stays.
			</p>
		</div>
		<div class="p-4">
			<Button variant="destructive" onclick={() => openDelete('all')}>Delete all data</Button>
		</div>
	</section>
</div>

<Dialog
	bind:open={dialogOpen}
	title={pending ? `Delete ${pending === 'all' ? 'all your data' : pending.label}?` : ''}
	description={pending ? pendingDescription : ''}
>
	{#if pending}
		<form
			method="POST"
			action={pending === 'all' ? '?/delete-all' : '?/delete'}
			use:enhance
			class="flex flex-col gap-4"
		>
			<input type="hidden" name="type" value={pending === 'all' ? '' : pending.key} />
			<Field label={`Type your username, "${data.user.name}", to confirm`} error={dialogError || null}>
				<Input
					type="text"
					name="confirm"
					bind:value={confirm}
					placeholder={data.user.name}
					autocomplete="off"
					autocapitalize="off"
					spellcheck="false"
				/>
			</Field>
			<div class="flex justify-end gap-2">
				<Button type="button" variant="secondary" onclick={close}>Cancel</Button>
				<Button type="submit" variant="destructive" disabled={!matches}>
					{pending === 'all' ? 'Delete everything' : `Delete ${pending.label}`}
				</Button>
			</div>
		</form>
	{/if}
</Dialog>

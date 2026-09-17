<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '$lib/components/ui/Button.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Title from '$lib/components/Title.svelte';
	import { toastFormResult } from '$lib/toasts';
	import type { Tag } from '$lib/types';

	let {
		form,
		data
	}: {
		form:
			| { error?: string | null; ok?: boolean; message?: string | null; source?: string }
			| undefined;
		data: { tags: Tag[] };
	} = $props();

	// --- Create / Edit dialog ---
	let editOpen = $state(false);
	let tagEditId = $state<number | null>(null);
	let tagName = $state('');
	let editError = $state('');

	function openCreate() {
		tagEditId = null;
		tagName = '';
		editError = '';
		editOpen = true;
	}

	function openEdit(t: Tag) {
		tagEditId = t.id;
		tagName = t.name;
		editError = '';
		editOpen = true;
	}

	function closeEdit() {
		editOpen = false;
		tagEditId = null;
		tagName = '';
		editError = '';
	}

	// --- Delete dialog ---
	let deleteOpen = $state(false);
	let pendingDelete = $state<Tag | null>(null);
	let deleteError = $state('');

	function openDelete(t: Tag) {
		pendingDelete = t;
		deleteError = '';
		deleteOpen = true;
	}

	function closeDelete() {
		deleteOpen = false;
		pendingDelete = null;
		deleteError = '';
	}

	// Failed dialog submissions keep the dialog open and show the server message.
	let lastError = $state<string | null>(null);
	$effect(() => {
		const e = form?.error ?? null;
		if (e !== lastError) {
			lastError = e;
			if (form?.source === 'save') editError = e ?? '';
			if (form?.source === 'delete') deleteError = e ?? '';
		}
	});

	// Success closes the matching dialog and toasts once per new result.
	let lastForm: typeof form | null = null;
	$effect(() => {
		if (form === lastForm) return;
		lastForm = form;
		toastFormResult(form);
		if (!form?.ok) return;
		if (form.source === 'save') closeEdit();
		if (form.source === 'delete') closeDelete();
	});
</script>

<Title title="Tags" />

<div class="mx-auto flex max-w-3xl flex-col gap-4 2xl:max-w-5xl">
	<a href="/settings" class="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
		>← Back to Settings</a
	>
	<div class="flex flex-wrap items-center justify-between gap-3">
		<h1 class="text-2xl font-semibold tracking-tight">Tags</h1>
		<Button type="button" onclick={openCreate}>Add tag</Button>
	</div>

	<section class="rounded-lg border border-border bg-surface">
		<div class="border-b border-border px-4 py-3">
			<h2 class="font-medium">Tags</h2>
			<p class="text-sm text-muted-foreground">Free-form labels for transactions.</p>
		</div>
		<div class="p-4">
			{#if data.tags.length === 0}
				<p class="py-4 text-center text-sm text-muted-foreground">No tags yet.</p>
			{:else}
				<ul class="divide-y divide-border">
					{#each data.tags as tag (tag.id)}
						<li class="flex items-center gap-3 py-2.5">
							<span class="flex-1 truncate text-sm">{tag.name}</span>
							<button
								type="button"
								class="text-sm text-primary hover:underline"
								onclick={() => openEdit(tag)}
							>
								Edit
							</button>
							<button
								type="button"
								class="text-sm text-destructive hover:underline"
								onclick={() => openDelete(tag)}
							>
								Delete
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</section>
</div>

<Dialog
	bind:open={editOpen}
	title={tagEditId ? 'Edit tag' : 'Add tag'}
	description={tagEditId ? 'Rename this tag. Transactions keep the same tag.' : 'Create a free-form label for transactions.'}
>
	<form method="POST" action="?/save-tag" use:enhance class="flex flex-col gap-4">
		<input type="hidden" name="id" value={tagEditId ?? ''} />
		<Field label="Name" error={editError || null}>
			<Input type="text" name="name" bind:value={tagName} required placeholder="e.g. trip" />
		</Field>
		<div class="flex justify-end gap-2">
			<Button type="button" variant="secondary" onclick={closeEdit}>Cancel</Button>
			<Button type="submit">{tagEditId ? 'Save changes' : 'Add tag'}</Button>
		</div>
	</form>
</Dialog>

<Dialog
	bind:open={deleteOpen}
	title={pendingDelete ? `Delete ${pendingDelete.name}?` : 'Delete tag?'}
	description="This tag is removed from all transactions and scheduled items, then deleted. Transactions themselves stay."
>
	{#if pendingDelete}
		<form method="POST" action="?/delete-tag" use:enhance class="flex flex-col gap-4">
			<input type="hidden" name="id" value={pendingDelete.id} />
			{#if deleteError}
				<p class="text-sm text-destructive">{deleteError}</p>
			{/if}
			<div class="flex justify-end gap-2">
				<Button type="button" variant="secondary" onclick={closeDelete}>Cancel</Button>
				<Button type="submit" variant="destructive">Delete tag</Button>
			</div>
		</form>
	{/if}
</Dialog>

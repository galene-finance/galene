<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '$lib/components/ui/Button.svelte';
	import ColorPicker from '$lib/components/ui/ColorPicker.svelte';
	import Combobox from '$lib/components/ui/Combobox.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Title from '$lib/components/Title.svelte';
	import { toastFormResult } from '$lib/toasts';
	import { CATEGORY_TYPES } from '$lib/types';
	import type { Category, CategoryType } from '$lib/types';

	let {
		form,
		data
	}: {
		form:
			| { error?: string | null; ok?: boolean; message?: string | null; source?: string }
			| undefined;
		data: { categories: Category[] };
	} = $props();

	const typeItems = CATEGORY_TYPES.map((t) => ({
		value: t,
		label: t.charAt(0).toUpperCase() + t.slice(1)
	}));

	// --- Create / Edit dialog ---
	let editOpen = $state(false);
	let catEditId = $state<number | null>(null);
	let catName = $state('');
	let catType = $state<CategoryType>('expense');
	let catParent = $state('');
	let catColor = $state('');
	let editError = $state('');

	const parentItems = $derived(
		data.categories
			.filter((c) => c.id !== catEditId)
			.map((c) => ({ value: String(c.id), label: c.name }))
	);

	function openCreate() {
		catEditId = null;
		catName = '';
		catType = 'expense';
		catParent = '';
		catColor = '';
		editError = '';
		editOpen = true;
	}

	function openEdit(c: Category) {
		catEditId = c.id;
		catName = c.name;
		catType = c.type;
		catParent = c.parent_id ? String(c.parent_id) : '';
		catColor = c.color ?? '';
		editError = '';
		editOpen = true;
	}

	function closeEdit() {
		editOpen = false;
		catEditId = null;
		catName = '';
		catType = 'expense';
		catParent = '';
		catColor = '';
		editError = '';
	}

	// --- Delete dialog ---
	let deleteOpen = $state(false);
	let pendingDelete = $state<Category | null>(null);
	let reassignTo = $state('none');
	let deleteError = $state('');

	/** Ids under a category (for excluding from reassign targets). */
	function descendantIds(rootId: number): Set<number> {
		const children = new Map<number, number[]>();
		for (const c of data.categories) {
			if (c.parent_id == null) continue;
			const list = children.get(c.parent_id) ?? [];
			list.push(c.id);
			children.set(c.parent_id, list);
		}
		const out = new Set<number>();
		const stack = [...(children.get(rootId) ?? [])];
		while (stack.length) {
			const n = stack.pop()!;
			out.add(n);
			stack.push(...(children.get(n) ?? []));
		}
		return out;
	}

	const reassignItems = $derived.by(() => {
		const items = [{ value: 'none', label: 'None (uncategorized)' }];
		if (!pendingDelete) return items;
		const blocked = descendantIds(pendingDelete.id);
		blocked.add(pendingDelete.id);
		for (const c of data.categories) {
			if (blocked.has(c.id)) continue;
			const suffix = c.type === 'transfer' ? ' (transfer)' : '';
			items.push({ value: String(c.id), label: `${c.name}${suffix}` });
		}
		return items;
	});

	function openDelete(c: Category) {
		pendingDelete = c;
		reassignTo = 'none';
		deleteError = '';
		deleteOpen = true;
	}

	function closeDelete() {
		deleteOpen = false;
		pendingDelete = null;
		reassignTo = 'none';
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

<Title title="Categories" />

<div class="mx-auto flex max-w-3xl flex-col gap-4 2xl:max-w-5xl">
	<a href="/settings" class="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
		>← Back to Settings</a
	>
	<div class="flex flex-wrap items-center justify-between gap-3">
		<h1 class="text-2xl font-semibold tracking-tight">Categories</h1>
		<Button type="button" onclick={openCreate}>Add category</Button>
	</div>

	<section class="rounded-lg border border-border bg-surface">
		<div class="border-b border-border px-4 py-3">
			<h2 class="font-medium">Categories</h2>
			<p class="text-sm text-muted-foreground">
				Named category buckets and transfers, with optional subcategories. Transfer categories
				(for example credit card payments) move money between your accounts and are excluded from
				cashflow income/expense and other income/expense reports and budgets by default.
			</p>
		</div>
		<div class="p-4">
			{#if data.categories.length === 0}
				<p class="py-4 text-center text-sm text-muted-foreground">No categories yet.</p>
			{:else}
				<ul class="divide-y divide-border">
					{#each data.categories as category (category.id)}
						<li class="flex items-center gap-3 py-2.5">
							<span
								class="size-3 shrink-0 rounded-full"
								style="background: {category.color ?? 'transparent'}"
							></span>
							<span class="flex-1 truncate text-sm">{category.name}</span>
							{#if category.type === 'transfer'}
								<span
									class="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
									title="Excluded from cashflow income/expense by default"
								>
									<svg
										class="size-3"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
										aria-hidden="true"
									>
										<path d="M7 16V4m0 0L3 8m4-4l4 4" />
										<path d="M17 8v12m0 0l4-4m-4 4l-4-4" />
									</svg>
									transfer
								</span>
							{/if}
							<button
								type="button"
								class="text-sm text-primary hover:underline"
								onclick={() => openEdit(category)}
							>
								Edit
							</button>
							<button
								type="button"
								class="text-sm text-destructive hover:underline"
								onclick={() => openDelete(category)}
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
	title={catEditId ? 'Edit category' : 'Add category'}
	description={catEditId
		? 'Update this category. Transfer categories stay out of cashflow income/expense by default.'
		: 'Create a named category bucket (or a transfer). Optional subcategory and color.'}
>
	<form method="POST" action="?/save-category" use:enhance class="flex flex-col gap-4">
		<input type="hidden" name="id" value={catEditId ?? ''} />
		<Field label="Name" error={editError || null}>
			<Input type="text" name="name" bind:value={catName} required placeholder="e.g. Groceries" />
		</Field>
		<Field
			label="Type"
			hint="Expense/income is only a create hint. Transfer is excluded from cashflow and budgets by default."
		>
			<Select name="type" bind:value={catType} items={typeItems} />
		</Field>
		<Field label="Subcategory of">
			<Combobox name="parent" bind:value={catParent} items={parentItems} placeholder="None (top level)" />
		</Field>
		<Field label="Color">
			<ColorPicker name="color" bind:value={catColor} />
		</Field>
		<div class="flex justify-end gap-2">
			<Button type="button" variant="secondary" onclick={closeEdit}>Cancel</Button>
			<Button type="submit">{catEditId ? 'Save changes' : 'Add category'}</Button>
		</div>
	</form>
</Dialog>

<Dialog
	bind:open={deleteOpen}
	title={pendingDelete ? `Delete ${pendingDelete.name}?` : 'Delete category?'}
	description="Transactions on this category (and any subcategories) move to the choice below, then the category is removed. Subcategories are deleted with it."
>
	{#if pendingDelete}
		<form method="POST" action="?/delete-category" use:enhance class="flex flex-col gap-4">
			<input type="hidden" name="id" value={pendingDelete.id} />
			<Field label="Move transactions to…" error={deleteError || null}>
				<Select name="reassign_to" bind:value={reassignTo} items={reassignItems} />
			</Field>
			<div class="flex justify-end gap-2">
				<Button type="button" variant="secondary" onclick={closeDelete}>Cancel</Button>
				<Button type="submit" variant="destructive">Delete category</Button>
			</div>
		</form>
	{/if}
</Dialog>

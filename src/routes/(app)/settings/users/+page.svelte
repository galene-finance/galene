<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import Button from '$lib/components/ui/Button.svelte';
	import Checkbox from '$lib/components/ui/Checkbox.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Title from '$lib/components/Title.svelte';
	import { toast } from '$lib/toasts';
	import type { UserRow } from '$lib/server/users';
	import { formatDate } from '$lib/utils';

	let {
		form,
		data
	}: {
		form: {
			ok?: boolean;
			error?: string | null;
			message?: string;
			source?: 'create' | 'toggle' | 'delete' | 'reset';
			name?: string;
			email?: string;
		} | undefined;
		data: { users: UserRow[]; me: number };
	} = $props();

	// --- Create form ---
	let name = $state('');
	let email = $state('');
	let password = $state('');
	let makeAdmin = $state(false);
	let loadDemo = $state(false);

	// Re-seed name/email from a failed submission so they survive the re-render
	// (the component's local state is reset when the form data updates).
	$effect(() => {
		if (form?.name) name = form.name;
		if (form?.email) email = form.email;
	});

	// --- Dialog (reset password / delete) ---
	let pending = $state<{ kind: 'delete' | 'reset'; user: UserRow } | null>(null);
	let dialogOpen = $state(false);
	let confirm = $state('');
	let newPass = $state('');
	let dialogError = $state('');

	function openDialog(kind: 'delete' | 'reset', user: UserRow) {
		pending = { kind, user };
		confirm = '';
		newPass = '';
		dialogError = '';
		dialogOpen = true;
	}

	function close() {
		dialogOpen = false;
		pending = null;
		confirm = '';
		newPass = '';
		dialogError = '';
	}

	// A failed dialog submission keeps the dialog open and shows the server's
	// message (a stale error from an earlier submission is dropped when the
	// dialog reopens).
	let lastError = $state<string | null>(null);
	$effect(() => {
		const e = form?.error ?? null;
		if (e !== lastError) {
			lastError = e;
			if (form?.source === 'delete' || form?.source === 'reset') dialogError = e ?? '';
		}
	});

	// A successful submission closes the dialog, clears the create form, and
	// refreshes the list (and the layout's user state). The identity guard
	// makes the effect react only to *new* action results — otherwise opening
	// the dialog (which changes `pending`) would re-run it against a stale
	// success and close the dialog again.
	let lastForm: typeof form | null = null;
	$effect(() => {
		if (form === lastForm) return;
		lastForm = form;
		// Toast the result (replaces the old top-of-page status block): the
		// success message, or a failed admin toggle. Other errors surface
		// inline (create form) or in the dialog.
		if (form?.message) toast(form.message, 'success');
		else if (form?.error && form?.source === 'toggle') toast(form.error, 'error');
		if (!form?.ok) return;
		if (pending) close();
		if (form.source === 'create') {
			name = '';
			email = '';
			password = '';
			makeAdmin = false;
			loadDemo = false;
		}
		invalidateAll();
	});

	const matches = $derived(confirm.trim() === pending?.user.name);
</script>

<Title title="Users" />

<div class="mx-auto flex max-w-3xl flex-col gap-4 2xl:max-w-5xl">
	<a href="/settings" class="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
		>← Back to Settings</a
	>
	<h1 class="text-2xl font-semibold tracking-tight">Users</h1>

	<section class="rounded-lg border border-border bg-surface">
		<div class="border-b border-border px-4 py-3">
			<h2 class="font-medium">Create an account</h2>
			<p class="text-sm text-muted-foreground">New accounts sign in with the password you set here.</p>
		</div>
		<div class="p-4">
			<form method="POST" action="?/create" use:enhance class="flex flex-col gap-3">
				<div class="grid gap-3 sm:grid-cols-2">
					<Field label="Name">
						<Input
							type="text"
							name="name"
							bind:value={name}
							required
							autocomplete="off"
							placeholder="Display name"
						/>
					</Field>
					<Field label="Email">
						<Input
							type="email"
							name="email"
							bind:value={email}
							required
							autocomplete="off"
							placeholder="you@example.com"
						/>
					</Field>
				</div>
				<Field label="Password" hint="At least 8 characters">
					<Input
						type="password"
						name="password"
						bind:value={password}
						required
						autocomplete="new-password"
						placeholder="••••••••"
					/>
				</Field>
				<div class="flex flex-wrap items-start gap-x-6 gap-y-2">
					<Checkbox bind:checked={makeAdmin} name="is_admin" label="Make admin" class="mt-0.5" />
					<div class="flex items-start gap-2">
						<Checkbox bind:checked={loadDemo} name="demo_data" label="Load demo data" class="mt-0.5" />
						<p class="text-xs leading-4 text-muted-foreground">
							Sample accounts, ~3 months of transactions, budgets, and rules.
						</p>
					</div>
				</div>
				{#if form?.error && form?.source === 'create'}
					<p class="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{form.error}</p>
				{/if}
				<div class="flex justify-end">
					<Button type="submit">Create account</Button>
				</div>
			</form>
		</div>
	</section>

	<section class="rounded-lg border border-border bg-surface">
		<div class="border-b border-border px-4 py-3">
			<h2 class="font-medium">Accounts ({data.users.length})</h2>
			<p class="text-sm text-muted-foreground">
				Admins can manage every account on this server. Deleting an account removes all of its data.
			</p>
		</div>
		<div class="p-4">
			<ul class="divide-y divide-border">
				{#each data.users as u (u.id)}
					<li class="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
						<div class="min-w-0 flex-1">
							<p class="text-sm font-medium">
								{u.name}
								{#if u.is_admin}
									<span class="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary"
										>Admin</span
									>
								{/if}
								{#if u.id === data.me}
									<span class="ml-1 text-xs font-normal text-muted-foreground">(you)</span>
								{/if}
							</p>
							<p class="text-sm text-muted-foreground">
								{u.email} · created {formatDate(u.created_at.slice(0, 10))}
							</p>
						</div>
						<div class="flex shrink-0 flex-wrap items-center gap-2">
							{#if u.id !== data.me}
								<form method="POST" action="?/toggle-admin" use:enhance>
									<input type="hidden" name="id" value={u.id} />
									<input type="hidden" name="make_admin" value={u.is_admin ? '0' : '1'} />
									<Button type="submit" variant="secondary" size="sm">
										{u.is_admin ? 'Remove admin' : 'Make admin'}
									</Button>
								</form>
							{/if}
							<Button variant="secondary" size="sm" onclick={() => openDialog('reset', u)}>
								Reset password
							</Button>
							{#if u.id !== data.me}
								<Button variant="destructive" size="sm" onclick={() => openDialog('delete', u)}>
									Delete
								</Button>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		</div>
	</section>
</div>

<Dialog
	bind:open={dialogOpen}
	title={
		pending
			? pending.kind === 'delete'
				? `Delete ${pending.user.name}?`
				: `Reset ${pending.user.name}'s password?`
			: ''
	}
	description={
		pending
			? pending.kind === 'delete'
				? 'This permanently removes the account and all of its data: accounts, transactions, categories, tags, budgets, scheduled expectations, rules, bank connections, and themes.'
				: 'The user signs in with the new password.'
			: ''
	}
>
	{#if pending}
		<form
			method="POST"
			action={pending.kind === 'delete' ? '?/delete' : '?/reset-password'}
			use:enhance
			class="flex flex-col gap-4"
		>
			<input type="hidden" name="id" value={pending.user.id} />
			{#if pending.kind === 'delete'}
				<Field label={`Type the user's name, "${pending.user.name}", to confirm`} error={dialogError || null}>
					<Input
						type="text"
						name="confirm"
						bind:value={confirm}
						placeholder={pending.user.name}
						autocomplete="off"
						autocapitalize="off"
						spellcheck="false"
					/>
				</Field>
			{:else}
				<Field label="New password" hint="At least 8 characters" error={dialogError || null}>
					<Input
						type="password"
						name="password"
						bind:value={newPass}
						autocomplete="new-password"
						placeholder="••••••••"
					/>
				</Field>
			{/if}
			<div class="flex justify-end gap-2">
				<Button type="button" variant="secondary" onclick={close}>Cancel</Button>
				<Button
					type="submit"
					variant={pending.kind === 'delete' ? 'destructive' : 'primary'}
					disabled={pending.kind === 'delete' ? !matches : newPass.length === 0}
				>
					{pending.kind === 'delete' ? 'Delete account' : 'Update password'}
				</Button>
			</div>
		</form>
	{/if}
</Dialog>

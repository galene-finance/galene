<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '$lib/components/ui/Button.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Title from '$lib/components/Title.svelte';
	import { toastFormResult } from '$lib/toasts';

	let { data, form } = $props();

	let shareUrl = $state('');
	let lastForm: typeof form | null = null;

	$effect(() => {
		if (form === lastForm) return;
		lastForm = form;
		toastFormResult(form ?? undefined);
		if (form && 'shareUrl' in form && form.shareUrl) shareUrl = String(form.shareUrl);
	});
</script>

<Title title="Advisor access" />

<div class="mx-auto flex min-w-0 max-w-3xl flex-col gap-6">
	<div>
		<a href="/settings" class="text-sm text-muted-foreground hover:text-foreground">← Settings</a>
		<h1 class="mt-2 text-2xl font-semibold tracking-tight">Advisor access</h1>
		<p class="mt-1 text-sm text-muted-foreground">
			Generate a frozen accountant pack or invite a read-only viewer. Links expire and can be revoked.
			Balances in a pack are the ledger through the end of the date range.
		</p>
	</div>

	<form
		method="POST"
		action="?/create"
		use:enhance
		class="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
	>
		{#if form && 'error' in form && form.error}
			<p class="text-sm text-destructive">{form.error}</p>
		{/if}
		<Field label="Label">
			<Input name="label" required maxlength={80} placeholder="2025 tax pack" />
		</Field>
		<div class="flex flex-wrap gap-4 text-sm">
			<label class="flex items-center gap-2"><input type="radio" name="kind" value="pack" checked /> Accountant pack</label>
			<label class="flex items-center gap-2"><input type="radio" name="kind" value="viewer" /> Read-only viewer</label>
		</div>
		<div class="grid gap-3 sm:grid-cols-3">
			<Field label="Year">
				<Input name="year" type="number" min="1970" max="2100" value={data.year} />
			</Field>
			<Field label="From">
				<Input name="date_from" type="date" />
			</Field>
			<Field label="To">
				<Input name="date_to" type="date" />
			</Field>
		</div>
		<Field label="Link lifetime (days, 1–30)">
			<Input name="ttl_days" type="number" min="1" max="30" value="14" />
		</Field>
		<Field label="Optional link password">
			<Input name="password" type="password" autocomplete="new-password" />
		</Field>
		{#if data.accounts.length > 0}
			<fieldset class="text-sm">
				<legend class="mb-1 font-medium">Accounts (leave empty for all)</legend>
				<div class="flex flex-col gap-1">
					{#each data.accounts as account (account.id)}
						<label class="flex items-center gap-2">
							<input type="checkbox" name="account_ids" value={account.id} />
							{account.name}
						</label>
					{/each}
				</div>
			</fieldset>
		{/if}
		<Button type="submit">Create</Button>
	</form>

	{#if shareUrl}
		<div class="rounded-lg border border-border bg-surface p-4 text-sm">
			<p class="font-medium">Link (shown once)</p>
			<p class="mt-1 break-all font-mono text-xs">{shareUrl}</p>
			{#if form && 'downloadId' in form && form.downloadId}
				<a class="mt-2 inline-block text-primary underline" href="/settings/advisor/pack/{form.downloadId}">Download zip</a>
			{/if}
		</div>
	{/if}

	<section class="flex flex-col gap-2">
		<h2 class="text-lg font-medium">Grants</h2>
		{#if data.grants.length === 0}
			<p class="text-sm text-muted-foreground">No grants yet.</p>
		{:else}
			<ul class="flex flex-col gap-2">
				{#each data.grants as grant (grant.id)}
					<li class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
						<div>
							<p class="font-medium">{grant.label}</p>
							<p class="text-muted-foreground">
								{grant.kind} · {grant.date_from} – {grant.date_to} ·
								{grant.revoked_at ? 'revoked' : grant.active ? 'active' : 'expired'}
								{#if grant.has_password} · password{/if}
							</p>
						</div>
						<div class="flex items-center gap-2">
							{#if grant.kind === 'pack'}
								<a class="text-primary underline" href="/settings/advisor/pack/{grant.id}">Download</a>
							{/if}
							{#if !grant.revoked_at}
								<form method="POST" action="?/revoke" use:enhance>
									<input type="hidden" name="id" value={grant.id} />
									<Button type="submit" variant="secondary">Revoke</Button>
								</form>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section>
		<h2 class="text-lg font-medium">Audit</h2>
		<ul class="mt-2 flex flex-col gap-1 text-sm text-muted-foreground">
			{#each data.audit as row (row.id)}
				<li>{row.created_at} · {row.event}{row.detail ? ` · ${row.detail}` : ''}</li>
			{/each}
		</ul>
	</section>
</div>

<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { deserialize, enhance } from '$app/forms';
	import { toast } from '$lib/toasts';
	import Button from '$lib/components/ui/Button.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Title from '$lib/components/Title.svelte';
	import { openPlaidLink, preloadPlaidLink, type PlaidLinkHandler } from '$lib/plaidLink';
	import AccountMapping from './AccountMapping.svelte';
	import { mergedNote } from '$lib/utils';
	import type { Connection, LinkedAccount, ProviderInfo } from '$lib/types';

	/** Auto-sync choices in minutes; the server filters out ones under the provider's minimum. */
	const FREQ_OPTIONS = [
		{ value: '', label: 'Manual only' },
		{ value: '15', label: 'Every 15 minutes' },
		{ value: '30', label: 'Every 30 minutes' },
		{ value: '60', label: 'Every hour' },
		{ value: '120', label: 'Every 2 hours' },
		{ value: '240', label: 'Every 4 hours' },
		{ value: '360', label: 'Every 6 hours' },
		{ value: '720', label: 'Every 12 hours' },
		{ value: '1440', label: 'Every day' },
		{ value: '2880', label: 'Every 2 days' },
		{ value: '4320', label: 'Every 3 days' },
		{ value: '10080', label: 'Every week' }
	];
	function freqOptions(p: ProviderInfo) {
		const min = p.minSyncIntervalMinutes ?? 0;
		return FREQ_OPTIONS.filter((o) => o.value === '' || Number(o.value) >= min);
	}

	// Plaid Link: the server mints a one-time link token, the widget returns a
	// one-time public token, and the hidden form field carries that to the
	// connect action for exchange.
	let plaidForm = $state<HTMLFormElement | null>(null);
	let plaidPublicToken = $state('');
	let plaidError = $state('');
	let plaidOpening = $state(false);
	let plaidHandler = $state<PlaidLinkHandler | null>(null);
	onDestroy(() => plaidHandler?.destroy());
	onMount(() => {
		if (data.providers.some((p) => p.link)) preloadPlaidLink();
	});

	async function openPlaid(p: ProviderInfo) {
		if (!p.link || plaidOpening || !plaidForm) return;
		plaidError = '';
		plaidOpening = true;
		try {
			// Mint the one-time link token server-side, then hand it to the widget.
			const response = await fetch(new URL('?/link-token', window.location.href), {
				method: 'POST',
				body: new FormData()
			});
			const res = deserialize(await response.text());
			const d =
				'data' in res ? (res.data as { token?: string; error?: string } | undefined) : undefined;
			if (!d?.token) throw new Error(d?.error ?? 'Could not start a Plaid session.');
			plaidHandler = await openPlaidLink({
				token: d.token,
				onSuccess: async (publicToken) => {
					plaidPublicToken = publicToken;
					await tick(); // let the hidden input pick up the token before submit
					plaidForm?.requestSubmit();
					// Success never fires onExit, so clear the flag here or the button
					// stays stuck on "Opening Plaid…" until a refresh.
					plaidOpening = false;
				},
				onExit: (message) => {
					plaidOpening = false;
					if (message) plaidError = message;
				}
			});
		} catch (error) {
			plaidOpening = false;
			plaidError = error instanceof Error ? error.message : 'Could not open Plaid Link.';
		}
	}

	let {
		form,
		data
	}: {
		form:
			| {
					error?: string;
					message?: string;
					ok?: boolean;
					accounts?: number;
					created?: number;
					updated?: number;
					merged?: number;
					lastSyncedAt?: string;
			  }
			| undefined;
		data: {
			providers: ProviderInfo[];
			connections: Connection[];
			linked: Record<string, LinkedAccount[]>;
			allAccounts: { id: number; name: string; type: string; provider: string | null; external_id: string | null }[];
			userId: number;
			plaid: { clientId: string; env: string; sandboxInstance: string; secretConfigured: boolean };
		};
	} = $props();

	function formatTime(s: string | null): string {
		if (!s) return 'never';
		return new Date(s.replace(' ', 'T') + 'Z').toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	}

	let freqForms = $state<Record<string, HTMLFormElement | null>>({});

	// Plaid is configured per user: the form pre-fills from the saved values
	// and a save action persists them before the Link widget is opened. The
	// secret is never pre-filled — it is not sent to the browser, so the
	// field starts empty and an empty save keeps the stored secret.
	let plaidClientId = $state(data.plaid.clientId);
	let plaidClientSecret = $state('');
	let plaidEnv = $state(data.plaid.env);
	let plaidSandbox = $state(data.plaid.sandboxInstance);
	let plaidSecretRevealed = $state(false);

	// Toast the latest action result (replaces the old top-of-page status block).
	// The identity guard makes the effect react only to *new* results. A sync
	// success carries no message, so its summary sentence is composed here.
	let lastForm = form;
	$effect(() => {
		if (form === lastForm) return;
		lastForm = form;
		if (form?.error) toast(form.error, 'error');
		else if (form?.message) toast(form.message, 'success');
		else if (form?.lastSyncedAt)
			toast(
				`Synced ${form.accounts} account${form.accounts === 1 ? '' : 's'}: ${form.created} new transaction${form.created === 1 ? '' : 's'}, ${form.updated} updated${mergedNote(form)}.`,
				'success'
			);
	});
</script>

<Title title="Bank sync" />

<div class="mx-auto flex max-w-3xl flex-col gap-4 2xl:max-w-5xl">
	<a href="/settings" class="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
		>← Back to Settings</a
	>
	<h1 class="text-2xl font-semibold tracking-tight">Bank sync</h1>

	{#each data.providers as p (p.id)}
		{@const conn = data.connections.find((c) => c.provider === p.id)}
		<section class="rounded-lg border border-border bg-surface">
			<div class="border-b border-border px-4 py-3">
				<h2 class="font-medium">{p.label}</h2>
				<p class="text-sm text-muted-foreground">{p.description}</p>
			</div>
			<div class="p-4">
				{#if p.id === 'plaid'}
					<!-- reset: false so a successful save doesn't blank the fields: use:enhance's
						default form.reset() would revert them to their initial (empty) values. -->
					<form
						method="POST"
						action="?/save-plaid"
						use:enhance={() => ({ update }) => update({ reset: false })}
						class="flex flex-col gap-3"
					>
						<div class="flex flex-wrap gap-3">
							<Field label="Client ID" class="w-56">
								<Input type="text" name="plaid_client_id" bind:value={plaidClientId} placeholder="Your Plaid client ID" />
							</Field>
							<Field label="Client secret" class="w-56">
								<Input
									type={plaidSecretRevealed ? 'text' : 'password'}
									name="plaid_client_secret"
									bind:value={plaidClientSecret}
									placeholder={data.plaid.secretConfigured ? 'Leave blank to keep current' : 'Your Plaid client secret'}
								/>
							</Field>
						</div>
						<div class="flex flex-wrap items-end gap-3">
							<Field label="Environment" class="w-40">
								<Select
									name="plaid_env"
									value={plaidEnv}
									items={[
										{ value: 'sandbox', label: 'Sandbox' },
										{ value: 'production', label: 'Production' }
									]}
									onValueChange={(v) => (plaidEnv = v)}
								/>
							</Field>
							{#if plaidEnv === 'sandbox'}
								<Field label="Sandbox instance" class="w-56">
									<Input type="text" name="plaid_sandbox_instance" bind:value={plaidSandbox} placeholder="Plaid dashboard → Sandbox" />
								</Field>
							{/if}
							<Button type="submit">Save Plaid settings</Button>
							<Button type="button" variant="ghost" size="sm" onclick={() => (plaidSecretRevealed = !plaidSecretRevealed)}>
								{plaidSecretRevealed ? 'Hide secret' : 'Show secret'}
							</Button>
						</div>
						{#if form?.error}
							<p class="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{form.error}</p>
						{/if}
					</form>

					{#if !p.configured}
						<p class="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">{p.configureHint}</p>
					{:else if !conn}
						<div class="my-4 border-t border-border"></div>
						<form bind:this={plaidForm} method="POST" action="?/connect" use:enhance class="flex flex-col gap-3">
							<input type="hidden" name="provider" value={p.id} />
							<input type="hidden" name="cred_public_token" value={plaidPublicToken} />
							{#if plaidError}
								<p class="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{plaidError}</p>
							{/if}
							<div>
								<Button type="button" disabled={plaidOpening} onclick={() => openPlaid(p)}>
									{plaidOpening ? 'Opening Plaid…' : 'Connect with Plaid'}
								</Button>
							</div>
						</form>
					{:else}
						<div class="flex flex-col gap-4">
							<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
								<span class="flex items-center gap-1.5">
									<span class="size-2 rounded-full {conn.status === 'connected' ? 'bg-success' : 'bg-destructive'}"></span>
									{conn.status === 'connected' ? 'Connected' : 'Error'}
								</span>
								<span class="text-muted-foreground">Last synced {formatTime(conn.last_synced_at)}</span>
							</div>
							{#if conn.last_error}
								<p class="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{conn.last_error}</p>
							{/if}
							{#if plaidError}
								<p class="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{plaidError}</p>
							{/if}

							{#if p.minSyncIntervalMinutes != null}
								<!-- use:enhance skips its default form.reset(): that would revert the
									select's hidden input and re-fire onValueChange, looping submits. -->
								<form
									bind:this={freqForms[p.id]}
									method="POST"
									action="?/interval"
									use:enhance={() => ({ update }) => update({ reset: false })}
									class="flex flex-wrap items-center gap-2"
								>
									<input type="hidden" name="provider" value={p.id} />
									<span class="text-sm text-muted-foreground">Auto-sync</span>
									<Select
										name="interval"
										value={String(conn.sync_interval_minutes ?? '')}
										items={freqOptions(p)}
										onValueChange={(v) => {
											// Skip if the server already holds this value (re-select).
											if (v === String(conn.sync_interval_minutes ?? '')) return;
											// bits-ui updates its input on the next render, so copy the
											// picked value into it before submitting the form.
											const form = freqForms[p.id];
											const input = form?.querySelector('input[name="interval"]') as
												| HTMLInputElement
												| null;
											if (input) input.value = v;
											form?.requestSubmit();
										}}
										class="w-44"
									/>
									{#if conn.next_sync_at}
										<span class="text-sm text-muted-foreground">Next sync {formatTime(conn.next_sync_at)}</span>
									{/if}
								</form>
							{/if}

							<div class="flex flex-wrap gap-2">
								<form method="POST" action="?/sync" use:enhance>
									<input type="hidden" name="provider" value={p.id} />
									<Button type="submit">Sync now</Button>
								</form>
								<form bind:this={plaidForm} method="POST" action="?/connect" use:enhance>
									<input type="hidden" name="provider" value={p.id} />
									<input type="hidden" name="cred_public_token" value={plaidPublicToken} />
									<Button type="button" variant="secondary" disabled={plaidOpening} onclick={() => openPlaid(p)}>
										{plaidOpening ? 'Opening Plaid…' : 'Link another account'}
									</Button>
								</form>
								<form method="POST" action="?/disconnect" use:enhance>
									<input type="hidden" name="provider" value={p.id} />
									<Button type="submit" variant="secondary">Disconnect</Button>
								</form>
							</div>

							{#if data.linked[p.id]?.length}
								<div>
									<p class="mb-1.5 text-sm font-medium">Linked accounts</p>
									<p class="mb-2 text-xs text-muted-foreground">
										Each source account maps to a Galene account — pick an existing one or use a custom
										name (it starts as the source's name). You can change this any time.
									</p>
									<ul class="divide-y divide-border">
										{#each data.linked[p.id] as a (a.id)}
											<li class="py-3">
												<AccountMapping provider={p.id} account={a} allAccounts={data.allAccounts} />
											</li>
										{/each}
									</ul>
								</div>
							{/if}
						</div>
					{/if}
				{:else if !p.configured}
					<p class="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
						{p.configureHint ?? 'This provider is not configured on this server.'}
					</p>
				{:else if !conn}
					{#if p.configureHint}
						<p class="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">{p.configureHint}</p>
					{:else}
						<form method="POST" action="?/connect" use:enhance class="flex flex-col gap-4">
							<input type="hidden" name="provider" value={p.id} />
							<div class="flex flex-wrap gap-3">
								{#each p.credentialFields as f (f.key)}
									<Field label={f.label} class="w-56">
										<Input
											type={f.secret ? 'password' : 'text'}
											name={`cred_${f.key}`}
											placeholder={f.placeholder ?? ''}
											required
										/>
									</Field>
								{/each}
							</div>
							<div>
								<Button type="submit">Connect</Button>
							</div>
						</form>
					{/if}
				{:else}
					<div class="flex flex-col gap-4">
						<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
							<span class="flex items-center gap-1.5">
								<span class="size-2 rounded-full {conn.status === 'connected' ? 'bg-success' : 'bg-destructive'}"></span>
								{conn.status === 'connected' ? 'Connected' : 'Error'}
							</span>
							<span class="text-muted-foreground">Last synced {formatTime(conn.last_synced_at)}</span>
						</div>
						{#if conn.last_error}
							<p class="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{conn.last_error}</p>
						{/if}

						{#if p.minSyncIntervalMinutes != null}
							<!-- use:enhance skips its default form.reset(): that would revert the
								select's hidden input and re-fire onValueChange, looping submits. -->
							<form
								bind:this={freqForms[p.id]}
								method="POST"
								action="?/interval"
								use:enhance={() => ({ update }) => update({ reset: false })}
								class="flex flex-wrap items-center gap-2"
							>
								<input type="hidden" name="provider" value={p.id} />
								<span class="text-sm text-muted-foreground">Auto-sync</span>
								<Select
									name="interval"
									value={String(conn.sync_interval_minutes ?? '')}
									items={freqOptions(p)}
									onValueChange={(v) => {
										// Skip if the server already holds this value (re-select).
										if (v === String(conn.sync_interval_minutes ?? '')) return;
										// bits-ui updates its input on the next render, so copy the
										// picked value into it before submitting the form.
										const form = freqForms[p.id];
										const input = form?.querySelector('input[name="interval"]') as
											| HTMLInputElement
											| null;
										if (input) input.value = v;
										form?.requestSubmit();
									}}
									class="w-44"
								/>
								{#if conn.next_sync_at}
									<span class="text-sm text-muted-foreground">Next sync {formatTime(conn.next_sync_at)}</span>
								{/if}
							</form>
						{/if}

						<div class="flex flex-wrap gap-2">
							<form method="POST" action="?/sync" use:enhance>
								<input type="hidden" name="provider" value={p.id} />
								<Button type="submit">Sync now</Button>
							</form>
							<form method="POST" action="?/disconnect" use:enhance>
								<input type="hidden" name="provider" value={p.id} />
								<Button type="submit" variant="secondary">Disconnect</Button>
							</form>
						</div>

						{#if data.linked[p.id]?.length}
							<div>
								<p class="mb-1.5 text-sm font-medium">Linked accounts</p>
								<p class="mb-2 text-xs text-muted-foreground">
									Each source account maps to a Galene account — pick an existing one or use a custom
									name (it starts as the source's name). You can change this any time.
								</p>
								<ul class="divide-y divide-border">
									{#each data.linked[p.id] as a (a.id)}
										<li class="py-3">
											<AccountMapping provider={p.id} account={a} allAccounts={data.allAccounts} />
										</li>
									{/each}
								</ul>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		</section>
	{/each}
</div>

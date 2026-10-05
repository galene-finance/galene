<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '$lib/components/ui/Button.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Title from '$lib/components/Title.svelte';
	import DemoReadonlyBanner from '$lib/components/DemoReadonlyBanner.svelte';
	import type { ApiTokenInfo } from '$lib/server/apiTokens';
	import { copyText } from '$lib/clipboard';
	import { watchFormToast } from '$lib/formToast.svelte';
	import { toast } from '$lib/toasts';

	let {
		form,
		data
	}: {
		form: {
			error?: string;
			mcpError?: string;
			writeError?: string;
			webhookError?: string;
			token?: string;
			tokenName?: string;
			tokenScope?: string;
			webhookSecret?: string;
			webhookName?: string;
			message?: string;
			ok?: boolean;
		} | undefined;
		data: {
			tokens: ApiTokenInfo[];
			mcpArgs: string[];
			mcpBundleHint: string;
			apiUrl: string;
			isAdmin: boolean;
			mcp: {
				enabled: boolean;
				enabledFromEnv: boolean;
				listening: boolean;
				listenUrl: string;
				path: string;
				version: string;
			} | null;
			writeApiEnabled: boolean;
			webhooks: {
				id: number;
				name: string;
				url: string;
				secret_hint: string;
				events: string[];
				fields: string[];
				created_at: string;
			}[];
			webhookEvents: string[];
			webhookFields: string[];
			audit: { id: number; action: string; resource: string; resource_id: number | null; created_at: string; token_name: string | null }[];
		};
	} = $props();

	let tokenName = $state('');
	let tokenScope = $state('read');
	let copied = $state(false);
	let secretCopied = $state(false);
	let mcpEnabled = $state(false);
	let writeEnabled = $state(false);

	$effect(() => {
		if (form?.token) {
			tokenName = '';
			tokenScope = 'read';
			copied = false;
		}
	});

	$effect(() => {
		if (!data.mcp) return;
		mcpEnabled = data.mcp.enabled;
	});

	$effect(() => {
		writeEnabled = data.writeApiEnabled;
	});

	async function copyToken() {
		if (!form?.token) return;
		const ok = await copyText(form.token);
		if (!ok) {
			toast('Could not copy — select the token manually', 'error');
			return;
		}
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	async function copySecret() {
		if (!form?.webhookSecret) return;
		const ok = await copyText(form.webhookSecret);
		if (!ok) {
			toast('Could not copy — select the secret manually', 'error');
			return;
		}
		secretCopied = true;
		setTimeout(() => (secretCopied = false), 2000);
	}

	const mcpConfig = $derived(JSON.stringify(
		{
			mcpServers: {
				galene: {
					command: 'bun',
					args: data.mcpArgs,
					env: {
						GALENE_API_URL: data.apiUrl,
						GALENE_API_TOKEN: '<paste your token here>'
					}
				}
			}
		},
		null,
		2
	));

	const mcpHttpConfig = $derived(
		data.mcp
			? JSON.stringify(
					{
						mcpServers: {
							galene: {
								url: data.mcp.listenUrl,
								headers: {
									Authorization: 'Bearer <paste your token here>'
								}
							}
						}
					},
					null,
					2
				)
			: ''
	);

	const endpoints: [path: string, desc: string][] = [
		['/api/v1/summary', 'Balance, month income/expense, recent transactions, top categories'],
		['/api/v1/accounts', 'Accounts with current balances'],
		['/api/v1/transactions', 'Transactions with filters and pagination'],
		['/api/v1/categories', 'Categories'],
		['/api/v1/tags', 'Tags'],
		['/api/v1/budgets', 'Budgets with current-period spend'],
		['/api/v1/scheduled', 'Scheduled expectations'],
		['/api/v1/cashflow', 'Forecast vs. actual by category, by month'],
		['/api/v1/notifications', 'App notifications']
	];

	watchFormToast(() => form);
</script>

<Title title="API" />

<div class="mx-auto flex max-w-3xl flex-col gap-4 2xl:max-w-5xl">
	<a href="/settings" class="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
		>← Back to Settings</a
	>
	<h1 class="text-2xl font-semibold tracking-tight">API</h1>

	
	<DemoReadonlyBanner demo={Boolean(data.demo)} feature="API tokens, the write API, and MCP" />

	<div data-demo-readonly-shell inert={data.demo || undefined} class={data.demo ? 'pointer-events-none opacity-60' : undefined}>


<section class="rounded-lg border border-border bg-surface">
		<div class="border-b border-border px-4 py-3">
			<h2 class="font-medium">API tokens</h2>
			<p class="text-sm text-muted-foreground">
				Tokens authenticate the REST API and the MCP server. Each token is read-only unless you choose write.
				Write tokens do nothing until an administrator turns the write API on. Delete a token to revoke it.
			</p>
		</div>
		<div class="p-4">
			<form method="POST" action="?/create" use:enhance class="mb-4 flex flex-wrap items-end gap-3">
				<Field label="Name" class="min-w-40 flex-1">
					<Input type="text" name="name" bind:value={tokenName} required placeholder="e.g. laptop, claude" />
				</Field>
				<Field label="Scope" class="min-w-32">
					<select name="scope" bind:value={tokenScope} class="h-9 rounded-md border border-border bg-background px-2 text-sm">
						<option value="read">Read</option>
						<option value="write">Write</option>
					</select>
				</Field>
				<Button type="submit">Create token</Button>
			</form>

			{#if form?.token}
				<div class="mb-4 rounded-md border border-border bg-background p-3">
					<p class="mb-2 text-sm">
						Token for <span class="font-medium">{form.tokenName}</span> — copy it now, it is only shown once:
					</p>
					<div class="flex items-center gap-2">
						<code class="flex-1 overflow-x-auto rounded bg-background px-2 py-1.5 font-mono text-xs">{form.token}</code>
						<Button type="button" variant="secondary" size="sm" onclick={copyToken}>{copied ? 'Copied' : 'Copy'}</Button>
					</div>
				</div>
			{/if}

			{#if data.tokens.length === 0}
				<p class="py-4 text-center text-sm text-muted-foreground">No tokens yet.</p>
			{:else}
				<!-- Narrow: Tokens B — meta on its line(s); Delete right-aligned on its own line (#148). -->
				<ul class="divide-y divide-border md:hidden">
					{#each data.tokens as t (t.id)}
						<li class="flex flex-col gap-2 py-3">
							<span class="truncate text-sm font-medium">{t.name} <span class="text-muted-foreground">({t.scope})</span></span>
							<span class="text-xs leading-snug text-muted-foreground">
								<span>created {t.created_at}</span>
								<span aria-hidden="true"> · </span>
								<span>last used {t.last_used_at ?? 'never'}</span>
							</span>
							<form method="POST" action="?/delete" class="flex justify-end">
								<input type="hidden" name="id" value={t.id} />
								<button
									type="submit"
									class="inline-flex items-center rounded-md border border-destructive/35 bg-destructive/10 px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/20"
								>
									Delete
								</button>
							</form>
						</li>
					{/each}
				</ul>
				<!-- md+: keep the existing single-row layout. -->
				<ul class="hidden divide-y divide-border md:block">
					{#each data.tokens as t (t.id)}
						<li class="flex items-center gap-3 py-2.5">
							<span class="flex-1 truncate text-sm">{t.name} <span class="text-muted-foreground">({t.scope})</span></span>
							<span class="shrink-0 text-xs text-muted-foreground">
								created {t.created_at} · last used {t.last_used_at ?? 'never'}
							</span>
							<form method="POST" action="?/delete">
								<input type="hidden" name="id" value={t.id} />
								<button type="submit" class="shrink-0 text-sm text-destructive hover:underline">Delete</button>
							</form>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</section>

	{#if data.isAdmin && data.mcp}
		<section class="rounded-lg border border-border bg-surface">
			<div class="border-b border-border px-4 py-3">
				<h2 class="font-medium">MCP HTTP</h2>
				<p class="text-sm text-muted-foreground">
					Serve MCP on the same host and port as the app at
					<code class="font-mono text-xs">{data.mcp.path}</code>. Off by default (path not live). Turn on to
					expose MCP for HTTP clients; each client sends a Settings → API token per request. No second port.
					Stdio clients can still launch the bundle without this toggle.
				</p>
			</div>
			<form
				method="POST"
				action="?/save-mcp"
				use:enhance={() => ({ update }) => update({ reset: false })}
				class="flex flex-col gap-4 p-4"
			>
				<label class="flex items-center justify-between gap-3 text-sm">
					<span>Enable MCP HTTP</span>
					<input type="checkbox" name="enabled" value="1" bind:checked={mcpEnabled} class="size-4 accent-primary" />
				</label>
				{#if data.mcp.enabledFromEnv}
					<p class="text-xs text-muted-foreground">
						Enabled is set by <code class="font-mono text-xs">GALENE_ENABLE_MCP</code> and overrides this
						checkbox at runtime.
					</p>
				{/if}

				{#if data.mcp.enabled}
					<div class="rounded-md border border-border bg-background p-3 text-sm">
						<p>
							Status:
							{#if data.mcp.listening}
								<span class="font-medium text-primary">live</span>
							{:else}
								<span class="font-medium">enabled</span>
							{/if}
							— <code class="font-mono text-xs">{data.mcp.listenUrl}</code>
						</p>
						<p class="mt-2 text-muted-foreground">
							Same port as the app (no second publish). Terminate TLS at the reverse proxy; do not expose
							plain HTTP on a public interface.
						</p>
						<p class="mt-2 mb-1 text-sm">Client config (HTTP):</p>
						<pre class="overflow-x-auto rounded bg-background p-3 font-mono text-xs">{mcpHttpConfig}</pre>
					</div>
				{/if}

				{#if form?.mcpError}
					<p class="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{form.mcpError}</p>
				{/if}

				<Button type="submit">Save MCP settings</Button>
			</form>
		</section>
	{/if}


	{#if data.isAdmin}
		<section class="rounded-lg border border-border bg-surface">
			<div class="border-b border-border px-4 py-3">
				<h2 class="font-medium">Write API</h2>
				<p class="text-sm text-muted-foreground">
					Off by default. When on, a token with write scope can change transactions, categories, schedules,
					and the same accounts, tags, budgets, rules, and splits the app already edits. Read tokens and the
					MCP tools stay read-only. Demo mode still rejects every write.
				</p>
			</div>
			<form method="POST" action="?/save-write-api" use:enhance class="flex flex-col gap-4 p-4">
				<label class="flex items-center justify-between gap-3 text-sm">
					<span>Enable write API</span>
					<input type="checkbox" name="enabled" value="1" bind:checked={writeEnabled} class="size-4 accent-primary" />
				</label>
				{#if form?.writeError}
					<p class="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{form.writeError}</p>
				{/if}
				<Button type="submit">Save write API</Button>
			</form>
		</section>
	{/if}

	<section class="rounded-lg border border-border bg-surface">
		<div class="border-b border-border px-4 py-3">
			<h2 class="font-medium">Webhooks</h2>
			<p class="text-sm text-muted-foreground">
				Each webhook has its own HTTPS URL, event list, simple filters (account, category, amount), and payload
				fields. Unselected fields are left out. Every request is HMAC-signed. There is no unsigned option. The
				signing secret is shown once, here, and can be rotated. Webhooks run after a change from the write API or
				from the app, once per save.
			</p>
		</div>
		<div class="flex flex-col gap-4 p-4">
			{#if form?.webhookSecret}
				<div class="rounded-md border border-border bg-background p-3">
					<p class="mb-2 text-sm">
						Signing secret for <span class="font-medium">{form.webhookName}</span> — copy it now. It is only shown once:
					</p>
					<div class="flex items-center gap-2">
						<code class="flex-1 overflow-x-auto rounded bg-background px-2 py-1.5 font-mono text-xs">{form.webhookSecret}</code>
						<Button type="button" variant="secondary" size="sm" onclick={copySecret}>{secretCopied ? 'Copied' : 'Copy'}</Button>
					</div>
				</div>
			{/if}
			{#if form?.webhookError}
				<p class="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{form.webhookError}</p>
			{/if}
			<form method="POST" action="?/create-webhook" use:enhance class="flex flex-col gap-3">
				<div class="flex flex-wrap gap-3">
					<Field label="Name" class="min-w-40 flex-1">
						<Input type="text" name="name" required placeholder="Ledger sync" />
					</Field>
					<Field label="HTTPS URL" class="min-w-64 flex-[2]">
						<Input type="url" name="url" required placeholder="https://example.com/hooks/galene" />
					</Field>
				</div>
				<fieldset class="flex flex-col gap-2">
					<legend class="text-sm font-medium">Events</legend>
					<div class="flex flex-wrap gap-x-3 gap-y-1">
						{#each data.webhookEvents as event (event)}
							<label class="flex items-center gap-1.5 text-xs">
								<input type="checkbox" name="events" value={event} />
								{event}
							</label>
						{/each}
					</div>
				</fieldset>
				<div class="flex flex-wrap gap-3">
					<Field label="Account id" class="w-28">
						<Input type="number" name="account_id" min="1" />
					</Field>
					<Field label="Category id" class="w-28">
						<Input type="number" name="category_id" min="1" />
					</Field>
					<Field label="Min cents" class="w-28">
						<Input type="number" name="min_amount_cents" />
					</Field>
					<Field label="Max cents" class="w-28">
						<Input type="number" name="max_amount_cents" />
					</Field>
				</div>
				<fieldset class="flex flex-col gap-2">
					<legend class="text-sm font-medium">Payload fields</legend>
					<div class="flex flex-wrap gap-x-3 gap-y-1">
						{#each data.webhookFields as field (field)}
							<label class="flex items-center gap-1.5 text-xs">
								<input type="checkbox" name="fields" value={field} />
								{field}
							</label>
						{/each}
					</div>
				</fieldset>
				<Button type="submit">Create webhook</Button>
			</form>
			{#if data.webhooks.length === 0}
				<p class="text-sm text-muted-foreground">No webhooks yet.</p>
			{:else}
				<ul class="divide-y divide-border">
					{#each data.webhooks as hook (hook.id)}
						<li class="flex flex-col gap-2 py-3 text-sm">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<span class="font-medium">{hook.name}</span>
								<span class="text-xs text-muted-foreground">secret ····{hook.secret_hint}</span>
							</div>
							<code class="overflow-x-auto font-mono text-xs">{hook.url}</code>
							<p class="text-xs text-muted-foreground">{hook.events.join(', ')}</p>
							<div class="flex justify-end gap-3">
								<form method="POST" action="?/rotate-webhook">
									<input type="hidden" name="id" value={hook.id} />
									<button type="submit" class="text-sm text-foreground hover:underline">Rotate secret</button>
								</form>
								<form method="POST" action="?/delete-webhook">
									<input type="hidden" name="id" value={hook.id} />
									<button type="submit" class="text-sm text-destructive hover:underline">Delete</button>
								</form>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</section>

	<section class="rounded-lg border border-border bg-surface">
		<div class="border-b border-border px-4 py-3">
			<h2 class="font-medium">Write audit</h2>
			<p class="text-sm text-muted-foreground">Recent write-API changes for this account: who, which token, and what changed.</p>
		</div>
		<div class="p-4">
			{#if data.audit.length === 0}
				<p class="text-sm text-muted-foreground">No write-API changes yet.</p>
			{:else}
				<ul class="divide-y divide-border text-sm">
					{#each data.audit as row (row.id)}
						<li class="flex flex-wrap gap-x-3 py-2">
							<span>{row.created_at}</span>
							<span class="font-medium">{row.action} {row.resource} {row.resource_id ?? ''}</span>
							<span class="text-muted-foreground">{row.token_name ?? 'deleted token'}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</section>

	<section class="rounded-lg border border-border bg-surface">
		<div class="border-b border-border px-4 py-3">
			<h2 class="font-medium">MCP stdio (client-launched)</h2>
			<p class="text-sm text-muted-foreground">
				Connect an MCP client (Claude Desktop, Grok, …) that launches the bundled stdio server. No Settings
				toggle required — the client starts the process. In the app image the entry is
				<code class="font-mono text-xs">mcp-bundle.js</code>; from source use
				<code class="font-mono text-xs">mcp/index.ts</code>.
			</p>
		</div>
		<div class="p-4">
			<p class="mb-2 text-sm">Add this to your client's MCP config, with one of your tokens:</p>
			<pre class="overflow-x-auto rounded bg-background p-3 font-mono text-xs">{mcpConfig}</pre>
		</div>
	</section>

	<section class="rounded-lg border border-border bg-surface">
		<div class="border-b border-border px-4 py-3">
			<h2 class="font-medium">REST API</h2>
			<p class="text-sm text-muted-foreground">
				JSON under <code class="font-mono text-xs">/api/v1</code>. Reads work with any token. Writes (POST, PATCH,
				DELETE) stay off until the write API is enabled, and then only a write-scoped token is accepted. Authenticate
				with <code class="font-mono text-xs">Authorization: Bearer &lt;token&gt;</code>. Amounts are integer cents;
				dates are YYYY-MM-DD.
			</p>
		</div>
		<div class="p-4">
			<ul class="space-y-1.5 text-sm">
				{#each endpoints as [path, desc] (path)}
					<li class="flex flex-wrap gap-x-3">
						<code class="font-mono text-xs">{path}</code>
						<span class="text-muted-foreground">{desc}</span>
					</li>
				{/each}
			</ul>
		</div>
	</section>

	</div>
</div>

<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import Button from '$lib/components/ui/Button.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Title from '$lib/components/Title.svelte';
	import { copyText } from '$lib/clipboard';
	import { toast, toastFormResult } from '$lib/toasts';

	let {
		form,
		data
	}: {
		form:
			| {
					ok?: boolean;
					error?: string;
					oidcError?: string;
					message?: string;
					secret?: string;
					qrDataUrl?: string;
					backupCodes?: string[];
			  }
			| undefined;
		data: {
			totp: { confirmedAt: string | null } | null;
			backupCodes: { total: number; unused: number };
			isAdmin: boolean;
			oidc: {
				enabled: boolean;
				mode: 'optional' | 'required';
				issuer: string;
				clientId: string;
				secretConfigured: boolean;
				secretMasked: string;
				secretFromEnv: boolean;
				enabledFromEnv: boolean;
				modeFromEnv: boolean;
				issuerFromEnv: boolean;
				clientIdFromEnv: boolean;
				scopesFromEnv: boolean;
				scopes: string;
				redirectUri: string;
				providerLabel: string;
			} | null;
		};
	} = $props();

	let code = $state('');
	let password = $state('');
	let disableCode = $state('');
	let copied = $state(false);
	let copiedCodes = $state(false);
	let copiedRedirect = $state(false);
	let secretVisible = $state(false);
	let oidcEnabled = $state(false);
	let oidcMode = $state<'optional' | 'required'>('optional');
	let oidcIssuer = $state('');
	let oidcClientId = $state('');
	let oidcSecret = $state('');
	let oidcScopes = $state('openid profile email');

	$effect(() => {
		if (!data.oidc) return;
		oidcEnabled = data.oidc.enabled;
		oidcMode = data.oidc.mode;
		oidcIssuer = data.oidc.issuer;
		oidcClientId = data.oidc.clientId;
		oidcScopes = data.oidc.scopes;
	});

	async function copyRedirect() {
		if (!data.oidc) return;
		const ok = await copyText(data.oidc.redirectUri);
		if (!ok) {
			toast('Could not copy — select the redirect URI manually', 'error');
			return;
		}
		copiedRedirect = true;
		setTimeout(() => (copiedRedirect = false), 2000);
	}

	async function copySecret() {
		if (!form?.secret) return;
		const ok = await copyText(form.secret);
		if (!ok) {
			toast('Could not copy — select the secret manually', 'error');
			return;
		}
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	async function copyBackupCodes() {
		if (!form?.backupCodes?.length) return;
		const ok = await copyText(form.backupCodes.join('\n'));
		if (!ok) {
			toast('Could not copy — select the codes manually', 'error');
			return;
		}
		copiedCodes = true;
		setTimeout(() => (copiedCodes = false), 2000);
	}

	// Toast the latest action result (replaces the old top-of-page status block).
	let lastForm = untrack(() => form);
	$effect(() => {
		if (form === lastForm) return;
		lastForm = form;
		copied = false;
		copiedCodes = false;
		if (form?.oidcError) toast(form.oidcError, 'error');
		else toastFormResult(form);
	});
</script>

<Title title="Security" />

<div class="mx-auto flex max-w-3xl flex-col gap-4 2xl:max-w-5xl">
	<a href="/settings" class="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
		>← Back to Settings</a
	>
	<h1 class="text-2xl font-semibold tracking-tight">Security</h1>

	<section class="rounded-lg border border-border bg-surface">
		<div class="border-b border-border px-4 py-3">
			<h2 class="font-medium">Two-factor authentication</h2>
			<p class="text-sm text-muted-foreground">
				With an authenticator app, signing in asks for a 6-digit code after your password.
			</p>
		</div>
		<div class="p-4">
			{#if form?.qrDataUrl}
				<!-- Enrolling: the secret and QR are shown only here, until confirmed. -->
				<div class="mb-4 flex flex-col gap-4 sm:flex-row">
					<img
						src={form.qrDataUrl}
						alt="Authenticator setup QR code"
						class="size-40 shrink-0 rounded border border-border"
					/>
					<div class="flex flex-1 flex-col gap-2">
						<p class="text-sm">Scan the code, or enter this secret manually in your authenticator app:</p>
						<div class="flex items-center gap-2">
							<code class="flex-1 overflow-x-auto rounded bg-background px-2 py-1.5 font-mono text-xs">
								{form.secret}
							</code>
							<Button type="button" variant="secondary" size="sm" onclick={copySecret}
								>{copied ? 'Copied' : 'Copy'}</Button
							>
						</div>
						<p class="text-xs text-muted-foreground">Then enter the 6-digit code the app shows to confirm.</p>
					</div>
				</div>
				<form method="POST" action="?/confirm" use:enhance class="flex flex-wrap items-end gap-3">
					<input type="hidden" name="secret" value={form.secret} />
					<Field label="Code from your authenticator app" class="min-w-40 flex-1">
						<Input
							type="text"
							name="code"
							bind:value={code}
							required
							autocomplete="one-time-code"
							placeholder="123456"
						/>
					</Field>
					<Button type="submit">Confirm</Button>
				</form>
			{:else if form?.backupCodes}
				<!-- Just confirmed: the backup codes are shown once, here. -->
				<div class="rounded-md border border-border bg-background p-3">
					<p class="mb-2 text-sm">
						Two-factor is on. Save these backup codes — each works once, in case you lose your phone:
					</p>
					<div class="flex items-center gap-2">
						<code class="flex-1 overflow-x-auto font-mono text-xs">{form.backupCodes.join('  ')}</code>
						<Button type="button" variant="secondary" size="sm" onclick={copyBackupCodes}
							>{copiedCodes ? 'Copied' : 'Copy'}</Button
						>
					</div>
					<p class="mt-3">
						<a href="/settings/security" class="text-sm font-medium text-primary hover:underline">Done</a>
					</p>
				</div>
			{:else if data.totp}
				<p class="mb-3 text-sm">
					Two-factor is on{data.totp.confirmedAt ? ` (since ${data.totp.confirmedAt})` : ''}. You have
					{data.backupCodes.unused} of {data.backupCodes.total} backup codes left.
				</p>
				<form method="POST" action="?/disable" use:enhance class="flex flex-col gap-3">
					<p class="text-sm text-muted-foreground">
						Enter your password and a code from your authenticator app (or a backup code) to turn
						two-factor off.
					</p>
					<Field label="Password">
						<Input
							type="password"
							name="password"
							bind:value={password}
							required
							autocomplete="current-password"
							placeholder="••••••••"
						/>
					</Field>
					<Field label="Code">
						<Input
							type="text"
							name="code"
							bind:value={disableCode}
							required
							autocomplete="one-time-code"
							placeholder="123456 or a backup code"
						/>
					</Field>
					<Button type="submit" variant="destructive">Turn two-factor off</Button>
				</form>
			{:else}
				<p class="mb-3 text-sm">Two-factor is off.</p>
				<form method="POST" action="?/begin" use:enhance>
					<Button type="submit">Enable authenticator</Button>
				</form>
			{/if}
		</div>
	</section>

	{#if data.isAdmin && data.oidc}
		<section class="rounded-lg border border-border bg-surface">
			<div class="border-b border-border px-4 py-3">
				<h2 class="font-medium">Single sign-on (OIDC)</h2>
				<p class="text-sm text-muted-foreground">
					Connect Authentik or another OIDC provider. Galene redirects for login and sets its own session cookie on return.
				</p>
			</div>
			<form method="POST" action="?/save-oidc" use:enhance={() => ({ update }) => update({ reset: false })} class="flex flex-col gap-4 p-4">
				<label class="flex items-center justify-between gap-3 text-sm">
					<span>Show Continue with SSO on the sign-in page</span>
					<input type="checkbox" name="enabled" value="1" bind:checked={oidcEnabled} class="size-4 accent-primary" />
				</label>
				{#if data.oidc.enabledFromEnv}
					<p class="text-xs text-muted-foreground">Enabled is set by GALENE_OIDC_ENABLED and overrides this checkbox at runtime.</p>
				{/if}

				<Field label="Issuer URL" hint="From Authentik: Application → Provider → OpenID Configuration Issuer">
					<Input type="url" name="issuer" bind:value={oidcIssuer} placeholder="https://auth.example/application/o/galene/" autocomplete="off" />
				</Field>
				<Field label="Client ID">
					<Input type="text" name="client_id" bind:value={oidcClientId} autocomplete="off" />
				</Field>
				<Field
					label="Client secret"
					hint={data.oidc.secretFromEnv
						? 'Set by GALENE_OIDC_CLIENT_SECRET. This field is not saved.'
						: data.oidc.secretConfigured
							? `Saved as ${data.oidc.secretMasked}. Leave blank to keep it.`
							: 'Required when single sign-on is on.'}
				>
					<div class="flex items-center gap-2">
						<Input
							type={secretVisible ? 'text' : 'password'}
							name="client_secret"
							bind:value={oidcSecret}
							autocomplete="off"
							placeholder={data.oidc.secretConfigured ? 'Leave blank to keep current' : ''}
							disabled={data.oidc.secretFromEnv}
						/>
						<Button type="button" variant="secondary" size="sm" onclick={() => (secretVisible = !secretVisible)}>
							{secretVisible ? 'Hide' : 'Show'}
						</Button>
					</div>
				</Field>
				<Field label="Scopes" hint="Optional. Defaults are enough for household email matching.">
					<Input type="text" name="scopes" bind:value={oidcScopes} autocomplete="off" />
				</Field>

				<fieldset class="flex flex-col gap-2">
					<legend class="text-sm font-medium">Mode</legend>
					<label class="flex items-start gap-2 text-sm">
						<input type="radio" name="mode" value="optional" bind:group={oidcMode} class="mt-1" />
						<span><span class="font-medium">Optional</span> <span class="text-muted-foreground">— password and MFA stay on the sign-in page.</span></span>
					</label>
					<label class="flex items-start gap-2 text-sm">
						<input type="radio" name="mode" value="required" bind:group={oidcMode} class="mt-1" />
						<span><span class="font-medium">Required</span> <span class="text-muted-foreground">— SSO is primary. Local password sits behind “Use local password”.</span></span>
					</label>
					<p class="text-xs text-muted-foreground">Optional is the default. Required is for a household that wants SSO first.</p>
				</fieldset>

				<div class="rounded-md border border-border bg-background p-3">
					<p class="text-sm font-medium">User mapping</p>
					<p class="mt-1 text-sm">
						Match existing user by email
						<span class="ml-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">Recommended</span>
					</p>
					<p class="mt-1 text-xs text-muted-foreground">
						SSO users must already have a Galene account with the same email. Creating an account on first login is off.
					</p>
				</div>

				<Field label="Redirect URI" hint="Paste this into the identity provider as an allowed redirect URI.">
					<div class="flex items-center gap-2">
						<Input type="text" readonly value={data.oidc.redirectUri} class="font-mono text-xs" />
						<Button type="button" variant="secondary" size="sm" onclick={copyRedirect}>
							{copiedRedirect ? 'Copied' : 'Copy'}
						</Button>
					</div>
				</Field>

				{#if form?.oidcError}
					<p class="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{form.oidcError}</p>
				{/if}

				<div class="flex flex-wrap gap-2">
					<Button type="submit">Save</Button>
					<Button type="submit" variant="secondary" formaction="?/test-oidc">Test connection</Button>
				</div>
				<p class="text-xs text-muted-foreground">
					App-native OIDC only. Forward-auth at the reverse proxy is out of scope for household v1.
					{#if data.oidc.issuerFromEnv || data.oidc.clientIdFromEnv || data.oidc.scopesFromEnv || data.oidc.modeFromEnv}
						A set GALENE_OIDC_* variable overrides the matching field here.
					{/if}
				</p>
			</form>
		</section>
	{/if}
</div>

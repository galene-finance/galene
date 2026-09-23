<script lang="ts">
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
					message?: string;
					secret?: string;
					qrDataUrl?: string;
					backupCodes?: string[];
			  }
			| undefined;
		data: {
			totp: { confirmedAt: string | null } | null;
			backupCodes: { total: number; unused: number };
		};
	} = $props();

	let code = $state('');
	let password = $state('');
	let disableCode = $state('');
	let copied = $state(false);
	let copiedCodes = $state(false);

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
		toastFormResult(form);
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
</div>

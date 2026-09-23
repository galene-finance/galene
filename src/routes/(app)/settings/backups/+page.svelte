<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import Button from '$lib/components/ui/Button.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Title from '$lib/components/Title.svelte';
	import { toastFormResult } from '$lib/toasts';
	import { formatBytes } from '$lib/utils';
	import type { BackupFile, BackupSettings } from '$lib/types';

	const INTERVAL_OPTIONS = [
		{ value: '', label: 'Off' },
		{ value: '15', label: 'Every 15 minutes' },
		{ value: '30', label: 'Every 30 minutes' },
		{ value: '60', label: 'Every hour' },
		{ value: '360', label: 'Every 6 hours' },
		{ value: '720', label: 'Every 12 hours' },
		{ value: '1440', label: 'Every day' },
		{ value: '2880', label: 'Every 2 days' },
		{ value: '4320', label: 'Every 3 days' },
		{ value: '10080', label: 'Every week' }
	];

	const KEEP_OPTIONS = [
		{ value: '', label: 'Keep all' },
		{ value: '7', label: '7 days' },
		{ value: '14', label: '14 days' },
		{ value: '30', label: '30 days' },
		{ value: '60', label: '60 days' },
		{ value: '90', label: '90 days' },
		{ value: '180', label: '180 days' },
		{ value: '365', label: '1 year' }
	];

	let {
		form,
		data
	}: {
		form: { ok?: boolean; error?: string | null; message?: string } | undefined;
		data: {
			settings: BackupSettings;
			backups: BackupFile[];
			backupRoot: string;
		};
	} = $props();

	// First paint snapshot. The effect copies a new server path only if the field was not edited.
	let dir = $state(untrack(() => data.settings.destDir));
	let dirFromServer = untrack(() => data.settings.destDir);
	$effect(() => {
		const next = data.settings.destDir;
		if (dir === dirFromServer) dir = next;
		dirFromServer = next;
	});


	// The selects submit on change, like the sync page's auto-sync control.
	let scheduleForm = $state<HTMLFormElement | null>(null);
	let keepForm = $state<HTMLFormElement | null>(null);

	// bits-ui updates its hidden input on the next render, so copy the picked
	// value into it before submitting the form.
	function submitSelect(form: HTMLFormElement | null, name: string, value: string) {
		const input = form?.querySelector(`input[name="${name}"]`) as HTMLInputElement | null;
		if (input) input.value = value;
		form?.requestSubmit();
	}

	// lastRunAt is ISO; nextRunAt is the DB format (UTC, space-separated).
	function formatTime(s: string | null): string {
		if (!s) return 'never';
		const iso = s.includes('T') ? s : `${s.replace(' ', 'T')}Z`;
		return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	}

	// Toast the latest action result (replaces the old top-of-page status block).
	let lastForm = untrack(() => form);
	$effect(() => {
		if (form === lastForm) return;
		lastForm = form;
		toastFormResult(form);
	});
</script>

<Title title="Backups" />

<div class="mx-auto flex max-w-3xl flex-col gap-4 2xl:max-w-5xl">
	<a href="/settings" class="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
		>← Back to Settings</a
	>
	<h1 class="text-2xl font-semibold tracking-tight">Backups</h1>
	<p class="mt-2 max-w-2xl text-sm text-muted-foreground">
		Take a backup before upgrading the app image when schema migrations may run. If category links
		were lost after an upgrade, restore the database file from a pre-upgrade backup — Galene does
		not invent a silent repair. See the self-host Backups docs.
	</p>

	<section class="rounded-lg border border-border bg-surface">
		<div class="border-b border-border px-4 py-3">
			<h2 class="font-medium">Backup folder</h2>
			<p class="text-sm text-muted-foreground">
				Where backup copies are written on this server — inside the container if you run Docker or Podman.
				Each backup is a full copy of the database file, including every user's data.
			</p>
		</div>
		<div class="p-4">
			<!-- reset: false so a successful save doesn't blank the field -->
			<form
				method="POST"
				action="?/save-dir"
				use:enhance={() => ({ update }) => update({ reset: false })}
				class="flex flex-col gap-3"
			>
				<Field
					label="Folder"
					hint={`Absolute path on this server, inside ${data.backupRoot}. In Docker or Podman mount a volume there (the compose file has a galene_backups volume for it) or backups are deleted when the container is recreated. Created if it doesn't exist.`}
				>
					<Input type="text" name="dir" bind:value={dir} placeholder={data.backupRoot} />
				</Field>
				<div>
					<Button type="submit">Save folder</Button>
				</div>
			</form>
		</div>
	</section>

	<section class="rounded-lg border border-border bg-surface">
		<div class="border-b border-border px-4 py-3">
			<h2 class="font-medium">Back up now</h2>
			<p class="text-sm text-muted-foreground">Copy the database to the backup folder right now.</p>
		</div>
		<div class="p-4">
			<form method="POST" action="?/backup-now" use:enhance>
				<Button type="submit" disabled={!data.settings.destDir}>Back up now</Button>
			</form>
			<p class="mt-3 text-sm text-muted-foreground">
				Last backup: {formatTime(data.settings.lastRunAt)}
			</p>
			{#if data.settings.lastError}
				<p class="mt-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
					Last run failed: {data.settings.lastError}
				</p>
			{/if}
		</div>
	</section>

	<section class="rounded-lg border border-border bg-surface">
		<div class="border-b border-border px-4 py-3">
			<h2 class="font-medium">Scheduled backups</h2>
			<p class="text-sm text-muted-foreground">
				Run a backup automatically on an interval. The first one happens one interval after you turn this on.
			</p>
		</div>
		<div class="p-4">
			<!-- use:enhance skips its default form.reset(): that would revert the
				select's hidden input and re-fire onValueChange, looping submits. -->
			<form
				bind:this={scheduleForm}
				method="POST"
				action="?/save-schedule"
				use:enhance={() => ({ update }) => update({ reset: false })}
				class="flex flex-wrap items-center gap-2"
			>
				<span class="text-sm text-muted-foreground">Interval</span>
				<Select
					name="interval"
					value={String(data.settings.intervalMinutes ?? '')}
					placeholder="Off"
					items={INTERVAL_OPTIONS}
					onValueChange={(v) => {
						// Skip if the server already holds this value (re-select).
						if (v === String(data.settings.intervalMinutes ?? '')) return;
						submitSelect(scheduleForm, 'interval', v);
					}}
					class="w-44"
				/>
			</form>
			{#if data.settings.nextRunAt}
				<p class="mt-2 text-sm text-muted-foreground">Next backup {formatTime(data.settings.nextRunAt)}</p>
			{/if}
		</div>
	</section>

	<section class="rounded-lg border border-border bg-surface">
		<div class="border-b border-border px-4 py-3">
			<h2 class="font-medium">Keep backups for</h2>
			<p class="text-sm text-muted-foreground">
				Older backups are deleted automatically after each backup run, so the folder doesn't grow without
				bound.
			</p>
		</div>
		<div class="p-4">
			<!-- use:enhance skips its default form.reset(): that would revert the
				select's hidden input and re-fire onValueChange, looping submits. -->
			<form
				bind:this={keepForm}
				method="POST"
				action="?/save-keep"
				use:enhance={() => ({ update }) => update({ reset: false })}
				class="flex flex-wrap items-center gap-2"
			>
				<span class="text-sm text-muted-foreground">Keep the last</span>
				<Select
					name="keep"
					value={String(data.settings.keepDays ?? '')}
					placeholder="Keep all"
					items={KEEP_OPTIONS}
					onValueChange={(v) => {
						// Skip if the server already holds this value (re-select).
						if (v === String(data.settings.keepDays ?? '')) return;
						submitSelect(keepForm, 'keep', v);
					}}
					class="w-44"
				/>
			</form>
		</div>
	</section>

	<section class="rounded-lg border border-border bg-surface">
		<div class="border-b border-border px-4 py-3">
			<h2 class="font-medium">Existing backups</h2>
			<p class="text-sm text-muted-foreground">
				{data.backups.length
					? `${data.backups.length} in ${data.settings.destDir}`
					: 'No backups yet.'}
			</p>
		</div>
		<div class="p-4">
			{#if data.backups.length}
				<ul class="divide-y divide-border">
					{#each data.backups as b (b.filename)}
						<li class="flex items-center gap-3 py-3">
							<div class="min-w-0 flex-1">
								<p class="truncate font-mono text-sm">{b.filename}</p>
								<p class="text-sm text-muted-foreground">
									{formatTime(b.createdAt)} · {formatBytes(b.sizeBytes)}
								</p>
							</div>
							<form method="POST" action="?/delete-backup" use:enhance>
								<input type="hidden" name="filename" value={b.filename} />
								<Button type="submit" variant="ghost" size="sm" class="text-destructive">Delete</Button>
							</form>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-sm text-muted-foreground">
					{data.settings.destDir
						? 'No backups in that folder yet. Use "Back up now" to make one.'
						: 'Set a backup folder above, then use "Back up now" to make one.'}
				</p>
			{/if}
		</div>
	</section>
</div>

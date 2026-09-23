<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '$lib/components/ui/Button.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Title from '$lib/components/Title.svelte';
	import { readableOn } from '$lib/color';
	import { EMBLEM_ICON_KEY, EMBLEM_SRC, ICONS, getIcon, isEmblemIcon, normalizeBrandingIcon } from '$lib/icons';
	import { DEFAULT_THEMES, applyThemeNow, themeValue } from '$lib/themes';
	import { toastFormResult } from '$lib/toasts';
	import type { Theme, ThemeColors } from '$lib/types';

	let {
		form,
		data
	}: {
		form: { error?: string | null } | undefined;
		data: {
			themes: Theme[];
			selected: string;
			appName: string;
			icon: string;
			favicon: string;
			weekStartsOn: string;
		};
	} = $props();

	const allThemes = $derived([...DEFAULT_THEMES, ...data.themes]);
	const selectedTheme = $derived(
		allThemes.find((t) => themeValue(t) === data.selected) ?? DEFAULT_THEMES[0]
	);

	// --- Theme selection (from the grid) ---
	let selectedNow = $state(untrack(() => data.selected));
	$effect(() => {
		selectedNow = data.selected;
	});
	let selectForm = $state<HTMLFormElement | null>(null);

	function pickTheme(t: Theme) {
		selectedNow = themeValue(t);
		applyThemeNow(t);
		setTimeout(() => selectForm?.requestSubmit(), 0);
	}

	// --- Theme editor ---
	let editing = $state(false);
	let editId = $state<number | null>(null);
	let editName = $state('');
	let draft = $state<ThemeColors | null>(null);
	let dupFrom = $state('');

	const colorFields = [
		{ key: 'background', label: 'Background' },
		{ key: 'surface', label: 'Surface' },
		{ key: 'surfaceHover', label: 'Surface (hover)' },
		{ key: 'foreground', label: 'Text' },
		{ key: 'mutedForeground', label: 'Muted text' },
		{ key: 'primary', label: 'Accent' },
		{ key: 'primaryForeground', label: 'Accent contrast' },
		{ key: 'success', label: 'Positive' },
		{ key: 'destructive', label: 'Negative' },
		{ key: 'border', label: 'Border' },
		{ key: 'warning', label: 'Warning' },
		{ key: 'input', label: 'Input border' }
	] as const;

	function startEdit(t: Theme) {
		editId = t.id;
		editName = t.id === null ? `${t.name} copy` : t.name;
		draft = { ...t.colors };
		editing = true;
	}

	function newTheme() {
		startEdit(selectedTheme);
	}

	function duplicateTheme() {
		const t = allThemes.find((x) => themeValue(x) === dupFrom);
		if (t) startEdit(t);
	}

	function cancelEdit() {
		editing = false;
		editId = null;
		editName = '';
		draft = null;
	}

	// Live preview: while editing, override the theme variables on the page.
	$effect(() => {
		if (!draft) return;
		const el = document.documentElement;
		const vars: Record<string, string> = {
			'--background': draft.background,
			'--surface': draft.surface,
			'--surface-hover': draft.surfaceHover,
			'--muted': draft.surfaceHover,
			'--border': draft.border,
			'--input': draft.input,
			'--foreground': draft.foreground,
			'--muted-foreground': draft.mutedForeground,
			'--primary': draft.primary,
			'--primary-foreground': draft.primaryForeground,
			'--success': draft.success,
			'--destructive': draft.destructive,
			'--warning': draft.warning,
			'--ring': draft.primary,
			'--radius': draft.radius
		};
		for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
		return () => {
			for (const k of Object.keys(vars)) el.style.removeProperty(k);
		};
	});

	// --- Branding ---
	// First paint snapshot. The effect below applies the next saved branding.
	let appName = $state(untrack(() => data.appName));
	let icon = $state(untrack(() => normalizeBrandingIcon(data.icon)));
	let favicon = $state(untrack(() => normalizeBrandingIcon(data.favicon)));
	$effect(() => {
		appName = data.appName;
		icon = normalizeBrandingIcon(data.icon);
		favicon = normalizeBrandingIcon(data.favicon);
	});
	const faviconIcon = $derived(getIcon(favicon));

	// --- Calendar ---
	let weekStartsOn = $state(untrack(() => data.weekStartsOn));
	$effect(() => {
		weekStartsOn = data.weekStartsOn;
	});

	// Toast the latest action result (replaces the old top-of-page status block).
	let lastForm = untrack(() => form);
	$effect(() => {
		if (form === lastForm) return;
		lastForm = form;
		toastFormResult(form);
	});
</script>

<Title title="Appearance" />

<div class="mx-auto flex max-w-3xl flex-col gap-8 2xl:max-w-5xl">
	<a href="/settings" class="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
		>← Back to Settings</a
	>
	<h1 class="text-2xl font-semibold tracking-tight">Appearance</h1>

	<!-- Theme -->
	<section class="rounded-lg border border-border bg-surface">
		<div class="border-b border-border px-4 py-3">
			<h2 class="font-medium">Theme</h2>
			<p class="text-sm text-muted-foreground">
				Pick a theme for your account. Your choice is saved and applies every time you sign in.
			</p>
		</div>
		<div class="p-4">
			<form bind:this={selectForm} method="POST" action="?/select-theme" use:enhance class="hidden">
				<input type="hidden" name="theme" bind:value={selectedNow} />
			</form>

			<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
				{#each allThemes as t (t.slug)}
					<button
						type="button"
						class="group rounded-lg border-2 p-1.5 text-left transition-colors {selectedNow ===
							themeValue(t)
							? 'border-primary'
							: 'border-border hover:border-muted-foreground/40'}"
						onclick={() => pickTheme(t)}
					>
						<div class="h-20 rounded-md p-2" style="background: {t.colors.background}">
							<div class="flex h-full flex-col gap-1.5 rounded" style="background: {t.colors.surface}">
								<span class="size-3.5 rounded-sm" style="background: {t.colors.primary}"></span>
								<span class="h-1.5 w-3/4 rounded-full" style="background: {t.colors.foreground}44"></span>
								<span class="h-1.5 w-1/2 rounded-full" style="background: {t.colors.mutedForeground}55"></span>
							</div>
						</div>
						<div class="mt-1.5 flex items-center justify-between gap-1 px-0.5">
							<span class="truncate text-sm font-medium">{t.name}</span>
							{#if selectedNow === themeValue(t)}
								<svg
									class="size-4 shrink-0 text-primary"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
								>
									<path d="M20 6 9 17l-5-5" />
								</svg>
							{:else if t.id !== null}
								<span class="shrink-0 text-xs text-muted-foreground">Custom</span>
							{/if}
						</div>
					</button>
				{/each}
			</div>

			<div class="mt-4 flex flex-wrap items-center gap-3">
				<Button type="button" variant="secondary" onclick={newTheme}>New theme</Button>
				<div class="flex items-center gap-2">
					<span class="text-sm text-muted-foreground">Duplicate from</span>
					<Select
						bind:value={dupFrom}
						class="w-44"
						placeholder="Choose…"
						items={allThemes.map((t) => ({ value: themeValue(t), label: t.name }))}
					/>
				</div>
				{#if dupFrom}
					<Button type="button" variant="secondary" onclick={duplicateTheme}>Duplicate</Button>
				{/if}
			</div>

			{#each data.themes as t (t.id)}
				{#if t.id !== null}
					<div class="mt-3 flex items-center justify-between rounded-md border border-border px-3 py-2">
						<div class="flex min-w-0 items-center gap-2">
							<span class="size-3 shrink-0 rounded-full" style="background: {t.colors.primary}"></span>
							<span class="truncate text-sm">{t.name}</span>
							<span class="shrink-0 text-xs text-muted-foreground">Custom</span>
						</div>
						<div class="flex shrink-0 gap-2">
							<button type="button" class="text-sm text-primary hover:underline" onclick={() => startEdit(t)}>
								Edit
							</button>
							<form method="POST" action="?/delete-theme">
								<input type="hidden" name="id" value={t.id} />
								<button type="submit" class="text-sm text-destructive hover:underline">Delete</button>
							</form>
						</div>
					</div>
				{/if}
			{/each}

			{#if editing && draft}
				<div class="mt-4 rounded-lg border border-border p-4">
					<div class="mb-4 flex flex-wrap items-end gap-3">
						<Field label="Name" class="w-64">
							<Input type="text" bind:value={editName} maxlength={40} placeholder="My theme" />
						</Field>
						<p class="pb-2 text-xs text-muted-foreground">
							The page previews your changes live.
						</p>
					</div>

					<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
						{#each colorFields as f (f.key)}
							<div class="flex flex-col gap-1.5">
								<span class="text-xs font-medium text-muted-foreground">{f.label}</span>
								<div class="relative h-9 w-full overflow-hidden rounded-md border border-input">
									<input
										type="color"
										class="absolute -inset-2 h-[calc(100%+16px)] w-[calc(100%+16px)] cursor-pointer border-0 p-0"
										bind:value={draft[f.key]}
										aria-label={f.label}
									/>
								</div>
							</div>
						{/each}
						<div class="flex flex-col gap-1.5">
							<span class="text-xs font-medium text-muted-foreground">Card radius</span>
							<Input type="text" bind:value={draft.radius} placeholder="0.5rem" class="h-9" />
						</div>
					</div>

					<form
						method="POST"
						action="?/save-theme"
						use:enhance={() =>
						({ result, update }) => {
							if (result?.type === 'success') {
								cancelEdit();
								// A custom callback suppresses the default behavior, so
								// update() re-runs the loads with the new theme.
								void update();
							}
						}}
						class="mt-4 flex flex-wrap items-center gap-2"
					>
						<input type="hidden" name="id" value={editId ?? ''} />
						<input type="hidden" name="name" value={editName} />
						{#each colorFields as f (f.key)}
							<input type="hidden" name={f.key} value={draft[f.key]} />
						{/each}
						<input type="hidden" name="radius" value={draft.radius} />
						<Button type="submit">{editId ? 'Save changes' : 'Save theme'}</Button>
						<Button type="button" variant="secondary" onclick={cancelEdit}>Cancel</Button>
					</form>
				</div>
			{/if}
		</div>
	</section>

	<!-- Branding -->
	<section class="rounded-lg border border-border bg-surface">
		<div class="border-b border-border px-4 py-3">
			<h2 class="font-medium">Branding</h2>
			<p class="text-sm text-muted-foreground">
				The name and icon shown in the top bar, and the browser tab icon. Applies to your account only.
			</p>
		</div>
		<div class="p-4">
			<form method="POST" action="?/save-branding" use:enhance class="flex flex-col gap-5">
				<Field label="App name" hint="Leave blank to use the default (Galene)" class="max-w-xs">
					<Input type="text" name="app_name" bind:value={appName} maxlength={40} placeholder="Galene" />
				</Field>

				<div>
					<span class="mb-1.5 block text-sm font-medium">Top-left icon</span>
					<p class="mb-2 text-xs text-muted-foreground">
						Emblem is the default image. Pick a stroke icon to override it, or choose Emblem again to go back.
					</p>
					<div class="flex flex-wrap gap-1.5">
						<button
							type="button"
							class="flex size-9 items-center justify-center rounded-md border-2 transition-colors {icon === EMBLEM_ICON_KEY
								? 'border-primary bg-primary/10'
								: 'border-border hover:bg-surface-hover'}"
							onclick={() => (icon = EMBLEM_ICON_KEY)}
							aria-label="Emblem"
							title="Emblem"
						>
							<img src={EMBLEM_SRC} alt="" class="size-5 rounded-full object-cover" />
						</button>
						{#each ICONS as ic (ic.key)}
							<button
								type="button"
								class="flex size-9 items-center justify-center rounded-md border-2 transition-colors {icon === ic.key
									? 'border-primary bg-primary/10'
									: 'border-border hover:bg-surface-hover'}"
								onclick={() => (icon = ic.key)}
								aria-label={ic.label}
							>
								<svg
									class="size-4"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
								>
									{@html ic.d.map((p) => `<path d="${p}"/>`).join('')}
								</svg>
							</button>
						{/each}
					</div>
					<input type="hidden" name="icon" value={icon} />
				</div>

				<div>
					<div class="mb-1.5 flex items-center gap-3">
						<span class="text-sm font-medium">Favicon</span>
						<span class="flex items-center gap-1.5 text-xs text-muted-foreground">
							Preview
							{#if isEmblemIcon(favicon)}
								<img src={EMBLEM_SRC} alt="" class="size-7 rounded-md object-cover" />
							{:else}
								<span
									class="flex size-7 items-center justify-center rounded-md"
									style="background: {selectedTheme.colors.primary}"
								>
									<svg
										class="size-4"
										style="color: {readableOn(selectedTheme.colors.primary)}"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
									>
										{@html faviconIcon.d.map((p) => `<path d="${p}"/>`).join('')}
									</svg>
								</span>
							{/if}
						</span>
					</div>
					<p class="mb-2 text-xs text-muted-foreground">
						Emblem is the default tab icon. Pick a stroke icon to override, or Emblem to restore the image.
					</p>
					<div class="flex flex-wrap gap-1.5">
						<button
							type="button"
							class="flex size-9 items-center justify-center rounded-md border-2 transition-colors {favicon === EMBLEM_ICON_KEY
								? 'border-primary bg-primary/10'
								: 'border-border hover:bg-surface-hover'}"
							onclick={() => (favicon = EMBLEM_ICON_KEY)}
							aria-label="Emblem"
							title="Emblem"
						>
							<img src={EMBLEM_SRC} alt="" class="size-5 rounded-full object-cover" />
						</button>
						{#each ICONS as ic (ic.key)}
							<button
								type="button"
								class="flex size-9 items-center justify-center rounded-md border-2 transition-colors {favicon === ic.key
									? 'border-primary bg-primary/10'
									: 'border-border hover:bg-surface-hover'}"
								onclick={() => (favicon = ic.key)}
								aria-label={ic.label}
							>
								<svg
									class="size-4"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
								>
									{@html ic.d.map((p) => `<path d="${p}"/>`).join('')}
								</svg>
							</button>
						{/each}
					</div>
					<input type="hidden" name="favicon" value={favicon} />
				</div>

				<div>
					<Button type="submit">Save branding</Button>
				</div>
			</form>
		</div>
	</section>

	<!-- Calendar -->
	<section class="rounded-lg border border-border bg-surface">
		<div class="border-b border-border px-4 py-3">
			<h2 class="font-medium">Calendar</h2>
			<p class="text-sm text-muted-foreground">How the calendar page lays out weeks.</p>
		</div>
		<div class="p-4">
			<form method="POST" action="?/save-week-start" use:enhance class="flex items-end gap-3">
				<Field label="Week starts on" class="w-48">
					<Select
						name="week_starts_on"
						bind:value={weekStartsOn}
						items={[
							{ value: 'sunday', label: 'Sunday' },
							{ value: 'monday', label: 'Monday' }
						]}
					/>
				</Field>
				<Button type="submit">Save</Button>
			</form>
		</div>
	</section>
</div>

<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import DropdownMenu from '$lib/components/ui/DropdownMenu.svelte';
	import ThemePicker from './ThemePicker.svelte';
	import type { AppNotification, Branding, NotificationKind, Theme, User } from '$lib/types';

	let {
		user,
		branding,
		themes = [] as Theme[],
		selectedTheme = '',
		themeAction = null as string | null,
		notifications = [] as AppNotification[],
		notificationsUnread = 0,
		open = $bindable(false)
	}: {
		user: User;
		branding: Branding;
		themes?: Theme[];
		selectedTheme?: string;
		themeAction?: string | null;
		notifications?: AppNotification[];
		notificationsUnread?: number;
		open?: boolean;
	} = $props();

	const nav = [
		{ href: '/', label: 'Home' },
		{ href: '/transactions', label: 'Transactions' },
		{ href: '/budget', label: 'Budget' },
		{ href: '/calendar', label: 'Calendar' },
		{ href: '/cashflow', label: 'Cashflow' },
		{ href: '/trends', label: 'Trends' },
		{ href: '/settings', label: 'Settings' }
	];

	function isActive(href: string) {
		const path = page.url.pathname;
		return href === '/' ? path === '/' : path.startsWith(href);
	}

	$effect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') open = false;
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	const KIND_ICONS: Record<NotificationKind, string[]> = {
		sync_failed: [
			'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
			'M12 9v4',
			'M12 17h.01'
		],
		sync_recovered: ['M22 11.08V12a10 10 0 1 1-5.93-9.14', 'm22 4-10 10.01-3-3'],
		budget_overrun: ['M21.21 15.89A10 10 0 1 1 8 2.83', 'M22 12A10 10 0 0 0 12 2v10z'],
		bill_upcoming: [
			'M8 2v4',
			'M16 2v4',
			'M3 10h18',
			'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'
		]
	};

	function kindIcon(kind: NotificationKind): string {
		return KIND_ICONS[kind].map((d) => `<path d="${d}"/>`).join('');
	}

	// The dropdown keeps its own copy of the list so opening it can refresh
	// without a page reload; the props resync it after any layout reload.
	let items = $state(notifications);
	let unread = $state(notificationsUnread);
	let menuOpen = $state(false);

	$effect(() => {
		items = notifications;
		unread = notificationsUnread;
	});

	$effect(() => {
		if (!menuOpen) return;
		void fetch('/notifications')
			.then((r) => (r.ok ? r.json() : null))
			.then((data) => {
				if (data) {
					items = data.notifications;
					unread = data.unread;
				}
			});
	});

	async function post(body: { action: string; id?: number }) {
		const r = await fetch('/notifications', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		if (!r.ok) return;
		const data = await r.json();
		items = data.notifications;
		unread = data.unread;
		invalidateAll();
	}

	async function onItemClick(e: MouseEvent, n: AppNotification) {
		e.preventDefault();
		await post({ action: 'mark_read', id: n.id });
		window.location.assign(n.link ?? '/');
	}
</script>

{#if open}
	<div class="fixed inset-0 z-30 bg-black/50 lg:hidden" role="presentation" onclick={() => (open = false)}></div>
{/if}

<header class="sticky top-0 z-40 min-w-0 overflow-x-clip border-b border-border bg-surface">
	<div class="flex h-14 min-w-0 items-center gap-2 px-3 sm:px-4">
		<button
			type="button"
			class="shrink-0 rounded-md p-2 text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground lg:hidden"
			onclick={() => (open = true)}
			aria-label="Open navigation"
		>
			<svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
				<path d="M4 6h16M4 12h16M4 18h16" />
			</svg>
		</button>

		<a href="/" class="flex min-w-0 flex-1 items-center gap-2 lg:flex-none">
			<img
				src="/brand/galene-emblem.png"
				alt=""
				width="28"
				height="28"
				class="size-7 shrink-0 rounded-full object-cover"
				decoding="async"
			/>
			<span class="truncate text-base font-semibold tracking-tight">{branding.name}</span>
		</a>

		<nav class="ml-4 hidden items-center gap-1 lg:flex">
			{#each nav as item (item.href)}
				<a
					href={item.href}
					class="rounded-md px-2.5 py-1.5 text-sm transition-colors {isActive(item.href)
						? 'bg-primary/10 font-medium text-primary'
						: 'text-muted-foreground hover:bg-surface-hover hover:text-foreground'}"
				>
					{item.label}
				</a>
			{/each}
		</nav>

		<div class="ml-auto flex min-w-0 shrink items-center gap-0.5 sm:gap-1.5">
			<DropdownMenu
				bind:open={menuOpen}
				ariaLabel="Notifications"
				class="relative shrink-0 rounded-md p-2 text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
			>
				{#snippet trigger()}
					<svg
						class="size-5"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
						<path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
					</svg>
					{#if unread > 0}
						<span
							class="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground"
						>
							{unread > 99 ? '99+' : unread}
						</span>
					{/if}
				{/snippet}

				<div class="max-h-96 w-80 max-w-[min(20rem,calc(var(--vvw,100%)-2.5rem))] overflow-y-auto">
					{#if items.length === 0}
						<p class="px-2.5 py-6 text-center text-sm text-muted-foreground">No notifications</p>
					{:else}
						{#each items as n (n.id)}
							<a
								href={n.link ?? '/'}
								class="flex items-start gap-2.5 rounded-sm px-2.5 py-2 transition-colors hover:bg-surface-hover"
								onclick={(e) => onItemClick(e, n)}
							>
								<span class="mt-0.5 shrink-0 {n.read_at ? 'text-muted-foreground' : 'text-primary'}">
									<svg
										class="size-4"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
									>
										{@html kindIcon(n.kind)}
									</svg>
								</span>
								<span class="min-w-0">
									<span
										class="block truncate text-sm {n.read_at
											? 'text-muted-foreground'
											: 'font-medium text-foreground'}"
									>
										{n.title}
									</span>
									<span class="block text-xs text-muted-foreground line-clamp-2">{n.body}</span>
								</span>
							</a>
						{/each}
					{/if}
				</div>
				{#if unread > 0}
					<div class="mt-1 border-t border-border pt-1">
						<button
							type="button"
							class="w-full rounded-sm px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-surface-hover"
							onclick={() => void post({ action: 'mark_all' })}
						>
							Mark all read
						</button>
					</div>
				{/if}
			</DropdownMenu>
			<div class="min-w-0 max-w-[5.5rem] sm:max-w-none">
				<ThemePicker {themes} selected={selectedTheme} action={themeAction} />
			</div>
			<DropdownMenu ariaLabel="Account" class="shrink-0">
				{#snippet trigger()}
					<span
						class="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
					>
						{user.name.charAt(0).toUpperCase()}
					</span>
				{/snippet}
				<div class="px-2.5 py-1.5">
					<p class="flex items-center gap-1.5 text-sm font-medium">
						<span class="truncate">{user.name}</span>
						{#if user.is_admin}
							<span class="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
								>Admin</span
							>
						{/if}
					</p>
					<p class="truncate text-xs text-muted-foreground">{user.email}</p>
				</div>
				<div class="my-1 border-t border-border"></div>
				<form method="POST" action="/login?/logout">
					<button
						type="submit"
						class="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2.5 py-1.5 text-sm hover:bg-surface-hover"
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
							<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
							<path d="m16 17 5-5-5-5" />
							<path d="M21 12H9" />
						</svg>
						Sign out
					</button>
				</form>
			</DropdownMenu>
		</div>
	</div>
</header>

{#if open}
	<nav class="fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-surface lg:hidden">
		<div class="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
			<img
					src="/brand/galene-emblem.png"
					alt=""
					width="28"
					height="28"
					class="size-7 shrink-0 rounded-full object-cover"
					decoding="async"
				/>
			<span class="truncate text-base font-semibold tracking-tight">{branding.name}</span>
		</div>

		<div class="flex-1 space-y-0.5 overflow-y-auto p-2">
			{#each nav as item (item.href)}
				<a
					href={item.href}
					class="block rounded-md px-2.5 py-2 text-sm transition-colors {isActive(item.href)
						? 'bg-primary/10 font-medium text-primary'
						: 'text-muted-foreground hover:bg-surface-hover hover:text-foreground'}"
					onclick={() => (open = false)}
				>
					{item.label}
				</a>
			{/each}
		</div>

		<div class="shrink-0 border-t border-border p-3">
			<ThemePicker {themes} selected={selectedTheme} action={themeAction} />
			<div class="mt-3 flex items-center justify-between gap-2">
				<div class="min-w-0">
					<p class="flex items-center gap-1.5 text-sm font-medium">
						<span class="truncate">{user.name}</span>
						{#if user.is_admin}
							<span class="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
								>Admin</span
							>
						{/if}
					</p>
					<p class="truncate text-xs text-muted-foreground">{user.email}</p>
				</div>
				<form method="POST" action="/login?/logout">
					<button
						type="submit"
						class="rounded-md p-2 text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
						aria-label="Sign out"
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
							<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
							<path d="m16 17 5-5-5-5" />
							<path d="M21 12H9" />
						</svg>
					</button>
				</form>
			</div>
		</div>
	</nav>
{/if}

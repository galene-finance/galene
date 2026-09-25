/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

// App shell only. Finance pages, API responses, and transaction data stay
// on the network — this worker exists so Chromium can install the PWA.
const CACHE = `galene-shell-${version}`;

// Boot assets only: the client entry, root layout CSS, and brand/static files.
// Route chunks load on demand and are not stored here.
const SHELL = new Set(
	[
		...build.filter((path) => /\/_app\/immutable\/(entry\/|assets\/0\.)/.test(path)),
		...files.filter((path) => !/\.(csv|db|sqlite|sql)$/i.test(path))
	]
);

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll([...SHELL]))
			.then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
			.then(() => sw.clients.claim())
	);
});

sw.addEventListener('fetch', (event) => {
	const request = event.request;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	if (url.origin !== sw.location.origin) return;

	// Never cache authenticated or financial data.
	if (
		url.pathname.startsWith('/api/') ||
		url.pathname.startsWith('/transactions') ||
		url.pathname.startsWith('/budget') ||
		url.pathname.startsWith('/cashflow') ||
		url.pathname.startsWith('/dashboard') ||
		url.pathname.startsWith('/calendar') ||
		url.pathname.startsWith('/recurring') ||
		url.pathname.startsWith('/trends') ||
		url.pathname.startsWith('/notifications') ||
		url.pathname.startsWith('/settings') ||
		url.pathname === '/' ||
		url.pathname.startsWith('/login') ||
		url.pathname.startsWith('/theme.css') ||
		url.pathname.startsWith('/version')
	) {
		return;
	}

	if (!SHELL.has(url.pathname)) return;

	event.respondWith(
		caches.open(CACHE).then(async (cache) => {
			const cached = await cache.match(request);
			if (cached) return cached;
			const response = await fetch(request);
			if (response.ok) cache.put(request, response.clone());
			return response;
		})
	);
});

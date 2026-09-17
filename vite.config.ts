import { execSync } from 'node:child_process';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

// Build metadata baked into the app (src/lib/version.ts). Vite exposes
// VITE_-prefixed process env vars on import.meta.env; CI and the Dockerfile
// set these, and the fallbacks below cover a local dev checkout.
process.env.VITE_GIT_COMMIT ??= (() => {
	try {
		return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
	} catch {
		return '';
	}
})();
process.env.VITE_BUILD_DATE ??= new Date().toISOString();

export default defineConfig({
	plugins: [sveltekit(), tailwindcss()],
	ssr: {
		// bun:sqlite is only available when running under bun (dev via `bun run dev`, prod via `bun run build/server/index.js`)
		external: ['bun:sqlite']
	}
});

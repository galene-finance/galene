/**
 * Registers SvelteKit `$lib` / `$app` path aliases for `bun test`.
 * Loaded via bunfig.toml preload.
 */
import { plugin } from 'bun';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const libRoot = resolve(root, 'src/lib');

plugin({
	name: 'galene-$lib',
	setup(build) {
		build.onResolve({ filter: /^\$lib$/ }, () => ({ path: libRoot }));
		build.onResolve({ filter: /^\$lib\// }, (args) => ({
			path: resolve(libRoot, args.path.slice('$lib/'.length))
		}));
	}
});

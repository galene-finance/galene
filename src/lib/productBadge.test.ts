import { expect, test } from 'bun:test';
import { plugin } from 'bun';
import { existsSync, readFileSync } from 'node:fs';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';

plugin({ name: 'financial-badge-ssr', setup(build) {
	build.onLoad({ filter: /FinancialBadge\.svelte$/ }, ({ path }) => ({
		contents: compile(readFileSync(path, 'utf8'), { filename: path, generate: 'server', css: 'injected' }).js.code,
		loader: 'js'
	}));
} });

test('amount badge renders its value, visible meaning and semantic state', async () => {
	expect(existsSync(new URL('./components/FinancialBadge.svelte', import.meta.url))).toBe(true);
	const { default: Badge } = await import('./components/FinancialBadge.svelte');
	const result = render(Badge, { props: { value: '$100.00', label: 'Within limit', tone: 'positive' } });
	expect(result.body).toContain('$100.00');
	expect(result.body).toContain('Within limit');
	expect(result.body).toContain('data-tone="positive"');
	expect(result.body).toContain('financial-badge');
	expect(result.head).toContain('--pill-positive-fill');
});

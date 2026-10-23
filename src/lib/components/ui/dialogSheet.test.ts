import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compile, optimize } from '@tailwindcss/node';

/**
 * Reproduces the production CSS pipeline cheaply:
 * `@tailwindcss/node` `compile` + `build(candidates)`, then `optimize({ minify: true })`,
 * which is lightningcss `transform` with the same targets @tailwindcss/vite uses in
 * build mode (Safari/iOS 16.4, Firefox 128, Chrome 111).
 *
 * The old fix put `translate: none` in an unlayered rule. lightningcss drops that
 * declaration, and the layered `-translate-*` utilities keep shifting the sheet.
 */

const root = resolve(import.meta.dir, '../../../..');

/** Classes that actually land on BitsDialog.Content, including the sheet const. */
function contentCandidates(dialogSrc: string): string[] {
	const classAttr = dialogSrc.match(/class="(dialog-content[^"]*)"/)?.[1] ?? '';
	const sheet = dialogSrc.match(/const sheet =\s*'([^']*)'/)?.[1] ?? '';
	const size = dialogSrc.match(/md: '([^']*)'/)?.[1] ?? '';
	return `${classAttr} ${sheet} ${size}`.replace(/\{[^}]*\}/g, ' ').split(/\s+/).filter(Boolean);
}

async function productionCss(appCss: string, dialogSrc: string): Promise<string> {
	const compiled = await compile(appCss, { base: root, onDependency() {} });
	const built = compiled.build(contentCandidates(dialogSrc));
	return optimize(built, { minify: true }).code;
}

/**
 * True for the <640px sheet query. lightningcss rewrites `width < 640px` to
 * `not all and (min-width: 640px)`. Tailwind's max-sm variant is
 * `not all and (min-width: 40rem)`.
 */
function isMobileQuery(header: string): boolean {
	return (
		/width\s*<\s*640px/.test(header) ||
		/max-width:\s*639px/.test(header) ||
		/not all and \(min-width:\s*640px\)/.test(header) ||
		/not all and \(min-width:\s*40rem\)/.test(header)
	);
}

function mediaBlocks(css: string, predicate: (header: string) => boolean): string[] {
	const blocks: string[] = [];
	const re = /@media[^{]*\{/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(css))) {
		if (!predicate(match[0])) continue;
		let i = re.lastIndex;
		let depth = 1;
		while (i < css.length && depth > 0) {
			if (css[i] === '{') depth++;
			else if (css[i] === '}') depth--;
			i++;
		}
		blocks.push(css.slice(match.index, i));
	}
	return blocks;
}

describe('mobile dialog sheet survives lightningcss minify', () => {
	test('minified max-width:640px CSS resets translate and does not set transform/top/left unlayered', async () => {
		const css = await productionCss(
			readFileSync(resolve(root, 'src/app.css'), 'utf8'),
			readFileSync(resolve(import.meta.dir, 'Dialog.svelte'), 'utf8')
		);
		const mobile = mediaBlocks(css, isMobileQuery).join('\n');
		expect(mobile.length).toBeGreaterThan(0);

		// translate-x-0 / translate-y-0 → --tw-translate-x/y: 0 (and a translate declaration).
		expect(mobile).toMatch(/--tw-translate-x:\s*0(?:px)?/);
		expect(mobile).toMatch(/--tw-translate-y:\s*0(?:px)?/);
		expect(mobile).toMatch(/translate:\s*(?:var\(--tw-translate-x\)|0)/);

		// Sheet edges come from utilities, not a hand-written rule the minifier can drop.
		expect(mobile).toMatch(/inset:\s*auto 0 0|bottom:\s*0/);
		expect(mobile).toMatch(/width:\s*100%/);

		// No unlayered .dialog-content rule may set transform/translate/top/left.
		// Utilities live in @layer; an unlayered block is whatever is left outside @layer.
		const unlayered = css.replace(/@layer\s+[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, '');
		const unlayeredMobile = mediaBlocks(unlayered, isMobileQuery).join('\n');
		for (const block of unlayeredMobile.split('}')) {
			if (!/\.dialog-content/.test(block)) continue;
			expect(block).not.toMatch(/(?:^|[{;])\s*transform\s*:/);
			expect(block).not.toMatch(/(?:^|[{;])\s*translate\s*:/);
			expect(block).not.toMatch(/(?:^|[{;])\s*top\s*:/);
			expect(block).not.toMatch(/(?:^|[{;])\s*left\s*:/);
		}

		// Height cap that used to share the rule must still be present after minify.
		expect(unlayeredMobile).toMatch(/max-height:/);
		expect(unlayeredMobile).toMatch(/100dvh/);
	});
});

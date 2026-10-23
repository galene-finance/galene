import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '../../../..');
const dialogSrc = readFileSync(resolve(import.meta.dir, 'Dialog.svelte'), 'utf8');
const appCss = readFileSync(resolve(root, 'src/app.css'), 'utf8');

/** Dialogs that use ui/Dialog and expose a Cancel/Save (or equivalent) row. */
const actionDialogs = [
	'src/lib/components/AddScheduledDialog.svelte',
	'src/lib/components/AddTransactionDialog.svelte',
	'src/lib/components/CashflowFiltersDialog.svelte',
	'src/lib/components/RememberPayeeDialog.svelte',
	'src/lib/components/RuleDialog.svelte',
	'src/lib/components/SplitDialog.svelte',
	'src/lib/components/WebhookDialog.svelte',
	'src/lib/components/dashboard/WidgetFiltersDialog.svelte',
	'src/routes/(app)/budget/+page.svelte',
	'src/routes/(app)/settings/tags/+page.svelte',
	'src/routes/(app)/settings/categories/+page.svelte',
	'src/routes/(app)/settings/data/+page.svelte',
	'src/routes/(app)/settings/sync/+page.svelte',
	'src/routes/(app)/settings/accounts/+page.svelte',
	'src/routes/(app)/settings/users/+page.svelte'
];

describe('Dialog scroll structure', () => {
	test('body is the only scroller and height uses dvh with a vh fallback', () => {
		expect(dialogSrc).toContain('class="dialog-body min-h-0 flex-1 overflow-y-auto overscroll-contain');
		expect(appCss).toContain('-webkit-overflow-scrolling: touch');
		expect(appCss).toContain('max-height: calc(100vh - 2rem)');
		expect(appCss).toContain('max-height: calc(100dvh - 2rem');
		expect(dialogSrc).toContain('overflow-hidden');
		expect(dialogSrc).not.toContain('max-h-[calc(100vh-2rem)]');
		expect(dialogSrc).not.toContain('overflow-y-auto rounded-lg');
	});

	test('footer renders outside the scroll body and dialog-actions can stick inside it', () => {
		const bodyAt = dialogSrc.indexOf('class="dialog-body');
		const footerAt = dialogSrc.indexOf('class="dialog-footer');
		expect(bodyAt).toBeGreaterThan(0);
		expect(footerAt).toBeGreaterThan(bodyAt);
		expect(dialogSrc.slice(bodyAt, footerAt)).not.toContain('{@render footer()}');
		expect(dialogSrc).toContain('{@render footer()}');
		expect(appCss).toContain('.dialog-body .dialog-actions:not(.dialog-footer)');
		expect(appCss).toContain('position: sticky');
		expect(appCss).toContain('bottom: 0');
		expect(appCss).toContain('env(safe-area-inset-bottom');
	});

	test('locks background scroll while open and bits-ui still closes on escape and backdrop', () => {
		expect(dialogSrc).toContain('$effect');
		expect(dialogSrc).toContain('lockPageScroll()');
		expect(dialogSrc).toContain('unlockPageScroll()');
		expect(dialogSrc).toContain("interactOutsideBehavior={busy ? 'ignore' : 'close'}");
		expect(dialogSrc).toContain("escapeKeydownBehavior={busy ? 'ignore' : 'close'}");
	});

	test('every action dialog puts its button row in the footer slot', () => {
		for (const rel of actionDialogs) {
			const src = readFileSync(resolve(root, rel), 'utf8');
			const dialogs = src.split(/<Dialog\b/).slice(1);
			for (const block of dialogs) {
				const body = block.split('</Dialog>')[0] ?? block;
				if (!/Cancel|Save|Delete|Remove|Close/.test(body)) continue;
				expect(body, rel).toContain('{#snippet footer()}');
			}
		}
	});
});

/**
 * Reference-counted page scroll lock for open dialogs.
 *
 * bits-ui Dialog (preventScroll, default true) sets `body { overflow: hidden }`
 * and restores the whole body style attribute on close. On iOS Safari that does
 * not pin the page: the layout viewport still scrolls under the fixed overlay.
 * This lock adds `position: fixed` with the scroll offset and restores only the
 * properties it set, so it never fights the bits-ui restore. Nested dialogs
 * share one lock.
 */

const PROPS = ['position', 'top', 'left', 'right', 'width'] as const;
type Prop = (typeof PROPS)[number];

let depth = 0;
let saved: { scrollY: number; values: Record<Prop, string> } | null = null;

export function lockCount(): number {
	return depth;
}

export function lockPageScroll(): void {
	depth += 1;
	if (depth > 1 || typeof document === 'undefined' || typeof window === 'undefined') return;
	const body = document.body;
	const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
	const values = {} as Record<Prop, string>;
	for (const p of PROPS) values[p] = body.style.getPropertyValue(p);
	saved = { scrollY, values };
	body.style.setProperty('position', 'fixed');
	body.style.setProperty('top', `-${scrollY}px`);
	body.style.setProperty('left', '0');
	body.style.setProperty('right', '0');
	body.style.setProperty('width', '100%');
}

export function unlockPageScroll(): void {
	if (depth === 0) return;
	depth -= 1;
	if (depth > 0 || typeof document === 'undefined' || typeof window === 'undefined') return;
	const s = saved;
	saved = null;
	if (!s) return;
	const body = document.body;
	for (const p of PROPS) {
		if (s.values[p]) body.style.setProperty(p, s.values[p]);
		else body.style.removeProperty(p);
	}
	window.scrollTo(0, s.scrollY);
}

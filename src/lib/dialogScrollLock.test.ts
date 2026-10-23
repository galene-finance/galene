import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { lockCount, lockPageScroll, unlockPageScroll } from './dialogScrollLock';

/** bun test has no DOM. A tiny body/window is enough to check the lock. */
function installDom() {
	const props = new Map<string, string>();
	const body = {
		style: {
			getPropertyValue: (k: string) => props.get(k) ?? '',
			setProperty: (k: string, v: string) => void props.set(k, v),
			removeProperty: (k: string) => void props.delete(k)
		}
	};
	Object.assign(globalThis, {
		document: { body, documentElement: { scrollTop: 0 } },
		window: {
			scrollY: 0,
			scrollTo(_x: number, y: number) {
				this.scrollY = y;
			}
		}
	});
	return props;
}

let props: Map<string, string>;

describe('dialog page scroll lock', () => {
	beforeAll(() => {
		props = installDom();
	});

	afterEach(() => {
		while (lockCount() > 0) unlockPageScroll();
		props.clear();
	});

	test('pins the body at the scroll offset and restores it on unlock', () => {
		(window as unknown as { scrollY: number }).scrollY = 240;
		lockPageScroll();
		expect(props.get('position')).toBe('fixed');
		expect(props.get('top')).toBe('-240px');
		window.scrollTo(0, 0);
		unlockPageScroll();
		expect(props.has('position')).toBe(false);
		expect(props.has('top')).toBe(false);
		expect(window.scrollY).toBe(240);
		expect(lockCount()).toBe(0);
	});

	test('leaves styles it does not own alone (bits-ui overflow restore)', () => {
		props.set('overflow', 'hidden');
		lockPageScroll();
		props.delete('overflow');
		unlockPageScroll();
		expect(props.has('overflow')).toBe(false);
	});

	test('restores a previous value of an owned property', () => {
		props.set('width', '50%');
		lockPageScroll();
		unlockPageScroll();
		expect(props.get('width')).toBe('50%');
	});

	test('nested locks restore only when the last dialog closes', () => {
		lockPageScroll();
		lockPageScroll();
		expect(lockCount()).toBe(2);
		unlockPageScroll();
		expect(props.get('position')).toBe('fixed');
		unlockPageScroll();
		expect(props.has('position')).toBe(false);
	});
});

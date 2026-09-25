import { describe, expect, test } from 'bun:test';
import {
	CREATE_VALUE,
	availableItems,
	optionsPanelBox,
	pillLabel,
	removeLastPill,
	removeValue,
	selectedPills,
	shouldRemoveLastOnBackspace
} from './multiCombobox';

const items = [
	{ value: '1', label: 'Groceries' },
	{ value: '2', label: 'Coffee' },
	{ value: '3', label: 'Checking' }
];

describe('selectedPills', () => {
	test('one pill per selected value, in order', () => {
		expect(selectedPills(['2', '1'], items, '')).toEqual([
			{ value: '2', label: 'Coffee' },
			{ value: '1', label: 'Groceries' }
		]);
	});

	test('create sentinel uses lastCreated, not the raw token', () => {
		expect(selectedPills(['2', CREATE_VALUE], items, 'New tag')).toEqual([
			{ value: '2', label: 'Coffee' },
			{ value: CREATE_VALUE, label: 'New tag' }
		]);
		expect(pillLabel(CREATE_VALUE, items, 'New tag')).toBe('New tag');
	});
});

describe('removeValue', () => {
	test('× on one pill leaves the others', () => {
		expect(removeValue(['1', '2', '3'], '2')).toEqual(['1', '3']);
	});
});

describe('removeLastPill', () => {
	test('Backspace on empty search removes the last pill', () => {
		expect(shouldRemoveLastOnBackspace('', ['1', '2'])).toBe(true);
		expect(removeLastPill(['1', '2'])).toEqual(['1']);
	});

	test('Backspace does nothing when the search has text or there are no pills', () => {
		expect(shouldRemoveLastOnBackspace('cof', ['1'])).toBe(false);
		expect(shouldRemoveLastOnBackspace('', [])).toBe(false);
		expect(removeLastPill([])).toEqual([]);
	});
});

describe('optionsPanelBox', () => {
	const keyboard = { height: 360, offsetTop: 80, offsetLeft: 0, width: 390 };

	test('opens below the field with a real row height when the keyboard leaves room', () => {
		const box = optionsPanelBox(
			{ top: 120, bottom: 160, left: 16, width: 358 },
			keyboard
		);
		expect(box.top).toBe(160 + 4 - 80);
		expect(box.maxHeight).toBeGreaterThanOrEqual(48);
		expect(box.maxHeight).toBeLessThanOrEqual(288);
		expect(box.width).toBe(358);
		expect(box.left).toBe(16);
	});

	test('flips above the field when the keyboard covers the space below', () => {
		const box = optionsPanelBox(
			{ top: 400, bottom: 440, left: 16, width: 358 },
			keyboard
		);
		// Layout field top 400, visual offset 80, 4px gap → panel ends at 316.
		expect(box.maxHeight).toBeGreaterThanOrEqual(48);
		expect(box.top + box.maxHeight).toBe(400 - 4 - 80);
		expect(box.top).toBeGreaterThanOrEqual(0);
	});

	test('does not invent a tall list when both sides are shorter than one row', () => {
		const box = optionsPanelBox(
			{ top: 90, bottom: 110, left: 0, width: 200 },
			{ height: 40, offsetTop: 80, offsetLeft: 0, width: 390 }
		);
		expect(box.maxHeight).toBeLessThanOrEqual(40);
	});
});

describe('availableItems', () => {
	test('drops values already in the pill set until they are removed', () => {
		expect(availableItems(items, ['3'], '')).toEqual([
			{ value: '1', label: 'Groceries' },
			{ value: '2', label: 'Coffee' }
		]);
		expect(availableItems(items, [], '')).toEqual(items);
	});

	test('still filters by search among remaining options', () => {
		expect(availableItems(items, ['1'], 'che')).toEqual([{ value: '3', label: 'Checking' }]);
		expect(availableItems(items, ['3'], 'che')).toEqual([]);
	});
});

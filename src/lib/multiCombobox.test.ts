import { describe, expect, test } from 'bun:test';
import {
	CREATE_VALUE,
	availableItems,
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

/** Plaid merchant is the statement line when original_description is not blank. */
import { describe, expect, test } from 'bun:test';
import { plaidMerchant } from './plaid';

describe('plaidMerchant', () => {
	test('stores the statement line instead of the cleaned name', () => {
		expect(plaidMerchant({ name: 'Kroger', original_description: '  KROGER FUEL #4454  ' })).toBe('KROGER FUEL #4454');
	});

	test('stores name when original_description is missing', () => {
		expect(plaidMerchant({ name: 'Kroger' })).toBe('Kroger');
	});

	test('stores name when original_description is blank', () => {
		expect(plaidMerchant({ name: '  Kroger  ', original_description: '   ' })).toBe('Kroger');
		expect(plaidMerchant({ name: '   ', original_description: '  ' })).toBeNull();
	});
});

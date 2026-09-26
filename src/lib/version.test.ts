import { describe, expect, test } from 'bun:test';
import { formatProfileVersion } from './version';

describe('profile version line', () => {
	test('includes a leading v and a 7-character commit', () => {
		expect(formatProfileVersion('0.3', 'd58afd8abcdef')).toBe('v0.3 (d58afd8)');
	});

	test('falls back to the version alone when the commit is unknown', () => {
		expect(formatProfileVersion('0.3', '')).toBe('v0.3');
	});
});

import { describe, expect, test } from 'bun:test';
import { filterSettingsSections, settingsSections, type SettingsSection } from './settingsHub';

const sections: SettingsSection[] = settingsSections(true);

describe('filterSettingsSections', () => {
	test('empty query returns every section and card', () => {
		const filtered = filterSettingsSections(sections, '   ');
		expect(filtered).toEqual(sections);
		expect(filtered.flatMap((s) => s.cards).map((c) => c.href)).toContain('/settings/advisor');
	});

	test('matches title, description, and keyword synonyms', () => {
		expect(filterSettingsSections(sections, 'sync').flatMap((s) => s.cards.map((c) => c.href))).toEqual([
			'/settings/sync'
		]);
		expect(filterSettingsSections(sections, 'API')[0]?.cards.map((c) => c.title)).toEqual(['API']);
		expect(filterSettingsSections(sections, 'plaid')[0]?.cards[0]?.href).toBe('/settings/sync');
		expect(filterSettingsSections(sections, 'authenticator')[0]?.cards[0]?.href).toBe('/settings/security');
	});

	test('hides a section when none of its cards match', () => {
		const filtered = filterSettingsSections(sections, 'backup');
		expect(filtered.map((s) => s.id)).toEqual(['system']);
		expect(filtered[0]?.cards.map((c) => c.href)).toEqual(['/settings/backups']);
	});

	test('no matches yields an empty list', () => {
		expect(filterSettingsSections(sections, 'zzzz-nope')).toEqual([]);
	});
});

describe('settingsSections admin gate', () => {
	test('Users and Backups only when admin', () => {
		const adminHrefs = settingsSections(true)
			.flatMap((s) => s.cards)
			.map((c) => c.href);
		const userHrefs = settingsSections(false)
			.flatMap((s) => s.cards)
			.map((c) => c.href);
		expect(adminHrefs).toContain('/settings/users');
		expect(adminHrefs).toContain('/settings/backups');
		expect(userHrefs).not.toContain('/settings/users');
		expect(userHrefs).not.toContain('/settings/backups');
		expect(userHrefs).toContain('/settings/advisor');
	});
});

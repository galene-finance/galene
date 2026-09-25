export type SettingsCard = {
	href: string;
	title: string;
	desc: string;
	/** Extra nouns for type-to-filter (POC `data-text`), beyond title and description. */
	keywords: string;
	icon: string;
	admin?: boolean;
};

export type SettingsSection = {
	id: string;
	label: string;
	cards: SettingsCard[];
};

export function settingsSections(isAdmin: boolean): SettingsSection[] {
	return [
		{
			id: 'you',
			label: 'You & access',
			cards: [
				{
					href: '/settings/appearance',
					title: 'Appearance',
					desc: 'Theme, app name, and icons.',
					keywords: 'theme app name icons',
					icon: 'Aa'
				},
				{
					href: '/settings/security',
					title: 'Security',
					desc: 'Two-factor authentication with an authenticator app.',
					keywords: 'two-factor authentication 2fa totp',
					icon: '2F'
				},
				{
					href: '/settings/advisor',
					title: 'Advisor access',
					desc: 'Accountant packs and read-only viewer invites, with an expiry you can revoke.',
					keywords: 'accountant pack viewer invite share expiry tax',
					icon: 'Ad'
				},
				...(isAdmin
					? [
							{
								href: '/settings/users',
								title: 'Users',
								desc: 'Create accounts, manage admin access, and remove users.',
								keywords: 'users admin access accounts',
								icon: 'Us',
								admin: true
							}
						]
					: [])
			]
		},
		{
			id: 'money',
			label: 'Money setup',
			cards: [
				{
					href: '/settings/accounts',
					title: 'Accounts',
					desc: 'Bank, credit, cash, and investment accounts.',
					keywords: 'accounts bank credit cash investment',
					icon: '$'
				},
				{
					href: '/settings/sync',
					title: 'Bank sync',
					desc: 'Connect a bank provider and import your accounts and transactions.',
					keywords: 'bank sync provider import plaid simplefin',
					icon: '⇄'
				},
				{
					href: '/settings/categories',
					title: 'Categories',
					desc: 'Expense and income categories, with optional subcategories.',
					keywords: 'categories expense income subcategories',
					icon: '☰'
				},
				{
					href: '/settings/tags',
					title: 'Tags',
					desc: 'Free-form labels for transactions.',
					keywords: 'tags labels transactions',
					icon: '#'
				}
			]
		},
		{
			id: 'automation',
			label: 'Automation & integrations',
			cards: [
				{
					href: '/settings/rules',
					title: 'Categorization rules',
					desc: 'Auto-assign a category to transactions that come in without one.',
					keywords: 'categorization rules auto-assign category',
					icon: '⚡'
				},
				{
					href: '/settings/api',
					title: 'API',
					desc: 'API tokens and the MCP server for scripts and AI assistants.',
					keywords: 'api tokens mcp server scripts assistants',
					icon: '{ }'
				}
			]
		},
		{
			id: 'system',
			label: 'System',
			cards: [
				...(isAdmin
					? [
							{
								href: '/settings/backups',
								title: 'Backups',
								desc: 'Copy the database to a local folder, on a schedule, with automatic cleanup of old copies.',
								keywords: 'backups database schedule cleanup admin',
								icon: '⤓',
								admin: true
							}
						]
					: []),
				{
					href: '/settings/data',
					title: 'Data',
					desc: 'Delete specific data — accounts, transactions, categories, and more — or all of it at once.',
					keywords: 'data delete wipe accounts transactions',
					icon: '⌀'
				},
				{
					href: '/settings/about',
					title: 'About',
					desc: 'Version, build info, and how to check for updates.',
					keywords: 'about version build updates',
					icon: 'i'
				}
			]
		}
	];
}

function haystack(card: SettingsCard): string {
	return `${card.title} ${card.desc} ${card.keywords}`.toLowerCase();
}

/** Empty query returns every section. Sections with no matching cards are omitted. */
export function filterSettingsSections(sections: SettingsSection[], query: string): SettingsSection[] {
	const term = query.trim().toLowerCase();
	if (!term) return sections;
	return sections
		.map((section) => ({
			...section,
			cards: section.cards.filter((card) => haystack(card).includes(term))
		}))
		.filter((section) => section.cards.length > 0);
}

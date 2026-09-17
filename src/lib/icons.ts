/**
 * Built-in icons available for the top-left logo and the favicon.
 * All are 24x24 stroke paths matching the app's icon style.
 */
export interface AppIcon {
	key: string;
	label: string;
	d: string[];
}

export const ICONS: AppIcon[] = [
	{
		key: 'logo',
		label: 'Galene',
		d: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20', 'M7 12c1.5-2.5 3.5-2.5 5 0s3.5 2.5 5 0']
	},
	{ key: 'spark', label: 'Spark', d: ['M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z'] },
	{
		key: 'leaf',
		label: 'Leaf',
		d: [
			'M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10Z',
			'M2 21c0-3 1.9-5.4 5.1-6C9.5 14.5 12 13 13 12'
		]
	},
	{ key: 'wave', label: 'Wave', d: ['M2 12c2-4.5 4-4.5 6 0s4 4.5 6 0 4-4.5 6 0'] },
	{ key: 'bolt', label: 'Bolt', d: ['M13 2L3 14h7l-1 8 10-12h-7l1-8z'] },
	{
		key: 'coin',
		label: 'Coin',
		d: [
			'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20',
			'M14.5 8.5c-.5-1-1.5-1.5-2.5-1.5-1.7 0-3 .9-3 2s1.3 1.7 3 2 3 1 3 2-1.3 2-3 2c-1 0-2-.5-2.5-1.5',
			'M12 5v2m0 10v2'
		]
	},
	{ key: 'chart', label: 'Chart', d: ['M3 3v18h18', 'M7 15v-4m5 4V7m5 8v-6'] },
	{ key: 'shield', label: 'Shield', d: ['M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z'] },
	{
		key: 'home',
		label: 'Home',
		d: ['M3 10l9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M9 22V12h6v10']
	},
	{
		key: 'target',
		label: 'Target',
		d: [
			'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20',
			'M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12',
			'M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4'
		]
	},
	{
		key: 'globe',
		label: 'Globe',
		d: [
			'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20',
			'M2 12h20',
			'M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10'
		]
	},
	{
		key: 'star',
		label: 'Star',
		d: ['M12 2l2.9 6.3 6.9.8-5.1 4.6 1.4 6.8-6.1-3.5-6.1 3.5 1.4-6.8L2.2 9.1l6.9-.8z']
	},
	{ key: 'mountain', label: 'Mountain', d: ['M3 20l6-12 4 7 3-4 5 9z'] },
	{
		key: 'sun',
		label: 'Sun',
		d: [
			'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
			'M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4'
		]
	}
];

export function getIcon(key: string): AppIcon {
	return ICONS.find((i) => i.key === key) ?? ICONS[0];
}

/** The icon's inner SVG markup (paths only) for use with {@html}. */
export function iconPaths(key: string): string {
	return getIcon(key).d.map((p) => `<path d="${p}"/>`).join('');
}

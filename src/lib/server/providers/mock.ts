import type { BankProvider, ProviderAccount, ProviderTransaction } from '$lib/types';

const ACCOUNTS: ProviderAccount[] = [
	{ external_id: 'mock-checking', name: 'Demo Checking', type: 'bank', balance_cents: 248_532 },
	{ external_id: 'mock-credit', name: 'Demo Credit Card', type: 'credit', balance_cents: -41_290 },
	{ external_id: 'mock-savings', name: 'Demo Savings', type: 'bank', balance_cents: 1_502_000 }
];

/** Small deterministic PRNG (mulberry32). */
function mulberry32(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const GROCERS = ['FreshMart', 'Corner Market', 'GreenGrocer'];
const DINING = ["Luca's Trattoria", 'Noodle Bar', 'Taco Loco'];
const GAS = ['Shell', 'QuickFuel'];

function iso(y: number, m: number, d: number): string {
	return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * A generated demo transaction before it is shaped into the provider's
 * wire format. `cat` is the spending category key, used both in the
 * external id (dedup) and by the demo-data seeder.
 */
export interface DemoRow {
	account: 'checking' | 'credit' | 'savings';
	date: string;
	amount_cents: number;
	merchant: string;
	cat: string;
}

/**
 * ~90 days of realistic transactions, anchored to today (UTC). Deterministic
 * for a given UTC day, so re-syncing the same day is a no-op and dedup is
 * stable; the next day the window slides and new transactions appear.
 */
export function generateDemoRows(): DemoRow[] {
	const now = new Date();
	const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
	const out: DemoRow[] = [];

	const push = (account: DemoRow['account'], date: string, amountCents: number, merchant: string, cat: string) => {
		out.push({ account, date, amount_cents: amountCents, merchant, cat });
	};

	for (let offset = 90; offset >= 0; offset--) {
		const day = new Date(today - offset * 86400000);
		const y = day.getUTCFullYear();
		const m = day.getUTCMonth() + 1;
		const dom = day.getUTCDate();
		const dow = day.getUTCDay();
		const date = iso(y, m, dom);
		const rng = mulberry32(0xc0ffee + offset);
		const pick = (arr: string[]) => arr[Math.floor(rng() * arr.length)];

		if (dom === 1) {
			push('checking', date, 420000, 'Acme Corp Payroll', 'salary');
			push('checking', date, -180000, 'Hillside Apartments', 'rent');
			push('checking', date, -50000, 'Transfer to Savings', 'transfer-out');
			push('savings', date, 50000, 'Transfer from Checking', 'transfer-in');
		}
		if (dom === 5) push('credit', date, -1599, 'StreamFlix', 'sub1');
		if (dom === 12) push('credit', date, -1199, 'CloudBox Storage', 'sub2');
		if (dom === 15) push('checking', date, -(11000 + Math.floor(rng() * 4000)), 'City Power & Light', 'utilities');

		if (dom % 3 === 0) push('checking', date, -(4000 + Math.floor(rng() * 8000)), pick(GROCERS), 'groceries');
		if (dow === 2 || dow === 4) push('credit', date, -(350 + Math.floor(rng() * 300)), 'Daily Grind', 'coffee');
		if (dow === 5) push('credit', date, -(2500 + Math.floor(rng() * 5500)), pick(DINING), 'dining');
		if (dow === 0) push('checking', date, -(3000 + Math.floor(rng() * 3000)), pick(GAS), 'gas');
	}

	return out;
}

/** The provider's wire format for the generated rows. */
function generateTransactions(since?: string): ProviderTransaction[] {
	const out = generateDemoRows().map((r) => ({
		external_id: `mock-${r.account}-${r.date.replace(/-/g, '')}-${r.cat}`,
		account_external_id: `mock-${r.account}`,
		date: r.date,
		amount_cents: r.amount_cents,
		merchant: r.merchant
	}));
	return since ? out.filter((t) => t.date >= since) : out;
}

export const mockProvider: BankProvider = {
	id: 'mock',
	label: 'Demo Bank',
	description:
		'A built-in mock bank for trying out sync without a real account. It reports three demo accounts and about three months of realistic transactions.',
	credentialFields: [{ key: 'account_number', label: 'Account number', placeholder: 'Any value, e.g. 0001234567' }],
	// Local provider with no external API; 15 minutes is the floor for any provider.
	minSyncIntervalMinutes: 15,
	connect(credentials) {
		if (!String(credentials.account_number ?? '').trim()) throw new Error('Enter an account number.');
	},
	listAccounts() {
		return ACCOUNTS;
	},
	fetchTransactions(since) {
		return generateTransactions(since);
	}
};

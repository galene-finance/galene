import type { BankProvider } from '$lib/types';
import { mockProvider } from './mock';
import { simplefinProvider } from './simplefin';
import { plaidProvider } from './plaid';

/** All available bank providers, in display order. */
export const PROVIDERS: BankProvider[] = [mockProvider, simplefinProvider, plaidProvider];

export function getProvider(id: string): BankProvider | undefined {
	return PROVIDERS.find((p) => p.id === id);
}

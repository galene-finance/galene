import type { AccountType } from './types';

/** Presentation only: never changes account type or the sign supplied by the ledger. */
export function accountSection(account: { type: AccountType; name: string }): 'cash' | 'debts' | 'other' {
 if (account.type === 'credit' || /\b(loan|mortgage)\b/i.test(account.name)) return 'debts';
 return account.type === 'bank' || account.type === 'cash' ? 'cash' : 'other';
}

export function comparisonWidth(value: number, maximum: number): number {
 return maximum > 0 ? Math.min(100, Math.max(0, value / maximum * 100)) : 0;
}

export function bankTimestamp(value: string | null): string {
 if (!value) return 'As-of time unavailable';
 const date = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
 return Number.isNaN(date.getTime()) ? 'As-of time unavailable' : `As of ${date.toLocaleString(undefined, {dateStyle:'medium', timeStyle:'short'})}`;
}

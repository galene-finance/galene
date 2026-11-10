import { describe, expect, test } from 'bun:test';
import {
	MATCH_AMOUNT_TOLERANCE_MIN_CENTS,
	MATCH_DATE_WINDOW_DAYS,
	MATCH_PAYEE_SIMILARITY_MIN,
	PICKER_DATE_WINDOW_DAYS,
	amountDeltaHint,
	amountToleranceCents,
	amountWithinTolerance,
	candidateMatchesQuery,
	listPickerCandidates,
	payeeSimilarity,
	strongSuggestion,
	transactionHref,
	type MatchOccurrence,
	type MatchTxn
} from './scheduledMatch';

const display = '2026-11-10';

function occ(over: Partial<MatchOccurrence> = {}): MatchOccurrence {
	return {
		displayDate: display,
		amountCents: -10000,
		name: 'Rent',
		accountId: 1,
		...over
	};
}

function txn(over: Partial<MatchTxn> = {}): MatchTxn {
	return {
		id: 1,
		date: display,
		amountCents: -10000,
		merchant: 'Rent',
		accountId: 1,
		...over
	};
}

describe('amount tolerance', () => {
	test('uses the greater of 2% and $1', () => {
		expect(amountToleranceCents(-1000)).toBe(MATCH_AMOUNT_TOLERANCE_MIN_CENTS);
		expect(amountToleranceCents(-10000)).toBe(200);
		expect(amountToleranceCents(10000)).toBe(200);
	});

	test('a small bill is within $1 and out one cent past it', () => {
		expect(amountWithinTolerance(-1000, -1100)).toBe(true);
		expect(amountWithinTolerance(-1000, -1101)).toBe(false);
		expect(amountWithinTolerance(-1000, -900)).toBe(true);
		expect(amountWithinTolerance(-1000, -899)).toBe(false);
	});

	test('a large bill is within 2% and out one cent past it', () => {
		expect(amountWithinTolerance(-10000, -10200)).toBe(true);
		expect(amountWithinTolerance(-10000, -10201)).toBe(false);
		expect(amountWithinTolerance(-10000, -9800)).toBe(true);
		expect(amountWithinTolerance(-10000, -9799)).toBe(false);
	});

	test('an opposite sign is not within tolerance', () => {
		expect(amountWithinTolerance(-10000, 10000)).toBe(false);
		expect(amountWithinTolerance(-10000, 0)).toBe(false);
	});

	test('hint is the magnitude gap versus scheduled', () => {
		expect(amountDeltaHint(-2900, -3150)).toBe('+$2.50 vs scheduled');
		expect(amountDeltaHint(-2900, -2500)).toBe('-$4.00 vs scheduled');
		expect(amountDeltaHint(-2900, -2900)).toBe('Same amount');
	});
});

describe('date window', () => {
	test('exactly the suggestion window is in, one day past is out', () => {
		const inside = txn({ date: '2026-11-14', id: 2 });
		const outside = txn({ date: '2026-11-15', id: 3 });
		expect(MATCH_DATE_WINDOW_DAYS).toBe(4);
		expect(strongSuggestion(occ(), [inside])?.id).toBe(2);
		expect(strongSuggestion(occ(), [outside])).toBeNull();
		expect(strongSuggestion(occ(), [txn({ date: '2026-11-06' })])?.id).toBe(1);
		expect(strongSuggestion(occ(), [txn({ date: '2026-11-05' })])).toBeNull();
	});

	test('the picker window is wider than the suggestion window', () => {
		expect(PICKER_DATE_WINDOW_DAYS).toBe(14);
		const far = txn({ date: '2026-11-24', merchant: 'Hardware', amountCents: -5000 });
		const listed = listPickerCandidates(occ(), [far]);
		expect(listed.map((row) => row.id)).toEqual([1]);
		expect(listed[0]?.strong).toBe(false);
		expect(listPickerCandidates(occ(), [txn({ date: '2026-11-25' })])).toEqual([]);
	});
});

describe('payee similarity', () => {
	test('normalizes case and a trailing store number', () => {
		expect(payeeSimilarity('Netflix', 'NETFLIX #12345')).toBe(1);
	});

	test('one shared token of two is below the threshold', () => {
		const score = payeeSimilarity('Cable bill', 'Cable wire');
		expect(score).toBeLessThan(MATCH_PAYEE_SIMILARITY_MIN);
		expect(score).toBeGreaterThan(0);
	});

	test('a contained name clears the threshold', () => {
		expect(payeeSimilarity('Rent', 'Rent payment')).toBeGreaterThanOrEqual(MATCH_PAYEE_SIMILARITY_MIN);
	});

	test('unrelated payees do not score', () => {
		expect(payeeSimilarity('Electric', 'Grocery Mart')).toBe(0);
	});
});

describe('same-account rule', () => {
	test('a different account is not a candidate', () => {
		const other = txn({ accountId: 9, merchant: 'Rent', amountCents: -10000 });
		expect(strongSuggestion(occ(), [other])).toBeNull();
		expect(listPickerCandidates(occ(), [other])).toEqual([]);
	});

	test('same account and exact amount is strong without a payee hit', () => {
		const hit = txn({ merchant: 'Power Co', amountCents: -9640 });
		const suggestion = strongSuggestion(occ({ name: 'Electric', amountCents: -9640 }), [hit]);
		expect(suggestion?.strong).toBe(true);
		expect(suggestion?.exactAmount).toBe(true);
		expect(suggestion?.payeeSimilarity).toBe(0);
	});

	test('same account within tolerance but not exact, and a weak payee, is only listed', () => {
		const near = txn({ merchant: 'Hardware', amountCents: -10100 });
		expect(strongSuggestion(occ(), [near])).toBeNull();
		const listed = listPickerCandidates(occ(), [near]);
		expect(listed).toHaveLength(1);
		expect(listed[0]?.strong).toBe(false);
		expect(listed[0]?.hint).toBe('+$1.00 vs scheduled');
	});

	test('no account on the series allows any account, and exact amount alone is not strong', () => {
		const other = txn({ accountId: 9, merchant: 'Something else' });
		expect(strongSuggestion(occ({ accountId: null }), [other])).toBeNull();
		expect(listPickerCandidates(occ({ accountId: null }), [other])).toHaveLength(1);
		const named = txn({ accountId: 9, merchant: 'Rent' });
		expect(strongSuggestion(occ({ accountId: null }), [named])?.strong).toBe(true);
	});
});

describe('exclusions and strong versus weak', () => {
	test('a transaction matched elsewhere is never suggested or listed', () => {
		const taken = txn({ matchedElsewhere: true });
		expect(strongSuggestion(occ(), [taken])).toBeNull();
		expect(listPickerCandidates(occ(), [taken])).toEqual([]);
	});

	test('a dismissal is not suggested again, and a different transaction still is', () => {
		const dismissed = txn({ id: 4, dismissedForOccurrence: true, merchant: 'Rent' });
		const other = txn({ id: 5, merchant: 'Rent payment', amountCents: -10050 });
		expect(strongSuggestion(occ(), [dismissed, other])?.id).toBe(5);
		const listed = listPickerCandidates(occ(), [dismissed, other]);
		expect(listed.map((row) => row.id).sort()).toEqual([4, 5]);
	});

	test('payee plus amount plus date is strong; a date miss is weak', () => {
		const good = txn({ id: 7, merchant: 'Rent payment', amountCents: -10100, date: '2026-11-12' });
		const late = txn({ id: 8, merchant: 'Rent payment', amountCents: -10000, date: '2026-11-20' });
		expect(strongSuggestion(occ(), [good, late])?.id).toBe(7);
		const listed = listPickerCandidates(occ(), [good, late]);
		expect(listed[0]?.id).toBe(7);
		expect(listed[0]?.strong).toBe(true);
		expect(listed.find((row) => row.id === 8)?.strong).toBe(false);
	});

	test('search filters the picker and does not confirm anything', () => {
		const rows = [
			txn({ id: 1, merchant: 'Fitness Club', amountCents: -3150 }),
			txn({ id: 2, merchant: 'Grocery Mart', amountCents: -5400 })
		];
		expect(candidateMatchesQuery(rows[0]!, '31.50')).toBe(true);
		expect(candidateMatchesQuery(rows[0]!, 'grocery')).toBe(false);
		expect(listPickerCandidates(occ({ amountCents: -2900, name: 'Gym' }), rows, 'fitness')).toHaveLength(1);
		expect(strongSuggestion(occ(), rows)).toBeNull();
	});
});

describe('transaction link', () => {
	test('uses the transactions search filters', () => {
		const href = transactionHref({
			date: '2026-11-06',
			amountCents: -9640,
			merchant: 'Power Co',
			accountId: 3
		});
		expect(href.startsWith('/transactions?')).toBe(true);
		const params = new URLSearchParams(href.slice('/transactions?'.length));
		expect(params.get('date_from')).toBe('2026-11-06');
		expect(params.get('date_to')).toBe('2026-11-06');
		expect(params.get('account')).toBe('3');
		expect(params.get('amount_op')).toBe('eq');
		expect(params.get('amount_from')).toBe('96.40');
		expect(params.get('q')).toBe('Power Co');
	});
});

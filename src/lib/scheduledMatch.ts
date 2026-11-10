import { addDaysIso } from '$lib/calendarMobile';
import { daysBetween, isOverdue } from '$lib/scheduledPaid';
import { normalizeMerchant } from '$lib/merchantNormalize';
import { formatMoney } from '$lib/utils';

/**
 * Match a scheduled occurrence to an existing transaction. Pure: no database.
 *
 * Amount tolerance is max(2% of the scheduled amount, $1). A few percent covers
 * tax and rounding; the $1 floor keeps a small bill from requiring a cent match.
 * A strong suggestion also needs the transaction inside ±4 days of the display
 * date, and either payee similarity at or above 0.5 or the same account with
 * the exact signed amount.
 *
 * When the series has an account, a different account is not a candidate.
 * A series with no account may match any account; the same-account path then
 * cannot make a suggestion strong, so payee similarity is required.
 *
 * Already matched to another occurrence, or dismissed for this occurrence,
 * is never suggested. Dismissed rows stay in the picker. Nothing here confirms
 * a link — the server inserts a row only on an explicit confirm or match.
 */

/** Fraction of |scheduled amount| allowed as slack. */
export const MATCH_AMOUNT_TOLERANCE_RATE = 0.02;

/** Floor so a small bill still allows a dollar of slack. */
export const MATCH_AMOUNT_TOLERANCE_MIN_CENTS = 100;

/** Strong suggestions must fall inside this many days of the display date. */
export const MATCH_DATE_WINDOW_DAYS = 4;

/** Picker lists transactions inside this many days of the display date. */
export const PICKER_DATE_WINDOW_DAYS = 14;

/**
 * Unpaid occurrences overdue, or due within this many days, get a suggestion.
 * The calendar computes those server-side for the loaded range only.
 */
export const SUGGESTION_LOOKAHEAD_DAYS = 7;

/** Unpaid, and either overdue or due within the lookahead. Today counts. */
export function occurrenceNeedsSuggestion(displayDate: string, paid: boolean, today: string): boolean {
	if (paid) return false;
	if (isOverdue(displayDate, false, today)) return true;
	return displayDate >= today && displayDate <= addDaysIso(today, SUGGESTION_LOOKAHEAD_DAYS);
}

/** Jaccard (with a containment boost) at or above this can make a suggestion strong. */
export const MATCH_PAYEE_SIMILARITY_MIN = 0.5;

export type MatchOccurrence = {
	displayDate: string;
	amountCents: number;
	name: string;
	accountId: number | null;
};

export type MatchTxn = {
	id: number;
	date: string;
	amountCents: number;
	merchant: string | null;
	description?: string | null;
	accountId: number;
	/** Linked to some other occurrence. Never a candidate. */
	matchedElsewhere?: boolean;
	/** Not this, for this occurrence. Hidden from suggestions, still pickable. */
	dismissedForOccurrence?: boolean;
};

export type MatchSuggestionView = {
	transactionId: number;
	date: string;
	amountCents: number;
	merchant: string | null;
	accountId: number;
	accountName: string | null;
};

export type ListedCandidate = {
	id: number;
	date: string;
	amountCents: number;
	merchant: string | null;
	accountId: number;
	accountName: string | null;
	hint: string;
	strong: boolean;
};

export type ScoredMatch = {
	id: number;
	date: string;
	amountCents: number;
	merchant: string | null;
	accountId: number;
	strong: boolean;
	payeeSimilarity: number;
	amountWithinTolerance: boolean;
	inDateWindow: boolean;
	sameAccount: boolean;
	exactAmount: boolean;
	/** Positive when the transaction is larger in magnitude than scheduled. */
	deltaCents: number;
	hint: string;
};

export function amountToleranceCents(scheduledCents: number): number {
	const pct = Math.round(Math.abs(scheduledCents) * MATCH_AMOUNT_TOLERANCE_RATE);
	return Math.max(MATCH_AMOUNT_TOLERANCE_MIN_CENTS, pct);
}

/** Magnitude gap. Positive means the transaction is larger than scheduled. */
export function amountDeltaCents(scheduledCents: number, txnCents: number): number {
	return Math.abs(txnCents) - Math.abs(scheduledCents);
}

export function amountDeltaHint(scheduledCents: number, txnCents: number): string {
	const delta = amountDeltaCents(scheduledCents, txnCents);
	if (delta === 0 && txnCents === scheduledCents) return 'Same amount';
	const body = delta > 0 ? `+${formatMoney(delta)}` : formatMoney(delta);
	return `${body} vs scheduled`;
}

function sameDirection(scheduledCents: number, txnCents: number): boolean {
	if (scheduledCents === 0 || txnCents === 0) return scheduledCents === txnCents;
	return Math.sign(scheduledCents) === Math.sign(txnCents);
}

export function amountWithinTolerance(scheduledCents: number, txnCents: number): boolean {
	if (!sameDirection(scheduledCents, txnCents)) return false;
	return Math.abs(amountDeltaCents(scheduledCents, txnCents)) <= amountToleranceCents(scheduledCents);
}

function payeeTokens(raw: string): string[] {
	return normalizeMerchant(raw)
		.split(/[^a-z0-9]+/)
		.filter((token) => token.length >= 3);
}

/** Token overlap against the scheduled name. Containment of the normalized name scores 0.85. */
export function payeeSimilarity(scheduledName: string, merchant: string | null, description?: string | null): number {
	const rightRaw = [merchant, description].filter((part) => part && part.trim()).join(' ');
	const left = payeeTokens(scheduledName);
	const right = payeeTokens(rightRaw);
	if (left.length === 0 || right.length === 0) return 0;
	const a = new Set(left);
	const b = new Set(right);
	let shared = 0;
	for (const token of a) if (b.has(token)) shared += 1;
	const jaccard = shared / (a.size + b.size - shared);
	const leftNorm = normalizeMerchant(scheduledName);
	const rightNorm = normalizeMerchant(rightRaw);
	if (leftNorm.length >= 3 && rightNorm.length >= 3 && (rightNorm.includes(leftNorm) || leftNorm.includes(rightNorm))) {
		return Math.max(jaccard, 0.85);
	}
	return jaccard;
}

export function inMatchDateWindow(displayDate: string, txnDate: string): boolean {
	return Math.abs(daysBetween(displayDate, txnDate)) <= MATCH_DATE_WINDOW_DAYS;
}

export function inPickerDateWindow(displayDate: string, txnDate: string): boolean {
	return Math.abs(daysBetween(displayDate, txnDate)) <= PICKER_DATE_WINDOW_DAYS;
}

/** Different account is not a candidate when the series has an account. */
export function isAccountCandidate(occurrence: MatchOccurrence, txn: MatchTxn): boolean {
	if (txn.matchedElsewhere) return false;
	if (occurrence.accountId != null && txn.accountId !== occurrence.accountId) return false;
	return true;
}

export function scoreMatch(occurrence: MatchOccurrence, txn: MatchTxn): ScoredMatch {
	const sameAccount = occurrence.accountId != null && txn.accountId === occurrence.accountId;
	const exactAmount = txn.amountCents === occurrence.amountCents;
	const amountOk = amountWithinTolerance(occurrence.amountCents, txn.amountCents);
	const inWindow = inMatchDateWindow(occurrence.displayDate, txn.date);
	const similarity = payeeSimilarity(occurrence.name, txn.merchant, txn.description);
	const strong =
		amountOk && inWindow && (similarity >= MATCH_PAYEE_SIMILARITY_MIN || (sameAccount && exactAmount));
	return {
		id: txn.id,
		date: txn.date,
		amountCents: txn.amountCents,
		merchant: txn.merchant,
		accountId: txn.accountId,
		strong,
		payeeSimilarity: similarity,
		amountWithinTolerance: amountOk,
		inDateWindow: inWindow,
		sameAccount,
		exactAmount,
		deltaCents: amountDeltaCents(occurrence.amountCents, txn.amountCents),
		hint: amountDeltaHint(occurrence.amountCents, txn.amountCents)
	};
}

function byRank(occurrence: MatchOccurrence, a: ScoredMatch, b: ScoredMatch): number {
	if (a.strong !== b.strong) return a.strong ? -1 : 1;
	const dateA = Math.abs(daysBetween(occurrence.displayDate, a.date));
	const dateB = Math.abs(daysBetween(occurrence.displayDate, b.date));
	if (dateA !== dateB) return dateA - dateB;
	const deltaA = Math.abs(a.deltaCents);
	const deltaB = Math.abs(b.deltaCents);
	if (deltaA !== deltaB) return deltaA - deltaB;
	if (a.payeeSimilarity !== b.payeeSimilarity) return b.payeeSimilarity - a.payeeSimilarity;
	return a.id - b.id;
}

/** Best strong hit, or null. Never confirms. Skips dismissed and matched-elsewhere. */
export function strongSuggestion(occurrence: MatchOccurrence, txns: readonly MatchTxn[]): ScoredMatch | null {
	const scored = txns
		.filter((txn) => isAccountCandidate(occurrence, txn) && !txn.dismissedForOccurrence)
		.map((txn) => scoreMatch(occurrence, txn))
		.filter((row) => row.strong)
		.sort((a, b) => byRank(occurrence, a, b));
	return scored[0] ?? null;
}

export function candidateMatchesQuery(
	txn: { merchant: string | null; description?: string | null; amountCents: number },
	query: string
): boolean {
	const q = query.trim().toLowerCase();
	if (!q) return true;
	const dollars = (Math.abs(txn.amountCents) / 100).toFixed(2);
	const hay = [txn.merchant, txn.description, formatMoney(txn.amountCents), dollars, `$${dollars}`]
		.filter((part) => part && String(part).trim())
		.join(' ')
		.toLowerCase();
	return hay.includes(q);
}

/**
 * Picker rows: ±14 days, same-account rule, search filter, matched-elsewhere excluded.
 * Dismissed rows stay so the user can still pick one. Sorted strongest / closest first.
 */
export function listPickerCandidates(
	occurrence: MatchOccurrence,
	txns: readonly MatchTxn[],
	query = ''
): ScoredMatch[] {
	return txns
		.filter(
			(txn) =>
				isAccountCandidate(occurrence, txn) &&
				inPickerDateWindow(occurrence.displayDate, txn.date) &&
				candidateMatchesQuery(txn, query)
		)
		.map((txn) => scoreMatch(occurrence, txn))
		.sort((a, b) => byRank(occurrence, a, b));
}

/** Transactions list has no id deep link. Date, account, amount, and payee find the row. */
export function transactionHref(txn: {
	date: string;
	amountCents: number;
	merchant: string | null;
	accountId: number;
}): string {
	const params = new URLSearchParams();
	params.set('date_from', txn.date);
	params.set('date_to', txn.date);
	params.set('account', String(txn.accountId));
	params.set('amount_op', 'eq');
	params.set('amount_from', (Math.abs(txn.amountCents) / 100).toFixed(2));
	const merchant = txn.merchant?.trim();
	if (merchant) params.set('q', merchant);
	return `/transactions?${params.toString()}`;
}

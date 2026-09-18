/** Normalize payee/merchant for matching (ADO-14 / recurring-style). */
export function normalizeMerchant(raw: string | null | undefined): string {
	if (!raw) return '';
	let s = raw.trim().toLowerCase();
	s = s.replace(/\s+/g, ' ');
	s = s.replace(/\s+#?\d{2,}$/g, '').trim();
	return s;
}

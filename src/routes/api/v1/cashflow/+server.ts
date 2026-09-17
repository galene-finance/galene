import { apiUser, json, unauthorized } from '$lib/server/api';
import { cashflowForMonths, lastDayOfMonth, monthDiff, shiftMonth } from '$lib/server/finance';

const isDate = (s: string | null) => s != null && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s);
const isMonth = (s: string | null) => s != null && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

/** Accepts YYYY-MM or YYYY-MM-DD; returns the YYYY-MM part or null. */
function toMonth(s: string | null): string | null {
	if (isMonth(s)) return s;
	if (isDate(s)) return s!.slice(0, 7);
	return null;
}

export function GET(event) {
	const user = apiUser(event);
	if (!user) return unauthorized();
	const now = new Date();
	const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

	// Defaults to the last 6 months, capped at 24 (same as the cashflow page).
	let fromMonth = toMonth(event.url.searchParams.get('from')) ?? shiftMonth(currentMonth, -5);
	let endMonth = toMonth(event.url.searchParams.get('to')) ?? currentMonth;
	if (fromMonth > endMonth) [fromMonth, endMonth] = [endMonth, fromMonth];
	if (monthDiff(fromMonth, endMonth) > 23) fromMonth = shiftMonth(endMonth, -23);

	const monthList: string[] = [];
	for (let cur = fromMonth; cur <= endMonth; cur = shiftMonth(cur, 1)) monthList.push(cur);

	const { sections, summary } = cashflowForMonths(user.id, monthList);
	return json(200, {
		from: `${monthList[0]}-01`,
		to: lastDayOfMonth(monthList[monthList.length - 1]),
		monthList,
		sections,
		summary
	});
}

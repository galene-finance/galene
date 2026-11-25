/** Budget engine wire contract v1. All monetary values are safe integer cents. */
export const BUDGET_ENGINE_VERSION = 1 as const;
export type Cadence = 'monthly' | 'weekly' | 'annual' | 'irregular';
export type Target = {
 id: string; categoryId: number; amountCents: number; cadence: Cadence;
 behavior: 'refill' | 'set_aside' | 'balance'; startDate: string;
 dueDate?: string; repeatMonths?: number; weekday?: number;
};
export type TargetProgress = { cycleAssignedCents: number; monthAssignedCents: number; cycleStartAvailableCents: number; availableCents: number };
export type TargetEvaluation = { targetId: string; categoryId: number; month: string; cycleStart: string; dueDate: string | null; goalCents: number; plannedCents: number; remainingCents: number; neededThisMonthCents: number; active: boolean };
export type BudgetAccount = { id: number; currency?: string; scope: 'cash' | 'credit' | 'tracking'; balanceCents: number };
export type LedgerEvent = { id: string; date: string } & (
 | { kind: 'assign'; categoryId: number; amountCents: number }
 | { kind: 'move'; fromCategoryId: number; toCategoryId: number; amountCents: number }
 | { kind: 'reserve'; accountId: number; amountCents: number }
 | { kind: 'income'; accountId: number; amountCents: number }
 | { kind: 'purchase' | 'refund'; accountId: number; categoryId: number; amountCents: number }
 | { kind: 'transfer'; fromAccountId: number; toAccountId: number; amountCents: number; categoryId?: number }
);
export type CategoryFunds = { categoryId: number; availableCents: number; assignedCents: number; activityCents: number; creditOverspentCents: number };
export type LedgerView = { cashCents: number; readyToAssignCents: number; categories: CategoryFunds[]; accounts: BudgetAccount[]; cardReserves: { accountId: number; reservedCents: number; cashBackedReserveCents: number | null; debtCents: number; unfundedCents: number }[]; netExpenseCents: number; appliedEventIds: string[]; cashOverspentCents: number; cashBackingShortfallCents: number };
export type BalanceSource = 'actual' | 'accepted_estimate' | 'reconstructed';
export type BalanceSnapshot = { accountId: number; currency: string; asOf: string; balanceCents: number; source: BalanceSource; evidence: string; recordedAt: string; coverageFrom?: string; coverageTo?: string };
export type HistoryAccount = { id: number; included: boolean; fromDate?: string; throughDate?: string };
export type HistoryPoint = { date: string; totalCents: number | null; knownSubtotalCents: number; missingAccountIds: number[]; includedAccountIds: number[]; sources: BalanceSnapshot[]; complete: boolean };
export type CommandMeta = { expectedRevision: number; idempotencyKey: string };

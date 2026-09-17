export type AccountType = 'bank' | 'credit' | 'cash' | 'investment' | 'other';
export type CategoryType = 'expense' | 'income' | 'transfer';
export type RepeatUnit = 'day' | 'week' | 'month' | 'year';
export type ForecastBehavior = 'bill' | 'spread';

export interface User {
	id: number;
	name: string;
	email: string;
	/** 1 when the account can manage other users (Settings → Users). */
	is_admin: number;
}

export interface Account {
	id: number;
	name: string;
	type: AccountType;
	color: string | null;
	/** Set when the account was imported from a bank provider. */
	provider?: string | null;
	external_id?: string | null;
	/** The provider's own name for this account (kept in sync on each pull). */
	source_name?: string | null;
	/** 1 when the user chose this name; the sync engine won't overwrite it. */
	name_locked?: number;
	/**
	 * Opening balance in signed cents (same convention as transactions).
	 * NULL until set. With opening_as_of, anchors ledger balance (issue #44).
	 */
	opening_balance_cents?: number | null;
	/** YYYY-MM-DD as-of for opening; NULL until set. */
	opening_as_of?: string | null;
	/**
	 * Last provider-reported balance in signed cents (issue #45).
	 * NULL for manual accounts or until a sync reports one.
	 */
	provider_balance_cents?: number | null;
	/** UTC DB datetime when the provider balance was accurate / fetched. */
	provider_balance_as_of?: string | null;
}

export interface Category {
	id: number;
	name: string;
	type: CategoryType;
	parent_id: number | null;
	color: string | null;
}

export interface Tag {
	id: number;
	name: string;
}

export interface TransactionSplit {
	category_id: number;
	category_name: string | null;
	amount_cents: number;
}

export interface Transaction {
	id: number;
	account_id: number;
	category_id: number | null;
	date: string;
	amount_cents: number;
	merchant: string | null;
	notes: string | null;
	color: string | null;
	/** Set when the transaction was imported from a bank provider. */
	provider?: string | null;
	external_id?: string | null;
	account_name?: string;
	category_name?: string | null;
	category_color?: string | null;
	/** Present when the row was joined to categories; transfer categories are excluded from cashflow/reports. */
	category_type?: CategoryType | null;
	tags?: string[];
	tag_ids?: number[];
	splits?: TransactionSplit[];
}

export interface Budget {
	id: number;
	category_id: number;
	period: 'week' | 'month' | 'year';
	limit_cents: number;
	category_name?: string;
	category_color?: string | null;
}

export interface Scheduled {
	id: number;
	name: string;
	account_id: number | null;
	category_id: number | null;
	amount_cents: number;
	start_date: string;
	repeat_interval: number | null;
	repeat_unit: RepeatUnit | null;
	until_date: string | null;
	forecast_behavior: ForecastBehavior;
	color: string | null;
	notes?: string | null;
	account_name?: string | null;
	category_name?: string | null;
	tags?: string[];
	tag_ids?: number[];
}

export interface RecurringSuggestion {
	key: string;
	merchant: string;
	hitCount: number;
	medianAmountCents: number;
	nextDate: string;
	lastDate: string;
	repeatInterval: number;
	repeatUnit: RepeatUnit;
	accountId: number | null;
	accountName: string | null;
	categoryId: number | null;
	categoryName: string | null;
	confidence: number;
	sampleDates: string[];
}

export type NotificationKind = 'sync_failed' | 'sync_recovered' | 'budget_overrun' | 'bill_upcoming';

export interface AppNotification {
	id: number;
	kind: NotificationKind;
	title: string;
	body: string;
	link: string | null;
	read_at: string | null;
	created_at: string;
	resolved_at: string | null;
}

export type RuleField = 'merchant' | 'amount' | 'account';
export type RuleOp = 'contains' | 'equals' | 'gt' | 'lt' | 'between';

export interface RuleCondition {
	field: RuleField;
	op: RuleOp;
	value: string | number;
	/** Second bound for `between`; a number when parsed from the DB, a string while editing in the dialog. */
	value2?: string | number;
}

export interface CategorizationRule {
	id: number;
	name: string;
	conditions: RuleCondition[];
	category_id: number;
	priority: number;
	enabled: number;
	category_name?: string;
}

export const ACCOUNT_TYPES: AccountType[] = ['bank', 'credit', 'cash', 'investment', 'other'];

// ---------------------------------------------------------------------------
// Data deletion (Settings > Data)
// ---------------------------------------------------------------------------

/**
 * The user's data, as deletable from the Data settings page. Each key maps
 * to one or more tables owned by the user.
 */
export type DeletableDataType =
	| 'accounts'
	| 'transactions'
	| 'categories'
	| 'tags'
	| 'budgets'
	| 'scheduled'
	| 'rules'
	| 'connections'
	| 'notifications'
	| 'api_tokens'
	| 'themes'
	| 'settings';

export interface DataTypeInfo {
	key: DeletableDataType;
	label: string;
	/** What the deletion affects, including cascades. Shown in the confirmation dialog. */
	description: string;
}

/** Display order for the Data page: day-to-day data first, account plumbing last. */
export const DATA_TYPES: DataTypeInfo[] = [
	{
		key: 'accounts',
		label: 'Accounts',
		description:
			'All accounts and the transactions recorded on them. Scheduled expectations linked to an account keep their other details.'
	},
	{
		key: 'transactions',
		label: 'Transactions',
		description: 'All transactions, including their tags and splits.'
	},
	{
		key: 'categories',
		label: 'Categories',
		description:
			'All categories. Budgets and categorization rules tied to a category are removed, and transactions and scheduled expectations become uncategorized.'
	},
	{
		key: 'tags',
		label: 'Tags',
		description: 'All tags, and every tag assignment on transactions and scheduled expectations.'
	},
	{
		key: 'budgets',
		label: 'Budgets',
		description: 'All budgets.'
	},
	{
		key: 'scheduled',
		label: 'Scheduled expectations',
		description: 'All recurring bills and income expectations.'
	},
	{
		key: 'rules',
		label: 'Categorization rules',
		description: 'All rules that auto-assign categories to transactions.'
	},
	{
		key: 'connections',
		label: 'Bank connections',
		description:
			'All bank provider connections and their stored credentials. Imported accounts and transactions are kept.'
	},
	{
		key: 'notifications',
		label: 'Notifications',
		description: 'All notifications.'
	},
	{
		key: 'api_tokens',
		label: 'API tokens',
		description: 'All API tokens. Scripts and the MCP server using them stop working.'
	},
	{
		key: 'themes',
		label: 'Custom themes',
		description: 'All custom themes. Your selected theme falls back to the default.'
	},
	{
		key: 'settings',
		label: 'Preferences',
		description: 'All saved preferences, such as your theme choice.'
	}
];

export const CATEGORY_TYPES: CategoryType[] = ['expense', 'income', 'transfer'];

export const COLORS = [
	'#ef4444',
	'#f97316',
	'#f59e0b',
	'#84cc16',
	'#22c55e',
	'#14b8a6',
	'#0ea5e9',
	'#6366f1',
	'#a855f7',
	'#ec4899',
	'#64748b'
];

/** Per-user branding: the name and icon shown in the top bar. */
export interface Branding {
	name: string;
	/** Built-in icon key, see lib/icons.ts. */
	icon: string;
}

/** The color set that defines a theme. All colors are #rrggbb hex. */
export interface ThemeColors {
	background: string;
	surface: string;
	surfaceHover: string;
	foreground: string;
	mutedForeground: string;
	primary: string;
	primaryForeground: string;
	success: string;
	destructive: string;
	border: string;
	warning: string;
	input: string;
	/** Card corner radius, e.g. "0.5rem". */
	radius: string;
}

export interface Theme {
	/** null for built-in default themes, a themes-table row id for user themes. */
	id: number | null;
	/** Stable identifier used in the data-theme attribute: slug for defaults, "t<id>" for user themes. */
	slug: string;
	name: string;
	colors: ThemeColors;
}

// ---------------------------------------------------------------------------
// Bank sync
// ---------------------------------------------------------------------------

/** A credential the user enters in the Sync settings page. */
export interface ProviderCredentialField {
	key: string;
	label: string;
	placeholder?: string;
	secret?: boolean;
}

/** A bank account as reported by a provider. */
export interface ProviderAccount {
	external_id: string;
	name: string;
	type: AccountType;
	/**
	 * Provider-reported balance in Galene signed cents (positive = asset,
	 * negative = typical credit liability). Omit when the provider has none.
	 */
	balance_cents?: number | null;
	/**
	 * When the balance was accurate (UTC 'YYYY-MM-DD HH:MM:SS').
	 * Omit to let the sync engine stamp fetch time.
	 */
	balance_as_of?: string | null;
}

/** A bank transaction as reported by a provider. Amounts are signed cents (negative = expense). */
export interface ProviderTransaction {
	external_id: string;
	account_external_id: string;
	/** YYYY-MM-DD */
	date: string;
	amount_cents: number;
	merchant: string | null;
	notes?: string | null;
}

/** Per-call context the sync engine passes to a provider. */
export interface ProviderContext {
	userId: number;
	/** The user's stored credentials for this provider (the connect form values). */
	credentials: Record<string, string>;
	/**
	 * The credentials currently persisted for this provider, when a connection
	 * already exists (empty for a brand-new one). Lets a provider merge new
	 * credentials into the stored set instead of clobbering it — e.g. Plaid
	 * appends a second bank's access token to the ones it already holds.
	 */
	existing?: Record<string, string>;
}

/**
 * A bank data provider. Implementations plug into the sync engine and the
 * Sync settings page; `connect` throws with a user-facing message on bad
 * credentials. Methods may return values or promises.
 *
 * `connect` may return a replacement credential set (e.g. SimpleFIN's
 * one-time setup token exchanged for a long-lived access URL); the engine
 * stores whatever it returns instead of the original form values.
 *
 * `fetchTransactions(since)` supports incremental sync: when `since` is a
 * YYYY-MM-DD date, the provider returns only transactions dated on or after
 * it (the engine passes the newest date it has already imported, so re-syncs
 * fetch just the boundary day and anything newer). Omit `since` for a full
 * fetch.
 */
export interface BankProvider {
	id: string;
	label: string;
	description: string;
	credentialFields: ProviderCredentialField[];
	/**
	 * Whether the provider can be used for this user. Providers that need
	 * per-user credentials (e.g. Plaid) take the user id; others ignore it.
	 * Defaults to true. Shown as "not configured" in the UI when false.
	 */
	isConfigured?(userId?: number): boolean;
	/**
	 * Minimum auto-sync interval in minutes, derived from the provider's
	 * published rate limits. Undefined means the provider has no auto-sync
	 * (the UI hides the schedule control).
	 */
	minSyncIntervalMinutes?: number;
	/**
	 * When true, the connect action pulls the provider's accounts and
	 * transactions in immediately after a successful connect, instead of
	 * waiting for a separate "Sync now". Used by Plaid, where each Link
	 * session links one bank and the user expects to see it right away.
	 */
	autoSyncOnConnect?: boolean;
	connect(
		credentials: Record<string, string>,
		ctx?: ProviderContext
	): void | Promise<void | Record<string, string>>;
	listAccounts(ctx?: ProviderContext): ProviderAccount[] | Promise<ProviderAccount[]>;
	fetchTransactions(since?: string, ctx?: ProviderContext): ProviderTransaction[] | Promise<ProviderTransaction[]>;
}

/** Serializable subset of BankProvider, safe to send to the client for the settings UI. */
export interface ProviderInfo {
	id: string;
	label: string;
	description: string;
	credentialFields: ProviderCredentialField[];
	/** False when the provider needs server-side setup (e.g. env vars) that is missing. */
	configured: boolean;
	/** Human-readable hint shown when `configured` is false. */
	configureHint?: string;
	minSyncIntervalMinutes?: number;
	/**
	 * Set when the provider connects through an interactive hosted flow
	 * (Plaid Link) instead of credential fields, and the server is fully
	 * configured to create new connections.
	 */
	link?: boolean;
}

/** A saved provider connection for a user. */
export interface Connection {
	id: number;
	provider: string;
	status: 'connected' | 'error';
	last_synced_at: string | null;
	last_error: string | null;
	/** Auto-sync cadence in minutes; null = manual syncs only. */
	sync_interval_minutes: number | null;
	/** When the scheduler will next run this connection (UTC, DB format). */
	next_sync_at: string | null;
}

/** A provider account linked to a Galene account, with its imported transaction count. */
export interface LinkedAccount {
	id: number;
	name: string;
	type: AccountType;
	external_id: string;
	tx_count: number;
	/** The provider's own name for this account (may differ from `name` if the user renamed it). */
	source_name: string | null;
	/** 1 when the user chose this account's name; the sync engine won't overwrite it. */
	name_locked: number;
}

/** Result of a sync run. */
export interface SyncSummary {
	accounts: number;
	created: number;
	updated: number;
	/** Stale copies the provider no longer reports, merged into their live replacements. */
	merged: number;
	lastSyncedAt: string;
}

// ---------------------------------------------------------------------------
// Database backups (Settings > Backups, admin-only)
// ---------------------------------------------------------------------------

/** Instance-level backup configuration (one row per server). */
export interface BackupSettings {
	/** Absolute path of the folder backups are written to (inside the allowlisted backup root). */
	destDir: string;
	/** Scheduled-backup interval in minutes; null = no schedule. */
	intervalMinutes: number | null;
	/** When the scheduler will next run a backup (UTC, DB format). */
	nextRunAt: string | null;
	/** When the last backup run happened (ISO). */
	lastRunAt: string | null;
	/** Error message from the last failed run. */
	lastError: string | null;
	/** Delete backups older than this many days; null = keep all. */
	keepDays: number | null;
}

/** A backup file in the backup folder. */
export interface BackupFile {
	filename: string;
	/** ISO timestamp parsed from the file name (mtime when it can't be). */
	createdAt: string;
	sizeBytes: number;
}

// ---------------------------------------------------------------------------
// Home dashboard (issue #11)
// ---------------------------------------------------------------------------

export type DashboardWidgetType =
	| 'balances'
	| 'recent'
	| 'upcoming'
	| 'budgets'
	| 'month'
	| 'notifications'
	| 'trends';

/**
 * Per-widget filters. Which dimensions apply depends on the widget type
 * (see the catalog in lib/dashboard.ts); unused fields stay absent.
 */
/** Per-user Cashflow page gear filters (issue #37). Empty arrays = all. */
export interface CashflowViewFilters {
	accountIds: number[];
	categoryIds: number[];
}

export interface DashboardFilters {
	accountIds?: number[];
	categoryIds?: number[];
	tagIds?: number[];
	accountType?: '' | AccountType;
	period?: 'week' | 'month' | 'year';
	kinds?: NotificationKind[];
	unreadOnly?: boolean;
	days?: number;
	months?: number;
	limit?: number;
}

/**
 * One dashboard widget. `x`/`y` are grid cells (12-column grid, row units);
 * they are always derived by the layout compactor, never stored user input.
 */
export interface DashboardWidget {
	id: string;
	type: DashboardWidgetType;
	x: number;
	y: number;
	w: number;
	h: number;
	filters: DashboardFilters;
}

/** Server-computed payload for one dashboard widget, keyed by its type. */
export type DashboardWidgetData =
	| {
			kind: 'balances';
			items: {
				id: number;
				name: string;
				type: AccountType;
				color: string | null;
				/** Ledger balance (opening + txns on/after as-of). */
				balanceCents: number;
				/** Provider/bank balance when synced; null for manual / never synced. */
				bankCents: number | null;
				/** UTC DB datetime for bankCents; null when bankCents is null. */
				bankAsOf: string | null;
			}[];
			totalCents: number;
	  }
	| { kind: 'recent'; items: Transaction[] }
	| {
			kind: 'upcoming';
			days: {
				date: string;
				label: string;
				items: {
					id: number;
					name: string;
					amountCents: number;
					color: string | null;
					accountName: string | null;
					categoryName: string | null;
				}[];
			}[];
	  }
	| {
			kind: 'budgets';
			items: {
				id: number;
				categoryName: string;
				categoryColor: string | null;
				period: Budget['period'];
				limitCents: number;
				spentCents: number;
			}[];
	  }
	| {
			kind: 'month';
			label: string;
			prevLabel: string;
			incomeCents: number;
			expenseCents: number;
			netCents: number;
			prevIncomeCents: number;
			prevExpenseCents: number;
	  }
	| { kind: 'notifications'; items: AppNotification[]; unread: number }
	| { kind: 'trends'; months: number; points: { key: string; label: string; spentCents: number }[] };

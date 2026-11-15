import { createHash } from 'node:crypto';
import type { RequestEvent } from '@sveltejs/kit';
import { json } from './api';
import { db } from './db';
import { demoBlockedMessage, isDemoMode } from './demoMode';
import { getDashboardLayout, saveDashboardLayout } from './dashboard';
import { getSetting, setSetting } from './finance';
import {
	getThemeSetting,
	getUserThemes,
	resolveTheme,
	saveUserTheme,
	selectTheme
} from './themes';
import { isWriteApiEnabled } from './writeApi';
import {
	DASHBOARD_MAX_WIDGETS,
	GRID_COLUMNS,
	WIDGET_CATALOG,
	WIDGET_CATALOG_LIST,
	sanitizeLayout
} from '$lib/dashboard';
import { EMBLEM_ICON_KEY, ICONS, normalizeBrandingIcon } from '$lib/icons';
import { DEFAULT_THEMES } from '$lib/themes';
import { ACCOUNT_TYPES } from '$lib/types';
import type {
	DashboardFilters,
	DashboardWidget,
	DashboardWidgetType,
	NotificationKind,
	ThemeColors
} from '$lib/types';

export type CustomizationKind = 'dashboard' | 'appearance';

type IntegrationEvent = Pick<RequestEvent, 'request' | 'locals'>;
type JsonRecord = Record<string, unknown>;

const REVISION_RE = /^[a-f0-9]{64}$/;
const WIDGET_ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const RADIUS_RE = /^(?:0|[01](?:\.\d{1,3})?|2(?:\.0{1,3})?)rem$/;
const UNSAFE_TEXT_RE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_SAFE_ID = Number.MAX_SAFE_INTEGER;

const COLOR_KEYS = [
	'background',
	'surface',
	'surfaceHover',
	'foreground',
	'mutedForeground',
	'primary',
	'primaryForeground',
	'success',
	'destructive',
	'border',
	'warning',
	'input'
] as const;

const NOTIFICATION_KINDS: NotificationKind[] = [
	'sync_failed',
	'sync_recovered',
	'budget_overrun',
	'bill_upcoming'
];

const ICON_KEYS = [EMBLEM_ICON_KEY, ...ICONS.map((icon) => icon.key)];

class ValidationError extends Error {}
class RevisionConflict extends Error {}
class AuthenticationChanged extends Error {}
class WriteGateChanged extends Error {}

interface TokenCaller {
	userId: number;
	tokenId: number;
	scope: 'read' | 'write';
}

interface BuiltInThemeValue {
	kind: 'built_in';
	slug: string;
}

interface CustomThemeValue {
	kind: 'custom';
	id: number;
	name: string;
	colors: ThemeColors;
}

type ThemeValue = BuiltInThemeValue | CustomThemeValue;

interface AppearanceValue {
	theme: ThemeValue;
	app_name: string;
	icon: string;
	favicon: string;
	week_starts_on: 'sunday' | 'monday';
}

interface ThemeCatalogRow {
	id: number;
	name: string;
	colors: ThemeColors;
}

export interface DashboardIntegrationState {
	layout: DashboardWidget[];
	catalog: {
		max_widgets: number;
		grid_columns: number;
		widget_types: {
			type: DashboardWidgetType;
			label: string;
			description: string;
			default_width: number;
			default_height: number;
			filters: string[];
		}[];
	};
	revision: string;
}

export interface AppearanceIntegrationState {
	appearance: AppearanceValue;
	catalog: {
		built_in_themes: { slug: string; name: string; colors: ThemeColors }[];
		custom_themes: ThemeCatalogRow[];
		icons: { key: string; label: string }[];
		week_starts_on: ('sunday' | 'monday')[];
	};
	revision: string;
}

interface BuiltInThemeChange {
	kind: 'built_in';
	slug: string;
}

interface CustomThemeChange {
	kind: 'custom';
	id?: number;
	name?: string;
	colors?: ThemeColors;
}

type ThemeChange = BuiltInThemeChange | CustomThemeChange;

interface AppearanceChanges {
	theme?: ThemeChange;
	app_name?: string;
	icon?: string;
	favicon?: string;
	week_starts_on?: 'sunday' | 'monday';
}

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: JsonRecord, allowed: readonly string[], message: string) {
	if (Object.keys(value).some((key) => !allowed.includes(key))) throw new ValidationError(message);
}

function stableValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stableValue);
	if (!isRecord(value)) return value;
	return Object.fromEntries(
		Object.keys(value)
			.sort()
			.map((key) => [key, stableValue(value[key])])
	);
}

function stableJson(value: unknown): string {
	return JSON.stringify(stableValue(value));
}

function revision(value: unknown): string {
	return createHash('sha256').update(stableJson(value)).digest('hex');
}

function sameValue(left: unknown, right: unknown): boolean {
	return stableJson(left) === stableJson(right);
}

function positiveId(value: unknown, message: string): number {
	if (!Number.isSafeInteger(value) || typeof value !== 'number' || value < 1 || value > MAX_SAFE_ID) {
		throw new ValidationError(message);
	}
	return value;
}

function boundedInteger(value: unknown, minimum: number, maximum: number, message: string): number {
	if (!Number.isInteger(value) || typeof value !== 'number' || value < minimum || value > maximum) {
		throw new ValidationError(message);
	}
	return value;
}

function boundedText(value: unknown, maximum: number, allowEmpty: boolean, message: string): string {
	if (typeof value !== 'string') throw new ValidationError(message);
	const text = value.trim();
	if ((!allowEmpty && !text) || text.length > maximum || UNSAFE_TEXT_RE.test(text)) {
		throw new ValidationError(message);
	}
	return text;
}

function tokenCaller(event: IntegrationEvent): TokenCaller | null {
	const user = event.locals.user;
	const supplied = event.locals.apiToken;
	if (!user || user.role === 'viewer' || !supplied || event.locals.viewer) return null;
	const row = db()
		.query('SELECT scope FROM api_tokens WHERE id = ? AND user_id = ?')
		.get(supplied.id, user.id) as { scope: string } | null;
	if (!row || (row.scope !== 'read' && row.scope !== 'write')) return null;
	const scope = row.scope;
	if (scope !== supplied.scope) return null;
	return { userId: user.id, tokenId: supplied.id, scope };
}

function tokenRequired(): Response {
	return json(401, {
		error: 'Unauthorized. Authenticate this integration route with an API token.'
	});
}

function outcomeUnknown(): Response {
	return json(500, {
		error: 'The customization outcome could not be verified. Inspect current state; do not retry.',
		outcome_unknown: true,
		retryable: false
	});
}

function dashboardCatalog(): DashboardIntegrationState['catalog'] {
	return {
		max_widgets: DASHBOARD_MAX_WIDGETS,
		grid_columns: GRID_COLUMNS,
		widget_types: WIDGET_CATALOG_LIST.map((entry) => ({
			type: entry.type,
			label: entry.label,
			description: entry.description,
			default_width: entry.w,
			default_height: entry.h,
			filters: Object.keys(entry.filters).sort()
		}))
	};
}

export function getDashboardIntegrationState(userId: number): DashboardIntegrationState {
	const layout = getDashboardLayout(userId);
	return {
		layout,
		catalog: dashboardCatalog(),
		revision: revision(layout)
	};
}

function themeValue(userId: number): ThemeValue {
	const theme = resolveTheme(userId, getThemeSetting(userId));
	if (theme.id === null) return { kind: 'built_in', slug: theme.slug };
	return { kind: 'custom', id: theme.id, name: theme.name, colors: theme.colors };
}

function appearanceRevisionValue(state: Omit<AppearanceIntegrationState, 'revision'>): unknown {
	return {
		appearance: state.appearance,
		custom_themes: state.catalog.custom_themes
	};
}

export function getAppearanceIntegrationState(userId: number): AppearanceIntegrationState {
	const customThemes = getUserThemes(userId).map((theme) => ({
		id: theme.id!,
		name: theme.name,
		colors: theme.colors
	}));
	const value: Omit<AppearanceIntegrationState, 'revision'> = {
		appearance: {
			theme: themeValue(userId),
			app_name: getSetting(userId, 'app_name') ?? '',
			icon: normalizeBrandingIcon(getSetting(userId, 'icon') ?? EMBLEM_ICON_KEY),
			favicon: normalizeBrandingIcon(getSetting(userId, 'favicon') ?? EMBLEM_ICON_KEY),
			week_starts_on: getSetting(userId, 'week_starts_on') === 'monday' ? 'monday' : 'sunday'
		},
		catalog: {
			built_in_themes: DEFAULT_THEMES.map((theme) => ({
				slug: theme.slug,
				name: theme.name,
				colors: theme.colors
			})),
			custom_themes: customThemes,
			icons: [
				{ key: EMBLEM_ICON_KEY, label: 'Galene emblem' },
				...ICONS.map((icon) => ({ key: icon.key, label: icon.label }))
			],
			week_starts_on: ['sunday', 'monday']
		}
	};
	return { ...value, revision: revision(appearanceRevisionValue(value)) };
}

function idArray(value: unknown, maximum: number, message: string): number[] {
	if (!Array.isArray(value) || value.length < 1 || value.length > maximum) {
		throw new ValidationError(message);
	}
	const ids = value.map((item) => positiveId(item, message));
	if (new Set(ids).size !== ids.length) throw new ValidationError(message);
	return ids;
}

function validateFilters(value: unknown, type: DashboardWidgetType): DashboardFilters {
	if (!isRecord(value)) throw new ValidationError('Dashboard filters must be an object.');
	const allowed = Object.keys(WIDGET_CATALOG[type].filters);
	exactKeys(value, allowed, `Unsupported filter for ${type}.`);
	const result: DashboardFilters = {};
	for (const [key, raw] of Object.entries(value)) {
		if (key === 'accountIds') result.accountIds = idArray(raw, 32, 'Invalid account filter.');
		else if (key === 'categoryIds') result.categoryIds = idArray(raw, 64, 'Invalid category filter.');
		else if (key === 'tagIds') result.tagIds = idArray(raw, 64, 'Invalid tag filter.');
		else if (key === 'accountType') {
			if (typeof raw !== 'string' || !ACCOUNT_TYPES.includes(raw as (typeof ACCOUNT_TYPES)[number])) {
				throw new ValidationError('Invalid account-type filter.');
			}
			result.accountType = raw as (typeof ACCOUNT_TYPES)[number];
		} else if (key === 'period') {
			if (raw !== 'week' && raw !== 'month' && raw !== 'year') {
				throw new ValidationError('Invalid period filter.');
			}
			result.period = raw;
		} else if (key === 'kinds') {
			if (!Array.isArray(raw) || raw.length < 1 || raw.length > NOTIFICATION_KINDS.length) {
				throw new ValidationError('Invalid notification-kind filter.');
			}
			const kinds = raw.map((item) => {
				if (typeof item !== 'string' || !NOTIFICATION_KINDS.includes(item as NotificationKind)) {
					throw new ValidationError('Invalid notification-kind filter.');
				}
				return item as NotificationKind;
			});
			if (new Set(kinds).size !== kinds.length) {
				throw new ValidationError('Invalid notification-kind filter.');
			}
			result.kinds = kinds;
		} else if (key === 'unreadOnly') {
			if (typeof raw !== 'boolean') throw new ValidationError('Invalid unread filter.');
			result.unreadOnly = raw;
		} else if (key === 'days') result.days = boundedInteger(raw, 1, 365, 'Invalid day filter.');
		else if (key === 'months') result.months = boundedInteger(raw, 1, 24, 'Invalid month filter.');
		else if (key === 'limit') result.limit = boundedInteger(raw, 1, 100, 'Invalid limit filter.');
	}
	return result;
}

function validateDashboardLayout(value: unknown): DashboardWidget[] {
	if (!Array.isArray(value) || value.length > DASHBOARD_MAX_WIDGETS) {
		throw new ValidationError(`Dashboard layout must contain at most ${DASHBOARD_MAX_WIDGETS} widgets.`);
	}
	const ids = new Set<string>();
	const layout: DashboardWidget[] = value.map((item) => {
		if (!isRecord(item)) throw new ValidationError('Each dashboard widget must be an object.');
		exactKeys(item, ['id', 'type', 'x', 'y', 'w', 'h', 'filters'], 'Unknown dashboard widget field.');
		if (typeof item.id !== 'string' || !WIDGET_ID_RE.test(item.id) || ids.has(item.id)) {
			throw new ValidationError('Dashboard widget ids must be unique and bounded.');
		}
		ids.add(item.id);
		if (typeof item.type !== 'string' || !(item.type in WIDGET_CATALOG)) {
			throw new ValidationError('Unknown dashboard widget type.');
		}
		const type = item.type as DashboardWidgetType;
		const x = boundedInteger(item.x, 0, GRID_COLUMNS - 1, 'Invalid dashboard column.');
		const y = boundedInteger(item.y, 0, 199, 'Invalid dashboard row.');
		const w = boundedInteger(item.w, 1, GRID_COLUMNS, 'Invalid dashboard width.');
		const h = boundedInteger(item.h, 1, 12, 'Invalid dashboard height.');
		if (x + w > GRID_COLUMNS) throw new ValidationError('Dashboard widget exceeds the grid.');
		return { id: item.id, type, x, y, w, h, filters: validateFilters(item.filters, type) };
	});
	const sanitized = sanitizeLayout(layout);
	if (!sameValue(sanitized, layout)) {
		throw new ValidationError('Dashboard layout must already be native-normalized.');
	}
	return sanitized;
}

function validateOwnedIds(userId: number, table: 'accounts' | 'categories' | 'tags', ids: Set<number>) {
	if (ids.size === 0) return;
	const list = [...ids];
	const rows = db()
		.query(`SELECT id FROM ${table} WHERE user_id = ? AND id IN (${list.map(() => '?').join(',')})`)
		.all(userId, ...list) as { id: number }[];
	if (rows.length !== list.length) throw new ValidationError(`A ${table.slice(0, -1)} filter is unavailable.`);
}

function validateDashboardOwnership(userId: number, layout: DashboardWidget[]) {
	const accounts = new Set<number>();
	const categories = new Set<number>();
	const tags = new Set<number>();
	for (const widget of layout) {
		for (const id of widget.filters.accountIds ?? []) accounts.add(id);
		for (const id of widget.filters.categoryIds ?? []) categories.add(id);
		for (const id of widget.filters.tagIds ?? []) tags.add(id);
	}
	validateOwnedIds(userId, 'accounts', accounts);
	validateOwnedIds(userId, 'categories', categories);
	validateOwnedIds(userId, 'tags', tags);
}

function validateColors(value: unknown): ThemeColors {
	if (!isRecord(value)) throw new ValidationError('Custom theme colors must be an object.');
	const keys = [...COLOR_KEYS, 'radius'];
	if (Object.keys(value).length !== keys.length) throw new ValidationError('Custom theme colors are incomplete.');
	exactKeys(value, keys, 'Unknown custom theme color.');
	const colors = {} as Record<(typeof COLOR_KEYS)[number], string>;
	for (const key of COLOR_KEYS) {
		const raw = value[key];
		if (typeof raw !== 'string' || !HEX_RE.test(raw)) throw new ValidationError(`Invalid color: ${key}.`);
		colors[key] = raw.toLowerCase();
	}
	if (typeof value.radius !== 'string' || !RADIUS_RE.test(value.radius.trim())) {
		throw new ValidationError('Card radius must be between 0rem and 2rem.');
	}
	return { ...colors, radius: value.radius.trim() };
}

function validateThemeChange(value: unknown): ThemeChange {
	if (!isRecord(value) || (value.kind !== 'built_in' && value.kind !== 'custom')) {
		throw new ValidationError('Invalid theme change.');
	}
	if (value.kind === 'built_in') {
		exactKeys(value, ['kind', 'slug'], 'Unknown built-in theme field.');
		if (typeof value.slug !== 'string' || !DEFAULT_THEMES.some((theme) => theme.slug === value.slug)) {
			throw new ValidationError('Unknown built-in theme.');
		}
		return { kind: 'built_in', slug: value.slug };
	}
	exactKeys(value, ['kind', 'id', 'name', 'colors'], 'Unknown custom theme field.');
	const result: CustomThemeChange = { kind: 'custom' };
	if ('id' in value) result.id = positiveId(value.id, 'Invalid custom theme id.');
	const hasName = 'name' in value;
	const hasColors = 'colors' in value;
	if (hasName !== hasColors || (!result.id && !hasName)) {
		throw new ValidationError('A new custom theme requires a name and complete colors.');
	}
	if (hasName) {
		result.name = boundedText(value.name, 40, false, 'Invalid custom theme name.');
		result.colors = validateColors(value.colors);
	}
	return result;
}

function validateAppearanceChanges(value: unknown): AppearanceChanges {
	if (!isRecord(value) || Object.keys(value).length === 0) {
		throw new ValidationError('Appearance changes must be a non-empty object.');
	}
	exactKeys(value, ['theme', 'app_name', 'icon', 'favicon', 'week_starts_on'], 'Unknown appearance field.');
	const changes: AppearanceChanges = {};
	if ('theme' in value) changes.theme = validateThemeChange(value.theme);
	if ('app_name' in value) changes.app_name = boundedText(value.app_name, 40, true, 'Invalid app name.');
	for (const key of ['icon', 'favicon'] as const) {
		if (key in value) {
			if (typeof value[key] !== 'string' || !ICON_KEYS.includes(value[key])) {
				throw new ValidationError(`Invalid ${key}.`);
			}
			changes[key] = value[key];
		}
	}
	if ('week_starts_on' in value) {
		if (value.week_starts_on !== 'sunday' && value.week_starts_on !== 'monday') {
			throw new ValidationError('Invalid week start.');
		}
		changes.week_starts_on = value.week_starts_on;
	}
	return changes;
}

async function requestObject(request: Request): Promise<JsonRecord> {
	const declared = request.headers.get('content-length');
	if (declared !== null) {
		const size = Number(declared);
		if (!Number.isFinite(size) || size < 0 || size > MAX_BODY_BYTES) {
			throw new ValidationError('Request body is too large.');
		}
	}
	const reader = request.body?.getReader();
	let text = '';
	if (reader) {
		const chunks: Uint8Array[] = [];
		let size = 0;
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > MAX_BODY_BYTES) {
				await reader.cancel();
				throw new ValidationError('Request body is too large.');
			}
			chunks.push(value);
		}
		const body = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) {
			body.set(chunk, offset);
			offset += chunk.byteLength;
		}
		try {
			text = new TextDecoder('utf-8', { fatal: true }).decode(body);
		} catch {
			throw new ValidationError('Request body must be valid UTF-8.');
		}
	}
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		throw new SyntaxError('Invalid JSON.');
	}
	if (!isRecord(value)) throw new SyntaxError('JSON object required.');
	return value;
}

function rollbackQuietly() {
	try {
		db().run('ROLLBACK');
	} catch {
		// A failed BEGIN or already-finished transaction needs no second failure.
	}
}

function insertCustomizationAudit(
	caller: TokenCaller,
	resource: CustomizationKind,
	changedFields: string[],
	beforeRevision: string,
	afterRevision: string
) {
	db()
		.query(
			`INSERT INTO api_audit (user_id, token_id, action, resource, resource_id, detail)
			 VALUES (?, ?, 'update', ?, NULL, ?)`
		)
		.run(
			caller.userId,
			caller.tokenId,
			resource,
			JSON.stringify({
				changed_fields: [...changedFields].sort(),
				before_revision: beforeRevision,
				after_revision: afterRevision
			})
		);
}

function parseRevision(value: unknown): string {
	if (typeof value !== 'string' || !REVISION_RE.test(value)) throw new ValidationError('Invalid revision.');
	return value;
}

function customThemeRows(state: AppearanceIntegrationState): ThemeCatalogRow[] {
	return state.catalog.custom_themes.map((theme) => ({
		id: theme.id,
		name: theme.name,
		colors: theme.colors
	}));
}

function appearanceTarget(
	current: AppearanceIntegrationState,
	changes: AppearanceChanges
): { value: unknown; changedFields: string[]; createsTheme: boolean } {
	const appearance: AppearanceValue = JSON.parse(JSON.stringify(current.appearance));
	const themes = customThemeRows(current);
	const changedFields: string[] = [];
	let createsTheme = false;
	const themeChange = changes.theme;
	if (themeChange) {
		if (themeChange.kind === 'built_in') {
			appearance.theme = { kind: 'built_in', slug: themeChange.slug };
		} else if (themeChange.id) {
			const existing = themes.find((theme) => theme.id === themeChange.id);
			if (!existing) throw new ValidationError('Custom theme not found.');
			if (themeChange.name && themeChange.colors) {
				existing.name = themeChange.name;
				existing.colors = themeChange.colors;
			}
			appearance.theme = { kind: 'custom', ...existing };
		} else {
			createsTheme = true;
		}
	}
	for (const key of ['app_name', 'icon', 'favicon', 'week_starts_on'] as const) {
		if (changes[key] !== undefined) {
			if (appearance[key] !== changes[key]) changedFields.push(key);
			appearance[key] = changes[key] as never;
		}
	}
	if (
		themeChange &&
		(createsTheme ||
			!sameValue(
				{ theme: current.appearance.theme, custom_themes: current.catalog.custom_themes },
				{ theme: appearance.theme, custom_themes: themes }
			))
	) {
		changedFields.push('theme');
	}
	return {
		value: { appearance, custom_themes: themes },
		changedFields,
		createsTheme
	};
}

function applyAppearanceChanges(userId: number, current: AppearanceIntegrationState, changes: AppearanceChanges) {
	const themeChange = changes.theme;
	if (themeChange?.kind === 'built_in') {
		selectTheme(userId, themeChange.slug);
	} else if (themeChange?.kind === 'custom') {
		if (themeChange.id) {
			const existing = current.catalog.custom_themes.find((theme) => theme.id === themeChange.id);
			if (!existing) throw new ValidationError('Custom theme not found.');
			if (themeChange.name && themeChange.colors) {
				saveUserTheme(userId, existing.id, themeChange.name, themeChange.colors);
			}
			selectTheme(userId, String(existing.id));
		} else {
			const name = themeChange.name!;
			if (current.catalog.custom_themes.some((theme) => theme.name.toLowerCase() === name.toLowerCase())) {
				throw new ValidationError('A custom theme with that name already exists.');
			}
			const id = saveUserTheme(userId, null, name, themeChange.colors!);
			selectTheme(userId, String(id));
		}
	}
	for (const key of ['app_name', 'icon', 'favicon', 'week_starts_on'] as const) {
		if (changes[key] !== undefined) setSetting(userId, key, changes[key]!);
	}
}

function verifyAppearanceChange(
	before: AppearanceIntegrationState,
	after: AppearanceIntegrationState,
	changes: AppearanceChanges
): boolean {
	for (const key of ['app_name', 'icon', 'favicon', 'week_starts_on'] as const) {
		const expected = changes[key] ?? before.appearance[key];
		if (after.appearance[key] !== expected) return false;
	}
	if (!changes.theme) return sameValue(before.appearance.theme, after.appearance.theme);
	if (changes.theme.kind === 'built_in') {
		return sameValue(after.appearance.theme, { kind: 'built_in', slug: changes.theme.slug });
	}
	if (after.appearance.theme.kind !== 'custom') return false;
	const selectedTheme = after.appearance.theme;
	if (changes.theme.id && selectedTheme.id !== changes.theme.id) return false;
	if (changes.theme.name && selectedTheme.name !== changes.theme.name) return false;
	if (changes.theme.colors && !sameValue(selectedTheme.colors, changes.theme.colors)) return false;
	if (!changes.theme.id) {
		if (before.catalog.custom_themes.some((theme) => theme.id === selectedTheme.id)) return false;
		if (after.catalog.custom_themes.length !== before.catalog.custom_themes.length + 1) return false;
	}
	const selected = after.catalog.custom_themes.find((theme) => theme.id === selectedTheme.id);
	return !!selected && selected.name === selectedTheme.name && sameValue(selected.colors, selectedTheme.colors);
}

export function handleCustomizationGet(event: IntegrationEvent, kind: CustomizationKind): Response {
	if (isDemoMode()) return json(403, { error: demoBlockedMessage('API tokens') });
	const caller = tokenCaller(event);
	if (!caller) return tokenRequired();
	return json(
		200,
		kind === 'dashboard'
			? getDashboardIntegrationState(caller.userId)
			: getAppearanceIntegrationState(caller.userId)
	);
}

export async function handleCustomizationPut(event: IntegrationEvent, kind: CustomizationKind): Promise<Response> {
	if (isDemoMode()) return json(403, { error: demoBlockedMessage('The write API') });
	const caller = tokenCaller(event);
	if (!caller) return tokenRequired();
	if (!isWriteApiEnabled()) return json(403, { error: 'The write API is off.' });
	if (caller.scope !== 'write') {
		return json(403, { error: 'This token cannot write. Create a token with write scope.' });
	}

	let body: JsonRecord;
	try {
		body = await requestObject(event.request);
	} catch (error) {
		if (error instanceof SyntaxError) return json(400, { error: error.message });
		return json(422, { error: error instanceof Error ? error.message : 'Invalid request.' });
	}

	let requestedRevision: string;
	let layout: DashboardWidget[] | null = null;
	let appearanceChanges: AppearanceChanges | null = null;
	try {
		if (kind === 'dashboard') {
			exactKeys(body, ['revision', 'layout'], 'Unknown dashboard request field.');
			if (!('revision' in body) || !('layout' in body)) throw new ValidationError('Dashboard request is incomplete.');
			requestedRevision = parseRevision(body.revision);
			layout = validateDashboardLayout(body.layout);
		} else {
			exactKeys(body, ['revision', 'changes'], 'Unknown appearance request field.');
			if (!('revision' in body) || !('changes' in body)) throw new ValidationError('Appearance request is incomplete.');
			requestedRevision = parseRevision(body.revision);
			appearanceChanges = validateAppearanceChanges(body.changes);
		}
	} catch (error) {
		return json(422, { error: error instanceof Error ? error.message : 'Invalid request.' });
	}

	let committed = false;
	let afterDashboard: DashboardIntegrationState | null = null;
	let afterAppearance: AppearanceIntegrationState | null = null;
	try {
		db().run('BEGIN IMMEDIATE');
		const currentCaller = tokenCaller(event);
		if (
			!currentCaller ||
			currentCaller.userId !== caller.userId ||
			currentCaller.tokenId !== caller.tokenId ||
			currentCaller.scope !== 'write'
		) {
			throw new AuthenticationChanged('API token authorization changed before the write.');
		}
		if (!isWriteApiEnabled()) throw new WriteGateChanged('The write API is off.');
		if (kind === 'dashboard') {
			const current = getDashboardIntegrationState(caller.userId);
			if (current.revision !== requestedRevision) throw new RevisionConflict('Dashboard revision is stale.');
			validateDashboardOwnership(caller.userId, layout!);
			if (sameValue(current.layout, layout)) {
				db().run('COMMIT');
				committed = true;
				return json(200, { ok: true, changed: false, ...current });
			}
			const saved = saveDashboardLayout(caller.userId, layout);
			if (!sameValue(saved, layout)) throw new Error('Dashboard native readback mismatch.');
			afterDashboard = getDashboardIntegrationState(caller.userId);
			if (!sameValue(afterDashboard.layout, layout)) throw new Error('Dashboard native readback mismatch.');
			insertCustomizationAudit(caller, kind, ['layout'], current.revision, afterDashboard.revision);
		} else {
			const current = getAppearanceIntegrationState(caller.userId);
			if (current.revision !== requestedRevision) throw new RevisionConflict('Appearance revision is stale.');
			const target = appearanceTarget(current, appearanceChanges!);
			if (!target.createsTheme && sameValue(target.value, appearanceRevisionValue(current))) {
				db().run('COMMIT');
				committed = true;
				return json(200, { ok: true, changed: false, ...current });
			}
			applyAppearanceChanges(caller.userId, current, appearanceChanges!);
			afterAppearance = getAppearanceIntegrationState(caller.userId);
			if (!verifyAppearanceChange(current, afterAppearance, appearanceChanges!)) {
				throw new Error('Appearance native readback mismatch.');
			}
			insertCustomizationAudit(
				caller,
				kind,
				target.changedFields,
				current.revision,
				afterAppearance.revision
			);
		}
		db().run('COMMIT');
		committed = true;
	} catch (error) {
		if (!committed) rollbackQuietly();
		if (error instanceof AuthenticationChanged) return tokenRequired();
		if (error instanceof WriteGateChanged) return json(403, { error: error.message });
		if (error instanceof RevisionConflict) return json(409, { error: error.message });
		if (error instanceof ValidationError) return json(422, { error: error.message });
		return outcomeUnknown();
	}

	try {
		if (kind === 'dashboard') {
			const observed = getDashboardIntegrationState(caller.userId);
			if (!afterDashboard || !sameValue(observed, afterDashboard)) return outcomeUnknown();
			return json(200, { ok: true, revision: observed.revision, layout: observed.layout });
		}
		const observed = getAppearanceIntegrationState(caller.userId);
		if (!afterAppearance || !sameValue(observed, afterAppearance)) return outcomeUnknown();
		return json(200, { ok: true, revision: observed.revision, appearance: observed.appearance });
	} catch {
		return outcomeUnknown();
	}
}

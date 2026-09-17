import { db } from './db';
import { DATA_TYPES, type DataTypeInfo, type DeletableDataType } from '$lib/types';

export { DATA_TYPES, type DataTypeInfo, type DeletableDataType };

export function getDataType(key: string): DataTypeInfo | undefined {
	return DATA_TYPES.find((t) => t.key === key);
}

/** Row counts per data type, for the page listing. */
export function dataCounts(userId: number): Record<DeletableDataType, number> {
	const d = db();
	const count = (sql: string) => (d.query(sql).get(userId) as { c: number }).c;
	return {
		accounts: count('SELECT COUNT(*) AS c FROM accounts WHERE user_id = ?'),
		transactions: count('SELECT COUNT(*) AS c FROM transactions WHERE user_id = ?'),
		categories: count('SELECT COUNT(*) AS c FROM categories WHERE user_id = ?'),
		tags: count('SELECT COUNT(*) AS c FROM tags WHERE user_id = ?'),
		budgets: count('SELECT COUNT(*) AS c FROM budgets WHERE user_id = ?'),
		scheduled: count('SELECT COUNT(*) AS c FROM scheduled WHERE user_id = ?'),
		rules: count('SELECT COUNT(*) AS c FROM categorization_rules WHERE user_id = ?'),
		connections: count('SELECT COUNT(*) AS c FROM connections WHERE user_id = ?'),
		notifications: count('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ?'),
		api_tokens: count('SELECT COUNT(*) AS c FROM api_tokens WHERE user_id = ?'),
		themes: count('SELECT COUNT(*) AS c FROM themes WHERE user_id = ?'),
		settings: count('SELECT COUNT(*) AS c FROM settings WHERE user_id = ?')
	};
}

/**
 * Deletes one data type for a user. Child rows are removed by the schema's
 * ON DELETE CASCADE / SET NULL rules, so each type is a single statement.
 */
export function deleteDataType(userId: number, type: DeletableDataType): void {
	const table = type === 'rules' ? 'categorization_rules' : type;
	db().query(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);
}

/**
 * Deletes everything on the Data page for a user. The user account itself is
 * kept, so they can sign in again. Order respects the schema's foreign keys:
 * children before parents, so no statement hits a dangling reference.
 */
export function deleteAllData(userId: number): void {
	const d = db();
	d.run('BEGIN');
	try {
		d.query('DELETE FROM transactions WHERE user_id = ?').run(userId);
		d.query('DELETE FROM scheduled WHERE user_id = ?').run(userId);
		d.query('DELETE FROM budgets WHERE user_id = ?').run(userId);
		d.query('DELETE FROM categorization_rules WHERE user_id = ?').run(userId);
		d.query('DELETE FROM accounts WHERE user_id = ?').run(userId);
		d.query('DELETE FROM categories WHERE user_id = ?').run(userId);
		d.query('DELETE FROM tags WHERE user_id = ?').run(userId);
		d.query('DELETE FROM connections WHERE user_id = ?').run(userId);
		d.query('DELETE FROM notifications WHERE user_id = ?').run(userId);
		d.query('DELETE FROM api_tokens WHERE user_id = ?').run(userId);
		d.query('DELETE FROM themes WHERE user_id = ?').run(userId);
		d.query('DELETE FROM settings WHERE user_id = ?').run(userId);
		d.run('COMMIT');
	} catch (error) {
		d.run('ROLLBACK');
		throw error;
	}
}

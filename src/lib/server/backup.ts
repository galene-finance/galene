import {
	existsSync,
	mkdirSync,
	realpathSync,
	readdirSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync
} from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { db } from './db';
import { dbTime } from './sync';
import { formatBytes } from '$lib/utils';
import type { BackupFile, BackupSettings } from '$lib/types';

export { formatBytes };

/** A failed scheduled backup retries no sooner than an hour later. */
const FAILURE_BACKOFF_MINUTES = 60;

const ROW_ID = 1;
/**
 * Backup file names: galene.db.bak-<ISO timestamp with : (and sometimes .)
 * → ->, matching manual dumps. The milliseconds separator is a dash in
 * files this app writes and a dot in some manual ones; both are accepted.
 */
const BACKUP_FILE_RE = /^galene\.db\.bak-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}[-.]\d{3}Z$/;

/**
 * Allowlisted root that every backup path must live under. Set via
 * GALENE_BACKUP_ROOT (the Docker image sets it to /app/backups); defaults to a
 * backups/ folder next to the app so a bare-metal dev setup works out of the box.
 */
export function backupRoot(): string {
	return process.env.GALENE_BACKUP_ROOT ?? resolve(process.cwd(), 'backups');
}

/**
 * Checks that `dir` is inside the allowlisted backup root. `resolve()`
 * normalizes `..`, so lexical traversal is rejected before any filesystem
 * access; if the path exists, `realpathSync()` follows symlinks so a link
 * can't redirect the backup outside the root. Returns the resolved path, or
 * null if it's outside (or can't be confirmed, e.g. it doesn't exist yet).
 */
function withinBackupRoot(dir: string): string | null {
	const resolved = resolve(dir);
	const root = resolve(backupRoot());
	if (resolved !== root && !resolved.startsWith(root + '/')) return null;
	if (existsSync(resolved)) {
		try {
			const real = realpathSync(resolved);
			const realRoot = realpathSync(root);
			if (real !== realRoot && !real.startsWith(realRoot + '/')) return null;
		} catch {
			return null;
		}
	}
	return resolved;
}

export function getBackupSettings(): BackupSettings {
	const row = db()
		.query('SELECT dest_dir, interval_minutes, next_run_at, last_run_at, last_error, keep_days FROM backup_settings WHERE id = ?')
		.get(ROW_ID) as
		| {
				dest_dir: string;
				interval_minutes: number | null;
				next_run_at: string | null;
				last_run_at: string | null;
				last_error: string | null;
				keep_days: number | null;
		  }
		| undefined;
	return {
		destDir: row?.dest_dir ?? '',
		intervalMinutes: row?.interval_minutes ?? null,
		nextRunAt: row?.next_run_at ?? null,
		lastRunAt: row?.last_run_at ?? null,
		lastError: row?.last_error ?? null,
		keepDays: row?.keep_days ?? null
	};
}

export function saveBackupSettings(patch: Partial<BackupSettings>): BackupSettings {
	const next = { ...getBackupSettings(), ...patch };
	db()
		.query(
			`INSERT INTO backup_settings (id, dest_dir, interval_minutes, next_run_at, last_run_at, last_error, keep_days)
			 VALUES (?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT (id) DO UPDATE SET
			   dest_dir = excluded.dest_dir,
			   interval_minutes = excluded.interval_minutes,
			   next_run_at = excluded.next_run_at,
			   last_run_at = excluded.last_run_at,
			   last_error = excluded.last_error,
			   keep_days = excluded.keep_days`
		)
		.run(
			ROW_ID,
			next.destDir,
			next.intervalMinutes,
			next.nextRunAt,
			next.lastRunAt,
			next.lastError,
			next.keepDays
		);
	return next;
}

/**
 * Validates (and if needed creates) the backup folder. Returns the resolved
 * path, or an error message. The path must be an absolute path inside the
 * allowlisted backup root (GALENE_BACKUP_ROOT). A non-existent path is created
 * so a fresh folder works out of the box; an existing path must be a writable
 * directory that does not resolve (via a symlink) outside the root.
 */
export function validateDestDir(raw: string): { dir?: string; error?: string } {
	const dir = raw.trim();
	const root = resolve(backupRoot());
	if (!dir) return { error: 'Enter a folder path.' };
	if (!isAbsolute(dir)) return { error: `The folder must be an absolute path inside ${root}.` };
	const resolved = resolve(dir);
	if (resolved !== root && !resolved.startsWith(root + '/')) {
		return { error: `The folder must be inside ${root}.` };
	}
	if (!existsSync(resolved)) {
		try {
			mkdirSync(resolved, { recursive: true });
		} catch (error) {
			return { error: `Could not create that folder: ${error instanceof Error ? error.message : 'permission denied'}` };
		}
	} else if (!statSync(resolved).isDirectory()) {
		return { error: 'That path exists but is not a folder.' };
	}
	// It exists now: confirm the real (symlink-resolved) location is still inside
	// the root, so a symlink can't redirect the backup outside it.
	if (!withinBackupRoot(resolved)) {
		return { error: `The folder must be inside ${root} (it resolves outside it).` };
	}
	// Probe writability with a throwaway file before trusting the folder.
	const probe = join(resolved, `.galene-write-probe-${Date.now()}`);
	try {
		writeFileSync(probe, '');
		unlinkSync(probe);
	} catch (error) {
		return { error: `That folder is not writable: ${error instanceof Error ? error.message : 'permission denied'}` };
	}
	return { dir: resolved };
}

/**
 * Copies the database to a new file in the backup folder. VACUUM INTO reads
 * the whole database through the normal (WAL-aware) read path, so the copy
 * is a consistent snapshot even while the app is in use. It writes to a
 * hidden temp file first and renames, so a failure never leaves a partial
 * backup under its final name.
 */
export function createBackup(destDir: string): BackupFile {
	// Re-check the root here too: the stored dest_dir is trusted input, but a
	// tampered value must not be able to redirect a full DB copy elsewhere.
	const dir = withinBackupRoot(destDir);
	if (!dir) throw new Error(`Backup folder must be inside the allowed root ${backupRoot()}.`);
	const now = new Date();
	const filename = backupFilename(now);
	const tmp = join(dir, `.${filename}.tmp`);
	try {
		db().query('VACUUM INTO ?').run(tmp);
		renameSync(tmp, join(dir, filename));
	} catch (error) {
		try {
			unlinkSync(tmp);
		} catch {
			// The temp file may not exist if VACUUM INTO failed before writing.
		}
		throw error;
	}
	const sizeBytes = statSync(join(dir, filename)).size;
	return { filename, createdAt: now.toISOString(), sizeBytes };
}

/** galene.db.bak-<ISO timestamp with : and . → ->, matching manual dumps. */
function backupFilename(now: Date): string {
	return `galene.db.bak-${now.toISOString().replace(/[:.]/g, '-')}`;
}

function timestampFromFilename(filename: string): string | null {
	const m = /^galene\.db\.bak-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})[-.](\d{3})Z$/.exec(filename);
	if (!m) return null;
	return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.${m[7]}Z`;
}

/** Backup files in the folder, newest first. */
export function listBackups(destDir: string): BackupFile[] {
	if (!withinBackupRoot(destDir)) return [];
	if (!existsSync(destDir) || !statSync(destDir).isDirectory()) return [];
	return readdirSync(destDir)
		.filter((name) => BACKUP_FILE_RE.test(name))
		.map((filename) => {
			const stat = statSync(join(destDir, filename));
			return {
				filename,
				createdAt: timestampFromFilename(filename) ?? stat.mtime.toISOString(),
				sizeBytes: stat.size
			};
		})
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Deletes one backup file. The name must match the backup pattern, so this can't reach outside the folder. */
export function deleteBackup(destDir: string, filename: string): boolean {
	if (!withinBackupRoot(destDir)) return false;
	if (!BACKUP_FILE_RE.test(filename)) return false;
	try {
		unlinkSync(join(destDir, filename));
		return true;
	} catch {
		return false;
	}
}

/** Deletes backups older than keepDays. Returns the number removed. */
export function trimBackups(destDir: string, keepDays: number): number {
	const cutoff = Date.now() - keepDays * 86_400_000;
	let removed = 0;
	for (const file of listBackups(destDir)) {
		if (Date.parse(file.createdAt) < cutoff && deleteBackup(destDir, file.filename)) removed++;
	}
	return removed;
}

/**
 * Runs a backup now (manual button or scheduler): writes a copy to the
 * configured folder, trims old copies, and records the outcome.
 */
export function runBackupNow(): { ok: true; message: string } | { ok: false; error: string } {
	const settings = getBackupSettings();
	if (!settings.destDir) return { ok: false, error: 'Set a backup folder first.' };
	try {
		const backup = createBackup(settings.destDir);
		let removed = 0;
		if (settings.keepDays) removed = trimBackups(settings.destDir, settings.keepDays);
		saveBackupSettings({ lastRunAt: backup.createdAt, lastError: null });
		const message = `Backed up to ${backup.filename} (${formatBytes(backup.sizeBytes)}).`;
		return { ok: true, message: removed ? `${message} Removed ${removed} older backup${removed === 1 ? '' : 's'}.` : message };
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Backup failed.';
		saveBackupSettings({ lastError: message });
		return { ok: false, error: message };
	}
}

// globalThis so a dev-mode module re-evaluation can't start a second loop.
const g = globalThis as unknown as { __galeneBackupScheduler?: boolean };

/**
 * Runs the scheduled backup once per minute, like the sync scheduler: when
 * next_run_at has passed it takes a backup, trims old ones, and reschedules
 * (backing off to an hour after a failure).
 */
export function startBackupScheduler(): void {
	if (g.__galeneBackupScheduler) return;
	g.__galeneBackupScheduler = true;
	setInterval(() => {
		void tickBackups().catch(() => {});
	}, 60_000);
}

async function tickBackups(): Promise<void> {
	const settings = getBackupSettings();
	if (!settings.intervalMinutes || !settings.nextRunAt) return;
	if (settings.nextRunAt > dbTime(new Date())) return;
	const result = runBackupNow();
	const delay = result.ok ? settings.intervalMinutes : Math.max(settings.intervalMinutes, FAILURE_BACKOFF_MINUTES);
	saveBackupSettings({ nextRunAt: dbTime(new Date(Date.now() + delay * 60_000)) });
}

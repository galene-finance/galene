import { redirect } from '@sveltejs/kit';
import {
	backupRoot,
	deleteBackup,
	getBackupSettings,
	listBackups,
	runBackupNow,
	saveBackupSettings,
	validateDestDir
} from '$lib/server/backup';
import { dbTime } from '$lib/server/sync';
import type { BackupFile, BackupSettings } from '$lib/types';

export function load({ locals, depends }) {
	depends('user');
	if (!locals.user) redirect(303, '/login');
	if (!locals.user.is_admin) redirect(303, '/settings');
	const settings = getBackupSettings();
	return {
		settings,
		backupRoot: backupRoot(),
		backups: settings.destDir ? listBackups(settings.destDir) : []
	};
}

/** Every action on this page is admin-only. */
function requireAdmin(locals: App.Locals) {
	if (!locals.user) redirect(303, '/login');
	if (!locals.user.is_admin) redirect(303, '/settings');
}

/** "90 minutes" / "an hour" / "a day" style label for an interval in minutes. */
function formatInterval(minutes: number): string {
	if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
	const hours = minutes / 60;
	if (hours < 24) return hours === 1 ? 'an hour' : `${hours} hours`;
	const days = hours / 24;
	if (days < 7) return days === 1 ? 'a day' : `${days} days`;
	const weeks = days / 7;
	return weeks === 1 ? 'a week' : `${weeks} weeks`;
}

export const actions = {
	// Save the backup folder. A missing folder is created (with parents); an
	// existing path must be a writable directory.
	'save-dir': async ({ request, locals }) => {
		requireAdmin(locals);
		const form = await request.formData();
		const { dir, error } = validateDestDir(String(form.get('dir') ?? ''));
		if (error) return { error };
		saveBackupSettings({ destDir: dir! });
		return { ok: true, message: `Backups will be written to ${dir}.` };
	},

	// Take a backup right now (also trims backups past the retention period).
	'backup-now': async ({ locals }) => {
		requireAdmin(locals);
		return runBackupNow();
	},

	// Turn the scheduled backup on/off and set its interval. The first run is
	// one interval out, so enabling it never fires a backup immediately.
	'save-schedule': async ({ request, locals }) => {
		requireAdmin(locals);
		const form = await request.formData();
		const raw = String(form.get('interval') ?? '').trim();
		const minutes = raw === '' ? null : Number(raw);
		if (minutes != null && (!Number.isInteger(minutes) || minutes < 15)) {
			return { error: 'Invalid backup interval.' };
		}
		saveBackupSettings({
			intervalMinutes: minutes,
			nextRunAt: minutes ? dbTime(new Date(Date.now() + minutes * 60_000)) : null
		});
		return {
			ok: true,
			message: minutes ? `Scheduled backups on: every ${formatInterval(minutes)}.` : 'Scheduled backups off.'
		};
	},

	// Retention: backups older than this many days are deleted after each run.
	'save-keep': async ({ request, locals }) => {
		requireAdmin(locals);
		const form = await request.formData();
		const raw = String(form.get('keep') ?? '').trim();
		const days = raw === '' ? null : Number(raw);
		if (days != null && (!Number.isInteger(days) || days < 1)) {
			return { error: 'Invalid retention period.' };
		}
		saveBackupSettings({ keepDays: days });
		return {
			ok: true,
			message: days
				? `Backups older than ${days} days will be removed automatically.`
				: 'All backups will be kept.'
		};
	},

	'delete-backup': async ({ request, locals }) => {
		requireAdmin(locals);
		const form = await request.formData();
		const filename = String(form.get('filename') ?? '');
		const settings = getBackupSettings();
		if (!settings.destDir || !deleteBackup(settings.destDir, filename)) {
			return { error: 'That backup no longer exists.' };
		}
		return { ok: true, message: `Deleted ${filename}.` };
	}
};

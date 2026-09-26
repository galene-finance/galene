import pkg from '../../package.json';

/**
 * Build-time version information.
 *
 * The major.minor version comes from package.json — the single source of truth, bumped by
 * the release workflow (Actions → Docker release). The commit and build date
 * are injected at build time by vite.config.ts (VITE_GIT_COMMIT /
 * VITE_BUILD_DATE, set from the environment in CI and Docker, or read from
 * the local git checkout in dev).
 */
export const appVersion: string = pkg.version;

/** Full git SHA the build was made from ('' when unknown, e.g. a tarball). */
export const gitCommit: string = import.meta.env.VITE_GIT_COMMIT ?? '';

/** ISO timestamp of the build ('' when unknown). */
export const buildDate: string = import.meta.env.VITE_BUILD_DATE ?? '';

/** Where releases live; used for the check-for-updates link. */
export const repoUrl = 'https://github.com/galene-finance/galene';

/** Short (7-char) commit hash for display. */
export function shortCommit(): string {
	return gitCommit.slice(0, 7);
}

/** "0.1 (abc1234)" — the compact form shown in the UI (login footer). */
export function versionLabel(): string {
	return gitCommit ? `${appVersion} (${shortCommit()})` : appVersion;
}

/** "v0.3 (abc1234)" — Profile menu line. Omits the commit when it is unknown. */
export function formatProfileVersion(version: string, commit: string): string {
	const short = commit.slice(0, 7);
	return short ? `v${version} (${short})` : `v${version}`;
}

/** Profile / Account menu: leading v plus short commit when the build has one. */
export function profileVersionLabel(): string {
	return formatProfileVersion(appVersion, gitCommit);
}

/** The full payload served by GET /version and the galene_version MCP tool. */
export function versionInfo() {
	return {
		name: 'galene',
		version: appVersion,
		commit: gitCommit || null,
		built_at: buildDate || null
	};
}

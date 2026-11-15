/**
 * Re-encrypt stored secrets with the current GALENE_SECRET_KEY.
 *
 * Set GALENE_SECRET_KEY to the new key and GALENE_SECRET_KEY_PREVIOUS to the
 * old key. Rows already on the new key are left unchanged. Stop the app
 * before running this so nothing else is writing the database file.
 *
 * From a checkout: `bun run secrets:rotate`
 * From the app image: `bun rotate-secrets.js`
 */
import { db } from '../lib/server/db';
import { rotateStoredSecrets } from '../lib/server/secrets';

try {
	const result = rotateStoredSecrets(db());
	console.log(
		`Re-encrypted ${result.updated} stored secret(s). ${result.unchanged} already used the current key.`
	);
} catch (error) {
	const message = error instanceof Error ? error.message : 'Could not re-encrypt stored credentials.';
	console.error(message);
	process.exit(1);
}

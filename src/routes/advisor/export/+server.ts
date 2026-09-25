import { error } from '@sveltejs/kit';
import { audit } from '$lib/server/advisor';
import { buildPackZip } from '$lib/server/pack';

/** Viewer download of a pack built for the grant's current in-scope rows. */
export function GET({ locals }) {
	const viewer = locals.viewer;
	if (!locals.user || !viewer) error(403, 'Forbidden');
	const zip = buildPackZip(viewer.scope, new Date().toISOString());
	audit(locals.user.id, viewer.grantId, 'viewer_export');
	return new Response(new Uint8Array(zip), {
		headers: {
			'content-type': 'application/zip',
			'content-disposition': 'attachment; filename="galene-advisor-export.zip"',
			'cache-control': 'no-store'
		}
	});
}

import { error } from '@sveltejs/kit';
import { audit, getGrant } from '$lib/server/advisor';
import { loadPack } from '$lib/server/pack';

/** Owner download of the frozen zip. Viewers use /advisor/export instead. */
export function GET({ locals, params }) {
	if (!locals.user || locals.user.role === 'viewer') error(403, 'Forbidden');
	const id = parseInt(params.id ?? '', 10);
	const grant = getGrant(locals.user.id, id);
	if (!grant || grant.kind !== 'pack') error(404, 'Pack not found');
	const zip = loadPack(locals.user.id, id);
	if (!zip) error(404, 'Pack not found');
	audit(locals.user.id, id, 'pack_downloaded', 'owner');
	return new Response(new Uint8Array(zip), {
		headers: {
			'content-type': 'application/zip',
			'content-disposition': `attachment; filename="galene-pack-${grant.date_from}.zip"`,
			'cache-control': 'no-store'
		}
	});
}

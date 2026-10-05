import { handleWriteRequest } from '$lib/server/writeApi';

export function POST(event) {
	return handleWriteRequest(event, 'split');
}

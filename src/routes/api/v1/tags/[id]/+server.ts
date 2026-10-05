import { handleWriteRequest } from '$lib/server/writeApi';

export function PATCH(event) {
	return handleWriteRequest(event, 'tag');
}

export function DELETE(event) {
	return handleWriteRequest(event, 'tag');
}

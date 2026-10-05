import { handleWriteRequest } from '$lib/server/writeApi';

export function PATCH(event) {
	return handleWriteRequest(event, 'category');
}

export function DELETE(event) {
	return handleWriteRequest(event, 'category');
}

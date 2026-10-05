import { handleWriteRequest } from '$lib/server/writeApi';

export function PATCH(event) {
	return handleWriteRequest(event, 'transaction');
}

export function DELETE(event) {
	return handleWriteRequest(event, 'transaction');
}

import { handleCustomizationGet, handleCustomizationPut } from '$lib/server/customizationApi';

export function GET(event) {
	return handleCustomizationGet(event, 'appearance');
}

export function PUT(event) {
	return handleCustomizationPut(event, 'appearance');
}

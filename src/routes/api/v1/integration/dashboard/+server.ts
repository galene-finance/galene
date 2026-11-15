import { handleCustomizationGet, handleCustomizationPut } from '$lib/server/customizationApi';

export function GET(event) {
	return handleCustomizationGet(event, 'dashboard');
}

export function PUT(event) {
	return handleCustomizationPut(event, 'dashboard');
}

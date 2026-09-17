import type { User } from '$lib/types';

declare global {
	namespace App {
		type Error = { message: string };
		type PageData = {};
		type PageState = {};
		type Platform = Request;
		interface Locals {
			user: User | null;
		}
	}
}

export {};

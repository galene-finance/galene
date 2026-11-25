import type { GrantScope } from '$lib/server/advisor';
import type { User } from '$lib/types';

declare global {
	namespace App {
		type Error = { message: string };
		type PageData = {};
		type PageState = {};
		type Platform = Request;
		interface Locals {
            /** Server-only approved-source context. Never populated from request fields.
             * No production producer is configured until approved mappings/receipts exist. */
            financeEvidence?: {
                ownerId:number; timeZone:string;
                closingCatalog:import('$lib/server/baselineSetupFeature').BaselineCatalog;
                historyPolicies:readonly import('$lib/server/historyCaptureProvider').HistoryCapturePolicy[];
                historyReceipts:readonly import('$lib/server/historyCaptureProvider').HistoryExternalEvidence[];
            };
			user: User | null;
			/** Set for a magic-link advisor session. Mutations must 403. */
			viewer: { grantId: number; scope: GrantScope } | null;
			/** Set when the request authenticated with an API token. Writes require scope write. */
			apiToken: { id: number; scope: 'read' | 'write' } | null;
		}
	}
}

export {};

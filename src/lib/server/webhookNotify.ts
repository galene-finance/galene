/**
 * One delivery per data change. Finance mutations enqueue the event; the write
 * API waits for the same queue instead of sending a second time.
 */

export interface DataChangeEvent {
	event: string;
	resource: string;
	action: 'created' | 'updated' | 'deleted';
	id: number;
	name?: string | null;
	amount_cents?: number | null;
	date?: string | null;
	account_id?: number | null;
	category_id?: number | null;
	merchant?: string | null;
	notes?: string | null;
	type?: string | null;
}

type Deliver = (userId: number, event: DataChangeEvent) => Promise<void>;

let deliver: Deliver | null = null;
let tail: Promise<void> = Promise.resolve();

export function registerWebhookDeliver(fn: Deliver) {
	deliver = fn;
}

export function emitDataChange(userId: number, event: DataChangeEvent) {
	const run = async () => {
		try {
			if (!deliver) {
				const mod = await import('./writeApi');
				deliver = mod.dispatchWebhooks;
			}
			await deliver(userId, event);
		} catch {
			// A receiver failure does not roll back the write.
		}
	};
	tail = tail.then(run, run);
}

export function flushDataChanges(): Promise<void> {
	return tail;
}

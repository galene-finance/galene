import { describe, expect, test } from 'bun:test';
import { withPending } from './formPending';
import type { SubmitFunction } from '@sveltejs/kit';

describe('withPending', () => {
	test('sets pending around an async enhance callback', async () => {
		const flags: boolean[] = [];
		const setPending = (v: boolean) => flags.push(v);
		const inner: SubmitFunction = () => {
			return async () => {
				flags.push(true); // still pending inside
			};
		};
		const wrapped = withPending(setPending, inner);
		const after = wrapped({} as Parameters<SubmitFunction>[0]);
		expect(typeof after).toBe('function');
		expect(flags).toEqual([true]);
		await (after as (o: unknown) => Promise<void>)({});
		expect(flags).toEqual([true, true, false]);
	});

	test('does not set pending when inner returns void', () => {
		const flags: boolean[] = [];
		const wrapped = withPending((v) => flags.push(v), () => undefined);
		const after = wrapped({} as Parameters<SubmitFunction>[0]);
		expect(after).toBeUndefined();
		expect(flags).toEqual([]);
	});
});

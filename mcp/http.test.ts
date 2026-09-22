import { describe, expect, test } from 'bun:test';
import { bearerToken, handleMcpRequest } from './http.ts';

const TOKEN = 'galene_test_token';
const options = { base: 'http://app.test', version: '0.0.0-test' };

function request(path: string, init: RequestInit = {}) {
	return new Request(`http://mcp.test${path}`, init);
}

describe('bearer token', () => {
	test('rejects a missing or empty header', () => {
		expect(bearerToken(null)).toBeNull();
		expect(bearerToken('Bearer ')).toBeNull();
		expect(bearerToken('Token abc')).toBeNull();
	});

	test('returns the token', () => {
		expect(bearerToken(`Bearer ${TOKEN}`)).toBe(TOKEN);
	});
});

describe('HTTP auth', () => {
	test('missing token is 401 and does not call Galene', async () => {
		let called = 0;
		const fetchImpl: typeof fetch = async () => {
			called += 1;
			return new Response('[]', { status: 200 });
		};
		const res = await handleMcpRequest(request('/mcp', { method: 'POST' }), { ...options, fetchImpl });
		expect(res.status).toBe(401);
		expect(called).toBe(0);
		expect(await res.text()).not.toContain(TOKEN);
	});

	test('a rejected token is 401 and is not logged', async () => {
		const errors: string[] = [];
		const original = console.error;
		console.error = (...args: unknown[]) => {
			errors.push(args.map(String).join(' '));
		};
		try {
			const fetchImpl: typeof fetch = async () => new Response('no', { status: 401 });
			const res = await handleMcpRequest(
				request('/mcp', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` } }),
				{ ...options, fetchImpl }
			);
			expect(res.status).toBe(401);
			const body = await res.text();
			expect(body).not.toContain(TOKEN);
			expect(errors.join('\n')).not.toContain(TOKEN);
		} finally {
			console.error = original;
		}
	});

	test('an unreachable app is 502 and the error text is not logged', async () => {
		const errors: string[] = [];
		const original = console.error;
		console.error = (...args: unknown[]) => {
			errors.push(args.map(String).join(' '));
		};
		try {
			const fetchImpl: typeof fetch = async () => {
				throw new Error(`connect ${TOKEN}`);
			};
			const res = await handleMcpRequest(
				request('/mcp', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` } }),
				{ ...options, fetchImpl }
			);
			expect(res.status).toBe(502);
			expect(await res.text()).not.toContain(TOKEN);
			expect(errors.join('\n')).not.toContain(TOKEN);
		} finally {
			console.error = original;
		}
	});
});

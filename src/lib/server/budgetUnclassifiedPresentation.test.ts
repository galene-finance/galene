import { expect, test } from 'bun:test';
import { plugin } from 'bun';
import { readFileSync } from 'node:fs';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import { Database } from 'bun:sqlite';
import { migrate } from './db';
import { BudgetEngine } from './budgetEngine/service';

plugin({
	name: 'budget-unclassified-ui-ssr',
	setup(build) {
		build.onLoad(
			{ filter: /(FundingOverview|FundingAmount|FinancialBadge|CategoryPill)\.svelte$/ },
			({ path }) => ({
				contents: compile(readFileSync(path, 'utf8'), { filename: path, generate: 'server', css: 'injected' }).js.code,
				loader: 'js'
			})
		);
	}
});

test('Plan shows unresolved classification without exposing provisional funding claims', async () => {
	const database = new Database(':memory:');
	try {
		database.exec('PRAGMA foreign_keys=ON');
		migrate(database);
		database.exec(
			"INSERT INTO users(id,name,email,password_hash) VALUES(1,'Synthetic','owner@example.test','x');" +
				"INSERT INTO accounts(id,user_id,name,type) VALUES(1,1,'Cash','bank');" +
				"INSERT INTO categories(id,user_id,name,type) VALUES(1,1,'Food','expense')"
		);
		const engine = new BudgetEngine(database, 1);
		engine.activate(
			{
				currency: 'USD',
				asOfDate: '2026-10-31',
				accounts: [{ id: 1, currency: 'USD', scope: 'cash', balanceCents: 100_000 }],
				evidence: 'synthetic accepted baseline'
			},
			{ expectedRevision: 0, idempotencyKey: 'activate' }
		);
		database.exec(
			"INSERT INTO transactions(id,user_id,account_id,category_id,date,amount_cents,pending) VALUES(1,1,1,NULL,'2026-11-01',-1000,0)"
		);
		engine.refreshRegister('2026-11-30', [], {
			expectedRevision: engine.view('2026-11').revision,
			idempotencyKey: 'refresh'
		});
		const funding = engine.dashboard('2026-11', [], '2026-11-30');
		expect(funding.view).toMatchObject({
			coverageComplete: true,
			classificationComplete: false,
			unclassifiedCount: 1,
			ledger: null
		});
		expect(funding.view.balanceProjection?.cashCents).toBe(99_000);
		expect(funding.categoryStates[0]).toMatchObject({
			availableCents: null,
			assignedCents: null,
			activityCents: null
		});
		const { default: FundingOverview } = await import('../components/FundingOverview.svelte');
		const html = render(FundingOverview, {
			props: {
				funding,
				fundingDate: '2026-11-30',
				commandKey: 'synthetic',
				categories: [{ id: 1, name: 'Food', type: 'expense', parent_id: null, color: null }]
			}
		}).body;
		expect(html).toContain('Available cash unknown');
		expect(html).toContain('1 posted transaction still needs a category');
		expect(html).toContain('Signed account balances are updated');
		expect(html).toContain('date_from=2026-11-01');
		expect(html).not.toContain('allocation-form');
		expect(html).not.toContain('Assigned this month');
		expect(html).not.toContain('990.00');
	} finally {
		database.close();
	}
});

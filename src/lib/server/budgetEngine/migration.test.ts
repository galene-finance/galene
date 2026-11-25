import {test,expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {migrate} from '../db';
import {budgetEngineMigration} from './migration';
test('additive migration dry-run rolls back all new tables and preserves legacy fixtures',()=>{
 const d=new Database(':memory:');d.exec('PRAGMA foreign_keys=ON');
 d.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY);CREATE TABLE budgets(id INTEGER PRIMARY KEY,user_id INTEGER,category_id INTEGER,period TEXT,limit_cents INTEGER);INSERT INTO users VALUES(1);INSERT INTO budgets VALUES(11,1,4,'month',20000),(12,1,4,'year',240000);CREATE TABLE accounts(id INTEGER PRIMARY KEY,user_id INTEGER);CREATE TABLE categories(id INTEGER PRIMARY KEY,user_id INTEGER);CREATE TABLE transaction_splits(id INTEGER PRIMARY KEY,transaction_id INTEGER);CREATE TABLE transactions(id INTEGER PRIMARY KEY,user_id INTEGER,amount_cents INTEGER);INSERT INTO transactions VALUES(1,1,-500);`);
 const before=JSON.stringify(d.query('SELECT * FROM budgets').all());
 d.exec('BEGIN IMMEDIATE');d.exec(budgetEngineMigration);
 expect(d.query('SELECT count(*) AS n FROM budget_engine_legacy_targets').get()).toEqual({n:2});expect(d.query('SELECT count(*) AS n FROM budget_engine_events').get()).toEqual({n:0});d.exec('ROLLBACK');
 expect(d.query("SELECT name FROM sqlite_master WHERE name='budget_engine_state'").get()).toBeNull();expect(JSON.stringify(d.query('SELECT * FROM budgets').all())).toBe(before);
 d.exec('BEGIN IMMEDIATE');d.exec(budgetEngineMigration);d.exec('COMMIT');d.exec(budgetEngineMigration);
 expect(d.query('SELECT count(*) AS n FROM budget_engine_legacy_targets').get()).toEqual({n:2});expect(d.query('SELECT * FROM transactions').all()).toEqual([{id:1,user_id:1,amount_cents:-500}]);d.close();
});

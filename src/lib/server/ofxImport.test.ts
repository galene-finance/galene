/**
 * OFX / QFX parse (issue #105). No database.
 */
import { describe, expect, test } from 'bun:test';
import { looksLikeOfx, ofxExternalId, parseOfx, parseOfxDate } from './ofxImport';

const OFX = `OFXHEADER:100
DATA:OFXSGML
<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<CURDEF>USD
<BANKACCTFROM>
<BANKID>021000021
<ACCTID>123456789
</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260315
<TRNAMT>-12.50
<FITID>coffee-1
<NAME>Coffee shop
<MEMO>Morning coffee
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260316120000
<TRNAMT>2500.00
<FITID>pay-1
<NAME>Employer
<MEMO>Paycheck
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>not-a-date
<TRNAMT>0
<FITID>bad-1
<NAME>Broken
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
`;

const QFX = `OFXHEADER:100
DATA:OFXSGML
<OFX>
<CREDITCARDMSGSRSV1>
<CCSTMTTRNRS>
<CCSTMTRS>
<CURDEF>USD
<CCACCTFROM>
<ACCTID>4111111111111111
</CCACCTFROM>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260102
<TRNAMT>-40.00
<FITID>card-9
<NAME>Grocery
</STMTTRN>
</BANKTRANLIST>
</CCSTMTRS>
</CCSTMTTRNRS>
</CREDITCARDMSGSRSV1>
</OFX>
`;

describe('parseOfx', () => {
	test('signed amounts, dates, payee, and FITID from SGML OFX', () => {
		const result = parseOfx(OFX);
		expect(result.error).toBeNull();
		expect(result.transactions).toHaveLength(3);

		const coffee = result.transactions[0];
		expect(coffee.date).toBe('2026-03-15');
		expect(coffee.amountCents).toBe(-1250);
		expect(coffee.merchant).toBe('Coffee shop');
		expect(coffee.notes).toBe('Morning coffee');
		expect(coffee.accountName).toBe('021000021 123456789');
		expect(ofxExternalId(coffee)).toBe('021000021 123456789\u001fcoffee-1');

		const pay = result.transactions[1];
		expect(pay.date).toBe('2026-03-16');
		expect(pay.amountCents).toBe(250000);
		expect(pay.merchant).toBe('Employer');

		const bad = result.transactions[2];
		expect(bad.date).toBeNull();
		expect(bad.amountCents).toBe(0);
	});

	test('QFX credit-card statement uses ACCTID as the account name', () => {
		const result = parseOfx(QFX);
		expect(result.error).toBeNull();
		expect(result.transactions).toHaveLength(1);
		expect(result.transactions[0].accountName).toBe('4111111111111111');
		expect(result.transactions[0].amountCents).toBe(-4000);
		expect(looksLikeOfx(QFX, 'card.qfx')).toBe(true);
	});

	test('XML OFX closes tags and still reads STMTTRN', () => {
		const xml = `<?xml version="1.0"?>
<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKACCTFROM><BANKID>111</BANKID><ACCTID>222</ACCTID></BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT</TRNTYPE>
<DTPOSTED>20260201</DTPOSTED>
<TRNAMT>-1.25</TRNAMT>
<FITID>xml-1</FITID>
<NAME>Cafe &amp; Co</NAME>
</STMTTRN>
</BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;
		const result = parseOfx(xml);
		expect(result.error).toBeNull();
		expect(result.transactions[0].merchant).toBe('Cafe & Co');
		expect(result.transactions[0].amountCents).toBe(-125);
		expect(result.transactions[0].accountName).toBe('111 222');
	});

	test('unparseable and investment files return a calm file error', () => {
		expect(parseOfx('hello, this is a letter').error).toBe('This file is not an OFX or QFX statement.');
		expect(parseOfx('<OFX><INVSTMTRS><INVPOS></INVPOS></INVSTMTRS></OFX>').error).toMatch(/investment/i);
		expect(parseOfx('<OFX><STMTRS></STMTRS></OFX>').error).toMatch(/No bank/);
	});

	test('parseOfxDate rejects impossible calendar days', () => {
		expect(parseOfxDate('20260230')).toBeNull();
		expect(parseOfxDate('20260228')).toBe('2026-02-28');
	});

	test('CSV text is not treated as OFX', () => {
		expect(looksLikeOfx('date,account,amount\n2026-01-01,Checking,-1\n', 'money.csv')).toBe(false);
		expect(looksLikeOfx('date,account,amount\n', 'export.ofx')).toBe(true);
	});
});

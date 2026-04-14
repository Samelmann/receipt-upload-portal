const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildEPCString } = require('../utils/qrGenerator');

test('buildEPCString matches the EPC/GiroCode v2 spec layout', () => {
  const result = buildEPCString({
    iban: 'DE89 3704 0044 0532 0130 00',
    name: 'Max Mustermann',
    amount: 42.5,
    remittance: 'Erstattung Gas - Paderborn 1 - Mo',
  });
  const lines = result.split('\n');
  assert.equal(lines[0], 'BCD');
  assert.equal(lines[1], '002');
  assert.equal(lines[2], '1');
  assert.equal(lines[3], 'SCT');
  assert.equal(lines[4], '');                                // BIC (blank)
  assert.equal(lines[5], 'Max Mustermann');
  assert.equal(lines[6], 'DE89370400440532013000');          // IBAN without spaces
  assert.equal(lines[7], 'EUR42.50');                        // amount always 2 decimals
  assert.equal(lines[10], 'Erstattung Gas - Paderborn 1 - Mo');
});

test('buildEPCString formats whole-euro amounts with .00', () => {
  const result = buildEPCString({ iban: 'DE1', name: 'X', amount: 100, remittance: 'r' });
  assert.ok(result.includes('EUR100.00'));
});

test('buildEPCString truncates name at 70 chars', () => {
  const long = 'A'.repeat(100);
  const result = buildEPCString({ iban: 'DE1', name: long, amount: 1, remittance: 'r' });
  assert.equal(result.split('\n')[5].length, 70);
});

test('buildEPCString truncates remittance at 140 chars', () => {
  const long = 'B'.repeat(200);
  const result = buildEPCString({ iban: 'DE1', name: 'X', amount: 1, remittance: long });
  assert.equal(result.split('\n')[10].length, 140);
});

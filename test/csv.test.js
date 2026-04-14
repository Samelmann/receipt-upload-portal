const { test } = require('node:test');
const assert = require('node:assert/strict');
const { escape, COLUMNS } = require('../utils/csv');

test('escape passes simple strings through', () => {
  assert.equal(escape('hello'), 'hello');
  assert.equal(escape(42), '42');
});

test('escape handles null/undefined as empty', () => {
  assert.equal(escape(null), '');
  assert.equal(escape(undefined), '');
});

test('escape quotes values with commas', () => {
  assert.equal(escape('a,b'), '"a,b"');
});

test('escape doubles embedded quotes and wraps', () => {
  assert.equal(escape('say "hi"'), '"say ""hi"""');
});

test('escape quotes values with newlines', () => {
  assert.equal(escape('line1\nline2'), '"line1\nline2"');
});

test('COLUMNS matches the Expenses sheet column order', () => {
  // If someone changes the sheet structure, update both COLUMNS and this test.
  assert.deepEqual(COLUMNS, [
    'Date', 'Description', 'Category', 'Paid By', 'Sub-category',
    'Opponent', 'Match', 'Price', 'Receipt', 'QR Code',
    'Refunded to Sammy', 'Note', 'Submitted to club', 'Needs reimbursement',
  ]);
});

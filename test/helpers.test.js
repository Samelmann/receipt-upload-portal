const { test } = require('node:test');
const assert = require('node:assert/strict');
const { toSafeFilePart, toGermanDate, buildDescription } = require('../utils/helpers');

test('toSafeFilePart strips diacritics and non-alphanumerics', () => {
  assert.equal(toSafeFilePart('Jödicke'), 'Jodicke');
  assert.equal(toSafeFilePart('Paderborn Untouchables!'), 'PaderbornUntouchables');
  assert.equal(toSafeFilePart('a-b_c.d'), 'abcd');
});

test('toSafeFilePart caps length at 30', () => {
  const long = 'a'.repeat(50);
  assert.equal(toSafeFilePart(long).length, 30);
});

test('toGermanDate converts YYYY-MM-DD to DD.MM.YYYY', () => {
  assert.equal(toGermanDate('2025-06-14'), '14.06.2025');
  assert.equal(toGermanDate('2026-01-02'), '02.01.2026');
});

test('buildDescription — Gas includes carUsed, nickname, and opponent', () => {
  assert.equal(
    buildDescription({ category: 'Gas', nickname: 'Mo', carUsed: 'rental-flo', opponent: 'Paderborn', matchNum: '1' }),
    'Gas - rental-flo - Mo - Paderborn 1'
  );
});

test('buildDescription — Accommodation uses hotel name', () => {
  assert.equal(
    buildDescription({ category: 'Accommodation', nickname: 'Paul', hotelName: 'Hotel Altona' }),
    'Hotel Altona - Paul'
  );
});

test('buildDescription — Car Rental uses company', () => {
  assert.equal(
    buildDescription({ category: 'Car Rental', nickname: 'Flo', rentalCompany: 'Sixt' }),
    'Sixt - Flo'
  );
});

test('buildDescription — Umpire ignores nickname, uses opponent and match', () => {
  assert.equal(
    buildDescription({ category: 'Umpire', nickname: 'Chris', opponent: 'Bonn', matchNum: '2' }),
    'Umpire - Bonn 2'
  );
});

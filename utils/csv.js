const fs = require('fs');
const path = require('path');

const CSV_PATH = path.join(__dirname, '..', 'data', 'submissions.csv');

const COLUMNS = [
  'Date',
  'Description',
  'Category',
  'Paid By',
  'Sub-category',
  'Opponent',
  'Match',
  'Price',
  'Receipt',
  'QR Code',
  'Refunded to Sammy',
  'Note',
  'Submitted to club',
  'Needs reimbursement',
];

function escape(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function appendRow(row) {
  const dir = path.dirname(CSV_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (!fs.existsSync(CSV_PATH)) {
    fs.writeFileSync(CSV_PATH, COLUMNS.map(escape).join(',') + '\n', 'utf8');
  }

  const line = COLUMNS.map(col => escape(row[col] ?? '')).join(',') + '\n';
  fs.appendFileSync(CSV_PATH, line, 'utf8');
}

module.exports = { appendRow, escape, COLUMNS };

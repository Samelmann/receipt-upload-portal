// Finds rows in data/submissions.csv that aren't in the online Expenses sheet
// and appends them. Idempotent — safe to re-run.
// Run: npm run replay-sheet
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { appendExpenseRow, hyperlink, COLUMNS } = require('../utils/google');

const CSV_PATH = path.join(__dirname, '..', 'data', 'submissions.csv');
const SHEET_ID  = process.env.SHEET_ID;
const SHEET_TAB = process.env.SHEET_TAB || 'Expenses';

// ── Minimal CSV parser (handles quoted fields + doubled quotes) ──────────────
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else { field += c; }
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1 || (r.length === 1 && r[0]));
}

function normPrice(v)   { return String(v ?? '').replace(',', '.').replace(/[^\d.]/g, '').replace(/^(\d+\.\d).*$/, '$1').replace(/^(\d+)$/, '$1.00'); }
function norm(v)        { return String(v ?? '').trim().toLowerCase(); }
function signature(row) { return [norm(row['Date']), normPrice(row['Price']), norm(row['Paid By']), norm(row['Description'])].join('|'); }

(async () => {
  if (!fs.existsSync(CSV_PATH)) { console.log('No local CSV — nothing to replay.'); return; }

  // Read sheet rows (formulas, so HYPERLINK text stays intact for us but we'll key on other columns)
  const clientCfg = require('../config/google-oauth-client.json').web;
  const tokens    = require('../config/google-oauth-token.json');
  const oauth2    = new google.auth.OAuth2(clientCfg.client_id, clientCfg.client_secret, clientCfg.redirect_uris[0]);
  oauth2.setCredentials(tokens);
  const sheets = google.sheets({ version: 'v4', auth: oauth2 });

  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_TAB}!A2:N`,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });
  const existingSigs = new Set();
  for (const r of existing.data.values || []) {
    const obj = Object.fromEntries(COLUMNS.map((c, i) => [c, r[i] ?? '']));
    existingSigs.add(signature(obj));
  }

  // Read CSV
  const csvText = fs.readFileSync(CSV_PATH, 'utf8');
  const parsed  = parseCSV(csvText);
  const [header, ...dataRows] = parsed;
  const csvRows = dataRows.map(r => Object.fromEntries(header.map((c, i) => [c, r[i] ?? ''])));

  // Diff
  const missing = csvRows.filter(r => !existingSigs.has(signature(r)));
  console.log(`CSV rows: ${csvRows.length}   sheet rows: ${existingSigs.size}   missing: ${missing.length}`);

  for (const r of missing) {
    // Re-wrap Drive URLs as HYPERLINK for the sheet; keep plain text for filename-only cells
    const receipt = /^https?:\/\//.test(r['Receipt']) ? hyperlink(r['Receipt'], r['Receipt'].split('/').pop()) : r['Receipt'];
    const qr      = /^https?:\/\//.test(r['QR Code']) ? hyperlink(r['QR Code'], r['QR Code'].split('/').pop()) : r['QR Code'];
    try {
      await appendExpenseRow({ ...r, Receipt: receipt, 'QR Code': qr });
      console.log(`  + ${signature(r)}`);
    } catch (err) {
      console.error(`  ✗ ${signature(r)} — ${err.message}`);
    }
  }
  console.log('Done.');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });

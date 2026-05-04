// Finds local CSV rows where Receipt / QR Code are plain filenames (not Drive URLs),
// uploads the files to Google Drive, then updates both the local CSV and the Sheet
// row in-place with the Drive links.
// Idempotent — safe to re-run; already-uploaded rows are left untouched.
// Run: npm run backfill-drive
require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { uploadReceipt, uploadQRCode, hyperlink, COLUMNS } = require('../utils/google');

const CSV_PATH      = path.join(__dirname, '..', 'data', 'submissions.csv');
const RECEIPTS_DIR  = path.join(__dirname, '..', 'data', 'receipts');
const QR_DIR        = path.join(__dirname, '..', 'data', 'qr-codes');
const SHEET_ID      = process.env.SHEET_ID;
const SHEET_TAB     = process.env.SHEET_TAB || 'Expenses';

// ── CSV parser (handles quoted fields + doubled quotes) ───────────────────────
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

function escapeCSVField(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function serializeCSV(header, rows) {
  return [header, ...rows].map(r => r.map(escapeCSVField).join(',')).join('\n') + '\n';
}

// ── Sheet helpers ─────────────────────────────────────────────────────────────
function norm(v)       { return String(v ?? '').trim().toLowerCase(); }
function normPrice(v)  { return String(v ?? '').replace(',', '.').replace(/[^\d.]/g, '').replace(/^(\d+\.\d).*$/, '$1').replace(/^(\d+)$/, '$1.00'); }
function signature(row) {
  return [norm(row['Date']), normPrice(row['Price']), norm(row['Paid By']), norm(row['Description'])].join('|');
}

(async () => {
  if (!fs.existsSync(CSV_PATH)) { console.log('No local CSV — nothing to backfill.'); return; }

  // ── Read sheet rows (row number → signature) ───────────────────────────────
  const clientCfg = require('../config/google-oauth-client.json').web || require('../config/google-oauth-client.json').installed;
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
  // Map signature → 1-based sheet row number (data starts at row 2)
  const sheetRowBySig = new Map();
  for (const [i, r] of (existing.data.values || []).entries()) {
    const obj = Object.fromEntries(COLUMNS.map((c, j) => [c, r[j] ?? '']));
    sheetRowBySig.set(signature(obj), i + 2); // +2: 1 for header, 1 for 0-index
  }

  // ── Read CSV ───────────────────────────────────────────────────────────────
  const csvText = fs.readFileSync(CSV_PATH, 'utf8');
  const parsed  = parseCSV(csvText);
  const [header, ...dataRows] = parsed;
  const receiptIdx = header.indexOf('Receipt');
  const qrIdx      = header.indexOf('QR Code');

  let changed = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const receiptVal = row[receiptIdx] || '';
    const qrVal      = row[qrIdx]      || '';

    const receiptNeedsUpload = receiptVal && !/^https?:\/\//.test(receiptVal);
    const qrNeedsUpload      = qrVal      && !/^https?:\/\//.test(qrVal);

    if (!receiptNeedsUpload && !qrNeedsUpload) continue;

    const rowObj = Object.fromEntries(header.map((c, j) => [c, row[j] ?? '']));
    console.log(`\nProcessing: ${receiptVal || qrVal}`);

    let receiptLink = receiptVal;
    let qrLink      = qrVal;

    // ── Upload receipt PDF ──────────────────────────────────────────────────
    if (receiptNeedsUpload) {
      const filePath = path.join(RECEIPTS_DIR, receiptVal);
      if (!fs.existsSync(filePath)) {
        console.error(`  ✗ Receipt file not found on disk: ${filePath}`);
      } else {
        // Parse opponent + matchNum from filename: YYYY-MM-DD_Nick_Opponent-Match_Cat_Amount.pdf
        const parts   = receiptVal.replace(/\.pdf$/i, '').split('_');
        // opponent is parts[2], which is "OpponentName-Match"
        const oppMatch  = parts[2] || '';
        const dashIdx   = oppMatch.lastIndexOf('-');
        const opponent  = dashIdx !== -1 ? oppMatch.slice(0, dashIdx) : oppMatch;
        const matchNum  = dashIdx !== -1 ? oppMatch.slice(dashIdx + 1) : '1';

        try {
          const uploaded = await uploadReceipt({
            buffer: fs.readFileSync(filePath),
            filename: receiptVal,
            opponent,
            matchNum,
          });
          receiptLink = uploaded.webViewLink;
          console.log(`  ✓ Receipt uploaded: ${receiptLink}`);
        } catch (err) {
          console.error(`  ✗ Receipt upload failed: ${err.message}`);
        }
      }
    }

    // ── Upload QR PNG ───────────────────────────────────────────────────────
    if (qrNeedsUpload) {
      const filePath = path.join(QR_DIR, qrVal);
      if (!fs.existsSync(filePath)) {
        console.error(`  ✗ QR file not found on disk: ${filePath}`);
      } else {
        try {
          const uploaded = await uploadQRCode({
            buffer: fs.readFileSync(filePath),
            filename: qrVal,
          });
          qrLink = uploaded.webViewLink;
          console.log(`  ✓ QR uploaded: ${qrLink}`);
        } catch (err) {
          console.error(`  ✗ QR upload failed: ${err.message}`);
        }
      }
    }

    // If neither link changed, nothing to update
    if (receiptLink === receiptVal && qrLink === qrVal) continue;

    // ── Update CSV row in memory ────────────────────────────────────────────
    row[receiptIdx] = receiptLink;
    row[qrIdx]      = qrLink;
    changed++;

    // ── Update Sheet row ────────────────────────────────────────────────────
    const sig      = signature(rowObj);
    const sheetRow = sheetRowBySig.get(sig);
    if (!sheetRow) {
      console.log(`  ! Row not found in sheet (run npm run replay-sheet after this to add it)`);
    } else {
      const receiptCell = /^https?:\/\//.test(receiptLink) ? hyperlink(receiptLink, receiptVal) : receiptLink;
      const qrCell      = /^https?:\/\//.test(qrLink)      ? hyperlink(qrLink, qrVal)           : qrLink;
      try {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: `${SHEET_TAB}!I${sheetRow}:J${sheetRow}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [[receiptCell, qrCell]] },
        });
        console.log(`  ✓ Sheet row ${sheetRow} updated`);
      } catch (err) {
        console.error(`  ✗ Sheet update failed: ${err.message}`);
      }
    }
  }

  // ── Write updated CSV ──────────────────────────────────────────────────────
  if (changed > 0) {
    fs.writeFileSync(CSV_PATH, serializeCSV(header, dataRows));
    console.log(`\nUpdated ${changed} row(s) in submissions.csv`);
  } else {
    console.log('\nNothing to backfill — all rows already have Drive links.');
  }
  console.log('Done.');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });

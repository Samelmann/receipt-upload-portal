// Generates QR codes for CSV rows that have Needs reimbursement = YES but no QR Code,
// provided the player has an IBAN in config/ibans.json. Uploads to Drive and updates
// both submissions.csv and the Sheet row in-place.
// Idempotent — safe to re-run; rows already with a QR link are skipped.
// Run: npm run backfill-qr
require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { generateQRBuffer } = require('../utils/qrGenerator');
const { uploadQRCode, hyperlink, COLUMNS } = require('../utils/google');
const { toSafeFilePart } = require('../utils/helpers');

const CSV_PATH   = path.join(__dirname, '..', 'data', 'submissions.csv');
const QR_DIR     = path.join(__dirname, '..', 'data', 'qr-codes');
const IBANS_PATH = path.join(__dirname, '..', 'config', 'ibans.json');
const SHEET_ID   = process.env.SHEET_ID;
const SHEET_TAB  = process.env.SHEET_TAB || 'Expenses';

// ── CSV helpers ───────────────────────────────────────────────────────────────
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
function norm(v)      { return String(v ?? '').trim().toLowerCase(); }
function normPrice(v) { return String(v ?? '').replace(',', '.').replace(/[^\d.]/g, '').replace(/^(\d+\.\d).*$/, '$1').replace(/^(\d+)$/, '$1.00'); }
function signature(row) {
  return [norm(row['Date']), normPrice(row['Price']), norm(row['Paid By']), norm(row['Description'])].join('|');
}

// DD.MM.YYYY → YYYY-MM-DD
function toISO(germanDate) {
  const [d, m, y] = germanDate.split('.');
  return `${y}-${m}-${d}`;
}

(async () => {
  if (!fs.existsSync(CSV_PATH)) { console.log('No local CSV — nothing to backfill.'); return; }

  const ibans = JSON.parse(fs.readFileSync(IBANS_PATH, 'utf8'));

  // ── Auth + Sheet ──────────────────────────────────────────────────────────
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
  const sheetRowBySig = new Map();
  for (const [i, r] of (existing.data.values || []).entries()) {
    const obj = Object.fromEntries(COLUMNS.map((c, j) => [c, r[j] ?? '']));
    sheetRowBySig.set(signature(obj), i + 2);
  }

  // ── Read CSV ──────────────────────────────────────────────────────────────
  const csvText = fs.readFileSync(CSV_PATH, 'utf8');
  const parsed  = parseCSV(csvText);
  const [header, ...dataRows] = parsed;
  const idx = col => header.indexOf(col);

  let changed = 0;
  fs.mkdirSync(QR_DIR, { recursive: true });

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const get = col => row[idx(col)] || '';

    // Skip rows that already have a QR Code or don't need reimbursement
    if (get('QR Code'))                        continue;
    if (get('Needs reimbursement') !== 'YES')  continue;

    const nickname = get('Paid By');
    const player   = ibans[nickname];
    if (!player?.iban) {
      console.log(`Skipping ${nickname} (${get('Date')}) — no IBAN on file`);
      continue;
    }

    const opponent  = get('Opponent');
    const matchNum  = get('Match');
    const amount    = parseFloat(get('Price'));
    const category  = get('Sub-category') || get('Category');
    const germanDate = get('Date');
    const isoDate   = toISO(germanDate);
    const amountSafe = amount.toFixed(2).replace('.', '-');
    const nickSafe   = toSafeFilePart(nickname);
    const oppSafe    = toSafeFilePart(opponent);
    const qrFilename = `${isoDate}_${nickSafe}_${amountSafe}EUR_${oppSafe}-${matchNum}.png`;

    console.log(`\nGenerating QR: ${qrFilename}`);

    // ── Generate QR buffer ──────────────────────────────────────────────────
    const remittance = `Erstattung ${category} - ${opponent} ${matchNum} - ${nickname}`;
    let qrBuffer;
    try {
      qrBuffer = await generateQRBuffer({
        iban: player.iban,
        name: player.fullName,
        amount,
        remittance,
      });
    } catch (err) {
      console.error(`  ✗ QR generation failed: ${err.message}`);
      continue;
    }

    // ── Save to disk ────────────────────────────────────────────────────────
    fs.writeFileSync(path.join(QR_DIR, qrFilename), qrBuffer);
    console.log(`  ✓ Saved to disk`);

    // ── Upload to Drive ─────────────────────────────────────────────────────
    let qrLink = '';
    try {
      const uploaded = await uploadQRCode({ buffer: qrBuffer, filename: qrFilename });
      qrLink = uploaded.webViewLink;
      console.log(`  ✓ Uploaded: ${qrLink}`);
    } catch (err) {
      console.error(`  ✗ Drive upload failed: ${err.message}`);
      // Store filename on disk at least; link stays empty
      row[idx('QR Code')] = qrFilename;
      changed++;
      continue;
    }

    // ── Update CSV row ──────────────────────────────────────────────────────
    row[idx('QR Code')] = qrLink;
    changed++;

    // ── Update Sheet row ────────────────────────────────────────────────────
    const rowObj   = Object.fromEntries(header.map((c, j) => [c, row[j] ?? '']));
    const sig      = signature(rowObj);
    const sheetRow = sheetRowBySig.get(sig);
    if (!sheetRow) {
      console.log(`  ! Row not in sheet — run npm run replay-sheet after this`);
    } else {
      try {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: `${SHEET_TAB}!J${sheetRow}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [[hyperlink(qrLink, qrFilename)]] },
        });
        console.log(`  ✓ Sheet row ${sheetRow} updated`);
      } catch (err) {
        console.error(`  ✗ Sheet update failed: ${err.message}`);
      }
    }
  }

  if (changed > 0) {
    fs.writeFileSync(CSV_PATH, serializeCSV(header, dataRows));
    console.log(`\nUpdated ${changed} row(s) in submissions.csv`);
  } else {
    console.log('\nNothing to backfill — all eligible rows already have QR codes.');
  }
  console.log('Done.');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });

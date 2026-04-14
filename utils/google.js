const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');
const { google } = require('googleapis');

const CONFIG_DIR         = path.join(__dirname, '..', 'config');
const OAUTH_CLIENT_PATH  = path.join(CONFIG_DIR, 'google-oauth-client.json');
const OAUTH_TOKEN_PATH   = path.join(CONFIG_DIR, 'google-oauth-token.json');

const AUSGABEN_FOLDER_ID = process.env.DRIVE_AUSGABEN_FOLDER_ID;
const SHEET_ID           = process.env.SHEET_ID;
const SHEET_TAB          = process.env.SHEET_TAB || 'Expenses';

const COLUMNS = [
  'Date', 'Description', 'Category', 'Paid By', 'Sub-category',
  'Opponent', 'Match', 'Price', 'Receipt', 'QR Code',
  'Refunded to Sammy', 'Note', 'Submitted to club', 'Needs reimbursement',
];

// OAuth acts as the real user — files owned by them, quota available.
// Run `node scripts/oauth-setup.js` once to produce google-oauth-token.json.
function makeAuth() {
  const clientCfg = (require(OAUTH_CLIENT_PATH).web) || (require(OAUTH_CLIENT_PATH).installed);
  const tokens    = require(OAUTH_TOKEN_PATH);
  const oauth2    = new google.auth.OAuth2(clientCfg.client_id, clientCfg.client_secret, clientCfg.redirect_uris[0]);
  oauth2.setCredentials(tokens);
  return oauth2;
}

const auth = makeAuth();
const drive  = google.drive({ version: 'v3', auth });
const sheets = google.sheets({ version: 'v4', auth });

// ── Drive helpers ─────────────────────────────────────────────────────────────

async function findChildFolder(parentId, name) {
  const escaped = name.replace(/'/g, "\\'");
  const res = await drive.files.list({
    q: `'${parentId}' in parents and name = '${escaped}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)',
  });
  return res.data.files[0] || null;
}

async function createFolder(parentId, name) {
  const res = await drive.files.create({
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    fields: 'id, name',
  });
  return res.data;
}

async function findOrCreateFolder(parentId, name) {
  return (await findChildFolder(parentId, name)) || (await createFolder(parentId, name));
}

/** Uploads a buffer to Drive. Returns { id, webViewLink }. */
async function uploadFile({ buffer, filename, mimeType, parentId }) {
  const res = await drive.files.create({
    requestBody: { name: filename, parents: [parentId] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id, webViewLink',
  });
  return res.data;
}

/**
 * Uploads a receipt PDF into Ausgaben/Receipts/<Opponent><Match>/.
 * Returns { id, webViewLink, folderName }.
 */
async function uploadReceipt({ buffer, filename, opponent, matchNum }) {
  const receiptsFolder = await findOrCreateFolder(AUSGABEN_FOLDER_ID, 'Receipts');
  const subFolderName  = `${opponent}${matchNum}`;
  const subFolder      = await findOrCreateFolder(receiptsFolder.id, subFolderName);
  const file = await uploadFile({ buffer, filename, mimeType: 'application/pdf', parentId: subFolder.id });
  return { ...file, folderName: subFolderName };
}

/** Uploads a QR code PNG into Ausgaben/qr-codes/. */
async function uploadQRCode({ buffer, filename }) {
  const qrFolder = await findOrCreateFolder(AUSGABEN_FOLDER_ID, 'qr-codes');
  return uploadFile({ buffer, filename, mimeType: 'image/png', parentId: qrFolder.id });
}

// ── Sheets helpers ────────────────────────────────────────────────────────────

/** Ensures row 1 has a header for column N ("Needs reimbursement"). Idempotent. */
async function ensureReimbursementHeader() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_TAB}!N1`,
  });
  const current = res.data.values?.[0]?.[0];
  if (!current) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_TAB}!N1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [['Needs reimbursement']] },
    });
  }
}

function hyperlink(url, label) {
  if (!url) return '';
  const safe = String(label).replace(/"/g, '""');
  return `=HYPERLINK("${url}","${safe}")`;
}

async function withRetry(fn, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (err) {
      lastErr = err;
      const code = err.code || err.response?.status;
      const retryable = code === 429 || (code >= 500 && code < 600) || /unavailable|ETIMEDOUT|ECONNRESET/i.test(err.message);
      if (!retryable || i === attempts - 1) throw err;
      await new Promise(r => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw lastErr;
}

/**
 * Appends a row to the Expenses sheet. Uses column B (Description — always filled
 * for real data rows) to compute the next empty row, then writes with values.update.
 * This avoids values.append's buggy "logical table" detection when columns have
 * uneven data (e.g. column N populated only for new rows).
 */
async function appendExpenseRow(row) {
  await withRetry(() => ensureReimbursementHeader());
  const existing = await withRetry(() => sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_TAB}!B:B`,
  }));
  const nextRow = (existing.data.values?.length || 0) + 1;
  const values = [COLUMNS.map(col => row[col] ?? '')];
  await withRetry(() => sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_TAB}!A${nextRow}:N${nextRow}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  }));
}

// ── Kontodaten sync ───────────────────────────────────────────────────────────

const IBANS_PATH = path.join(CONFIG_DIR, 'ibans.json');

/** Pulls Kontodaten sheet → writes config/ibans.json. Returns {count, diff}. */
async function syncIbansFromKontodaten() {
  const id = process.env.KONTODATEN_SHEET_ID;
  if (!id) throw new Error('KONTODATEN_SHEET_ID not set in .env');

  const meta = await sheets.spreadsheets.get({ spreadsheetId: id });
  const tab  = meta.data.sheets[0].properties.title;
  const res  = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `${tab}!A2:C` });

  const fresh = {};
  for (const [fullName, nickname, iban] of res.data.values || []) {
    if (!nickname) continue;
    fresh[nickname.trim()] = {
      fullName: (fullName || '').trim(),
      iban: (iban || '').replace(/\s/g, ''),
    };
  }

  let previous = {};
  if (fs.existsSync(IBANS_PATH)) {
    try { previous = JSON.parse(fs.readFileSync(IBANS_PATH, 'utf8')); } catch {}
  }
  const diff = {
    added:   Object.keys(fresh).filter(k => !previous[k]),
    removed: Object.keys(previous).filter(k => !fresh[k]),
    changed: Object.keys(fresh).filter(k => previous[k] && JSON.stringify(previous[k]) !== JSON.stringify(fresh[k])),
  };

  fs.writeFileSync(IBANS_PATH, JSON.stringify(fresh, null, 2));
  return { count: Object.keys(fresh).length, diff };
}

module.exports = {
  uploadReceipt,
  uploadQRCode,
  appendExpenseRow,
  hyperlink,
  syncIbansFromKontodaten,
  COLUMNS,
};

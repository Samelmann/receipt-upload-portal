const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { generateQRCode, generateQRBuffer } = require('../utils/qrGenerator');
const { appendRow } = require('../utils/csv');
const { toSafeFilePart, toGermanDate, buildDescription } = require('../utils/helpers');
const googleEnabled = !!(process.env.DRIVE_AUSGABEN_FOLDER_ID && process.env.SHEET_ID);
const googleApi = googleEnabled ? require('../utils/google') : null;

// ── IBAN lookup ────────────────────────────────────────────────────────────────

const IBANS_PATH = path.join(__dirname, '..', 'config', 'ibans.json');

function getIBANs() {
  try {
    return JSON.parse(fs.readFileSync(IBANS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

// ── Multer (PDF only, 20 MB max) ───────────────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are accepted. Make sure your image was converted.'));
    }
  },
});

// ── Route ──────────────────────────────────────────────────────────────────────

const handler = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No receipt file received.' });
    }

    const {
      nickname,
      date,
      category,
      carUsed = '',
      hotelName = '',
      rentalCompany = '',
      opponent,
      matchup,
      amount,
      needsReimbursement,
      fullName = '',
      iban: formIban = '',
    } = req.body;

    // Basic server-side validation
    if (!nickname || !date || !category || !opponent || !matchup || !amount) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    const matchNum = matchup === 'first' ? '1' : '2';
    const wantsReimbursement = needsReimbursement === 'true';

    // ── Sync IBANs from Kontodaten before lookup (best-effort) ──────────────
    if (googleEnabled && process.env.KONTODATEN_SHEET_ID) {
      try { await googleApi.syncIbansFromKontodaten(); }
      catch (err) { console.warn('IBAN sync skipped:', err.message); }
    }

    // ── Resolve IBAN ────────────────────────────────────────────────────────
    const ibans = getIBANs();
    const knownPlayer = ibans[nickname];
    const playerIban = (knownPlayer?.iban || formIban).replace(/\s/g, '');
    const playerFullName = knownPlayer?.fullName || fullName || nickname;

    // If a new IBAN was submitted, log it separately for Sammy to review
    if (formIban && !knownPlayer?.iban) {
      const newPath = path.join(__dirname, '..', 'data', 'new-ibans.json');
      let existing = [];
      if (fs.existsSync(newPath)) {
        existing = JSON.parse(fs.readFileSync(newPath, 'utf8'));
      }
      existing.push({
        nickname,
        fullName,
        iban: formIban.replace(/\s/g, ''),
        submittedAt: new Date().toISOString(),
      });
      fs.writeFileSync(newPath, JSON.stringify(existing, null, 2));
    }

    // ── Build filenames ─────────────────────────────────────────────────────
    const dateSafe    = date;                             // YYYY-MM-DD
    const nickSafe    = toSafeFilePart(nickname);
    const oppSafe     = toSafeFilePart(opponent);
    const catSafe     = toSafeFilePart(category);
    const amountSafe  = parseFloat(amount).toFixed(2).replace('.', '-');

    const pdfFilename = `${dateSafe}_${nickSafe}_${oppSafe}-${matchNum}_${catSafe}_${amountSafe}EUR.pdf`;
    const qrFilename  = `${dateSafe}_${nickSafe}_${amountSafe}EUR_${oppSafe}-${matchNum}.png`;

    // ── Save PDF locally (backup) ───────────────────────────────────────────
    const receiptDir = path.join(__dirname, '..', 'data', 'receipts');
    fs.mkdirSync(receiptDir, { recursive: true });
    fs.writeFileSync(path.join(receiptDir, pdfFilename), req.file.buffer);

    // ── Generate QR code ────────────────────────────────────────────────────
    let qrGenerated = false;
    let missingIban  = false;
    let qrBuffer     = null;

    // Generate QR whenever we have an IBAN for this nickname — the checkbox only
    // controls the "Needs reimbursement" column, not QR creation.
    if (playerIban) {
      const remittance = `Erstattung ${category} - ${opponent} ${matchNum} - ${nickname}`;
      const qrArgs = { iban: playerIban, name: playerFullName, amount: parseFloat(amount), remittance };
      await generateQRCode({ ...qrArgs, filename: qrFilename });
      qrBuffer = await generateQRBuffer(qrArgs);
      qrGenerated = true;
    } else if (wantsReimbursement) {
      missingIban = true;
    }

    // ── Upload to Google Drive + append Sheet row ───────────────────────────
    let receiptLink = '';
    let qrLink      = '';
    let sheetOk     = false;
    let googleError = null;

    if (googleEnabled) {
      try {
        const receiptFile = await googleApi.uploadReceipt({
          buffer: req.file.buffer,
          filename: pdfFilename,
          opponent,
          matchNum,
        });
        receiptLink = receiptFile.webViewLink;

        if (qrBuffer) {
          const qrFile = await googleApi.uploadQRCode({ buffer: qrBuffer, filename: qrFilename });
          qrLink = qrFile.webViewLink;
        }

        await googleApi.appendExpenseRow({
          'Date':                date ? toGermanDate(date) : '',
          'Description':         buildDescription({ category, nickname, carUsed, hotelName, rentalCompany, opponent, matchNum }),
          'Category':            category === 'Umpire' ? 'Umpire' : 'Travel Cost',
          'Paid By':             nickname,
          'Sub-category':        category === 'Umpire' ? '' : category,
          'Opponent':            opponent,
          'Match':               matchNum,
          'Price':               parseFloat(amount).toFixed(2),
          'Receipt':             googleApi.hyperlink(receiptLink, pdfFilename),
          'QR Code':             qrLink ? googleApi.hyperlink(qrLink, qrFilename) : '',
          'Refunded to Sammy':   '',
          'Note':                '',
          'Submitted to club':   '',
          'Needs reimbursement': wantsReimbursement ? 'YES' : 'NO',
        });
        sheetOk = true;
      } catch (err) {
        console.error('Google API error:', err.message);
        googleError = err.message;
      }
    }

    // ── Local CSV (always — backup and fallback) ────────────────────────────
    appendRow({
      'Date':                date ? toGermanDate(date) : '',
      'Description':         buildDescription({ category, nickname, carUsed, hotelName, rentalCompany, opponent, matchNum }),
      'Category':            category === 'Umpire' ? 'Umpire' : 'Travel Cost',
      'Paid By':             nickname,
      'Sub-category':        category === 'Umpire' ? '' : category,
      'Opponent':            opponent,
      'Match':               matchNum,
      'Price':               parseFloat(amount).toFixed(2),
      'Receipt':             receiptLink || pdfFilename,
      'QR Code':             qrLink || (qrGenerated ? qrFilename : ''),
      'Refunded to Sammy':   '',
      'Note':                '',
      'Submitted to club':   '',
      'Needs reimbursement': wantsReimbursement ? 'YES' : 'NO',
    });

    res.json({
      success: true,
      wantsReimbursement,
      qrGenerated,
      missingIban,
      sheetOk,
      googleError,
    });

  } catch (err) {
    console.error('Submit error:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

module.exports = [upload.single('receipt'), handler];

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { generateQRCode } = require('../utils/qrGenerator');
const { appendRow } = require('../utils/csv');
const { toSafeFilePart, toGermanDate, buildDescription } = require('../utils/helpers');

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

router.post('/', upload.single('receipt'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No receipt file received.' });
    }

    const {
      nickname,
      date,
      category,
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

    // ── Save PDF ────────────────────────────────────────────────────────────
    const receiptDir = path.join(__dirname, '..', 'data', 'receipts');
    fs.mkdirSync(receiptDir, { recursive: true });
    fs.writeFileSync(path.join(receiptDir, pdfFilename), req.file.buffer);

    // ── Generate QR code ────────────────────────────────────────────────────
    let qrGenerated = false;
    let missingIban  = false;

    if (wantsReimbursement) {
      if (playerIban) {
        const remittance = `Erstattung ${category} - ${opponent} ${matchNum} - ${nickname}`;
        await generateQRCode({
          iban: playerIban,
          name: playerFullName,
          amount: parseFloat(amount),
          remittance,
          filename: qrFilename,
        });
        qrGenerated = true;
      } else {
        missingIban = true;
      }
    }

    // ── Append CSV row ──────────────────────────────────────────────────────
    appendRow({
      'Date':                date ? toGermanDate(date) : '',
      'Description':         buildDescription({ category, nickname, hotelName, rentalCompany, opponent, matchNum }),
      'Category':            category === 'Umpire' ? 'Umpire' : 'Travel Cost',
      'Paid By':             nickname,
      'Sub-category':        category === 'Umpire' ? '' : category,
      'Opponent':            opponent,
      'Match':               matchNum,
      'Price':               parseFloat(amount).toFixed(2),
      'Receipt':             pdfFilename,
      'QR Code':             qrGenerated ? qrFilename : '',
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
    });

  } catch (err) {
    console.error('Submit error:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;

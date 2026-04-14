const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

/**
 * Builds an EPC QR code string (GiroCode / SEPA Credit Transfer).
 * Standard: European Payments Council — Quick Response Code Guidelines v2.1
 */
function buildEPCString({ iban, name, amount, remittance }) {
  const amountStr = `EUR${parseFloat(amount).toFixed(2)}`;
  const nameTrunc = String(name).substring(0, 70);
  const remittanceTrunc = String(remittance).substring(0, 140);

  // EPC v002 has up to 12 fields. Trailing empty optional fields MUST be omitted —
  // some banking apps (e.g. C24) reject a trailing \n otherwise.
  const fields = [
    'BCD',           // 1. Service Tag
    '002',           // 2. Version
    '1',             // 3. Character set: UTF-8
    'SCT',           // 4. SEPA Credit Transfer
    '',              // 5. BIC (optional)
    nameTrunc,       // 6. Beneficiary name
    iban.replace(/\s/g, ''), // 7. IBAN (no spaces)
    amountStr,       // 8. Amount
    '',              // 9. Purpose code (optional)
    '',              // 10. Structured remittance reference (optional)
    remittanceTrunc, // 11. Unstructured remittance info (optional, but present here)
    // 12. Beneficiary-to-originator info — omitted entirely (no trailing newline)
  ];
  while (fields.length && fields[fields.length - 1] === '') fields.pop();
  return fields.join('\n');
}

const QR_OPTIONS = {
  errorCorrectionLevel: 'M',
  type: 'png',
  width: 400,
  margin: 2,
  color: { dark: '#000000', light: '#ffffff' },
};

/** Returns a PNG Buffer of the EPC QR code. */
async function generateQRBuffer({ iban, name, amount, remittance }) {
  const epcString = buildEPCString({ iban, name, amount, remittance });
  return QRCode.toBuffer(epcString, QR_OPTIONS);
}

/** Generates an EPC QR PNG and saves it to data/qr-codes/ (local backup). */
async function generateQRCode({ iban, name, amount, remittance, filename }) {
  const buffer = await generateQRBuffer({ iban, name, amount, remittance });
  const outputDir = path.join(__dirname, '..', 'data', 'qr-codes');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, filename);
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

module.exports = { generateQRCode, generateQRBuffer, buildEPCString };

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

  return [
    'BCD',           // Service Tag
    '002',           // Version
    '1',             // Character set: UTF-8
    'SCT',           // SEPA Credit Transfer
    '',              // BIC (optional, leave blank)
    nameTrunc,       // Beneficiary name
    iban.replace(/\s/g, ''), // Beneficiary IBAN (no spaces)
    amountStr,       // Amount
    '',              // Purpose code (optional)
    '',              // Creditor reference (optional)
    remittanceTrunc, // Remittance info (unstructured)
    '',              // Beneficiary info (optional)
  ].join('\n');
}

/**
 * Generates an EPC QR code PNG and saves it to data/qr-codes/.
 * Returns the full file path.
 */
async function generateQRCode({ iban, name, amount, remittance, filename }) {
  const epcString = buildEPCString({ iban, name, amount, remittance });
  const outputDir = path.join(__dirname, '..', 'data', 'qr-codes');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, filename);

  await QRCode.toFile(outputPath, epcString, {
    errorCorrectionLevel: 'M',
    type: 'png',
    width: 400,
    margin: 2,
    color: { dark: '#000000', light: '#ffffff' },
  });

  return outputPath;
}

module.exports = { generateQRCode, buildEPCString };

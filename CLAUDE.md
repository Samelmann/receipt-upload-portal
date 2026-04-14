# CLAUDE.md

Guidance for Claude Code when working in this repo. Also serves as the project README.

## What this project is

A mobile-first web form that lets teammates on a baseball team submit expense receipts (gas, accommodation, rental cars, umpire fees) from their phone. Sammy (the treasurer) currently collects these manually via chat and spreadsheets — this portal replaces that flow.

## How it works (end-to-end)

1. A player opens a **secret URL** (`/<SECRET_PATH>/`) on their phone. The path is unguessable; the URL is shared only with the team.
2. They fill in a form: nickname, date, category (Gas / Accommodation / Car Rental / Umpire), opponent, matchup (1st/2nd game), total amount, and optionally a hotel name or rental company.
3. They upload a photo of the receipt. Client-side:
   - HEIC → JPEG conversion (iPhone compatibility) via `heic2any`
   - Interactive crop via `cropper.js`
   - Quality warning shown if the result looks too small/blurry
   - Final image is converted to PDF in the browser via `pdf-lib`
4. They check "I need to be reimbursed" if they want an EPC QR code generated. If their IBAN isn't on file yet, they can supply it once in the collapsible section.
5. The server:
   - Saves the PDF to `data/receipts/` with a structured filename
   - Looks up the player's IBAN in `config/ibans.json`
   - Generates an **EPC/GiroCode QR code** PNG to `data/qr-codes/` (Sammy scans this with his C24 banking app to execute the transfer)
   - Appends a row to `data/submissions.csv` matching the structure of the real "Expenses 26" Google Sheet
6. (Phase 2, not yet built) The CSV writes get replaced with Google Sheets API calls, and receipts/QR PNGs upload to Google Drive.

## Data model

The CSV columns mirror Sammy's real expenses sheet exactly — any change here must be kept in sync with the sheet. See `utils/csv.js:COLUMNS` and `test/csv.test.js`.

| Col | Name | Source |
|---|---|---|
| A | Date | form (`DD.MM.YYYY`) |
| B | Description | auto-generated (see `buildDescription` in `utils/helpers.js`) |
| C | Category | `Travel Cost` for Gas/Accommodation/Car Rental, `Umpire` for Umpire |
| D | Paid By | nickname |
| E | Sub-category | Gas / Accommodation / Car Rental / empty for Umpire |
| F | Opponent | form |
| G | Match | `1` or `2` |
| H | Price | form (2 decimals) |
| I | Receipt | PDF filename / Drive link |
| J | QR Code | QR filename / Drive link |
| K | Refunded to Sammy | Sammy fills manually |
| L | Note | Sammy fills manually |
| M | Submitted to club | Sammy fills manually |
| N | Needs reimbursement | `YES` / `NO` |

## Repo layout

```
server.js                 Express entry point, strict routing, secret-path mounting
routes/submit.js          POST /<secret>/submit — orchestrates file save, QR, CSV
utils/helpers.js          Pure functions: filename sanitizer, date format, description builder
utils/csv.js              CSV append + escape, COLUMNS source of truth
utils/qrGenerator.js      EPC/GiroCode v2 string builder + QR PNG writer
public/                   Static frontend (index.html, css, js/app.js, vendored libs)
config/ibans.json         Nickname → {fullName, iban} lookup
data/                     Gitignored output (receipts/, qr-codes/, submissions.csv)
test/                     node:test unit tests
```

## Running it

```bash
cp .env.example .env            # then edit: openssl rand -hex 8 for SECRET_PATH
npm install
npm start                        # or: docker compose up -d
# form URL is printed on startup
```

## Tests

Uses Node's built-in test runner — no external framework.

```bash
npm test
```

**Rule for Claude: keep tests in sync with code changes.**

- If you change `utils/helpers.js` (filename sanitizer, date formatter, description logic) → update `test/helpers.test.js`.
- If you change the CSV column order or `escape` behavior in `utils/csv.js` → update `test/csv.test.js`. The `COLUMNS` assertion is intentionally strict — it catches silent schema drift against the real Google Sheet.
- If you change the EPC QR string format in `utils/qrGenerator.js` → update `test/qr.test.js`. The field positions are dictated by the EPC v2 spec, so don't "fix" a failing test by changing the assertion — fix the code.
- When adding a new pure helper, add a corresponding test in `test/`.
- Run `npm test` before declaring a task done. Don't skip, don't comment out failing tests.

Route handlers and filesystem/network code are not unit-tested — keep them thin and push logic into testable helpers.

## Things to know before editing

- **Strict routing is on** (`server.js`). `/secret` redirects to `/secret/`; only `/secret/` serves the form. Do not remove `app.set('strict routing', true)` — without it, the root path hits an `express.static` redirect loop.
- **Cropper.js is pinned to v1** (`cropperjs@1.6.2`). v2 has an incompatible API and will break `public/js/app.js`.
- **Vendor libs under `public/js/`** (`cropper.min.js`, `pdf-lib.min.js`, `heic2any.min.js`) are copies from `node_modules`, so the frontend has no CDN dependency at runtime. If you bump the npm version, re-copy the file.
- **`data/` is gitignored** and holds real receipts — never commit its contents.
- **`.env` holds the secret path** — never commit it. The example file uses a placeholder.
- **Filenames on disk** follow `YYYY-MM-DD_Name_Opponent-Match_Category_AmountEUR.pdf` (receipts) and `..._AmountEUR_Opponent-Match.png` (QR codes). Built in `routes/submit.js`.

## Phase 2 TODO (not started)

- Replace CSV append with Google Sheets API write to the real "Expenses 26" sheet
- Upload PDF to Google Drive `Ausgaben/receipts/<Opponent>/`
- Upload QR PNG to Google Drive `Ausgaben/qr-codes/`
- Put Drive share links in the Sheet's Receipt and QR Code columns (smartchips)
- OAuth setup for Google APIs (`node scripts/oauth-setup.js`)

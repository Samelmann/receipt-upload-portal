// One-time OAuth setup. Run: node scripts/oauth-setup.js
// Opens a browser, you authorize, token is saved to config/google-oauth-token.json
const http = require('http');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { google } = require('googleapis');

const CLIENT_PATH = path.join(__dirname, '..', 'config', 'google-oauth-client.json');
const TOKEN_PATH  = path.join(__dirname, '..', 'config', 'google-oauth-token.json');
const PORT        = 53682;
const REDIRECT    = `http://localhost:${PORT}/oauth2callback`;

const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets',
];

const clientCfg = require(CLIENT_PATH).web || require(CLIENT_PATH).installed;
const oauth2 = new google.auth.OAuth2(clientCfg.client_id, clientCfg.client_secret, REDIRECT);

const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline',   // gives us a refresh_token
  prompt: 'consent',        // force refresh_token on every run
  scope: SCOPES,
});

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith('/oauth2callback')) { res.writeHead(404); return res.end(); }
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end(`Auth error: ${error}`);
    console.error('Auth failed:', error);
    server.close();
    process.exit(1);
  }

  try {
    const { tokens } = await oauth2.getToken(code);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h1>Authorized ✓</h1><p>You can close this tab and return to the terminal.</p>');
    console.log('\n✓ Token saved to', TOKEN_PATH);
    if (!tokens.refresh_token) {
      console.warn('⚠ No refresh_token received. Revoke the app in https://myaccount.google.com/permissions and run again.');
    }
    server.close();
    process.exit(0);
  } catch (err) {
    res.writeHead(500); res.end('Token exchange failed');
    console.error('Token exchange failed:', err.message);
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log('Open this URL in your browser to authorize:\n');
  console.log('  ' + authUrl + '\n');
  // Try auto-opening (Windows)
  const opener = process.platform === 'win32' ? 'start ""' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  exec(`${opener} "${authUrl}"`, () => {});
});

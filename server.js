require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
app.set('strict routing', true);
const PORT = process.env.PORT || 3000;
const SECRET_PATH = process.env.SECRET_PATH;

if (!SECRET_PATH) {
  console.error('ERROR: SECRET_PATH is not set in .env');
  process.exit(1);
}

// Redirect bare secret path to trailing-slash version so relative URLs work
app.get(`/${SECRET_PATH}`, (req, res) => {
  res.redirect(301, `/${SECRET_PATH}/`);
});

// Form submission API
app.post(`/${SECRET_PATH}/submit`, require('./routes/submit'));

// Serve index.html explicitly for the root (avoids express.static redirect loop)
app.get(`/${SECRET_PATH}/`, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve static assets (css, js, etc.) under the secret path
app.use(`/${SECRET_PATH}/`, express.static(path.join(__dirname, 'public')));

// Everything else → 404 (no hints about what paths exist)
app.use((req, res) => {
  res.status(404).send('Not found');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Form: http://localhost:${PORT}/${SECRET_PATH}/`);
});

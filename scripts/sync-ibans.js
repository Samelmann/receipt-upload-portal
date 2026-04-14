// Pulls Kontodaten from Google Sheets → config/ibans.json
// Run: npm run sync-ibans
require('dotenv').config();
const { syncIbansFromKontodaten } = require('../utils/google');

(async () => {
  const { count, diff } = await syncIbansFromKontodaten();
  console.log(`✓ Synced ${count} players to config/ibans.json`);
  if (diff.added.length)   console.log('  added:  ', diff.added.join(', '));
  if (diff.removed.length) console.log('  removed:', diff.removed.join(', '));
  if (diff.changed.length) console.log('  changed:', diff.changed.join(', '));
  if (!diff.added.length && !diff.removed.length && !diff.changed.length) {
    console.log('  (no changes)');
  }
})().catch(err => { console.error('FAIL:', err.message); process.exit(1); });

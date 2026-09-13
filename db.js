// Persistent storage via Neon Postgres, replacing the old local JSON file.
// Stores the entire app state (settings, services, team, bookings,
// conversations) as a single JSONB blob — this keeps every other file
// (booking-logic.js, whatsapp-agent.js, all the route handlers) working
// exactly as before, since readDB()/writeDB() still hand back/accept the
// same plain JS object shape. Only now it's actually persistent.
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set — add your Neon connection string to .env');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

const DEFAULT_DATA = {
  settings: {
    salonName: 'VJ Signature Salon',
    tagline: 'Hair, cut with intention',
    heroDescription: '',
    area: '',
    address: '',
    phone: '',
    phoneDisplay: '',
    hours: '',
    logoUrl: '',
    instagramUrl: '',
    whatsappBotNumber: '919840417667', // used for "Message on WhatsApp" links — your bot's number
    depositEnabled: true,
    depositAmount: 50 // rupees
  },
  services: [],
  team: [],
  bookings: [],
  bookingSeq: 1001,
  conversations: {}
};

// Creates the table if it doesn't exist yet, and seeds it once — either from
// your existing local data/db.json (so you don't lose what you've already
// set up), or from sensible defaults if that file isn't there.
async function ensureReady() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY DEFAULT 1,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const { rows } = await pool.query('SELECT id FROM app_state WHERE id = 1');
  if (rows.length > 0) return; // already seeded, nothing to do

  let seed = DEFAULT_DATA;
  try {
    const localPath = path.join(__dirname, 'data', 'db.json');
    if (fs.existsSync(localPath)) {
      seed = JSON.parse(fs.readFileSync(localPath, 'utf-8'));
      console.log('[DB] Seeding Postgres from your existing local data/db.json...');
    } else {
      console.log('[DB] No local data/db.json found — seeding Postgres with defaults.');
    }
  } catch (err) {
    console.error('[DB] Could not read local db.json, using defaults instead:', err.message);
  }

  await pool.query('INSERT INTO app_state (id, data) VALUES (1, $1)', [JSON.stringify(seed)]);
  console.log('[DB] Seed complete.');
}

async function readDB() {
  const { rows } = await pool.query('SELECT data FROM app_state WHERE id = 1');
  if (rows.length === 0) throw new Error('App state not found — did ensureReady() run?');
  const db = rows[0].data;

  // Same backward-compatible defaults the old file-based version had.
  if (!db.bookings) db.bookings = [];
  if (!db.bookingSeq) db.bookingSeq = 1001;
  if (!db.conversations) db.conversations = {};
  if (db.settings.depositEnabled === undefined) db.settings.depositEnabled = true;
  if (db.settings.depositAmount === undefined) db.settings.depositAmount = 50;
  if (db.settings.whatsappBotNumber === undefined) db.settings.whatsappBotNumber = '919840417667';
  db.bookings.forEach(b => { if (!b.status) b.status = 'upcoming'; });
  db.bookings.forEach(b => { if (!b.source) b.source = 'website'; });

  return db;
}

async function writeDB(db) {
  await pool.query('UPDATE app_state SET data = $1, updated_at = now() WHERE id = 1', [JSON.stringify(db)]);
}

module.exports = { readDB, writeDB, ensureReady };

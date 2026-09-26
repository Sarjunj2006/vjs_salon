// Bookings viewer — a separate page (/bookings/) where front-desk people can
// SEE bookings and MARK THEM COMPLETED, using their own password.
// They cannot cancel bookings or open anything else in the admin panel.
// Mounted in server.js at /api/bookings-view.

const express = require('express');
const crypto = require('crypto');
const { Pool } = require('pg');
const { readDB, writeDB } = require('../db');

const router = express.Router();

// The password lives in its own small table — NOT in the salon settings,
// because /api/settings is public (the website reads it).
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
});

let tableReady = null;
function ensureTable() {
  if (!tableReady) {
    tableReady = pool.query(`
      CREATE TABLE IF NOT EXISTS bookings_view_settings (
        id INTEGER PRIMARY KEY,
        password_hash TEXT
      )
    `).catch((err) => { tableReady = null; throw err; });
  }
  return tableReady;
}

// ---------- helpers ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(check, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

async function getHash() {
  await ensureTable();
  const { rows } = await pool.query('SELECT password_hash FROM bookings_view_settings WHERE id = 1');
  return rows[0]?.password_hash || null;
}

// Simple protection against someone guessing the password over and over.
const failedLogins = new Map(); // ip -> { count, until }
function tooManyAttempts(ip) {
  const f = failedLogins.get(ip);
  return f && f.count >= 10 && f.until > Date.now();
}
function recordFailure(ip) {
  const f = failedLogins.get(ip);
  if (!f || f.until < Date.now()) failedLogins.set(ip, { count: 1, until: Date.now() + 15 * 60 * 1000 });
  else f.count += 1;
}

// ---------- access rules ----------
const isAdmin = (req) => !!(req.session && req.session.isAdmin);
const isViewer = (req) => !!(req.session && req.session.bookingsViewer);

function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  return res.status(401).json({ error: 'Admin login required.' });
}
function requireViewerOrAdmin(req, res, next) {
  if (isAdmin(req) || isViewer(req)) return next();
  return res.status(401).json({ error: 'Please log in.' });
}

// ---------- login ----------
router.post('/login', wrap(async (req, res) => {
  const ip = req.ip;
  if (tooManyAttempts(ip)) {
    return res.status(429).json({ error: 'Too many wrong attempts. Try again in 15 minutes.' });
  }
  const stored = await getHash();
  if (!stored) {
    return res.status(400).json({ error: 'This page is not set up yet. Ask the owner to set a password.' });
  }
  const { password } = req.body || {};
  if (!verifyPassword(password || '', stored)) {
    recordFailure(ip);
    return res.status(401).json({ error: 'Incorrect password.' });
  }
  failedLogins.delete(ip);
  req.session.bookingsViewer = true;
  res.json({ ok: true });
}));

router.post('/logout', (req, res) => {
  if (req.session) req.session.bookingsViewer = false;
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  res.json({ admin: isAdmin(req), viewer: isViewer(req) });
});

// ---------- admin: set the password ----------
router.get('/status', requireAdmin, wrap(async (req, res) => {
  res.json({ passwordSet: !!(await getHash()) });
}));

router.put('/password', requireAdmin, wrap(async (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters.' });
  }
  await ensureTable();
  await pool.query(
    `INSERT INTO bookings_view_settings (id, password_hash) VALUES (1, $1)
     ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [hashPassword(newPassword)]
  );
  res.json({ ok: true });
}));

// ---------- bookings ----------
// "5:45 PM" / "10:00 AM" / "17:45" -> minutes since midnight, so 9 AM sorts before 10 AM.
function timeToMinutes(t) {
  const m = String(t || '').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return 24 * 60;
  let h = Number(m[1]) % 12;
  if (!m[3]) h = Number(m[1]);
  else if (m[3].toUpperCase() === 'PM') h += 12;
  return h * 60 + Number(m[2]);
}
function compareBookings(a, b) {
  return String(a.date).localeCompare(String(b.date)) || timeToMinutes(a.time) - timeToMinutes(b.time);
}
// Turns a stored booking into a simple, consistent shape for the page.
function toView(b, db) {
  const service = (db.services || []).find((s) => s.id === b.serviceId);
  const stylist = (db.team || []).find((t) => t.id === b.professionalId);
  return {
    id: b.id,
    orderId: b.orderId || '',
    date: b.date || '',
    time: b.time || '',
    customer: b.name || b.customerName || b.customer || '',
    mobile: b.mobile || b.phone || '',
    service: b.serviceName || (service && service.name) || b.service || '',
    stylist: b.professionalName || (stylist && stylist.name) || '',
    status: b.status || 'upcoming',
    paymentStatus: b.paymentStatus || '',
    source: b.source || '',
    notes: b.notes || '',
  };
}

router.get('/list', requireViewerOrAdmin, wrap(async (req, res) => {
  const db = await readDB();
  const list = (db.bookings || [])
    .map((b) => toView(b, db))
    .sort(compareBookings);
  res.json(list);
}));

// Mark completed / back to upcoming. No cancel or delete here on purpose.
router.put('/:id/status', requireViewerOrAdmin, wrap(async (req, res) => {
  const { status } = req.body || {};
  if (!['upcoming', 'completed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status.' });
  }
  const db = await readDB();
  const booking = (db.bookings || []).find((b) => b.id === req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });
  booking.status = status;
  await writeDB(db);
  res.json(toView(booking, db));
}));

// ---------- error safety net ----------
router.use((err, req, res, next) => {
  console.error('[Bookings view] Error:', err.message);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

module.exports = router;

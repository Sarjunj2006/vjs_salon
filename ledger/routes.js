// Shop Ledger — runs INSIDE the VJ Signature Salon app.
// Mounted in server.js at /api/ledger. Uses ONLY the ledger_* tables,
// never app_state. Owner = logged-in salon admin. Staff = shared ledger password.

const express = require('express');
const crypto = require('crypto');
const { Pool } = require('pg');

const router = express.Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
});

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
function id(prefix) {
  return prefix + '_' + crypto.randomBytes(4).toString('hex');
}
// Any database error becomes a 500 reply instead of crashing the whole salon server.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Current date/time in India (the old ledger used UTC by mistake).
function nowIST() {
  const now = new Date();
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now); // YYYY-MM-DD
  const time = now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }); // HH:MM
  return { date, time, createdAt: now.toISOString() };
}

// ---------- access rules ----------
const isAdmin = (req) => !!(req.session && req.session.isAdmin);
const isStaff = (req) => !!(req.session && req.session.ledgerStaff);

function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  return res.status(401).json({ error: 'Admin login required.' });
}
function requireStaffOrAdmin(req, res, next) {
  if (isAdmin(req) || isStaff(req)) return next();
  return res.status(401).json({ error: 'Please log in.' });
}

// ---------- staff login (shared ledger password) ----------
router.post('/staff-login', wrap(async (req, res) => {
  const { password } = req.body || {};
  const { rows } = await pool.query('SELECT staff_password_hash FROM ledger_settings WHERE id = 1');
  if (!verifyPassword(password || '', rows[0]?.staff_password_hash)) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }
  req.session.ledgerStaff = true;
  res.json({ ok: true });
}));

router.post('/staff-logout', (req, res) => {
  if (req.session) req.session.ledgerStaff = false;
  res.json({ ok: true });
});

// Who is logged in? Used by the frontend to decide what to show.
router.get('/me', (req, res) => {
  res.json({ admin: isAdmin(req), staff: isStaff(req) });
});

// Admin changes the staff password (replaces the old email-reset flow).
router.put('/staff-password', requireAdmin, wrap(async (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: 'New password must be at least 4 characters.' });
  }
  await pool.query('UPDATE ledger_settings SET staff_password_hash = $1 WHERE id = 1', [hashPassword(newPassword)]);
  res.json({ ok: true });
}));

// ---------- staff members ----------
router.get('/staff', requireStaffOrAdmin, wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT id, name, active FROM ledger_staff ORDER BY seq');
  res.json(rows);
}));

router.post('/staff', requireAdmin, wrap(async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required.' });
  const { rows } = await pool.query(
    'INSERT INTO ledger_staff (id, name, active) VALUES ($1, $2, true) RETURNING id, name, active',
    [id('s'), name.trim()]
  );
  res.status(201).json(rows[0]);
}));

router.patch('/staff/:id', requireAdmin, wrap(async (req, res) => {
  const { rows: existing } = await pool.query('SELECT * FROM ledger_staff WHERE id = $1', [req.params.id]);
  if (existing.length === 0) return res.status(404).json({ error: 'Staff member not found.' });
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : existing[0].name;
  const active = typeof req.body.active === 'boolean' ? req.body.active : existing[0].active;
  const { rows } = await pool.query(
    'UPDATE ledger_staff SET name = $1, active = $2 WHERE id = $3 RETURNING id, name, active',
    [name, active, req.params.id]
  );
  res.json(rows[0]);
}));

router.delete('/staff/:id', requireAdmin, wrap(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM ledger_staff WHERE id = $1', [req.params.id]);
  if (rowCount === 0) return res.status(404).json({ error: 'Staff member not found.' });
  res.status(204).end();
}));

// ---------- ledger services (separate from the salon website's services) ----------
router.get('/services', requireStaffOrAdmin, wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT id, name, price FROM ledger_services ORDER BY seq');
  res.json(rows.map((r) => ({ ...r, price: Number(r.price) })));
}));

router.post('/services', requireAdmin, wrap(async (req, res) => {
  const { name, price } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Service name is required.' });
  if (typeof price !== 'number' || price < 0) return res.status(400).json({ error: 'Price must be a non-negative number.' });
  const { rows } = await pool.query(
    'INSERT INTO ledger_services (id, name, price) VALUES ($1, $2, $3) RETURNING id, name, price',
    [id('sv'), name.trim(), price]
  );
  res.status(201).json({ ...rows[0], price: Number(rows[0].price) });
}));

router.patch('/services/:id', requireAdmin, wrap(async (req, res) => {
  const { rows: existing } = await pool.query('SELECT * FROM ledger_services WHERE id = $1', [req.params.id]);
  if (existing.length === 0) return res.status(404).json({ error: 'Service not found.' });
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : existing[0].name;
  const price = typeof req.body.price === 'number' ? req.body.price : Number(existing[0].price);
  const { rows } = await pool.query(
    'UPDATE ledger_services SET name = $1, price = $2 WHERE id = $3 RETURNING id, name, price',
    [name, price, req.params.id]
  );
  res.json({ ...rows[0], price: Number(rows[0].price) });
}));

router.delete('/services/:id', requireAdmin, wrap(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM ledger_services WHERE id = $1', [req.params.id]);
  if (rowCount === 0) return res.status(404).json({ error: 'Service not found.' });
  res.status(204).end();
}));

// ---------- entries ----------
function rowToEntry(r) {
  return {
    id: r.id,
    staffId: r.staff_id,
    staffName: r.staff_name,
    serviceId: r.service_id,
    serviceName: r.service_name,
    price: Number(r.price),
    paymentMethod: r.payment_method,
    customerName: r.customer_name || '',
    note: r.note || '',
    date: r.date,
    time: r.time,
    createdAt: r.created_at,
  };
}

function dateFilters(query, params, conditions) {
  const { date, staffId, from, to } = query;
  if (date)    { params.push(date);    conditions.push(`date = $${params.length}`); }
  if (staffId) { params.push(staffId); conditions.push(`staff_id = $${params.length}`); }
  if (from)    { params.push(from);    conditions.push(`date >= $${params.length}`); }
  if (to)      { params.push(to);      conditions.push(`date <= $${params.length}`); }
}

router.get('/entries', requireAdmin, wrap(async (req, res) => {
  const params = [];
  const conditions = [];
  dateFilters(req.query, params, conditions);
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const { rows } = await pool.query(`SELECT * FROM ledger_entries ${where} ORDER BY created_at DESC`, params);
  res.json(rows.map(rowToEntry));
}));

router.post('/entries', requireStaffOrAdmin, wrap(async (req, res) => {
  const { staffId, serviceId, price, paymentMethod, customerName, note } = req.body || {};
  if (!staffId || !serviceId) return res.status(400).json({ error: 'Staff and service are required.' });
  if (typeof price !== 'number' || price < 0) return res.status(400).json({ error: 'Price must be a non-negative number.' });
  if (!['cash', 'card', 'upi', 'other'].includes(paymentMethod)) {
    return res.status(400).json({ error: 'Invalid payment method.' });
  }

  const { rows: staffRows } = await pool.query('SELECT * FROM ledger_staff WHERE id = $1', [staffId]);
  const { rows: serviceRows } = await pool.query('SELECT * FROM ledger_services WHERE id = $1', [serviceId]);
  if (staffRows.length === 0) return res.status(404).json({ error: 'Staff member not found.' });
  if (serviceRows.length === 0) return res.status(404).json({ error: 'Service not found.' });

  const { date, time, createdAt } = nowIST();
  const entry = {
    id: id('e'),
    staffId,
    staffName: staffRows[0].name,
    serviceId,
    serviceName: serviceRows[0].name,
    price,
    paymentMethod,
    customerName: customerName ? String(customerName).trim() : '',
    note: note ? String(note).trim() : '',
    date,
    time,
    createdAt,
  };
  await pool.query(
    `INSERT INTO ledger_entries (id, staff_id, staff_name, service_id, service_name, price, payment_method, customer_name, note, date, time, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [entry.id, entry.staffId, entry.staffName, entry.serviceId, entry.serviceName,
     entry.price, entry.paymentMethod, entry.customerName, entry.note,
     entry.date, entry.time, entry.createdAt]
  );
  res.status(201).json(entry);
}));

router.delete('/entries/:id', requireAdmin, wrap(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM ledger_entries WHERE id = $1', [req.params.id]);
  if (rowCount === 0) return res.status(404).json({ error: 'Entry not found.' });
  res.status(204).end();
}));

// ---------- summary / reports ----------
router.get('/summary', requireAdmin, wrap(async (req, res) => {
  const params = [];
  const conditions = [];
  dateFilters({ from: req.query.from, to: req.query.to }, params, conditions);
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const { rows } = await pool.query(`SELECT * FROM ledger_entries ${where}`, params);
  const entries = rows.map(rowToEntry);

  const total = entries.reduce((sum, e) => sum + e.price, 0);
  const byStaff = {};
  const byPayment = { cash: 0, card: 0, upi: 0, other: 0 };
  const byService = {};
  for (const e of entries) {
    byStaff[e.staffName] = byStaff[e.staffName] || { count: 0, total: 0 };
    byStaff[e.staffName].count += 1;
    byStaff[e.staffName].total += e.price;
    byPayment[e.paymentMethod] = (byPayment[e.paymentMethod] || 0) + e.price;
    byService[e.serviceName] = byService[e.serviceName] || { count: 0, total: 0 };
    byService[e.serviceName].count += 1;
    byService[e.serviceName].total += e.price;
  }
  res.json({ count: entries.length, total, byStaff, byPayment, byService });
}));

// ---------- error safety net (ledger only) ----------
router.use((err, req, res, next) => {
  console.error('[Ledger] Error:', err.message);
  res.status(500).json({ error: 'Something went wrong in the ledger. Please try again.' });
});

module.exports = router;

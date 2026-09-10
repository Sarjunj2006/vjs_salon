require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { readDB, writeDB, ensureReady } = require('./db');
const { createBooking } = require('./booking-logic');
const { handleIncomingMessage } = require('./whatsapp-agent');
const { sendWhatsAppMessage, notifyBooking } = require('./whatsapp-client');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'vjsalon2026';
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'vj-signature-salon-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 } // 8 hours
}));
app.use(express.static(path.join(__dirname, 'public')));

function newId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ---------- file uploads ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, newId('img') + ext);
    }
  }),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|png|webp|gif|avif)$/.test(file.mimetype);
    cb(ok ? null : new Error('Only image files are allowed'), ok);
  }
});

// ---------- auth ----------
function requireAuth(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ error: 'Not authenticated' });
}

app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (password && password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'Incorrect password' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/session', (req, res) => {
  res.json({ loggedIn: !!(req.session && req.session.isAdmin) });
});

app.post('/api/upload', requireAuth, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    if (!req.file) return res.status(400).json({ error: 'No file received' });
    res.json({ url: '/uploads/' + req.file.filename });
  });
});

// ---------- settings ----------
app.get('/api/settings', async (req, res) => {
  const db = await readDB();
  res.json(db.settings);
});

app.put('/api/settings', requireAuth, async (req, res) => {
  const db = await readDB();
  db.settings = { ...db.settings, ...req.body };
  await writeDB(db);
  res.json(db.settings);
});

// ---------- services ----------
app.get('/api/services', async (req, res) => {
  const db = await readDB();
  res.json(db.services);
});

app.post('/api/services', requireAuth, async (req, res) => {
  const db = await readDB();
  const service = {
    id: newId('s'),
    name: req.body.name || 'Untitled Service',
    description: req.body.description || '',
    duration: req.body.duration || '',
    price: req.body.price || ''
  };
  db.services.push(service);
  await writeDB(db);
  res.status(201).json(service);
});

app.put('/api/services/:id', requireAuth, async (req, res) => {
  const db = await readDB();
  const idx = db.services.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Service not found' });
  db.services[idx] = { ...db.services[idx], ...req.body, id: db.services[idx].id };
  await writeDB(db);
  res.json(db.services[idx]);
});

app.delete('/api/services/:id', requireAuth, async (req, res) => {
  const db = await readDB();
  const before = db.services.length;
  db.services = db.services.filter(s => s.id !== req.params.id);
  if (db.services.length === before) return res.status(404).json({ error: 'Service not found' });
  await writeDB(db);
  res.json({ ok: true });
});

// ---------- team ----------
app.get('/api/team', async (req, res) => {
  const db = await readDB();
  res.json(db.team);
});

app.post('/api/team', requireAuth, async (req, res) => {
  const db = await readDB();
  const member = {
    id: newId('t'),
    name: req.body.name || 'Untitled Stylist',
    role: req.body.role || '',
    photoUrl: req.body.photoUrl || ''
  };
  db.team.push(member);
  await writeDB(db);
  res.status(201).json(member);
});

app.put('/api/team/:id', requireAuth, async (req, res) => {
  const db = await readDB();
  const idx = db.team.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Team member not found' });
  db.team[idx] = { ...db.team[idx], ...req.body, id: db.team[idx].id };
  await writeDB(db);
  res.json(db.team[idx]);
});

app.delete('/api/team/:id', requireAuth, async (req, res) => {
  const db = await readDB();
  const before = db.team.length;
  db.team = db.team.filter(t => t.id !== req.params.id);
  if (db.team.length === before) return res.status(404).json({ error: 'Team member not found' });
  await writeDB(db);
  res.json({ ok: true });
});

// ---------- bookings ----------

// Returns the list of time strings already booked for a given professional + date.
app.get('/api/bookings/taken', async (req, res) => {
  const { professionalId, date } = req.query;
  if (!professionalId || !date) return res.status(400).json({ error: 'professionalId and date are required' });
  const db = await readDB();
  const taken = db.bookings
    .filter(b => b.professionalId === professionalId && b.date === date)
    .map(b => b.time);
  res.json(taken);
});

// Public: customers create their own booking, no login required.
app.post('/api/bookings', async (req, res) => {
  const db = await readDB();
  const result = createBooking(db, req.body, 'website');
  if (!result.ok) {
    const status = /already|taken/i.test(result.error) ? 409 : 400;
    return res.status(status).json({ error: result.error });
  }
  await writeDB(db);
  notifyBooking(db, result.booking).catch(err => console.error('Booking notification error:', err.message));
  res.status(201).json(result.booking);
});

// Admin: view all bookings.
app.get('/api/bookings', requireAuth, async (req, res) => {
  const db = await readDB();
  const sorted = [...db.bookings].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  res.json(sorted);
});

// Admin: mark a booking completed/upcoming (after attending to the customer).
app.put('/api/bookings/:id/status', requireAuth, async (req, res) => {
  const { status } = req.body || {};
  if (!['upcoming', 'completed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const db = await readDB();
  const booking = db.bookings.find(b => b.id === req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  booking.status = status;
  await writeDB(db);
  res.json(booking);
});

// Admin: cancel a booking.
app.delete('/api/bookings/:id', requireAuth, async (req, res) => {
  const db = await readDB();
  const before = db.bookings.length;
  db.bookings = db.bookings.filter(b => b.id !== req.params.id);
  if (db.bookings.length === before) return res.status(404).json({ error: 'Booking not found' });
  await writeDB(db);
  res.json({ ok: true });
});

// ---------- WhatsApp webhook (Meta Cloud API) ----------

app.get('/webhook/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

app.post('/webhook/whatsapp', async (req, res) => {
  res.sendStatus(200); // acknowledge immediately; Meta retries if we're slow

  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];
    if (!message) return;

    const from = message.from;
    const body = message.text?.body?.trim();
    if (!from || !body) return;

    const db = await readDB();
    let reply;
    try {
      reply = await handleIncomingMessage(db, from, body);
    } catch (err) {
      console.error('WhatsApp agent failed:', err.message);
      reply = "Sorry, something went wrong on our end. Please try again shortly, or call the salon directly.";
    }
    await writeDB(db);
    await sendWhatsAppMessage(from, reply);
  } catch (err) {
    console.error('WhatsApp webhook processing error:', err.message);
  }
});

ensureReady()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`VJ Signature Salon server running at http://localhost:${PORT}`);
      console.log(`Admin panel: http://localhost:${PORT}/admin.html`);
    });
  })
  .catch(err => {
    console.error('Failed to connect to the database:', err.message);
    process.exit(1);
  });

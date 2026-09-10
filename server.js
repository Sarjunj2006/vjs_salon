require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { createBooking } = require('./booking-logic');
const { handleIncomingMessage } = require('./whatsapp-agent');
const { sendWhatsAppMessage, notifyBooking } = require('./whatsapp-client');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data', 'db.json');
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

// ---------- tiny JSON "database" helpers ----------
function readDB() {
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  if (!db.bookings) db.bookings = []; // backward-compatible: adds bookings list if missing
  if (!db.bookingSeq) db.bookingSeq = 1001; // backward-compatible: order ID counter
  db.bookings.forEach(b => { if (!b.status) b.status = 'upcoming'; }); // backward-compatible: status field
  db.bookings.forEach(b => { if (!b.source) b.source = 'website'; }); // backward-compatible: booking source
  if (!db.conversations) db.conversations = {}; // backward-compatible: WhatsApp conversation history
  return db;
}
function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}
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
app.get('/api/settings', (req, res) => {
  res.json(readDB().settings);
});

app.put('/api/settings', requireAuth, (req, res) => {
  const db = readDB();
  db.settings = { ...db.settings, ...req.body };
  writeDB(db);
  res.json(db.settings);
});

// ---------- services ----------
app.get('/api/services', (req, res) => {
  res.json(readDB().services);
});

app.post('/api/services', requireAuth, (req, res) => {
  const db = readDB();
  const service = {
    id: newId('s'),
    name: req.body.name || 'Untitled Service',
    description: req.body.description || '',
    duration: req.body.duration || '',
    price: req.body.price || ''
  };
  db.services.push(service);
  writeDB(db);
  res.status(201).json(service);
});

app.put('/api/services/:id', requireAuth, (req, res) => {
  const db = readDB();
  const idx = db.services.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Service not found' });
  db.services[idx] = { ...db.services[idx], ...req.body, id: db.services[idx].id };
  writeDB(db);
  res.json(db.services[idx]);
});

app.delete('/api/services/:id', requireAuth, (req, res) => {
  const db = readDB();
  const before = db.services.length;
  db.services = db.services.filter(s => s.id !== req.params.id);
  if (db.services.length === before) return res.status(404).json({ error: 'Service not found' });
  writeDB(db);
  res.json({ ok: true });
});

// ---------- team ----------
app.get('/api/team', (req, res) => {
  res.json(readDB().team);
});

app.post('/api/team', requireAuth, (req, res) => {
  const db = readDB();
  const member = {
    id: newId('t'),
    name: req.body.name || 'Untitled Stylist',
    role: req.body.role || '',
    photoUrl: req.body.photoUrl || ''
  };
  db.team.push(member);
  writeDB(db);
  res.status(201).json(member);
});

app.put('/api/team/:id', requireAuth, (req, res) => {
  const db = readDB();
  const idx = db.team.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Team member not found' });
  db.team[idx] = { ...db.team[idx], ...req.body, id: db.team[idx].id };
  writeDB(db);
  res.json(db.team[idx]);
});

app.delete('/api/team/:id', requireAuth, (req, res) => {
  const db = readDB();
  const before = db.team.length;
  db.team = db.team.filter(t => t.id !== req.params.id);
  if (db.team.length === before) return res.status(404).json({ error: 'Team member not found' });
  writeDB(db);
  res.json({ ok: true });
});

// ---------- bookings ----------

// Returns the list of time strings already booked for a given professional + date.
// (Customers pick from this to know which slots are unavailable.)
app.get('/api/bookings/taken', (req, res) => {
  const { professionalId, date } = req.query;
  if (!professionalId || !date) return res.status(400).json({ error: 'professionalId and date are required' });
  const db = readDB();
  const taken = db.bookings
    .filter(b => b.professionalId === professionalId && b.date === date)
    .map(b => b.time);
  res.json(taken);
});

// Public: customers create their own booking, no login required.
app.post('/api/bookings', (req, res) => {
  const db = readDB();
  const result = createBooking(db, req.body, 'website');
  if (!result.ok) {
    const status = /already|taken/i.test(result.error) ? 409 : 400;
    return res.status(status).json({ error: result.error });
  }
  writeDB(db);
  notifyBooking(db, result.booking).catch(err => console.error('Booking notification error:', err.message));
  res.status(201).json(result.booking);
});

// Admin: view all bookings.
app.get('/api/bookings', requireAuth, (req, res) => {
  const db = readDB();
  const sorted = [...db.bookings].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  res.json(sorted);
});

// Admin: mark a booking completed/upcoming (after attending to the customer).
app.put('/api/bookings/:id/status', requireAuth, (req, res) => {
  const { status } = req.body || {};
  if (!['upcoming', 'completed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const db = readDB();
  const booking = db.bookings.find(b => b.id === req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  booking.status = status;
  writeDB(db);
  res.json(booking);
});

// Admin: cancel a booking.
app.delete('/api/bookings/:id', requireAuth, (req, res) => {
  const db = readDB();
  const before = db.bookings.length;
  db.bookings = db.bookings.filter(b => b.id !== req.params.id);
  if (db.bookings.length === before) return res.status(404).json({ error: 'Booking not found' });
  writeDB(db);
  res.json({ ok: true });
});

// ---------- WhatsApp webhook (Meta Cloud API) ----------

// Meta calls this once when you configure the webhook in the App Dashboard,
// to prove you control this URL. Must echo back hub.challenge if the verify
// token matches what you set in Meta's config.
app.get('/webhook/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Meta POSTs every incoming customer message here.
app.post('/webhook/whatsapp', async (req, res) => {
  res.sendStatus(200); // acknowledge immediately; Meta retries if we're slow

  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];
    if (!message) return; // status updates (delivered/read) land here too — ignore those

    const from = message.from; // digits with country code, no '+', e.g. "919876543210"
    const body = message.text?.body?.trim();
    if (!from || !body) return; // ignore non-text messages (images, audio, etc.) for now

    const db = readDB();
    let reply;
    try {
      reply = await handleIncomingMessage(db, from, body);
    } catch (err) {
      console.error('WhatsApp agent failed:', err.message);
      reply = "Sorry, something went wrong on our end. Please try again shortly, or call the salon directly.";
    }
    writeDB(db);
    await sendWhatsAppMessage(from, reply);
  } catch (err) {
    console.error('WhatsApp webhook processing error:', err.message);
  }
});

app.listen(PORT, () => {
  console.log(`VJ Signature Salon server running at http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin.html`);
});

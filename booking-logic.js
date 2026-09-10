// Shared logic for creating bookings and checking availability.
// Used by both the public website (server.js REST routes) and the WhatsApp agent,
// so a booking made through either channel is validated identically and can never double-book.

function newId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function normalizeMobile(mobile) {
  const digits = String(mobile || '').replace(/\D/g, '');
  return digits.slice(-10);
}

function isValidMobile(mobile) {
  return /^\d{10}$/.test(normalizeMobile(mobile));
}

/**
 * Generates the salon's slot template: 10:00 AM - 7:45 PM in 15-minute increments,
 * grouped into Morning/Afternoon/Evening. Mirrors public/book.js's buildSlotTemplate().
 */
function buildSlotTemplate() {
  const periods = { Morning: [], Afternoon: [], Evening: [] };
  for (let h = 10; h <= 19; h++) {
    for (let m = 0; m < 60; m += 15) {
      if (h === 19 && m > 45) continue;
      const hour12 = h > 12 ? h - 12 : h;
      const ampm = h >= 12 ? 'PM' : 'AM';
      const label = `${hour12}:${String(m).padStart(2, '0')} ${ampm}`;
      const period = h < 12 ? 'Morning' : (h < 17 ? 'Afternoon' : 'Evening');
      periods[period].push({ label, hour: h, minute: m });
    }
  }
  return periods;
}

/**
 * Returns { available: [...timeLabels], taken: [...timeLabels] } for a given
 * professional + date (YYYY-MM-DD), factoring in existing bookings and, if the
 * date is today, times already in the past.
 */
function getAvailability(db, professionalId, dateIso) {
  const taken = db.bookings
    .filter(b => b.professionalId === professionalId && b.date === dateIso)
    .map(b => b.time);

  const now = new Date();
  const isToday = dateIso === now.toISOString().slice(0, 10);
  const periods = buildSlotTemplate();

  const available = [];
  Object.values(periods).flat().forEach(s => {
    const isPast = isToday && (s.hour < now.getHours() || (s.hour === now.getHours() && s.minute <= now.getMinutes()));
    if (!isPast && !taken.includes(s.label)) available.push(s.label);
  });

  return { available, taken };
}

/**
 * Creates a booking after validating required fields, mobile format, and clash-checking.
 * Mutates `db` in place (caller is responsible for calling writeDB after).
 * Returns { ok: true, booking } or { ok: false, error }.
 */
function createBooking(db, payload, source) {
  const { professionalId, professionalName, serviceId, serviceName, serviceDuration, servicePrice, date, dateLabel, time, name, mobile, notes } = payload || {};

  if (!professionalId || !serviceId || !date || !time || !name || !mobile) {
    return { ok: false, error: 'Missing required booking details (professional, service, date, time, name, and mobile number are all needed).' };
  }
  if (!isValidMobile(mobile)) {
    return { ok: false, error: 'That mobile number does not look valid — please provide a 10-digit number.' };
  }

  const clash = db.bookings.some(b => b.professionalId === professionalId && b.date === date && b.time === time);
  if (clash) {
    return { ok: false, error: 'That time slot was just taken. Please pick another time.' };
  }

  const booking = {
    id: newId('b'),
    orderId: 'VJS' + db.bookingSeq,
    status: 'upcoming',
    source: source || 'website', // 'website' | 'whatsapp'
    professionalId,
    professionalName: professionalName || 'Any Professional',
    serviceId,
    serviceName: serviceName || '',
    serviceDuration: serviceDuration || '',
    servicePrice: servicePrice || '',
    date,
    dateLabel: dateLabel || date,
    time,
    name,
    mobile: normalizeMobile(mobile),
    notes: notes || '',
    createdAt: new Date().toISOString()
  };
  db.bookings.push(booking);
  db.bookingSeq += 1;

  return { ok: true, booking };
}

module.exports = { newId, isValidMobile, normalizeMobile, buildSlotTemplate, getAvailability, createBooking };

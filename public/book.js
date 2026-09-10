// ---------- state ----------
const state = {
  step: 0, // 0 professional, 1 service, 2 time, 3 details, 4 done
  professional: null, // {id, name, role, photoUrl}
  service: null,      // {id, name, duration, price}
  dateIso: null,       // "2026-09-09"
  dateLabel: null,     // "Wed, 10 Sept"
  time: null            // "5:45 PM"
};

let team = [];
let services = [];

function escapeHtml(str) {
  return (str || '').replace(/[&<>"']/g, m => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[m]));
}

// ---------- boot ----------
async function boot() {
  try {
    const [settingsRes, teamRes, servicesRes] = await Promise.all([
      fetch('/api/settings'), fetch('/api/team'), fetch('/api/services')
    ]);
    const settings = await settingsRes.json();
    team = await teamRes.json();
    services = await servicesRes.json();

    document.getElementById('bBrandName').textContent = settings.salonName;
    document.getElementById('orderSalonName').textContent = settings.salonName;
    document.title = 'Book an Appointment — ' + settings.salonName;
    if (settings.logoUrl) {
      const logo = document.getElementById('bBrandLogo');
      logo.src = settings.logoUrl;
      logo.style.display = 'block';
    }
  } catch (e) {
    console.error('Failed to load salon data', e);
  }
  renderProfessionals();
  renderServices();
  renderDateRow();
  goToStep(0);
}

// ---------- step navigation ----------
const stepIds = ['step-professional', 'step-service', 'step-time', 'step-details', 'step-done'];

function goToStep(idx) {
  state.step = idx;
  stepIds.forEach((id, i) => {
    document.getElementById(id).style.display = (i === idx) ? 'block' : 'none';
  });
  document.querySelectorAll('#stepsCrumb span[data-step]').forEach(el => {
    el.classList.toggle('active', Number(el.dataset.step) === Math.min(idx, 3));
  });
  const backLink = document.getElementById('backLink');
  backLink.style.display = (idx > 0 && idx < 4) ? 'inline-block' : 'none';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.getElementById('backLink').addEventListener('click', () => {
  if (state.step > 0) goToStep(state.step - 1);
});

// ---------- STEP 0: professional ----------
function renderProfessionals() {
  const grid = document.getElementById('profGrid');
  const cards = [{ id: 'any', name: 'Any Professional', role: 'Best available match', photoUrl: '' }, ...team];
  grid.innerHTML = cards.map(p => `
    <div class="prof-card" data-id="${p.id}">
      <div class="prof-photo" style="${p.photoUrl ? `background-image:url('${p.photoUrl}')` : ''}">${p.photoUrl ? '' : '👤'}</div>
      <div class="prof-info">
        <h3>${escapeHtml(p.name)}</h3>
        <p>${escapeHtml(p.role)}</p>
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('.prof-card').forEach(card => {
    card.addEventListener('click', () => {
      const p = cards.find(c => c.id === card.dataset.id);
      state.professional = p;
      updateOrderSummary();
      goToStep(1);
    });
  });
}

// ---------- STEP 1: service ----------
function renderServices() {
  const grid = document.getElementById('serviceGrid');
  if (!services.length) {
    grid.innerHTML = '<p style="color:var(--text-soft);">No services available yet.</p>';
    return;
  }
  grid.innerHTML = services.map(s => `
    <div class="service-card-wizard" data-id="${s.id}">
      <div class="check-badge">✓</div>
      <h3>${escapeHtml(s.name)}</h3>
      <div class="svc-time">${escapeHtml(s.duration)}</div>
      <div class="svc-price">${escapeHtml(s.price)}</div>
    </div>
  `).join('');

  grid.querySelectorAll('.service-card-wizard').forEach(card => {
    card.addEventListener('click', () => {
      grid.querySelectorAll('.service-card-wizard').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      state.service = services.find(s => s.id === card.dataset.id);
      document.getElementById('serviceContinueBtn').disabled = false;
      updateOrderSummary();
    });
  });
}

document.getElementById('serviceContinueBtn').addEventListener('click', () => {
  goToStep(2);
  loadSlotsForSelectedDate();
});

// ---------- STEP 2: time ----------
function renderDateRow() {
  const row = document.getElementById('dateRow');
  const days = [];
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push(d);
  }
  const dowNames = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
  const monNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  row.innerHTML = days.map((d, i) => {
    const iso = d.toISOString().slice(0, 10);
    const label = i === 0 ? 'TODAY' : (i === 1 ? 'TMRW' : dowNames[d.getDay()]);
    return `
      <div class="date-card" data-iso="${iso}" data-label="${dowNames[d.getDay()]}, ${d.getDate()} ${monNames[d.getMonth()]}">
        <div class="dow">${label}</div>
        <div class="dnum">${d.getDate()}</div>
        <div class="mon">${monNames[d.getMonth()]}</div>
      </div>
    `;
  }).join('');

  row.querySelectorAll('.date-card').forEach(card => {
    card.addEventListener('click', () => {
      row.querySelectorAll('.date-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      state.dateIso = card.dataset.iso;
      state.dateLabel = card.dataset.label;
      state.time = null;
      document.getElementById('timeContinueBtn').disabled = true;
      updateOrderSummary();
      loadSlotsForSelectedDate();
    });
  });
}

function buildSlotTemplate() {
  // 10:00 AM to 7:45 PM in 15-minute increments, split into 3 periods.
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

async function loadSlotsForSelectedDate() {
  const wrap = document.getElementById('slotsWrap');
  if (!state.dateIso || !state.professional) {
    wrap.innerHTML = '<p style="color:var(--text-soft);">Select a date to view available slots.</p>';
    return;
  }
  wrap.innerHTML = '<p style="color:var(--text-soft);">Loading times…</p>';

  let taken = [];
  try {
    const res = await fetch(`/api/bookings/taken?professionalId=${encodeURIComponent(state.professional.id)}&date=${state.dateIso}`);
    taken = await res.json();
  } catch (e) {
    taken = [];
  }

  const now = new Date();
  const isToday = state.dateIso === now.toISOString().slice(0, 10);
  const periods = buildSlotTemplate();

  wrap.innerHTML = Object.entries(periods).map(([period, slots]) => `
    <div class="slot-label">${period}</div>
    <div class="slot-grid">
      ${slots.map(s => {
        const isPast = isToday && (s.hour < now.getHours() || (s.hour === now.getHours() && s.minute <= now.getMinutes()));
        const isTaken = taken.includes(s.label);
        const disabled = isPast || isTaken;
        return `<button type="button" class="slot-btn" data-label="${s.label}" ${disabled ? 'disabled' : ''}>${s.label}</button>`;
      }).join('')}
    </div>
  `).join('');

  wrap.querySelectorAll('.slot-btn:not(:disabled)').forEach(btn => {
    btn.addEventListener('click', () => {
      wrap.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.time = btn.dataset.label;
      document.getElementById('timeContinueBtn').disabled = false;
      updateOrderSummary();
    });
  });
}

document.getElementById('timeContinueBtn').addEventListener('click', () => goToStep(3));

// ---------- STEP 3: details ----------
const custName = document.getElementById('custName');
const custMobile = document.getElementById('custMobile');
const confirmBtn = document.getElementById('confirmBtn');

function validateDetailsForm() {
  const nameOk = custName.value.trim().length > 1;
  const mobileOk = /^\d{10}$/.test(custMobile.value.trim());
  confirmBtn.disabled = !(nameOk && mobileOk);
}
custName.addEventListener('input', validateDetailsForm);
custMobile.addEventListener('input', () => {
  custMobile.value = custMobile.value.replace(/\D/g, '').slice(0, 10);
  validateDetailsForm();
});

document.getElementById('detailsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('bookingError');
  errEl.textContent = '';
  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Booking…';

  const payload = {
    professionalId: state.professional.id,
    professionalName: state.professional.name,
    serviceId: state.service.id,
    serviceName: state.service.name,
    serviceDuration: state.service.duration,
    servicePrice: state.service.price,
    date: state.dateIso,
    dateLabel: state.dateLabel,
    time: state.time,
    name: custName.value.trim(),
    mobile: '+91' + custMobile.value.trim(),
    notes: document.getElementById('custNotes').value.trim()
  };

  try {
    const res = await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok) {
      document.getElementById('doneOrderId').textContent = 'Order ID: ' + data.orderId;
      document.getElementById('doneOrderId').style.display = 'inline-block';
      document.getElementById('doneMessage').textContent =
        `We'll see you ${state.dateLabel} at ${state.time} for your ${state.service.name}.`;
      goToStep(4);
    } else {
      errEl.textContent = data.error || 'Something went wrong. Please try again.';
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Confirm Booking';
    }
  } catch (e) {
    errEl.textContent = 'Could not reach server. Please try again.';
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Confirm Booking';
  }
});

// ---------- order summary sidebar ----------
function updateOrderSummary() {
  const linesEl = document.getElementById('orderLines');
  const totalEl = document.getElementById('orderTotal');
  const totalAmtEl = document.getElementById('orderTotalAmt');
  const noteEl = document.getElementById('orderNote');

  let html = '';
  if (state.professional) {
    html += `
      <div class="order-line">
        <div><div>${escapeHtml(state.professional.name)}</div><div class="meta">${escapeHtml(state.professional.role || '')}</div></div>
      </div>`;
  }
  if (state.service) {
    html += `
      <div class="order-line">
        <div><div>${escapeHtml(state.service.name)}</div><div class="meta">${escapeHtml(state.service.duration || '')}</div></div>
        <div class="amt">${escapeHtml(state.service.price || '')}</div>
      </div>`;
  }
  if (state.dateIso && state.time) {
    html += `
      <div class="order-line">
        <div>${escapeHtml(state.dateLabel)} at ${escapeHtml(state.time)}</div>
      </div>`;
  }

  linesEl.innerHTML = html || '<div class="order-empty">Nothing selected yet</div>';

  if (state.service) {
    totalEl.style.display = 'flex';
    noteEl.style.display = 'block';
    totalAmtEl.textContent = state.service.price || '—';
  } else {
    totalEl.style.display = 'none';
    noteEl.style.display = 'none';
  }
}

boot();

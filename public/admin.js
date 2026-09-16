const loginView = document.getElementById('loginView');
const dashboardView = document.getElementById('dashboardView');

// ---------- session check ----------
async function checkSession() {
  const res = await fetch('/api/session');
  const data = await res.json();
  if (data.loggedIn) {
    showDashboard();
  } else {
    showLogin();
  }
}

function showLogin() {
  loginView.style.display = 'block';
  dashboardView.style.display = 'none';
}

function showDashboard() {
  loginView.style.display = 'none';
  dashboardView.style.display = 'block';
  loadBookings();
  loadServices();
  loadTeam();
  loadSettings();
  loadBotMessages();
}

// ---------- login / logout ----------
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = document.getElementById('password').value;
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    if (res.ok) {
      document.getElementById('password').value = '';
      showDashboard();
    } else {
      const data = await res.json();
      errEl.textContent = data.error || 'Login failed';
    }
  } catch (e) {
    errEl.textContent = 'Could not reach server';
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  showLogin();
});

// ---------- tabs ----------
document.querySelectorAll('.admin-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
  });
});

// ---------- reusable drag-and-drop / browse image uploader ----------
function setupDropzone({ zoneId, fileInputId, hiddenInputId, previewId, promptId, removeId, errorId }) {
  const zone = document.getElementById(zoneId);
  const fileInput = document.getElementById(fileInputId);
  const hidden = document.getElementById(hiddenInputId);
  const preview = document.getElementById(previewId);
  const prompt = document.getElementById(promptId);
  const removeBtn = document.getElementById(removeId);
  const errorEl = document.getElementById(errorId);

  function showPreview(url) {
    preview.src = url;
    preview.style.display = 'block';
    prompt.style.display = 'none';
    removeBtn.style.display = 'inline-block';
  }
  function clearPreview() {
    preview.src = '';
    preview.style.display = 'none';
    prompt.style.display = 'block';
    removeBtn.style.display = 'none';
    hidden.value = '';
  }

  async function uploadFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      errorEl.textContent = 'Please choose an image file.';
      return;
    }
    errorEl.textContent = '';
    zone.classList.add('uploading');
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (res.ok) {
        hidden.value = data.url;
        showPreview(data.url);
      } else {
        errorEl.textContent = data.error || 'Upload failed.';
      }
    } catch (e) {
      errorEl.textContent = 'Could not reach server.';
    }
    zone.classList.remove('uploading');
  }

  zone.addEventListener('click', (e) => {
    if (e.target === removeBtn) return;
    fileInput.click();
  });
  fileInput.addEventListener('change', () => uploadFile(fileInput.files[0]));

  ['dragenter', 'dragover'].forEach(evt =>
    zone.addEventListener(evt, (e) => { e.preventDefault(); zone.classList.add('dragover'); })
  );
  ['dragleave', 'drop'].forEach(evt =>
    zone.addEventListener(evt, (e) => { e.preventDefault(); zone.classList.remove('dragover'); })
  );
  zone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files[0];
    uploadFile(file);
  });

  removeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    clearPreview();
  });

  // expose a setter so edit flows can pre-fill an existing photo
  return {
    setValue(url) {
      hidden.value = url || '';
      if (url) showPreview(url); else clearPreview();
    },
    reset: clearPreview
  };
}

const teamPhotoUploader = setupDropzone({
  zoneId: 'teamPhotoDropzone', fileInputId: 'teamPhotoFile', hiddenInputId: 'teamPhoto',
  previewId: 'teamPhotoPreview', promptId: 'teamPhotoPrompt', removeId: 'teamPhotoRemove', errorId: 'teamPhotoError'
});

const logoUploader = setupDropzone({
  zoneId: 'setLogoDropzone', fileInputId: 'setLogoFile', hiddenInputId: 'setLogo',
  previewId: 'setLogoPreview', promptId: 'setLogoPrompt', removeId: 'setLogoRemove', errorId: 'setLogoError'
});

function escapeHtml(str) {
  return (str || '').replace(/[&<>"']/g, m => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[m]));
}

// ---------- BOOKINGS ----------
async function loadBookings() {
  const listEl = document.getElementById('bookingsList');
  try {
    const res = await fetch('/api/bookings');
    if (!res.ok) throw new Error('failed');
    const bookings = await res.json();
    if (!bookings.length) {
      listEl.innerHTML = '<p style="color:var(--text-soft);">No bookings yet.</p>';
      return;
    }

    const upcoming = bookings.filter(b => b.status !== 'completed');
    const completed = bookings.filter(b => b.status === 'completed');

    function bookingCard(b) {
      const isDone = b.status === 'completed';
      return `
        <div class="admin-card">
          <div class="admin-card-info">
            <h3>
              <span class="order-id-pill">${escapeHtml(b.orderId || '—')}</span>
              ${escapeHtml(b.name)} · ${escapeHtml(b.mobile)}
              ${b.source === 'whatsapp' ? '<span class="status-pill status-whatsapp">WhatsApp</span>' : ''}
              ${b.paymentStatus === 'paid'
                ? '<span class="status-pill status-paid">Paid</span>'
                : '<span class="status-pill status-unpaid">Unpaid</span>'}
              ${isDone ? '<span class="status-pill status-done">Completed</span>' : ''}
            </h3>
            <p>${escapeHtml(b.serviceName)} with ${escapeHtml(b.professionalName)}</p>
            <div class="admin-card-meta">${escapeHtml(b.dateLabel)} at ${escapeHtml(b.time)}${b.notes ? ' · ' + escapeHtml(b.notes) : ''}</div>
          </div>
          <div class="admin-card-actions booking-card-actions">
            ${isDone
              ? `<button class="btn btn-ghost btn-small" onclick="setBookingStatus('${b.id}','upcoming')">Reopen</button>`
              : `<button class="btn btn-primary btn-small" onclick="setBookingStatus('${b.id}','completed')">Mark Completed</button>`
            }
            <button class="btn btn-danger" onclick="cancelBooking('${b.id}')">Cancel</button>
          </div>
        </div>
      `;
    }

    let html = '';
    html += `<div class="bookings-group-label">Upcoming (${upcoming.length})</div>`;
    html += upcoming.length ? upcoming.map(bookingCard).join('') : '<p style="color:var(--text-soft); padding:8px 0 20px;">Nothing upcoming.</p>';
    if (completed.length) {
      html += `<div class="bookings-group-label">Completed (${completed.length})</div>`;
      html += completed.map(bookingCard).join('');
    }
    listEl.innerHTML = html;
  } catch (e) {
    listEl.innerHTML = '<p style="color:var(--text-soft);">Could not load bookings.</p>';
  }
}

window.setBookingStatus = async function(id, status) {
  await fetch('/api/bookings/' + id + '/status', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  });
  loadBookings();
};

window.cancelBooking = async function(id) {
  if (!confirm('Cancel this booking?')) return;
  await fetch('/api/bookings/' + id, { method: 'DELETE' });
  loadBookings();
};

// ---------- SERVICES ----------
async function loadServices() {
  const res = await fetch('/api/services');
  const services = await res.json();
  const listEl = document.getElementById('servicesList');
  if (!services.length) {
    listEl.innerHTML = '<p style="color:var(--text-soft);">No services yet.</p>';
    return;
  }
  listEl.innerHTML = services.map(s => `
    <div class="admin-card">
      <div class="admin-card-info">
        <h3>${escapeHtml(s.name)}</h3>
        <p>${escapeHtml(s.description)}</p>
        <div class="admin-card-meta">${escapeHtml(s.duration)} · ${escapeHtml(s.price)}</div>
      </div>
      <div class="admin-card-actions">
        <button class="btn btn-ghost btn-small" onclick="editService('${s.id}')">Edit</button>
        <button class="btn btn-danger" onclick="deleteService('${s.id}')">Delete</button>
      </div>
    </div>
  `).join('');
}

let allServices = [];
async function refreshServiceCache() {
  const res = await fetch('/api/services');
  allServices = await res.json();
}

window.editService = async function(id) {
  await refreshServiceCache();
  const s = allServices.find(x => x.id === id);
  if (!s) return;
  document.getElementById('serviceId').value = s.id;
  document.getElementById('serviceName').value = s.name;
  document.getElementById('servicePrice').value = s.price;
  document.getElementById('serviceDuration').value = s.duration;
  document.getElementById('serviceDescription').value = s.description;
  document.getElementById('serviceFormTitle').textContent = 'Edit service';
  document.getElementById('serviceSubmitBtn').textContent = 'Save changes';
  document.getElementById('serviceCancelBtn').style.display = 'inline-flex';
  document.getElementById('panel-services').scrollIntoView({ behavior: 'smooth' });
};

window.deleteService = async function(id) {
  if (!confirm('Delete this service?')) return;
  await fetch('/api/services/' + id, { method: 'DELETE' });
  loadServices();
};

document.getElementById('serviceCancelBtn').addEventListener('click', resetServiceForm);

function resetServiceForm() {
  document.getElementById('serviceForm').reset();
  document.getElementById('serviceId').value = '';
  document.getElementById('serviceFormTitle').textContent = 'Add a service';
  document.getElementById('serviceSubmitBtn').textContent = 'Add service';
  document.getElementById('serviceCancelBtn').style.display = 'none';
}

document.getElementById('serviceForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('serviceId').value;
  const payload = {
    name: document.getElementById('serviceName').value,
    price: document.getElementById('servicePrice').value,
    duration: document.getElementById('serviceDuration').value,
    description: document.getElementById('serviceDescription').value
  };
  const msgEl = document.getElementById('serviceMsg');
  try {
    const res = await fetch(id ? '/api/services/' + id : '/api/services', {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      msgEl.textContent = id ? 'Service updated.' : 'Service added.';
      resetServiceForm();
      loadServices();
      setTimeout(() => msgEl.textContent = '', 2500);
    } else {
      msgEl.textContent = 'Something went wrong.';
      msgEl.style.color = 'var(--danger)';
    }
  } catch (e) {
    msgEl.textContent = 'Could not reach server.';
  }
});

// ---------- TEAM ----------
async function loadTeam() {
  const res = await fetch('/api/team');
  const team = await res.json();
  const listEl = document.getElementById('teamList');
  if (!team.length) {
    listEl.innerHTML = '<p style="color:var(--text-soft);">No team members yet.</p>';
    return;
  }
  listEl.innerHTML = team.map(t => `
    <div class="admin-card">
      <div class="admin-card-info">
        <h3>${escapeHtml(t.name)}</h3>
        <p>${escapeHtml(t.role)}</p>
        ${t.photoUrl ? `<div class="admin-card-meta">Photo linked</div>` : ''}
      </div>
      <div class="admin-card-actions">
        <button class="btn btn-ghost btn-small" onclick="editTeam('${t.id}')">Edit</button>
        <button class="btn btn-danger" onclick="deleteTeam('${t.id}')">Delete</button>
      </div>
    </div>
  `).join('');
}

let allTeam = [];
async function refreshTeamCache() {
  const res = await fetch('/api/team');
  allTeam = await res.json();
}

window.editTeam = async function(id) {
  await refreshTeamCache();
  const t = allTeam.find(x => x.id === id);
  if (!t) return;
  document.getElementById('teamId').value = t.id;
  document.getElementById('teamName').value = t.name;
  document.getElementById('teamRoleInput').value = t.role;
  teamPhotoUploader.setValue(t.photoUrl);
  document.getElementById('teamFormTitle').textContent = 'Edit stylist';
  document.getElementById('teamSubmitBtn').textContent = 'Save changes';
  document.getElementById('teamCancelBtn').style.display = 'inline-flex';
  document.getElementById('panel-team').scrollIntoView({ behavior: 'smooth' });
};

window.deleteTeam = async function(id) {
  if (!confirm('Remove this team member?')) return;
  await fetch('/api/team/' + id, { method: 'DELETE' });
  loadTeam();
};

document.getElementById('teamCancelBtn').addEventListener('click', resetTeamForm);

function resetTeamForm() {
  document.getElementById('teamForm').reset();
  document.getElementById('teamId').value = '';
  teamPhotoUploader.reset();
  document.getElementById('teamFormTitle').textContent = 'Add a stylist';
  document.getElementById('teamSubmitBtn').textContent = 'Add stylist';
  document.getElementById('teamCancelBtn').style.display = 'none';
}

document.getElementById('teamForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('teamId').value;
  const payload = {
    name: document.getElementById('teamName').value,
    role: document.getElementById('teamRoleInput').value,
    photoUrl: document.getElementById('teamPhoto').value
  };
  const msgEl = document.getElementById('teamMsg');
  try {
    const res = await fetch(id ? '/api/team/' + id : '/api/team', {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      msgEl.textContent = id ? 'Stylist updated.' : 'Stylist added.';
      resetTeamForm();
      loadTeam();
      setTimeout(() => msgEl.textContent = '', 2500);
    } else {
      msgEl.textContent = 'Something went wrong.';
    }
  } catch (e) {
    msgEl.textContent = 'Could not reach server.';
  }
});

// ---------- SETTINGS ----------
async function loadSettings() {
  const res = await fetch('/api/settings');
  const s = await res.json();
  document.getElementById('setName').value = s.salonName || '';
  document.getElementById('setArea').value = s.area || '';
  document.getElementById('setTagline').value = s.tagline || '';
  document.getElementById('setHeroDesc').value = s.heroDescription || '';
  document.getElementById('setAddress').value = s.address || '';
  document.getElementById('setPhone').value = s.phone || '';
  document.getElementById('setPhoneDisplay').value = s.phoneDisplay || '';
  document.getElementById('setHours').value = s.hours || '';
  document.getElementById('setWaBotNumber').value = s.whatsappBotNumber || '';
  document.getElementById('setDepositEnabled').checked = s.depositEnabled !== false;
  document.getElementById('setDepositAmount').value = s.depositAmount ?? 50;
  updateDepositFieldVisibility();
  logoUploader.setValue(s.logoUrl || '');
}

function updateDepositFieldVisibility() {
  document.getElementById('depositAmountField').style.display =
    document.getElementById('setDepositEnabled').checked ? 'block' : 'none';
}
document.getElementById('setDepositEnabled').addEventListener('change', updateDepositFieldVisibility);

document.getElementById('settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    salonName: document.getElementById('setName').value,
    area: document.getElementById('setArea').value,
    tagline: document.getElementById('setTagline').value,
    heroDescription: document.getElementById('setHeroDesc').value,
    address: document.getElementById('setAddress').value,
    phone: document.getElementById('setPhone').value,
    phoneDisplay: document.getElementById('setPhoneDisplay').value,
    hours: document.getElementById('setHours').value,
    whatsappBotNumber: document.getElementById('setWaBotNumber').value,
    depositEnabled: document.getElementById('setDepositEnabled').checked,
    depositAmount: parseFloat(document.getElementById('setDepositAmount').value) || 50,
    logoUrl: document.getElementById('setLogo').value
  };
  const msgEl = document.getElementById('settingsMsg');
  try {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      msgEl.textContent = 'Settings saved.';
      setTimeout(() => msgEl.textContent = '', 2500);
    } else {
      msgEl.textContent = 'Something went wrong.';
    }
  } catch (e) {
    msgEl.textContent = 'Could not reach server.';
  }
});

checkSession();

// ---------- BOT MESSAGES ----------
const BOT_MESSAGE_FIELDS = [
  { key: 'chooseLanguageBody', label: 'Language picker message', hint: 'Shown before the customer picks a language. No placeholders — keep it trilingual so everyone understands.' },
  { key: 'welcome', label: 'Main menu (welcome message)', hint: 'Placeholders: {salonName}' },
  { key: 'chooseProfessional', label: 'Ask which professional', hint: 'No placeholders. The numbered list is added automatically after this text.' },
  { key: 'noServicesYet', label: 'No services yet (services list)', hint: 'Shown if you haven\'t added any services yet.' },
  { key: 'chooseService', label: 'Ask which service', hint: 'Placeholders: {professionalName}' },
  { key: 'noServicesSetup', label: 'No services (mid-booking)', hint: 'Shown if services are empty partway through booking.' },
  { key: 'chooseDate', label: 'Ask which date', hint: 'No placeholders.' },
  { key: 'noSlotsOnDate', label: 'No time slots available', hint: 'Placeholders: {professionalName}, {dateLabel}' },
  { key: 'chooseTime', label: 'Ask which time', hint: 'Placeholders: {dateLabel}' },
  { key: 'askName', label: "Ask for customer's name", hint: 'Placeholders: {time}, {dateLabel}' },
  { key: 'askNameRetry', label: 'Retry — name too short', hint: 'No placeholders.' },
  { key: 'askMobile', label: 'Ask for mobile number', hint: 'Placeholders: {name}' },
  { key: 'invalidMobile', label: 'Retry — invalid mobile number', hint: 'No placeholders.' },
  { key: 'confirmSummary', label: 'Booking summary + confirm prompt', hint: 'Placeholders: {serviceName}, {professionalName}, {dateLabel}, {time}, {name}, {mobile}' },
  { key: 'bookingSuccess', label: 'Booking confirmed (no deposit)', hint: 'Placeholders: {orderId}' },
  { key: 'bookingSuccessWithDeposit', label: 'Booking confirmed (with deposit link)', hint: 'Placeholders: {orderId}, {amount}, {link}' },
  { key: 'bookingCancelled', label: 'Booking cancelled', hint: 'No placeholders.' },
  { key: 'bookingFailed', label: 'Booking failed', hint: 'Placeholders: {error}' },
  { key: 'confirmYesNoPrompt', label: 'Invalid reply at confirm step', hint: 'No placeholders.' },
  { key: 'servicesListIntro', label: 'Services list header (menu 2)', hint: 'No placeholders. The service list is added automatically after this text.' },
  { key: 'hoursLocationReply', label: 'Hours & location reply (menu 3)', hint: 'Placeholders: {address}, {hours}, {phone}' },
  { key: 'staffReply', label: 'Talk to staff reply (menu 4)', hint: 'Placeholders: {phone}' },
  { key: 'didntCatch', label: 'Invalid main menu choice', hint: 'No placeholders.' },
  { key: 'pleaseReplyNumber', label: 'Invalid numbered-list reply', hint: 'Placeholders: {max}' }
];

let botMessagesData = { en: {}, ta: {}, hi: {} };
let activeBotLang = 'en';

function renderBotMessageFields() {
  const container = document.getElementById('botMessagesFields');
  const langData = botMessagesData[activeBotLang] || {};
  container.innerHTML = BOT_MESSAGE_FIELDS.map(f => `
    <div class="field">
      <label>${escapeHtml(f.label)}</label>
      <textarea data-key="${f.key}" rows="3">${escapeHtml(langData[f.key] || '')}</textarea>
      <div class="field-hint">${escapeHtml(f.hint)}</div>
    </div>
  `).join('');
  container.querySelectorAll('textarea').forEach(ta => {
    ta.addEventListener('input', () => {
      botMessagesData[activeBotLang][ta.dataset.key] = ta.value;
    });
  });
}

document.getElementById('botLangTabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.bot-lang-tab');
  if (!btn) return;
  document.querySelectorAll('.bot-lang-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  activeBotLang = btn.dataset.lang;
  renderBotMessageFields();
});

async function loadBotMessages() {
  const res = await fetch('/api/settings');
  const s = await res.json();
  botMessagesData = s.botMessages || { en: {}, ta: {}, hi: {} };
  renderBotMessageFields();
}

document.getElementById('saveBotMessagesBtn').addEventListener('click', async () => {
  const msgEl = document.getElementById('botMessagesMsg');
  msgEl.textContent = '';
  try {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botMessages: botMessagesData })
    });
    if (res.ok) {
      msgEl.textContent = 'Bot messages saved.';
      setTimeout(() => msgEl.textContent = '', 2500);
    } else {
      msgEl.textContent = 'Something went wrong.';
    }
  } catch (e) {
    msgEl.textContent = 'Could not reach server.';
  }
});

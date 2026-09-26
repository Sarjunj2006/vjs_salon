// Shop Ledger — the "Ledger" tab inside the admin panel.
// Self-contained: it only touches #panel-ledger and only calls /api/ledger/*.
(function () {
  const root = document.getElementById('ledgerRoot');
  const panel = document.getElementById('panel-ledger');
  if (!root || !panel) return;

  const API = '/api/ledger';
  const state = { staff: [], services: [], view: 'entries', from: '', to: '', staffFilter: '', built: false };

  // ---------- helpers ----------
  const todayIST = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const monthStartIST = () => todayIST().slice(0, 8) + '01';
  const money = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel) => root.querySelector(sel);

  async function api(method, path, body) {
    const res = await fetch(API + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  }

  function flash(el, text, isError) {
    el.textContent = text;
    el.style.color = isError ? '#b3261e' : '';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.textContent = ''; }, 3500);
  }

  // ---------- layout (built once) ----------
  function build() {
    state.from = todayIST();
    state.to = todayIST();
    root.classList.add('ledger-root');
    root.innerHTML = `
      <div class="ledger-subtabs">
        <button type="button" class="ledger-subtab ledger-on" data-view="entries">Entries</button>
        <button type="button" class="ledger-subtab" data-view="reports">Reports</button>
        <button type="button" class="ledger-subtab" data-view="setup">Staff &amp; Services</button>
      </div>

      <div class="ledger-filters" id="ledgerFilters">
        <div><label for="ledgerFrom">From</label><input type="date" id="ledgerFrom"></div>
        <div><label for="ledgerTo">To</label><input type="date" id="ledgerTo"></div>
        <div><label for="ledgerStaffFilter">Staff</label><select id="ledgerStaffFilter"></select></div>
        <button type="button" class="btn btn-ghost btn-small" data-range="today">Today</button>
        <button type="button" class="btn btn-ghost btn-small" data-range="month">This month</button>
        <button type="button" class="btn btn-ghost btn-small" data-range="all">All time</button>
      </div>

      <div class="ledger-stats" id="ledgerStats"></div>

      <!-- ENTRIES -->
      <div data-ledger-view="entries">
        <div class="form-card">
          <h3>Add an entry</h3>
          <form id="ledgerEntryForm">
            <div class="form-row">
              <div class="field"><label>Staff</label><select id="ledgerEntryStaff" required></select></div>
              <div class="field"><label>Service</label><select id="ledgerEntryService" required></select></div>
            </div>
            <div class="form-row">
              <div class="field"><label>Price (₹)</label><input type="number" id="ledgerEntryPrice" min="0" step="1" required></div>
              <div class="field"><label>Payment</label>
                <select id="ledgerEntryMethod">
                  <option value="cash">Cash</option><option value="upi">UPI</option>
                  <option value="card">Card</option><option value="other">Other</option>
                </select>
              </div>
            </div>
            <div class="form-row">
              <div class="field"><label>Customer name (optional)</label><input type="text" id="ledgerEntryCustomer"></div>
              <div class="field"><label>Note (optional)</label><input type="text" id="ledgerEntryNote"></div>
            </div>
            <button type="submit" class="btn btn-primary btn-small">Add entry</button>
            <div class="success-msg" id="ledgerEntryMsg"></div>
          </form>
        </div>
        <div class="ledger-table-wrap"><table class="ledger-table">
          <thead><tr><th>Date</th><th>Time</th><th>Staff</th><th>Service</th><th>Customer</th><th>Paid by</th><th class="ledger-num">Amount</th><th></th></tr></thead>
          <tbody id="ledgerEntriesBody"></tbody>
        </table></div>
      </div>

      <!-- REPORTS -->
      <div data-ledger-view="reports" hidden>
        <div class="ledger-two-col">
          <div>
            <div class="ledger-section-title">By staff</div>
            <div class="ledger-table-wrap"><table class="ledger-table">
              <thead><tr><th>Staff</th><th class="ledger-num">Services</th><th class="ledger-num">Total</th></tr></thead>
              <tbody id="ledgerByStaff"></tbody>
            </table></div>
          </div>
          <div>
            <div class="ledger-section-title">By service</div>
            <div class="ledger-table-wrap"><table class="ledger-table">
              <thead><tr><th>Service</th><th class="ledger-num">Count</th><th class="ledger-num">Total</th></tr></thead>
              <tbody id="ledgerByService"></tbody>
            </table></div>
          </div>
        </div>
      </div>

      <!-- SETUP -->
      <div data-ledger-view="setup" hidden>
        <div class="ledger-two-col">
          <div class="form-card">
            <h3>Staff</h3>
            <div class="ledger-table-wrap"><table class="ledger-table"><tbody id="ledgerStaffList"></tbody></table></div>
            <form id="ledgerStaffForm" class="ledger-inline">
              <input type="text" id="ledgerNewStaff" placeholder="New staff name" required>
              <button type="submit" class="btn btn-primary btn-small">Add</button>
            </form>
            <p class="ledger-note">Tip: mark staff who left as inactive instead of deleting them.</p>
            <div class="success-msg" id="ledgerStaffMsg"></div>
          </div>
          <div class="form-card">
            <h3>Ledger services &amp; prices</h3>
            <div class="ledger-table-wrap"><table class="ledger-table"><tbody id="ledgerServiceList"></tbody></table></div>
            <form id="ledgerServiceForm" class="ledger-inline">
              <input type="text" id="ledgerNewServiceName" placeholder="Service name" required>
              <input type="number" id="ledgerNewServicePrice" placeholder="Price" min="0" step="1" required>
              <button type="submit" class="btn btn-primary btn-small">Add</button>
            </form>
            <p class="ledger-note">These are only for the ledger — separate from the website's Services tab.</p>
            <div class="success-msg" id="ledgerServiceMsg"></div>
          </div>
        </div>

        <div class="form-card">
          <h3>Staff entry page</h3>
          <p class="ledger-note" style="margin-bottom:10px;">Staff open this link on their phone and log in with the staff password to add entries. They cannot see totals or anything else in the admin panel.</p>
          <div class="ledger-copy-row">
            <code id="ledgerStaffLink"></code>
            <button type="button" class="btn btn-ghost btn-small" id="ledgerCopyLink">Copy link</button>
          </div>
          <form id="ledgerPwForm" class="ledger-inline" style="margin-top:16px;">
            <input type="password" id="ledgerNewPw" placeholder="New staff password" minlength="4" required autocomplete="new-password">
            <button type="submit" class="btn btn-primary btn-small">Change staff password</button>
          </form>
          <div class="success-msg" id="ledgerPwMsg"></div>
        </div>
      </div>
    `;

    $('#ledgerFrom').value = state.from;
    $('#ledgerTo').value = state.to;
    $('#ledgerStaffLink').textContent = location.origin + '/ledger/staff.html';

    // sub-tab switching
    root.querySelectorAll('.ledger-subtab').forEach((btn) => {
      btn.addEventListener('click', () => showView(btn.dataset.view));
    });

    // filters
    $('#ledgerFrom').addEventListener('change', (e) => { state.from = e.target.value; refreshData(); });
    $('#ledgerTo').addEventListener('change', (e) => { state.to = e.target.value; refreshData(); });
    $('#ledgerStaffFilter').addEventListener('change', (e) => { state.staffFilter = e.target.value; refreshData(); });
    root.querySelectorAll('[data-range]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const r = btn.dataset.range;
        state.from = r === 'all' ? '' : r === 'month' ? monthStartIST() : todayIST();
        state.to = r === 'all' ? '' : todayIST();
        $('#ledgerFrom').value = state.from;
        $('#ledgerTo').value = state.to;
        refreshData();
      });
    });

    // add entry: service picks its default price
    $('#ledgerEntryService').addEventListener('change', (e) => {
      const s = state.services.find((x) => x.id === e.target.value);
      if (s) $('#ledgerEntryPrice').value = s.price;
    });
    $('#ledgerEntryForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = $('#ledgerEntryMsg');
      try {
        await api('POST', '/entries', {
          staffId: $('#ledgerEntryStaff').value,
          serviceId: $('#ledgerEntryService').value,
          price: Number($('#ledgerEntryPrice').value),
          paymentMethod: $('#ledgerEntryMethod').value,
          customerName: $('#ledgerEntryCustomer').value,
          note: $('#ledgerEntryNote').value,
        });
        $('#ledgerEntryCustomer').value = '';
        $('#ledgerEntryNote').value = '';
        flash(msg, 'Entry added.');
        refreshData();
      } catch (err) { flash(msg, err.message, true); }
    });

    // delete entry
    $('#ledgerEntriesBody').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-del-entry]');
      if (!btn || !confirm('Delete this entry? This cannot be undone.')) return;
      try { await api('DELETE', '/entries/' + btn.dataset.delEntry); refreshData(); }
      catch (err) { alert(err.message); }
    });

    // staff management
    $('#ledgerStaffForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('POST', '/staff', { name: $('#ledgerNewStaff').value });
        $('#ledgerNewStaff').value = '';
        flash($('#ledgerStaffMsg'), 'Staff added.');
        await loadLists();
      } catch (err) { flash($('#ledgerStaffMsg'), err.message, true); }
    });
    $('#ledgerStaffList').addEventListener('click', async (e) => {
      const toggle = e.target.closest('[data-toggle-staff]');
      const del = e.target.closest('[data-del-staff]');
      try {
        if (toggle) {
          const s = state.staff.find((x) => x.id === toggle.dataset.toggleStaff);
          await api('PATCH', '/staff/' + s.id, { active: !s.active });
        } else if (del) {
          if (!confirm('Delete this staff member? Their old entries stay in the ledger.')) return;
          await api('DELETE', '/staff/' + del.dataset.delStaff);
        } else return;
        await loadLists();
      } catch (err) { flash($('#ledgerStaffMsg'), err.message, true); }
    });

    // service management
    $('#ledgerServiceForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('POST', '/services', { name: $('#ledgerNewServiceName').value, price: Number($('#ledgerNewServicePrice').value) });
        $('#ledgerNewServiceName').value = '';
        $('#ledgerNewServicePrice').value = '';
        flash($('#ledgerServiceMsg'), 'Service added.');
        await loadLists();
      } catch (err) { flash($('#ledgerServiceMsg'), err.message, true); }
    });
    $('#ledgerServiceList').addEventListener('click', async (e) => {
      const save = e.target.closest('[data-save-service]');
      const del = e.target.closest('[data-del-service]');
      try {
        if (save) {
          const input = root.querySelector(`[data-price-for="${save.dataset.saveService}"]`);
          await api('PATCH', '/services/' + save.dataset.saveService, { price: Number(input.value) });
          flash($('#ledgerServiceMsg'), 'Price updated.');
        } else if (del) {
          if (!confirm('Delete this service? Old entries keep their service name.')) return;
          await api('DELETE', '/services/' + del.dataset.delService);
        } else return;
        await loadLists();
      } catch (err) { flash($('#ledgerServiceMsg'), err.message, true); }
    });

    // staff link + password
    $('#ledgerCopyLink').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText($('#ledgerStaffLink').textContent); flash($('#ledgerPwMsg'), 'Link copied.'); }
      catch { flash($('#ledgerPwMsg'), 'Copy failed — select the link and copy it manually.', true); }
    });
    $('#ledgerPwForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('PUT', '/staff-password', { newPassword: $('#ledgerNewPw').value });
        $('#ledgerNewPw').value = '';
        flash($('#ledgerPwMsg'), 'Staff password changed. Tell your staff the new one.');
      } catch (err) { flash($('#ledgerPwMsg'), err.message, true); }
    });

    state.built = true;
  }

  function showView(view) {
    state.view = view;
    root.querySelectorAll('.ledger-subtab').forEach((b) => b.classList.toggle('ledger-on', b.dataset.view === view));
    root.querySelectorAll('[data-ledger-view]').forEach((v) => { v.hidden = v.dataset.ledgerView !== view; });
    const showFilters = view !== 'setup';
    $('#ledgerFilters').hidden = !showFilters;
    $('#ledgerStats').hidden = !showFilters;
  }

  // ---------- data ----------
  async function loadLists() {
    [state.staff, state.services] = await Promise.all([api('GET', '/staff'), api('GET', '/services')]);

    const active = state.staff.filter((s) => s.active);
    $('#ledgerEntryStaff').innerHTML = active.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
    $('#ledgerStaffFilter').innerHTML = '<option value="">All staff</option>' +
      state.staff.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
    $('#ledgerStaffFilter').value = state.staffFilter;

    const svcSelect = $('#ledgerEntryService');
    const prev = svcSelect.value;
    svcSelect.innerHTML = state.services.map((s) => `<option value="${esc(s.id)}">${esc(s.name)} — ${money(s.price)}</option>`).join('');
    if (prev && state.services.some((s) => s.id === prev)) svcSelect.value = prev;
    const chosen = state.services.find((s) => s.id === svcSelect.value);
    if (chosen && !$('#ledgerEntryPrice').value) $('#ledgerEntryPrice').value = chosen.price;

    $('#ledgerStaffList').innerHTML = state.staff.length ? state.staff.map((s) => `
      <tr>
        <td>${esc(s.name)} ${s.active ? '' : '<span class="ledger-muted">(inactive)</span>'}</td>
        <td class="ledger-num">
          <button type="button" class="ledger-link-btn ledger-plain" data-toggle-staff="${esc(s.id)}">${s.active ? 'Mark inactive' : 'Mark active'}</button>
          &nbsp;·&nbsp;
          <button type="button" class="ledger-link-btn" data-del-staff="${esc(s.id)}">Delete</button>
        </td>
      </tr>`).join('') : '<tr><td class="ledger-empty">No staff yet.</td></tr>';

    $('#ledgerServiceList').innerHTML = state.services.length ? state.services.map((s) => `
      <tr>
        <td>${esc(s.name)}</td>
        <td class="ledger-num"><div class="ledger-inline" style="justify-content:flex-end;">
          <input type="number" min="0" step="1" value="${Number(s.price)}" data-price-for="${esc(s.id)}">
          <button type="button" class="ledger-link-btn ledger-plain" data-save-service="${esc(s.id)}">Save</button>
          <button type="button" class="ledger-link-btn" data-del-service="${esc(s.id)}">Delete</button>
        </div></td>
      </tr>`).join('') : '<tr><td class="ledger-empty">No services yet.</td></tr>';
  }

  function query() {
    const p = new URLSearchParams();
    if (state.from) p.set('from', state.from);
    if (state.to) p.set('to', state.to);
    if (state.staffFilter) p.set('staffId', state.staffFilter);
    return p.toString() ? '?' + p.toString() : '';
  }

  async function refreshData() {
    try {
      const entries = await api('GET', '/entries' + query());
      renderEntries(entries);
      renderStats(entries);
      renderReports(entries);
    } catch (err) {
      $('#ledgerEntriesBody').innerHTML = `<tr><td colspan="8" class="ledger-empty">${esc(err.message)}</td></tr>`;
    }
  }

  function renderEntries(entries) {
    $('#ledgerEntriesBody').innerHTML = entries.length ? entries.map((e) => `
      <tr>
        <td>${esc(e.date)}</td>
        <td class="ledger-muted">${esc(e.time)}</td>
        <td>${esc(e.staffName)}</td>
        <td>${esc(e.serviceName)}${e.note ? `<div class="ledger-muted" style="font-size:0.8rem;">${esc(e.note)}</div>` : ''}</td>
        <td>${esc(e.customerName) || '<span class="ledger-muted">—</span>'}</td>
        <td><span class="ledger-method">${esc(e.paymentMethod)}</span></td>
        <td class="ledger-num">${money(e.price)}</td>
        <td><button type="button" class="ledger-link-btn" data-del-entry="${esc(e.id)}">Delete</button></td>
      </tr>`).join('') : '<tr><td colspan="8" class="ledger-empty">No entries for this period.</td></tr>';
  }

  function renderStats(entries) {
    const sum = (m) => entries.filter((e) => !m || e.paymentMethod === m).reduce((t, e) => t + e.price, 0);
    const card = (label, value) => `<div class="ledger-stat"><div class="ledger-stat-label">${label}</div><div class="ledger-stat-value">${value}</div></div>`;
    $('#ledgerStats').innerHTML =
      card('Total', money(sum())) + card('Services', entries.length) +
      card('Cash', money(sum('cash'))) + card('UPI', money(sum('upi'))) + card('Card', money(sum('card')));
  }

  function renderReports(entries) {
    const group = (key) => {
      const out = {};
      for (const e of entries) {
        out[e[key]] = out[e[key]] || { count: 0, total: 0 };
        out[e[key]].count += 1;
        out[e[key]].total += e.price;
      }
      return Object.entries(out).sort((a, b) => b[1].total - a[1].total);
    };
    const rows = (list) => list.length
      ? list.map(([name, v]) => `<tr><td>${esc(name)}</td><td class="ledger-num">${v.count}</td><td class="ledger-num">${money(v.total)}</td></tr>`).join('')
      : '<tr><td colspan="3" class="ledger-empty">No entries for this period.</td></tr>';
    $('#ledgerByStaff').innerHTML = rows(group('staffName'));
    $('#ledgerByService').innerHTML = rows(group('serviceName'));
  }

  async function open() {
    if (!state.built) build();
    try { await loadLists(); } catch (err) { root.querySelector('#ledgerStaffMsg').textContent = err.message; }
    refreshData();
  }

  // ---------- hook into the admin panel's tabs ----------
  document.querySelectorAll('.admin-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      if (tab.dataset.tab !== 'ledger') { panel.classList.remove('active'); return; }
      document.querySelectorAll('.admin-tab').forEach((t) => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.admin-panel').forEach((p) => p.classList.toggle('active', p === panel));
      open();
    });
  });
})();

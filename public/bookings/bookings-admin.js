// Admin panel → Settings tab → "Bookings page" card.
// Lets the owner set the password for the separate /bookings/ page.
(function () {
  const card = document.getElementById('bkAdminCard');
  if (!card) return;
  const API = '/api/bookings-view';
  const $ = (id) => document.getElementById(id);

  $('bkAdminLink').textContent = location.origin + '/bookings/';

  async function refreshStatus() {
    try {
      const res = await fetch(API + '/status');
      if (!res.ok) return;
      const { passwordSet } = await res.json();
      $('bkAdminStatus').textContent = passwordSet
        ? 'A password is set. Setting a new one replaces it.'
        : 'No password yet — the bookings page stays locked until you set one.';
    } catch {}
  }

  function show(text, isError) {
    const el = $('bkAdminMsg');
    el.textContent = text;
    el.style.color = isError ? '#b3261e' : '';
    setTimeout(() => { el.textContent = ''; }, 4000);
  }

  $('bkAdminForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(API + '/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: $('bkAdminPw').value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save.');
      $('bkAdminPw').value = '';
      show('Bookings password saved.');
      refreshStatus();
    } catch (err) { show(err.message, true); }
  });

  $('bkAdminCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('bkAdminLink').textContent); show('Link copied.'); }
    catch { show('Copy failed — select the link and copy it manually.', true); }
  });

  // Load status when the Settings tab is opened (and once now, in case already logged in).
  document.querySelectorAll('.admin-tab[data-tab="settings"]').forEach((t) => t.addEventListener('click', refreshStatus));
  refreshStatus();
})();

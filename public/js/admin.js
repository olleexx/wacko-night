import { api, $, show } from './api.js';
const login = $('#login'), panel = $('#panel'), msg = $('#msg'), form = $('#settings');
const fields = ['name', 'date', 'startTime', 'venue', 'price', 'totalTickets', 'maxPerOrder', 'contactEmail'];
async function open() {
  const [s, st] = await Promise.all([api('/api/admin/settings'), api('/api/admin/stats')]);
  login.hidden = true; panel.hidden = false;
  fields.forEach(k => form.elements[k].value = s[k] ?? '');
  form.elements.salesOpen.checked = !!s.salesOpen;
  for (const k in st) { const el = $('#st-' + k); if (el) el.textContent = st[k] ?? '—'; }
}
try { await open(); } catch { login.hidden = false; }
login.addEventListener('submit', async e => {
  e.preventDefault();
  try { await api('/api/admin/login', { method: 'POST', body: { password: login.elements.password.value } }); login.reset(); await open(); show(msg, ''); }
  catch (err) { show(msg, err.message); }
});
form.addEventListener('submit', async e => {
  e.preventDefault();
  const body = { salesOpen: form.elements.salesOpen.checked };
  fields.forEach(k => { const v = form.elements[k].value.trim(); body[k] = v === '' ? null : (['price', 'totalTickets', 'maxPerOrder'].includes(k) ? Number(v) : v); });
  if (body.salesOpen && !(body.totalTickets > 0)) return show(msg, 'Set the total ticket quantity before opening sales.', 'warn');
  try { await api('/api/admin/settings', { method: 'PUT', body }); show(msg, 'Settings saved.', 'ok'); await open(); }
  catch (err) { show(msg, err.message); }
});
$('#logout').addEventListener('click', async e => { e.preventDefault(); await api('/api/admin/logout', { method: 'POST' }).catch(() => {}); location.reload(); });

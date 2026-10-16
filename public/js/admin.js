import { api, $, show, setBusy } from './api.js';
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
  const btn = login.querySelector('button'); setBusy(btn, true);
  try { await api('/api/admin/login', { method: 'POST', body: { password: login.elements.password.value } }); login.reset(); await open(); show(msg, ''); }
  catch (err) { show(msg, err.message); }
  finally { setBusy(btn, false); }
});
form.addEventListener('submit', async e => {
  e.preventDefault();
  const body = { salesOpen: form.elements.salesOpen.checked };
  fields.forEach(k => { const v = form.elements[k].value.trim(); body[k] = v === '' ? null : (['price', 'totalTickets', 'maxPerOrder'].includes(k) ? Number(v) : v); });
  if (body.salesOpen && !(body.totalTickets > 0)) return show(msg, 'Set the total ticket quantity before opening sales.', 'warn');
  const btn = form.querySelector('button'); setBusy(btn, true);
  try { await api('/api/admin/settings', { method: 'PUT', body }); show(msg, 'Settings saved.', 'ok'); await open(); }
  catch (err) { show(msg, err.message); }
  finally { setBusy(btn, false); }
});
$('#logout').addEventListener('click', async e => { e.preventDefault(); await api('/api/admin/logout', { method: 'POST' }).catch(() => {}); location.reload(); });

const manual = $('#manual');
manual.addEventListener('submit', async e => {
  e.preventDefault();
  const note = manual.elements.note.value.trim();
  const entries = manual.elements.rows.value.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const [name, email, qty, amt] = l.split(/\t|,/).map(s => s.trim());
    return { name, email, quantity: qty ? Number(qty) : 1, amount: amt ? Number(amt) : undefined, note };
  });
  const send = allowDuplicates => api('/api/admin/orders/manual', {
    method: 'POST', body: { entries, sendEmail: manual.elements.sendEmail.checked, allowDuplicates }
  });
  const btn = manual.querySelector('button'); setBusy(btn, true);
  try {
    let r;
    try { r = await send(false); }
    catch (err) { if (err.status === 409 && confirm(err.message + '\n\nIssue anyway?')) r = await send(true); else throw err; }
    show(msg, `Issued ${r.tickets} ticket(s) to ${r.created} order(s).` + (r.emailsPending ? ` ${r.emailsPending} email(s) not sent yet and will be retried.` : ''), 'ok');
    manual.reset(); await open();
  } catch (err) { show(msg, err.message); }
  finally { setBusy(btn, false); }
});